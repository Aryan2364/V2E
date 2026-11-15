# Adversarial test brief — Meetings v2 (opt-out attendance · rhythms · busy view · governance)

You are reviewing a just-completed feature build in this repo. **Do not trust this brief's
description of the code — verify everything against the actual files.** Read-only: do not
change code. Your job is to find what is WRONG, unsafe, or spec-violating — not to confirm it
works. A rubber stamp is a failed review. Cite every finding as `file:line` with a concrete
failure scenario (inputs → wrong result), and rank by severity. If you can run the app / DB /
tests to prove a defect, do so.

## Stack & where to look
- Backend: NestJS + Prisma (Postgres). Frontend: Next.js 14 App Router + Tailwind.
- Backend: `backend/src/meetings/**`, `backend/src/scheduler/scheduler.service.ts`,
  `backend/src/clock/replay.service.ts`, `backend/prisma/schema.prisma`,
  `backend/prisma/migrations/20260717093000_meetings_v2_opt_out_rhythms/migration.sql`.
- Frontend: `frontend/app/dashboard/governance/meetings/**`, `frontend/components/meetings/**`,
  `frontend/lib/api/meetings.ts`, `frontend/lib/types/meetings.ts`.
- Authoritative rules: `backend/AUTHORIZATION.md` (row-level auth), `DESIGN_RULES.md` (UI).

## Product intent it MUST satisfy (test against these, not against the code's own comments)
1. **Attendance is opt-out and non-negotiable.** Being on a meeting = attending by default.
   The ONLY opt-out is "can't make it" + a required reason. There must be NO accept step, NO
   asking the room for timings, NO poll/vote anywhere in the live path. A blank/never-answered
   attendee must never read as anything other than "attending".
2. **The organiser picks the time; the system may suggest but must never decide it.**
3. **Rhythms** = recurring meetings. Occurrences are materialised ahead of time. A holiday
   occurrence is SKIPPED (never slid to another day). Editing a rhythm must touch ONLY future,
   still-scheduled, untouched occurrences; past/held/cancelled/manually-moved ones are frozen;
   `after_n` must not silently restart on edit.
4. **Governance is creator-only in v1**, expressed through the scope machinery (not a hardcoded
   `if creator`), so widening to the reporting hierarchy later is a one-place scope change.
   Attendance rates must never count a meeting whose attendance was never recorded as no-shows.
5. **Nothing may silently lie**: an absence with no trace, a blank that reads as a pass, a rate
   backed by meetings that weren't graded, a count not backed by real rows.

## High-value hotspots to attack (find the bug, don't assume it's handled)
- **Opt-out read-sites — hunt for a missed one.** Grep the whole backend for `accepted`,
  `pending`, `reschedule`, `'declined'`, `response`. Every place that decides "who is coming"
  (reminder engine, analytics, aggregate report, conflict detection, busy view) must treat
  non-declined as attending. One missed site is a silent break. Confirm `expected`/roster
  treat the organiser consistently across per-meeting analytics AND the aggregate/by-person
  report (is the organiser double-counted or dropped inconsistently?).
- **Busy view authorization / privacy.** `POST …/meetings/busy` accepts an arbitrary
  `user_ids[]`. Can any authenticated meetings-reader enumerate ANY colleague's meetings, leave,
  and holidays across the org? Is there a scope/participation check on the requested users, or
  is this an information-leak (calendar/leave enumeration)? Weigh against AUTHORIZATION.md.
- **Rhythm `after_n` counting.** Create a rhythm ending after N; run the spawner twice (and via
  the 60-day horizon). Do you get exactly N instances or more? Does a holiday-skipped day wrongly
  consume a count? Does a soft-deleted occurrence free or block a slot — and is that intended?
- **Edit-freeze correctness.** Prove: (a) editing schedule does NOT reset `occurrence_count`
  / restart `after_n`; (b) a manually-moved future instance is left frozen; (c) a decline on a
  future instance is not wiped when the roster re-syncs; (d) narrowing a cadence (daily→weekly)
  — what happens to already-spawned now-invalid future instances? Is the result defensible?
- **Timezone / @db.Date.** `rhythm_spawn_date` is `@db.Date`; spawn builds times with
  `setHours` on a local day. Check for off-by-one / DST drift between the stored spawn date, the
  dedupe unique index `(rhythm_id, rhythm_spawn_date)`, and the instance's `scheduled_start`.
- **Reminder one-shot latch.** `reminder_sent` fires once. If a meeting is moved later after the
  reminder already went out, does anyone get re-reminded? Is the `meeting_updated` notification a
  sufficient substitute, or is there a gap where an attendee is stranded?
- **Governance scope ceiling.** Verify a user with a broad configured scope (team/org) is still
  clamped to creator-only; a non-creator attendee cannot see governance for a meeting they only
  attend; fail-closed when the caller has no read scope; and that `filters.user` / `department`
  narrow WITHIN scope and can't be abused to widen it (IDOR).
- **Migration safety.** Read the migration SQL. Is the enum remap correct and non-stranding on a
  POPULATED db (not just the empty one)? Does `prisma migrate status` show drift? Does the
  schema match the generated client? Are the dropped poll enums/tables fully removed with no
  dangling FK/reference anywhere in code?
- **Replay / simulated clock.** Confirm rhythm spawning in `ReplayService` (horizon 0, day-of)
  can't double-spawn or double-count `after_n` versus the real-time 60-day cron.
- **Dead code / references.** Any lingering references to removed symbols (poll, slots, votes,
  `mode`, `polling`, `respond`, `reschedule_requested`, removed notification events) in backend
  or frontend? Any endpoint still reachable that shouldn't exist?
- **UI vs DESIGN_RULES.** Native `<input type="date">`/`type="time"` anywhere (forbidden — must
  use shared DatePicker/TimeField)? Dropdowns/panels that clip or overflow their parent (busy
  panel, attendee picker inside modals)? Modals that don't portal? Copy that still implies a
  choice the model no longer offers (accept / RSVP / poll)?
- **Edge cases.** Busy view with 0 people or a >62-day window; a meeting with only the organiser;
  a rhythm with no attendees; declining an already-closed meeting; undo-decline by a non-attendee;
  attendance marked then meeting reopened.

## Prove it, don't guess
- Build & typecheck both apps (`npx tsc --noEmit`, `npx nest build`). Boot the backend and
  confirm routes map. Where feasible, exercise a flow against the local DB (`localhost:5432/orgos`)
  or write a focused script to demonstrate a defect (e.g. after_n over-spawn, busy-view leak).
- For any bug, give: severity (Critical/High/Medium/Low), `file:line`, the exact inputs/state that
  trigger it, the wrong output vs expected, and your confidence. Separate CONFIRMED (you
  reproduced/traced it) from SUSPECTED.

## Deliverable
A prioritized findings list (most severe first), then a one-paragraph verdict: is this safe to
ship, and if not, the single most important thing to fix. Call out anything that silently lies in
governance numbers or leaks data across users — those are the highest-stakes failures here.
