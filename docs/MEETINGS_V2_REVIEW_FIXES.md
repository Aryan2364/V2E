# Meetings v2 — Adversarial Review & Fixes

**Date:** 2026-07-17
**Scope reviewed:** opt-out attendance · rhythms (recurring meetings) · busy view · creator-only governance
**Nature:** Read-only adversarial review, followed by fixes for every confirmed defect.

This document records **what was found, what was changed, and why** — so the next
person doesn't have to re-derive the reasoning. Every fix is a behavioural or
security correction; none change the intended product model (attendance stays
opt-out, governance stays creator-only, the organiser still picks the time).

---

## Files touched

| File | Change |
|------|--------|
| `backend/src/meetings/meetings.service.ts` | Busy-view row-level auth; decision-log scoping; reminder un-latch on reschedule; empty-attendance stamp guard |
| `backend/src/meetings/meetings.controller.ts` | Pass the caller (actor) into the decision log so it can be scoped |
| `backend/src/meetings/meetings-reports.service.ts` | Stop counting the organiser as a no-show in attendance rates |
| `backend/src/meetings/meeting-rhythms.service.ts` | Retire orphaned future instances when a rhythm's cadence is narrowed |
| `backend/src/scheduler/scheduler.service.ts` | Fix `rhythm_spawn_date` off-by-one under +UTC timezones |
| `backend/prisma/seed-data.sql` | Bring meeting/attendee seed rows in line with the v2 schema |

Backend `tsc --noEmit` passes after all changes.

---

## Findings & fixes (most severe first)

### 1. 🔴 CRITICAL — Busy view leaked any colleague's calendar + leave (IDOR)

**Where:** `meetings.service.ts` → `busyView()` (endpoint `POST …/meetings/busy`)

**The bug:** the method accepted an arbitrary `user_ids[]` and returned, per user,
their meeting titles/times, **leave windows including leave state** (approved/pending),
and holidays — with **no row-level authorization** on the requested users. The only
gate was `@RequirePermission(meetings, read)`, which `backend/AUTHORIZATION.md`
explicitly says is *not* row-level auth. Any authenticated meetings-reader could
enumerate the entire org's calendars and HR leave data by iterating user ids.

**The fix:** clamp the requested users to the caller's **read scope over meetings**
before querying anything. Reused the existing scope toolkit
(`ScopeService.resolveListScope` + `visibleUserIds`) exactly as the list/report paths
do. Out-of-scope ids are dropped silently (fail-closed, no leak) rather than 403-ing
the whole request, so the slot-picker still works for the people you *can* see. A
caller with no read scope at all gets an empty result.

**Why this way:** AUTHORIZATION.md mandates gating the *specific rows/participants*,
never just `organization_id`, and mandates reusing the scope toolkit rather than
hand-rolling auth. `own` scope naturally includes the caller themselves.

---

### 2. 🔴 HIGH — Org-wide decision log exposed every meeting's decisions

**Where:** `meetings.service.ts` → `listDecisions()` (endpoint `GET …/meetings/decisions`)

**The bug:** the decision log was called **without the caller** and filtered only by
`organization_id`, so any meetings-reader could read the full decision text of every
meeting in the org — including leadership meetings they were never on. Every *other*
meeting read (`list`, `getOne`, governance report) is scope-gated; this one wasn't.

**The fix:** a decision is a sub-resource of a meeting, so it now inherits the
meeting's row-level visibility. `listDecisions` takes the actor and applies
`ScopeService.listWhere(orgId, principal, 'meetings')` nested under the parent
`meeting` relation. Fails closed (the toolkit returns a match-nothing fragment when
the caller is denied). The controller now passes `actorOf(req)`.

---

### 3. 🟠 MEDIUM — Rescheduling after the reminder fired stranded attendees

**Where:** `meetings.service.ts` → `update()`; reminder engine in `scheduler.service.ts`

**The bug:** `reminder_sent` was a one-way latch set once by the 15-minute reminder
engine. If a meeting was moved to a later time (or a different day) *after* its
reminder had already fired, the latch stayed `true` and **no reminder was ever sent
for the new time**. Under opt-out — where nobody chose the time — that silently
strands people. The `meeting_updated` notice fires at edit time, not near the start.

**The fix:** when `update()` detects that `scheduled_start` actually changed (it's
already in the `NOTIFY_ON_CHANGE` set used to re-notify attendees), it now resets
`reminder_sent = false`, so the new time gets its own day-of heads-up. Harmless if
the new time is in the past (the engine only notifies for still-upcoming meetings).

---

### 4. 🟠 MEDIUM — Narrowing a rhythm's cadence orphaned future meetings

**Where:** `meeting-rhythms.service.ts` → `update()` / `propagateToFutureInstances()`

**The bug:** editing a rhythm only **re-timed** future untouched instances; it never
**removed** instances whose day no longer fires under the new pattern. Change a
*daily* rhythm to *weekly* and ~30 stray daily meetings stayed live on everyone's
calendars (and counted toward `after_n`).

**The fix:** `propagateToFutureInstances` now receives the new schedule entry (only
when the cadence actually changed). For each future, still-scheduled, **untouched**
instance, it re-checks `shouldEntryFireToday` under the new pattern; if the day no
longer fires, the instance is soft-deleted (`deletion_reason: 'Rhythm cadence
changed'`). The re-spawn step then refills the now-correct days.

