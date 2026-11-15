# Recurring Task Module — Architecture Review

*Written 4 July 2026. A senior-architect review of the recurring-task feature you rebuilt today (commit `99581e2`) to bring it to parity with one-time tasks. Scope: setting up a recurring template → the background engine spawning real child tasks → working/completing them → the edit/delete/performance screens. Out of scope by request: one-time tasks (reviewed yesterday), tickets, workflows, projects.*

*Method: six parallel code reviewers — rule enforcement, the spawn engine, endpoint security, frontend↔backend agreement, UI vs DESIGN_RULES, and a regression check on the shared form pieces you extracted. Code-reading only (no live clicks this round). The two most severe items (C7 delete, category validation) were re-confirmed by hand at the exact lines.*

---

## Headline

Today's rebuild is **genuinely good work.** The parts that were the whole point of the exercise — copying every field faithfully into each spawned task, the 3 delete modes, the performance/stats view, the full edit modal, the shared form components — are **correct and match the one-time flow**. The refactor that pulled the checklist/reminders/escalation/goal builders out of the Create modal is a **clean, no-regression extraction**. The frontend and backend **agree field-for-field** on every payload. This is a much tighter build than yesterday's non-recurring review found.

**The recurring path is also, in one important way, *safer* than one-time:** the new `assertActiveOrgMembers` helper means you genuinely **cannot** assign recurring work to a fake user or someone in another company — a hole that one-time had. Credit where due.

**But the same root pattern from yesterday survives in two spots: "the rule lives in the screen, not the engine."** And this time there's an extra dimension one-time didn't have — **the engine runs unattended at midnight**, so a bug there spawns silently, every day, with nobody watching. The most serious findings are: one old cross-company security hole that was flagged before and never actually got fixed; the catalog (category/priority) validation gap you already fixed on one-time but not here; and three engine-level bugs (duplicate spawns, the holiday rule only half-applied, and one company's failure taking down everyone else's spawns for that night).

None of these will be hit by a normal user clicking through the screens. They live in the back door — direct API calls, the unattended scheduler, edge timing. Very fixable, mostly by copying guards you already have in `tasks.service.ts` into the recurring service and the scheduler.

---

## TIER 1 — Rules/security not actually enforced (fix first)

**1. The old cross-company delete hole (C7) is still open — it was flagged in the security audit and never fixed.**
Deleting one schedule entry checks that *your* template exists, then deletes the entry by its raw id with no check that the entry actually belongs to that template or your company. Anyone logged in who makes their own template with 2+ entries (to pass the "must keep one" guard) can then delete *any* schedule entry in *any* company by its id — including someone's last remaining entry, breaking a rule the system otherwise enforces. Its sibling "update entry" method does this correctly (binds the entry to the template); delete just never got the same line.
`backend/src/recurring-tasks/recurring-tasks.service.ts:304` — *confirmed by hand.* Fix: add `recurring_template_id: templateId` to the `where` (copy from `updateScheduleEntry` at `:273`).

**2. Category and priority aren't validated — same hole you already closed on one-time (Tier-1 #5 there).**
On create and edit, `category_id` and `priority_id` are written straight through with no check that they belong to your company or are active. A foreign or deactivated id is accepted and then **stamped onto every spawned task, every day** — a stored cross-company reference that pollutes Work Overview analytics on each occurrence. One-time now guards this with `assertMastersUsable`; recurring never calls it.
`recurring-tasks.service.ts:156-157` (create), `:219-220` (edit) — *confirmed by hand.* Also `department_id` is unvalidated the same way.

**3. Anyone in the company can read every recurring template (collection-level BOLA).**
Opening a single template is properly gated (you must be on it or have scope), but the *list* endpoint returns **every template in the company** to any logged-in member — titles, who's assigned, CC list, escalation contacts, linked goal, checklist contents — regardless of their row-level visibility. One-time task list filters this with `scope.listWhere`; recurring list filters by company only. *(Flagged independently by two reviewers.)*
`recurring-tasks.service.ts:128-135`.

**4. Assignee-visibility scope isn't re-checked on save (residual of one-time Tier-1 #3).**
Cross-company and fake ids **are** now blocked (good — the new helper). But the *picker's* visibility rules aren't re-enforced server-side: a manager can hand-craft an API call assigning recurring work to in-company people **outside their allowed assignable set** (e.g. another department they can see but aren't permitted to task). Every spawned instance and its daily notifications then hit those people. One-time now calls `assertAssigneesVisible` + subject-eligibility; recurring stops at membership+active.
`recurring-tasks.service.ts:142-148` (create), `:189-195` (edit).

**5. No "who's allowed to create/edit/delete tasks" permission gate on the recurring path at all.**
One-time `createTask` checks the org's task-creation permission (and edit/delete variants). The recurring controller declares no permission requirement and the service makes no such check — so a user your org config has **excluded from creating tasks** can still create recurring templates that spawn real tasks daily. *(The reviewer flagged one link in the chain — RolesGuard's default-pass behavior — as unconfirmed by reading; worth a 2-minute check, but the missing service-level call is certain.)*
`recurring-tasks.service.ts:140`; controller `recurring-tasks.controller.ts`.

