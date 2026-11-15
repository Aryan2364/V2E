# Meetings — Calendar-First Redesign (Design Brief)

**Status:** Phase 1 in build · **Owner:** Meetings module · **Last updated:** 2026-07-20

This is the single source of truth for the meetings redesign. It merges three inputs:
the calendar week-grid blueprint, the "find a time" scheduling flow, and the locked
decisions from the product discussion. Follow the repo-root **DESIGN_RULES.md** for all
colours, buttons, status pills, DatePicker/TimeField, and card styling. Follow
**backend/AUTHORIZATION.md** for any endpoint work.

The guiding idea: **keep the whole back end we already built and put a Google-Calendar
week time-grid on the front — with the already-built "find a time" engine pulled out of
hiding and made the heart of scheduling.** This is mostly wiring, not new machinery.

---

## 1. Locked decisions (do not relitigate)

- **Attendee model — strict opt-out.** Everyone invited is *attending* by default. If
  they can't come they mark "won't make it" with a reason. Decline is a **soft signal,
  not a lock-out** — anyone invited can still join and self-mark present. There is no
  "pending" and no "maybe". (Backend already does this: `MeetingAttendeeResponse =
  'attending' | 'declined'`.)
- **Organizer-only reschedule.** Only the organizer moves a meeting; a move shifts it for
  everyone and fires the `meeting_updated` notification (attendees never chose the time,
  so the notice is mandatory).
- **Clash handling — nudge, never block.** The organizer is *warned* of clashes at
  creation time (naming *who* and *how bad*), but is **never prevented** from booking.
- **Scheduling view shows busy/free only — titles hidden.** When picking a slot, the
  organizer sees *blocked vs free* per person, **not what the block is**. (Only show a
  title if the viewer already has access to that meeting.)
- **Attendance — self-mark.** Each person marks themselves present when they join.
- **Action items — one owner + due date,** each becomes a real task. No separate
  "accountable" role for now.
- **Scope of the calendar — meetings only.** The grid shows meetings I'm part of, plus my
  leave/holidays as background bands. **No personal tasks/events on it** — this is a
  meeting calendar, not a life planner.
- **RSVP stays opt-out** (no "tentative" state added in v1).

---

## 2. Reuse — already built, do NOT rebuild

Attendance (present, in/out times, `attendance_taken_at`), minutes / "what was
discussed", personal notes (`MeetingPrivateNote`), action items (`MeetingActionItem` →
link to a real task), decisions log (`MeetingDecision`), lifecycle statuses, governance
reports + analytics (creator-only for v1), audit log, permissions
(Global→Module→Line via `useMeetingPermissions`), rhythms (60-day rolling spawn horizon),
and the **busy/free engine** (`meetingsApi.busy` → `BusyView` with per-person `busy[]`
blocks + ranked `suggestions[]`). The finder is a *reskin and repositioning* of this
engine, not a rebuild.

---

## 3. Phasing (ship the visible win first)

| Phase | Scope | External deps |
|---|---|---|
| **1 — the visible win** | Calendar-first week grid + colour blocks + click-popover + list toggle + the **Find-a-time** finder using data we already have (meetings, leave, holidays) + best-times rail. | **None** — all internal DB. |
| **2 — Google (one-way)** | Read each person's busy/free from Google + push V2E meetings out as events; "synced" badges; graceful degrade for the unconnected. | Google OAuth, token refresh. |
| **3 — the rest** | Google write-back (two-way, conflict rule), external/guest participants (email invites), WhatsApp reminders (MSG91), configurable pre-meeting reminders. | Google webhooks, MSG91. |

**Reminders note:** email reminders ride existing SMTP infra and can land inside Phase 1
as a fast follow; WhatsApp is a Phase-3 integration, *not* "existing infra".

**This document's build target is Phase 1.**

---

## 4. Phase 1 — the calendar-first page

Calendar replaces the list as the landing view; **list stays behind a toggle.**

**Header (sticky):** title + `Rhythms`, `Governance` links + primary **`+ New meeting`**.

**Toolbar (sticky):** `‹ / Today / ›` week-nav + date-range label on the left; segmented
**Day · Week · Month · List** on the right (**Week is default**). Remembered **5-day /
7-day** toggle (work-week Mon–Fri by default).

