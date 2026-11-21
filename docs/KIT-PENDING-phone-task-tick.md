# Pending kit change: tick to complete on phone list rows (owner request, 2026-10-14)

Status: **wanted for v2e's phone layout, NOT yet in `kits/frontend-kit/FRONTEND_RULES_PHONE.md`.** Until the kit has these rules, v2e's phone task lists deliberately differ from kit §41.5 rule 13 on the points below. The kit itself is not to be edited from v2e.

**Why:** the owner wants task lists to work like Google Tasks / Todoist: complete a task from the list with one tap, without opening it. Completing tasks is the main thing people do on the phone. Today §41.5 rule 13 forbids tick boxes on list rows, so every completion takes three steps: open the record, press the action, go back.

## What is missing / what should change

1. **§41.5 rule 13: add a third exception.**
   - **The circle.** A row whose record is a to-do (it has only "done" and "not done" for this person, such as a task assigned to them) may carry a completion circle at the left of the row.
   - **Tap target.** The circle is 22px visible, with a 44px tap area. Tapping the circle completes the record. Tapping the rest of the row still opens it.
   - **What it is not.** The circle is not a selection tick box, and the row still has no swipe and no three-dot menu.
2. **Completing from the row (new rule under §41.5):**
   - **Order of events.** On tap, the circle fills with a check, the title takes a strike-through, and after ~300ms the row collapses out of the list (animated, §5.6). The Undo toast (§38.1, 10 seconds) then shows: "Task completed · Undo".
   - **Undo.** Undo puts the row back in its old position, unticked.
   - **Saving and errors.** The save is optimistic. If it fails, the row returns and an error toast shows.
   - **Toasts.** The rule of one Undo toast at a time (§41.8 rule 13) applies unchanged.
3. **When a single tap cannot finish it (new rule):**
   - **The sheet.** If the record needs more before it can be completed (proof to attach, a checklist to finish), the circle opens a bottom sheet called "Finish task" instead of completing.
   - **Sheet contents.** The sheet lists only what is still needed: the unfinished checklist items, each tickable in the sheet; and "Attach proof", with Take photo / Choose file and per-file progress (§41.16).
   - **Footer.** One full-width primary button, "Complete task", disabled with its reason until everything needed is done. It completes at once, with the same Undo toast.
   - **Row marker.** A row that will open this sheet shows a small marker on line 2 (a paperclip for proof, "2/5" for a checklist), so the sheet is never a surprise.
4. **§41.9 rule 9 (icon-only buttons on phone):** add the completion circle to the list of marks that need no text label.
   - Its look: hollow circle with a border outline when not done; filled primary with a white check when done.
   - Screen-reader label: "Mark complete" / "Mark not complete".
5. **§41.15 rules 6–7 (My work rows):** a task row on My work may carry the circle (rule 1 above). Approval rows never do; approving stays on the record or in select mode (§41.6).
6. **New rule in §41.12: the badge on the home-screen icon.**
   - **What it shows.** The installed app shows a count on its home-screen icon using the Badging API (`navigator.setAppBadge` / `clearAppBadge`). The count is the product's chosen "needs me now" count. For v2e that is my tasks that are overdue or due today.
   - **When it updates:**
     - when the app opens;
     - after every action that changes the count;
     - from the service worker whenever a phone notification arrives. Every push payload carries the current count, because iPhone gives the service worker no other chance to run.
   - **Zero.** At zero the badge is cleared.
   - **Device limits.** Some Android launchers show only a dot, and that is accepted.
   - **Kit files affected:** `lib/push.ts` and `lib/service-worker.ts` need badge support.

7. **§41.5 rules 8–11 (row lines): allow a one-line to-do row.**
   - **Why:** owner request, 2026-10-14. Three-line rows read cluttered for a to-do list.
   - **My work row:** one line, at least 56px tall. Circle, then the title, then a short due label on the right: the time only under a Today/Tomorrow heading, nothing for an end-of-day task there, "18 Oct" otherwise, red when overdue. The markers sit beside the due label.
   - **Given row:** two lines. Line 1: the title, with the due label on the right. Line 2: the assignee(s) and progress.
   - **Rule:** a row line appears only when it has something to say. A row never reserves an empty line.

## Backend-kit note (not frontend)

Hold the "completed" notification to the other side until the Undo window (10 seconds) has passed, and drop it if Undo is pressed. Otherwise the assigner gets "Task completed", then "Task reopened", for a single mistaken tap.

## Sections to amend

- §41.5 rule 13, plus new rules for items 2 and 3
- §41.9 rule 9
- §41.15 rules 6–7
- §41.12 (new badge rule)
- `components/ui/phone-list.tsx`: an optional leading completion slot
- a new `finish-sheet` pattern, or a note on sheet.tsx usage