---

## TIER 1 (engine) — The unattended scheduler produces wrong results

**6. Duplicate tasks can spawn — there's no lock and no uniqueness guarantee.**
Dedup is a non-atomic "count today's tasks → if zero, create" with no database unique constraint on (template, day). The midnight cron and the fire-and-forget spawn triggered by create/resume can both look, both see zero, and both insert — two identical child tasks for the same day. Your work-log feature solves exactly this with a `@@unique([demand_id, due_date])` + upsert; recurring doesn't.
`backend/src/scheduler/scheduler.service.ts:219-291`; schema `Task` model has only an index, no unique. Fix: add a unique constraint and let the DB reject the second insert.

**7. The holiday rule is only half-applied — it ignores department and individual holidays.**
Spawn adjusts the deadline against the **company baseline only** — it never passes the department or the assignee, even though the template stores both and the holiday engine supports the full cascade (and one-time create passes them). So a template scoped to a department with its own holiday (or an assignee with a personal holiday) spawns a task dated **on that non-working day** — recurring and one-time disagree on the exact cascade rule you built the holiday system around.
`scheduler.service.ts:243` (calls `adjustDeadline` with company id only); compare `tasks.service.ts:852-856`.

**8. One company's spawn failure kills the spawn run for every company after it that night.**
The loop over companies at midnight has no per-company try/catch. Per-*entry* errors are caught, but anything outside that — the initial query, the end-of-life deactivation sweep — throws straight out and aborts the whole tick, so every company later in the list gets **no tasks spawned** that day, silently. The sibling "leave-conflict warning" loop right nearby *does* wrap each company in try/catch — the intended pattern is just missing here.
`scheduler.service.ts:84-88`.

---

## TIER 2 — A normal user (or their people) hits these

**9. Removing/deactivating an assignee leaves the template spawning broken tasks.**
Spawn copies `assignee_user_ids` verbatim with no active-membership re-check (escalation contacts on the very next line *are* filtered). So a deactivated person keeps getting assigned every day; and if the last assignee was removed, spawn **silently creates a task with zero assignees** — a state one-time create forbids — which sits open, goes overdue, and escalates to nobody.
`scheduler.service.ts:293-301`.

**10. A recurring template with zero assignees is accepted and spawns unworkable tasks.**
Nothing requires at least one assignee (one-time rejects this). An `any_can_complete` template with an empty list spawns tasks no one can ever complete.
`create-recurring.dto.ts` (no min-size), `scheduler.service.ts:293-301`.

**11. Pause and Resume fail completely silently.**
Neither the list page nor the detail page has a catch on pause/resume. A rejected request (e.g. a permission 403) produces nothing — the spinner resets, the card doesn't change, no message. It looks like a dead button. The optimistic state update sits *after* the await, so on failure the UI is simply left untouched.
`frontend/app/dashboard/tasks/recurring/page.tsx:410-418` and `recurring/[id]/page.tsx:351-366`.

**12. Create and Edit swallow the real backend error.**
Both show a fixed generic string ("Failed to create/save… please try again") even though the same Create modal already has the good `apiErrorMessage()` helper used by the one-time branch right above. So a real, fixable reason ("linked goal from another org," "that contact isn't active," "title too long") is hidden.
`CreateTaskModal.tsx:442-443` (recurring create), `EditRecurringModal.tsx:231-232`.

**13. "End after N occurrences" can deliver one fewer than promised.**
When an occurrence lands on a holiday and gets skipped, no task is created — but the code still counts it against the "N" budget. A template set to "end after 5" where one lands on a holiday produces only 4 real tasks and then marks itself complete.
`scheduler.service.ts:244-256`.

**14. "Run Today" has no idempotency — repeat clicks make duplicates.**
The manual spawn forces creation and skips the same-day dedup entirely, so two clicks (or a click after the cron already spawned today) create multiple identical children. No confirmation, no guard.
`recurring-tasks.controller.ts` (`force=true`) → `scheduler.service.ts:219-229`.

**15. Reminder dates show one format on the detail page, another in the editor.**
The detail page renders reminder dates in `en-IN` (day-month-year: "5 Jul 26") while the editor now uses `en-US` ("Jul 5, 26") — the same reminder reads differently depending on where you look. This is the exact locale bug class from yesterday.
`recurring/[id]/page.tsx:85` vs `RemindersField.tsx:43,222`.

---

## TIER 3 — Fragile / works-by-luck / confusing