**Stat strip:** the four big stat cards collapse to **one thin line** (total this week +
live / scheduled / closed dots). Existing filters (All statuses, All types, My meetings)
become **compact chips** on the right of this row.

**Grid:**
- Left time rail ~**8 AM–6 PM**, scrollable beyond.
- Today's column tinted + accented date; **red now-line on today's column only**.
- Blocks positioned by start time, **height = duration**; overlaps split the column.
- **Colour = meaning:** blue = meeting · purple = rhythm (with ↻) · green = live ("Live
  now" + pulse) · grey struck-through = closed · grey/dim = cancelled.
- Rhythms sit on the **same grid**, differentiated by colour + icon.

**Click a block → popover in place (no navigation):** title, time, online/in-person,
attendee count, governance summary (agenda? · decisions n · action items n open), plus
**Open meeting** and **Join**.

**Empty week:** keep the grid frame; show a centered "schedule a meeting" prompt with a
button. **Do not auto-jump** to another week.

**Legend under the grid:** Meeting · Rhythm · Live · Closed.

**Feel:** minimal on the surface, depth on click. Governance is its own tab (a manager's
lens), never cluttering the daily view.

**Mobile:** **Day view is the default**; week collapses to a horizontally-scrolling
day-strip. Blocks full-width; popover becomes a bottom sheet.

---

## 5. Phase 1 — the Find-a-time scheduling flow

The form is the **fast lane**; "Find a time" is the **assist**. We *inform* on clashes
but never *block*.

**In the create form (before any calendar):**
1. Title, participants (chips; toggle who's optional — already built).
2. **Tentative duration** — `[30m] [1h] [2h] [custom]`, default **30m**. This seeds the
   suggestions; you can't rank slots without knowing how long.
3. Date + time, with two ways forward:
   - **Type it** (confident path) — a **live, non-blocking nudge** appears under the time
     field the moment there's a clash: *"Priya (required) is busy 4–5pm."* Names the
     person + time + severity (required = amber, optional/self = quiet grey). **Never
     names the other meeting's title.** Create stays enabled.
   - **`Find a time →`** (explore path) — opens the full availability view.

**The full "Find a time" view:**
- Everyone's **busy blocks overlaid** on one grid (meetings + leave + holidays), free
  gaps obvious. **Busy/free only, titles hidden.**
- **Add / remove people right here** — the participant rail is live; suggestions re-rank
  instantly.
- **Best-times rail** — the existing ranked `suggestions[]`: green = zero required clash,
  amber = "least-bad" with the reason spelled out. **Never an empty rail** — if the week
  is slammed, show the three least-bad options and a jump to next week.
- Pick a slot (rail **or** click the grid) → **inline confirm** ("Tue 13, 2:00–4:00pm —
  Adjust · Use this time"), then it drops back into the form filled. One hop, no
  popup ping-pong. The duration seeds it but can be stretched.
- Keep the honest caveat: "only what this app knows about — not a guarantee."

**On save:** participants get a notification and the meeting blocks their grid. (Google
write + external email invites are later phases.)

**Recurrence:** the finder is for **one-off meetings**; rhythms are set up separately
(as today). Don't promise free/busy across a recurring series in v1.

---

## 6. Governance / review (mostly exists)

A separate tab: who's attending across meetings/rhythms, attendance history, and — the
important part — the status of the **action items generated in meetings** (did the tasks
actually get done, by whom, by when). Creator-only visibility for v1; hierarchy rollup
deferred.

---

## 7. Build slices (Phase 1)

1. **`WeekGrid` component** — Day/Week time grid, 5/7-day toggle, now-line, colour-by-
   meaning blocks, overlap-split, click→popover. *(no backend change)*
2. **Calendar-first page** — Day·Week·Month·List toggle (Week default), thin stat strip +
   filter chips, keep month + list behind toggles, empty-week state, legend. *(reuses
   `meetingsApi.list`, filters to the visible range client-side)*
3. **Find-a-time flow** — duration-first in `CreateMeetingModal` + full availability view
   with live add/remove + best-times rail + inline confirm + soft clash nudge. *(reuses
   `meetingsApi.busy`)*
4. **Email reminders** *(fast-follow)* — pre-meeting reminder on existing SMTP infra.

Everything above is front-end assembly over existing endpoints. No schema changes for
Phase 1.
</content>
</invoke>