**Guards preserved:** manually-moved instances stay frozen (unchanged); the fire
probe zeroes `occurrence_count` so an `after_n` cap can't mislabel a genuinely
matching day as invalid, while `start_date`/`end_date` filtering stays active (so
narrowing the window legitimately removes out-of-range instances). Declines on
surviving instances are still never overwritten.

---

### 5. 🟠 MEDIUM — Stale seed snapshot broke `prisma db seed` / `migrate reset`

**Where:** `backend/prisma/seed-data.sql` (restored by `prisma/seed-restore.ts`)

**The bug:** the committed data snapshot still inserted into columns/values dropped
by this migration — `meetings.mode`, `poll_window_*`, `poll_duration_min`,
`meeting_attendees.reschedule_at/reschedule_note`, and `response` values
`'accepted'`/`'pending'`. Any teammate running the documented
`migrate deploy → db seed`, or any `migrate reset`, would fail on
`column "mode" ... does not exist`.

**The fix:** rewrote the `meetings` and `meeting_attendees` INSERTs to the v2 schema
via a column-aware transform (`scratchpad/fix-seed.js`): dropped the removed columns
and remapped the response enum (`accepted`/`pending` → `attending`,
`rejected`/`reschedule_requested` → `declined`), matching the migration's own remap.
`is_required` is omitted so it takes its `DEFAULT true`. The empty `meeting_slots` /
`meeting_slot_votes` sections are comment-only headers and are harmless.

---

### 6. 🟡 MEDIUM — Governance counted the organiser as a no-show

**Where:** `meetings-reports.service.ts` → `analytics()` and `report()`

**The bug:** attendance rates were computed over `expected` = **all** non-declined
attendees, *including the organiser*, whose `attended` defaults `false` and is only
set if they explicitly tick their own row. So an organiser who recorded attendance
for the room but not themselves was counted absent — dragging `attendance_rate` down
and inflating `no_show_rate`. `by_person` already excluded the organiser, so the
top-line rate and the per-person table disagreed.

**The fix:** attendance metrics (`expected`, `attended`, `late`, `no_show`, and the
aggregate `expectedRecorded`/`attendedRecorded`/`noShowRecorded`) are now computed
over the **roster** (non-organiser) only — consistent with `by_person`. The organiser
runs the meeting and takes attendance; they are no longer a candidate no-show.

---

### 7. 🟡 LOW–MEDIUM — Empty attendance submission flipped everyone to no-show

**Where:** `meetings.service.ts` → `markAttendance()`

**The bug:** `markAttendance` stamped `attendance_taken_at` even for an empty
`rows[]`. Once stamped, governance reads every non-declined attendee (all still
`attended=false`) as a no-show — a full room of false absences.

**The fix:** only stamp `attendance_taken_at` when `rows.length > 0`, so "recorded"
genuinely means attendance was taken.

---

### 8. 🟢 LOW — `rhythm_spawn_date` off-by-one under +UTC timezones

**Where:** `scheduler.service.ts` → `materialiseRhythmMeeting()`

**The bug:** `rhythm_spawn_date` is `@db.Date` (stores the UTC calendar date) but was
built from **local midnight**. On a +UTC server (e.g. IST, UTC+5:30), local midnight
is the previous day in UTC, so the stored spawn-day was one day behind the
instance's actual `scheduled_start` day. Dedupe stayed internally consistent (no
double-spawn), but the key desynced from the meeting's real date — a latent trap.

**The fix:** anchor the spawn day at **UTC-noon of the instance's local calendar
day** (`Date.UTC(y, m, d, 12, 0, 0)`), so the stored `@db.Date` matches
`scheduled_start`'s day in any timezone. Safe to change (local DB has no rhythm
instances yet).

---

## What was checked and found correct (not changed)

- **Opt-out reads are consistent** across the reminder engine, conflict detection,
  busy view, and analytics — everywhere uses `response !== 'declined'` (non-declined
  = attending). No `accepted`/`pending`/RSVP/poll logic survives in the live path.
- **Governance ceiling** is a scope constant (`GOVERNANCE_SCOPE_CEILING = own`), not
  an `if creator` branch; it clamps a broad configured scope down to creator-only and
  fails closed. `filters.user`/`department` narrow within scope and cannot widen it.
- **`after_n`** is measured by a live `COUNT` of spawned instances, so the 60-day
  cron, create/resume top-ups, and the replay engine can't double-count; holiday days
  `continue` before materialise so they don't consume a count.
- **Migration enum remap** is explicit and non-stranding on a populated DB, folds
  reschedule intent into `reject_reason`, and fully drops the poll tables/enums with
  no dangling code references (only the seed snapshot, now fixed).
- **Replay vs real-time** rhythm spawning is mutually exclusive by `is_test`, so the
  horizon-0 replay path and the 60-day cron never overlap.

---

## Verdict

The build was faithful to the opt-out / rhythm / creator-only-governance intent and
its "don't silently lie" defenses were largely well built. The blocking problems were
**two cross-user data leaks** (busy view, decision log) that `AUTHORIZATION.md` exists
specifically to prevent, plus several correctness/governance-integrity bugs. All are
now fixed and the backend typechecks clean. Recommended follow-up before release: a
focused integration test that a non-creator, out-of-scope user gets an empty busy view
and empty decision log for people/meetings they have no scope over.