- **No catch-up after downtime.** If the server is down over scheduled days, those recurring instances are simply lost for real companies — no back-fill, no log, no alert. (Test companies replay day-by-day; production doesn't.) Looks intentional, but silent loss is worth a log line at least. `scheduler.service.ts:72-91`.
- **CC watchers aren't notified when a task spawns** (they are on one-time create). CC rows are created but never pinged. `scheduler.service.ts:398-407`.
- **"Monthly on the 31st" silently skips short months** (Feb/Apr/Jun/Sep/Nov). By design (negative day = "from month-end"), but a likely user surprise with no clamping to last-day. `should-fire-today.ts:66-73`.
- **All day/date math is server-local — no per-company timezone.** For a company in another timezone, "today" and the fire-day can be off by one. *(unconfirmed — depends on whether all companies share the server timezone.)*
- **The creator can delete a template without holding the delete permission.** The gate short-circuits delete for the author, bypassing the entitlement (assignees correctly can't). Low impact — only your own template. `recurring-tasks.service.ts:79`.
- **Edit modal missing `role="dialog"`/`aria-modal`**, and backdrop-click/Escape silently discards a prefilled form with no confirm. `EditRecurringModal.tsx:241-244`.
- **The stats/instances views** return all child-task data behind a single template-level read check rather than re-filtering each child by scope — a reasonable proxy (same participants), but looser than the one-time task list. `recurring-tasks.service.ts:376-417`.

---

## TIER 4 — Polish (from DESIGN_RULES)

- Count pills aren't the mandated blue — checklist pill is purple, attachments pill is slate. `[id]/page.tsx:888,938`.
- Template count is plain gray text, not a solid blue pill beside the heading. `recurring/page.tsx:469`.
- Disabled buttons dimmed with `opacity` instead of the explicit disabled palette. `recurring/page.tsx:126,146,261,271`.
- No `AccessHiddenState` on the recurring list/detail — load errors collapse to a misleading "No recurring templates yet." `recurring/page.tsx:393,478`.
- The template card's schedule list has no height cap — many entries stretch the card and break grid alignment. `recurring/page.tsx:331-336`.
- The 3-way delete menu has no click-away dismiss. `recurring/page.tsx:287-311`.
- "Run Today" failure shows bare "Failed" button text; delete failure shows a permission-guess that can be misleading. `recurring/page.tsx:200,132-141`.
- Detail H1 is 26px vs the 28px spec. `[id]/page.tsx:418`.
- **Dead surface:** the per-entry schedule endpoints (`/schedules/:eid` etc.) are fully wired on both sides but no screen calls them (edit does a full-replace instead); and `department_id`/`quadrant` are DTO-settable but never sent by the create UI. Not bugs — just unused wiring. Note that C7 (finding #1) lives in one of these unused endpoints, so fixing or removing it also closes the hole.

---

## What's genuinely solid (do NOT touch)

- **Copy fidelity** — title, description, category, priority, quadrant, completion mode, per-person tracks, proof config, checklist, reminders (recomputed against each instance's deadline), escalations (correctly filtered), goal link (re-verified per spawn), and attachments (real R2 copies to independent files) all carry over faithfully. Verified field-by-field.
- **Born-closed is impossible** — a template has no status field; spawn always uses the default open status. (One-time had this hole; recurring doesn't.)
- **Cross-company / fake assignee ids are blocked** by the new `assertActiveOrgMembers` helper — a real improvement over one-time.
- **The 3 delete modes** (`stop` / `delete-future` / `delete-all`) match exactly across UI, API, and engine, with accurate per-mode copy, and each cascade is correctly scoped to company + template (can't touch another template's children).
- **Frontend↔backend contract** — every payload field matches its DTO; nothing silently stripped; stats shape matches the type field-for-field; edit-modal preloads every field; PATCH preserves untouched fields.
- **The refactor is clean** — the four extracted form components (`ChecklistBuilderField`, `RemindersField`, `EscalationLevelsField`, `GoalSelectField`) behave identically in the one-time flow. No regression from the extraction.
- **Simulated clock** used consistently through the spawn engine (no stray real-time), attachments best-effort (don't abort spawn), per-entry failures isolated, spawn attributed to `system` in the audit trail, manual and scheduled spawns share one code path.

---

## Suggested fix order

1. **The three that are genuinely dangerous now:** #1 (C7 cross-company delete — one line), #2 (category/priority validation — reuse `assertMastersUsable`), #6 (duplicate spawns — one DB unique constraint). Small, high-value.
2. **The rest of Tier 1:** #3 (scope the list), #4 (assignee-visibility re-check), #5 (task-permission gate), #7 (pass dept+assignee to the holiday adjuster), #8 (wrap each company's spawn in try/catch).
3. **Tier 2 user-facing:** #11 and #12 first (silent failures — reuse `apiErrorMessage`/toast you already have), then #9/#10 (assignee sanity at spawn), #13/#14 (occurrence budget + Run Today idempotency).
4. Tier 3, then Tier 4 polish.
