# Kit alignment — owner review

Each agent appends its own self-contained section. Do not edit another agent's section.

## P4 — Application shell (restyled, structure kept)

- **Kit says:** one sidebar, full application shell (`components/shell/app-shell.tsx`, §12).
  **v2e does:** top nav bar for modules + a left sidebar that is that module's own
  sub-menu (decision D4, locked before this phase). **Why kept:** this is the owner's
  deliberate navigation shape for v2e, not an oversight; P4 restyled it to kit tokens and
  §12.1 behaviour (primary fill, on-brand text, surface + primary-text active item,
  collapse rail, 240px/64px widths) without restructuring it into the kit's single
  sidebar.

- **Kit says:** sidebar has a 7-item limit (§12.1). **v2e does:** the Work (Tasks)
  sidebar carries more than 7 items once every group (Tasks, Projects, Workflows,
  Tickets, Delegation, Leave, Config) is counted. **Why kept:** these are genuinely
  separate sold modules sharing one sidebar by design (D4); splitting items would lose
  information, not gain clarity. Logged per the task brief's instruction to record rather
  than enforce the limit here.

- **Kit says:** notification centre is a popover opened from the bell, 360px wide, with
  "Notifications" / "Mark all as read" header, latest 25, "View all" footer, "You are all
  caught up" empty state (§7.4). **v2e does:** `components/layout/NotificationBell.tsx`
  is now restyled to that shape (360px panel, primary-band header with "Mark all as
  read", that empty-state copy, "View all notifications" footer) but is still v2e's own
  custom popover markup, not built from the kit's `popover.tsx` primitive, and it keeps
  v2e's richer row (type icon, module chip, push-notification toggle) rather than the
  kit's plainer neutral row. **Why kept:** `useNotifications()` / push plumbing is v2e's
  own data layer (D1: no data-flow changes), and swapping the container to
  `components/ui/popover.tsx` is a larger behavioural change (focus trap, phone sheet
  branching) than this pass's restyle scope. Noted here for a follow-up pass to adopt
  `popover.tsx` directly.

- **Kit says:** a mounted route-change progress bar (§5.6). **v2e does:** mounts
  `ProgressProvider` + `ProgressBar` from `components/shell/progress-bar.tsx` in
  `MainLayout`, but that component is still P3's documented no-op shim (its own file
  comment: "Building the real bar is follow-up work"). **Why kept:** building the real
  bar needs navigation-start/end instrumentation V2E's router calls don't currently emit;
  out of scope for a shell-restyle pass. The mount point now exists so a later pass only
  needs to implement the shim, not find somewhere to put it.

### Component changes needed in `components/ui` (not made here — that folder owned by the concurrent agent)

- None required. `badge.tsx` (`Count`), `tooltip.tsx`, `popover.tsx` and `dropdown-menu.tsx`
  all had what P4 needed for the sidebar/top-nav restyle.

### What changed

- New `components/layout/ModuleSidebar.tsx`: the single sidebar implementation (§4 rule
  2) for every module sub-menu. Takes `title`, `groups` (label/note + items with
  label/href/Icon/active/badge/disabled), an optional `collapseKey` for its own
  localStorage-persisted collapse toggle, or a controlled `collapsed`/`onToggle` pair for
  a parent that owns the toggle (Settings). Kit tokens only: `bg-primary`, `text-on-brand`,
  `text-on-brand-muted`, active item `bg-surface text-primary-text font-medium`, `z-shell`,
  `duration-fast`/`duration-slow`, `Count` from `badge.tsx` for item counts.
- `TaskModuleSidebar.tsx`, `GovernanceSidebar.tsx`, `GoalsSidebar.tsx`,
  `SettingsSidebar.tsx` are now thin wrappers: same permission/entitlement/count logic as
  before (untouched — D1), rendering through `ModuleSidebar` instead of hand-rolled dark
  navy markup. Every item, label, route, ordering and permission/entitlement filter is
  unchanged.
- `Sidebar.tsx` (super-admin / firm shell sidebar + org switcher + user footer) restyled
  in place to the same token set (not moved into `ModuleSidebar`, since its org-switcher
  and footer chrome don't fit that component's shape).
- `TopNav.tsx`: removed all remaining `font-semibold`/`font-bold` (→ `font-medium` at the
  two allowed weights), all `bg-white`/`text-white`/`rgba(...)` literals (→ `bg-surface`,
  `text-on-brand`, `shadow-menu`), and ad-hoc `z-40`/`z-50`/`z-9999` (→ `z-shell`/
  `z-popover`). Structure, routes and entitlement-gating logic unchanged.
- `NotificationBell.tsx`: panel restyled per §7.4 (see deviation above); all
  hex/rgba/font-bold removed.
- `DashboardLayout.tsx`, `MainLayout.tsx`: removed remaining hex/font-bold/arbitrary
  z-index; mounted `ProgressProvider`/`ProgressBar`.
- Phone: no phone file touched. `MainLayout` still returns `<PhoneShell />` before any
  desktop markup when `layout === 'phone'`, unchanged.

### Verify (clean)

- `npx tsc --noEmit` filtered to `components/(layout|shell)` and `app/.*layout\.tsx`: no
  errors.
- `grep -rnE "#[0-9A-Fa-f]{3,8}\b|rgba?\(" components/layout components/shell`: no matches.
- `grep -rnE "font-(semibold|bold)" components/layout components/shell`: no matches.

## Task components (module M1b: `components/tasks/**`, `lib/tasks/**`, `lib/task-badge.tsx`)

### Kept for owner decision

- **Hand-rolled modal/drawer overlays stay structurally as-is, restyled to tokens.**
  `components/tasks/{AssigneeSelector,CreateTaskModal,EditRecurringModal,EditTaskModal,
  ImportChecklistsModal,ImportTasksModal,KanbanView,ManageAccessModal}.tsx` and
  `components/tasks/overview/{SegmentDrawer,TaskDrawer}.tsx` each still build their own
  `fixed inset-0` backdrop + centred/sheet markup instead of `dialog.tsx`/`sheet.tsx`.
  The kit says these should become `Dialog`/`AlertDialog`/`Sheet`; converting them was
  judged too risky for a presentation-only pass within this slice — several have bespoke
  behaviour (CreateTaskModal's single/bulk tab switch with a fixed-size frame so tabs
  don't resize it; KanbanView's drag-and-drop card interacting with a confirmation
  sub-dialog; ImportTasksModal/ImportChecklistsModal's multi-phase wizard state) that a
  mechanical swap onto the kit's focus-trap/portal components could silently change.
  All of their colours, radii, shadows and z-layers now use kit tokens
  (`bg-surface`, `shadow-dialog`/`shadow-menu`, `rounded-xl`/`rounded-lg`,
  `bg-(--backdrop)`), so visually they already match; only the underlying
  component is still v2e's own. Flagged here per D12/D1 for a dedicated follow-up pass.
- **Dark "inverted" surfaces** (the bulk-action toolbar in `overview/BulkActionBar.tsx`,
  the Key insights card in `overview/KeyInsights.tsx`, the filter chip "on" state in
  `ImportTasksModal.tsx`) used literal dark hexes (`#0F172A`, `#1E293B`, `#334155`) for a
  dark surface with light text — the kit has no "inverted card" token. Mapped these to
  `bg-text-primary` (the darkest neutral) plus opacity modifiers (`/80`, `/30`) and
  `on-brand-hover`/`on-brand-muted`/`on-brand-accent` for the lighter accents on that dark
  ground. Visually equivalent to before; token-only now. Worth a real "inverse surface"
  token in the kit if more screens need this pattern.
- **`overview/CrossDeptMatrix.tsx`'s heatmap intensity** (computed shading of a
  within-department vs. cross-department cell by count) used `rgba(37,99,235,…)`/
  `rgba(220,38,38,…)` literals keyed to opacity, not a fixed set of colours. Converted to
  `color-mix(in srgb, var(--primary) N%, transparent)` / `var(--danger)` the same way, so
  the computed intensity is preserved but the base colour is now a token.

### Not done / follow-up

- The 10 `fixed inset-0` overlays above are not converted to kit `Dialog`/`AlertDialog`/
  `Sheet` components (listed above, kept for owner decision).
- Typography: `text-[Npx]` arbitrary sizes (e.g. `text-[15px]`, `text-[22px]`,
  `text-[10px]`) were left as-is across most files — not in the brief's required
  self-check greps, and swapping each to the nearest `text-section`/`text-card-heading`/
  `text-meta` token needs a per-call-site judgement call on which slot it actually is.
  Flagged for a follow-up typography pass.
- Adapters not migrated off (per `components/ui/ADAPTERS.md`, out of scope for this
  pass — each is a >25-call-site migration the brief defers): `Modal.tsx` (4 call sites
  in this module: `EmployeeAssigneeEditor`, `masters/TagsTab`, `ProofOfCompletionCard`,
  `TaskChecklistCard`), `ConfirmDialog.tsx` (`EditTaskModal`, `masters/TagsTab`),
  `StyledSelect.tsx` (many), `DatePicker.tsx` (many), `useToast`/`Toast.tsx` (many). These
  are already thin adapters over the kit components per P3, so call sites render
  correctly; only the import path is the old name.
- Pagination (D5): `overview/TaskTable.tsx` and the main task list view load an unbounded
  result set from the dashboard/overview endpoints; no server pagination added, per D5.
- `components/tasks/KanbanView.tsx` and `CalendarView.tsx` kept as v2e's own custom
  board/calendar visuals restyled to tokens (D12) rather than migrated onto kit
  `board.tsx`/`calendar.tsx` — Kanban's per-card inline status-change flow and
  Calendar's deadline/leave-marker rendering are specific to this product's task model.

### Visual changes the owner will notice

- The bulk-selection toolbar, Key insights card and the "on" filter chip in the task
  import review screen keep their same dark look, now built from tokens instead of fixed
  hex (should be visually identical).
- Native `confirm()`/`alert()` are gone: removing a person/role/department from a
  checklist's access list (`ChecklistAccessEditor.tsx`) now opens a styled `AlertDialog`
  ("Remove access?") instead of the browser's own confirm box; `CreateTaskModal.tsx`'s
  "this date falls on a non-working day — keep it anyway?" prompt is the same change,
  and its "attachment failed to upload" notice is now a toast instead of a blocking
  `alert()`.
- All card/dropdown/modal shadows, radii (`rounded-[12px]` etc.), and off-scale spacing
  (`p-5`, `py-10/14/16/20`, `pl-9`, `pr-14`, …) across every file in this module now use
  kit tokens and the §5.1 scale — should look the same or very slightly tighter/looser
  (1–2px), never a visible layout break.
- Every `font-semibold`/`font-bold` in this module is now `font-medium` (weight 500);
  bold-looking labels (section headings, badge counts, the filter chip "selected" count)
  read slightly lighter than before, consistent with the kit's two-weight rule (§3).

### Self-check results

- `npx tsc --noEmit | grep -E "components/tasks/|lib/tasks/|lib/task-badge"`: clean.
- hex/rgba, `font-(semibold|bold)`, `confirm|alert|prompt(`, `<select`, off-scale spacing,
  `toLocale(Date|Time)?String`, and the `Modal|ConfirmDialog|StyledSelect|DatePicker|
  ResponsiveTable|Toast` adapter-import grep: all clean except the adapter-import grep,
  which is expected (see "Not done" above — those adapters keep their old import paths
  by design, per P3/ADAPTERS.md).
- `fixed inset-0`: 10 files remain (see "Kept for owner decision").

### Wave 2 finishing pass (this pass)

- Type scale and surface tokens finished across the whole module: `text-xs/sm/base/lg/
  xl/2xl/3xl` and `text-[Npx]` (the "not in scope" item above) are now fully converted to
  `text-meta/body/label/card-heading/section/page-title` (0 raw hits left in
  `components/tasks/**`/`lib/tasks/**`), and `bg-white`/`text-white`/stray
  `bg-black`/`text-black` are gone (0 left). `components/tasks/overview/TaskRow.tsx`
  (the half-finished edit flagged as reverted) was redone cleanly: title → `text-body`,
  deadline chip → `text-meta`, selection tick icon → `text-primary-foreground`.
- Raw `<button>` count for the two folders cut from 200 to 100 — every clearly-actionable
  button (modal/dialog footers, icon actions, add/remove, retry/undo/import, toolbar
  Filter/Reset/Apply, search-clear, "Load more") is now kit `Button` with the matching
  variant/size, `loading` for async actions, and `Tooltip` on icon-only ones. Two
  hand-rolled toggles (`AssigneeVisibilityTab`'s `Toggle`, `ProofRequirementField`'s
  switch) became kit `Switch`; `ChecklistAccessEditor`'s "include sub-departments"
  control did too.
- The remaining ~100 raw buttons are the justified exceptions called for in the brief,
  not oversights: whole row/card/cell click targets (list rows, dashboard tiles, chart
  bars, tree rows, drill-down cards), segmented/toggle controls that are already a kit
  pattern (`LensToggle`, `ScopeSwitcher`, `ViewToggle`, status/kind/mode pill tabs,
  the all/some/none `CheckToggle` filter headers), calendar/matrix grid cells
  (`CrossDeptMatrix`'s heatmap), disclosure headers (the collapsible
  Reminders/Checklist/Escalation/Attachments cards — toggling the whole header, not a
  separate button), inline text actions (Retry/Reactivate/Hide-History/Clear-deadline,
  styled per §6.6/§6.7), and chip-remove icons too small for any kit `Button` size
  (18–24px pills in `ChecklistAccessEditor`, `RecurringFilterToolbar`,
  `TaskFilterChips`, `AssigneeSelector`, `TagList`) — kept raw with their existing
  styled hover/focus rather than forcing a 32px kit icon button into an 18px chip.
  `TaskCard.tsx`'s hand-rolled colour-pill status dropdown and `TaskSortControl.tsx`'s
  composite field+direction control are kept as deliberate custom interactions (D12) —
  not mechanically equivalent to `select.tsx`/`dropdown-menu.tsx`.
- `tsc --noEmit` filtered to `components/tasks/|lib/tasks/`: clean throughout.

## Tickets, workflows, projects

### Kept for owner decision

- `components/workflows/Sheet.tsx` (right-side slide-in panel, ~23 call sites) stays its
  own hand-rolled portal/overlay implementation (restyled to tokens: `bg-surface`,
  `shadow-dialog`, `z-(--z-dialog)`), rather than being rebuilt on kit `sheet.tsx`. Kit says
  sheets go through `sheet.tsx`; v2e's version already has the exact behaviour `sheet.tsx`
  specifies (portal, focus return, Escape deferring to a nested menu/dialog via
  `data-sheet-blocker`, slide transition) and rebuilding it risked regressing 23 call
  sites for a cosmetic-only win. Kept per D12; flagged for a dedicated pass.
- `components/workflows/useUnsavedChangesGuard.tsx`'s confirmation dialog (fixed
  inset-0, restyled to tokens: `bg-backdrop`, `bg-surface`, `rounded-card`,
  `shadow-dialog`, `rounded-control`) stays hand-rolled rather than `alert-dialog.tsx`,
  because it has a genuine three-button layout (Stay / Leave without saving / Save and
  leave) kit `alert-dialog.tsx` doesn't model. Kept per D12.
- `components/projects/GanttChart.tsx`'s `fmtDateLabel` (chart axis tick labels, "12 Aug"
  short form) kept as a local short date formatter rather than `lib/format.ts`'s
  `formatDate` (which always includes the year) — an axis densely repeating "12 Aug 2026"
  per tick would be unreadable. Everywhere else in this module now goes through
  `lib/format.ts`.
- Gantt/timeline visual in `components/projects/GanttChart.tsx`/`GanttBar.tsx` kept as-is
  structurally (D12/instructions), restyled to tokens only (today-marker dash now reads
  `var(--danger)`, hover tooltips `bg-text-primary`).

### Not done / follow-up

- Adapter call sites not migrated off `StyledSelect`/`DatePicker`/`Modal`/
  `ConfirmDialog`/`ResponsiveTable`/`Toast` onto the raw kit components directly: ~30
  import sites across `components/workflows/**` (ChangeCreatorDialog, InstanceDiscussion,
  InstanceList, RunDocumentsDrawer, RunStepDrawer, RunView, SendBackDialog,
  StartWorkflowModal, StepCard, StepTiming, useWorkflowActions, WorkflowBuilder),
  `components/projects/**` (CreateProjectWizard, MemberRow), and
  `app/dashboard/tasks/tickets/**` / `app/dashboard/projects/[id]/settings`. These
  adapters are already thin wrappers over the kit components per P3b (same visual
  result), so this is a direct-import cleanup, not a visual-regression risk; left for a
  follow-up pass given the volume (~30 sites) versus the rest of this module's scope.
- Several hand-rolled `<button className="bg-primary text-white rounded-[8px] ...">`
  "New X" / primary-action buttons (e.g. `app/dashboard/projects/page.tsx`,
  `templates/page.tsx`, `templates/new/page.tsx`) were not migrated onto kit `button.tsx`;
  spacing/radius on them is left at `rounded-[8px]` (not flagged by the required
  self-checks, but not the kit `Button` component). Flagged for follow-up.
- Pages in this module (ticket/workflow/project list and detail pages) were not rebuilt
  onto `PageHeader`/§11 list-page template zones; they kept their existing hand-rolled
  headers/toolbars, just restyled to tokens. A full §11 template migration (breadcrumbs,
  `PageHeader`, toolbar/pagination zones) is a larger structural pass than fit in this
  session and is left as follow-up, consistent with D1 (presentation/interaction only,
  but this module's screens use bespoke list/detail layouts rather than the kit's zones).
- Unbounded lists (D5/pagination note): `app/dashboard/tasks/tickets/**`,
  `app/dashboard/tasks/workflows/**`, `app/dashboard/projects/**` list pages all load
  their full result set client-side with no server pagination; left unchanged per D5.

### Visual changes the owner will notice

- Card surfaces across all three areas (ticket cards, workflow cards/panels, project
  cards, milestone/document/budget/template cards) now use `shadow-card`/`shadow-menu`
  (kit's faint/medium shadow tokens) instead of the previous one-off
  `shadow-[0_1px_3px_rgba(...)]`/`shadow-[0_8px_24px_rgba(...)]` values — slightly
  flatter at rest, a touch more lift on hover.
- All `font-semibold`/`font-bold` in this module (61 files) now render at `font-medium`
  (weight 500), per kit §3's two-weight rule. Headings/labels that previously looked
  bold now read as medium weight.
- Off-scale spacing (`p-5`, `gap-5`, `py-10`, `py-14`, `py-20`, etc., 37 files) moved to
  the nearest kit scale value (5→6, 7/9/10→8, 11/14/16/20→12). Card padding, empty-state
  vertical padding and section gaps are slightly larger or smaller than before (e.g. a
  `py-20` empty state is now `py-12`).
- The ticket "Delete this template?" `window.confirm()` on
  `app/dashboard/projects/templates/page.tsx` is now a styled `AlertDialog`
  ("Delete template" / "Cancel", danger action).
- The status filter `<select>` on `app/dashboard/projects/page.tsx` is now the kit
  `Select` component (same options, styled trigger/menu instead of the native control).
- All ad-hoc `toLocaleDateString`/`toLocaleString` calls (18 files) now go through
  `lib/format.ts`'s `formatDate`/`formatDateTime` — dates that previously showed as
  "12 Aug" or "Aug 12, 2026" (mixed `en-IN`/`en-US`, mixed day/month/year inclusion) now
  uniformly read "12 Aug 2026" / "12 Aug 2026, 3:45 PM" per kit §18.

### Self-check results (clean, this module's folders only)

- hex/rgba outside globals.css: none.
- `font-(semibold|bold|extrabold|black)`: none.
- native `confirm()/alert()/prompt()`: none (the one `.confirm(` hit was `ticketsApi.confirm(...)`, an API call, not the global).
- native `<select`: none.
- off-scale spacing (5/7/9/10/11/14/16/20): none.
- `fixed inset-0`: 2 remaining, both documented above as kept D12 overlays (Sheet.tsx, useUnsavedChangesGuard.tsx).
- `toLocale(Date|Time)?String`: none (one deliberate exception, GanttChart axis labels, documented above).
- adapter imports (`Modal|ConfirmDialog|StyledSelect|DatePicker|ResponsiveTable|Toast`): ~30 remain, documented above as follow-up.
- `npx tsc --noEmit` filtered to this module's folders: clean.
- `npm run test:unit` (components/workflows/__tests__): 69/69 pass.

### Second pass (owner asked for the kit actually followed, not just recoloured)

Done:
- **Back arrows / breadcrumbs:** removed the two remaining desktop back-arrow buttons
  (`app/dashboard/tasks/tickets/new/page.tsx`, `[ticketId]/page.tsx`) — replaced with
  `PageHeader`'s `trail` / a `Breadcrumb`, and (on the ticket wizard) a `SHOW_MORE_LINK`-styled
  "Back to templates" step control for the in-form wizard step, which is not page
  navigation.
- **PageHeader / §11 zones:** `app/dashboard/projects/page.tsx`, `managing/page.tsx`,
  `my/page.tsx`, `templates/page.tsx` rebuilt onto `PageHeader` (title + meta + the one
  primary action) with `EmptyState` (`nothing-yet`/`nothing-found`) in place of hand-rolled
  empty blocks and `Skeleton` in place of spinner divs.
- **Buttons/Badge/TextLink/Tooltip:** `templates/page.tsx`'s delete icon button →
  `Button variant="ghost" size="icon"` wrapped in `Tooltip`; its status pill → `Badge`;
  its "Edit" link → `TextLink`; all four project list pages' "New project"/"New template"
  →`Button render={<Link/>}`. The 3 native `title=` attributes left after the first pass
  (`components/workflows/RunView.tsx`, checklist/proof/comment icon hints) → `Tooltip`.
- **Type tokens:** full sweep. Every `text-xs/sm/base/2xl` and `text-[Npx]` arbitrary size
  in this module's files mapped to the nearest kit type token (`text-meta` 10-12px,
  `text-label` 13px, `text-body` 14-15px, `text-card-heading` 16-19px, `text-section` 20px,
  `text-page-title` 21-30px); the handful of sub-12px avatar-initial glyphs (`text-[8-9px]`)
  bumped to `text-meta` (12px minimum, per rule "nothing below 12px").
- **Spinners:** the remaining page-level `border-t-transparent rounded-full animate-spin`
  full-page loaders (`projects/[id]/page.tsx`, `[id]/settings/page.tsx`,
  `templates/[id]/page.tsx`, `tasks/tickets/reports/page.tsx`'s `Spinner()`) → `Skeleton`.

Not done (follow-up, in order of what would move the needle most):
- **~30 adapter call sites** (`StyledSelect`/`DatePicker`/`Modal`/`ConfirmDialog`/
  `ResponsiveTable`/`Toast`) still import the v2e adapter rather than the raw kit
  component directly (full list in the first-pass section above). These are visually
  identical today (the adapters are themselves thin kit wrappers per P3b) so this is a
  pure import-site cleanup, not a visual change — left for a dedicated pass given the
  volume relative to the rest of this second pass.
- **§11 template zones beyond the 4 project list pages:** the ticket list pages
  (`tickets/page.tsx`, `archive`, `assigned`, `my`), the workflow list page
  (`workflows/page.tsx`), and every detail/settings page in all three areas
  (`[ticketId]`, `projects/[id]`, `projects/[id]/settings`, `workflows/[id]`) were not
  rebuilt onto `PageHeader`/§11's toolbar+content+footer zones — they keep their existing
  hand-rolled headers (now on tokens/type-scale from the two passes above) rather than the
  template's exact zone structure. `[ticketId]/page.tsx` and `tickets/new/page.tsx` did
  get a breadcrumb (above) but not a full `PageHeader`/record-header rebuild.
- **Hand-rolled `<button>`/`<Link>` with `bg-primary text-white rounded-[8px]`
  classes → kit `Button`:** fixed on the 4 project list pages' primary actions only;
  dozens more remain across ticket/workflow/project detail and form pages (e.g. ticket
  new-ticket submit button, workflow builder's save/cancel row, project settings forms'
  add-member/save buttons) — same visual result today since they already carry the right
  tokens, but not the kit component.
- **Status-as-coloured-text → Badge:** fixed on `templates/page.tsx`'s is_active pill;
  the ticket priority/category pills in `[ticketId]/page.tsx` (inline `style={{
  backgroundColor: ... }}` using the record's own colour, not a fixed status) and other
  ad-hoc status spans across the module were not converted — several of these are
  user-chosen data colours (D7), not the fixed status vocabulary `Badge`'s variants model,
  so each needs a per-site judgment call rather than a mechanical swap.
- **`components/workflows/Sheet.tsx` vs kit `sheet.tsx`:** evaluated for a thin-wrapper
  rewrite as asked. Kit `sheet.tsx` is a Base UI `Root`/`SheetContent` composition with
  its own portal, focus-trap, Escape and phone-bottom-sheet behaviour; v2e's `Sheet.tsx`
  has a parallel but independently-coded version of the same contract, including one
  behaviour kit `sheet.tsx` has no equivalent knob for: deferring Escape to a nested
  menu/dialog via a `[data-sheet-blocker="true"]` query (so a dropdown or confirm opened
  from inside the panel gets Escape first). Rewriting it as a thin wrapper is possible in
  principle (`side="right"`, `SheetContent`/`SheetHeader`/`SheetBody`/`SheetFooter`,
  `className` overrides for the 520/640px widths) but risks silently losing that
  blocker-escape behaviour across its ~23 call sites without a dedicated
  interaction-testing pass this session didn't have room for — kept as-is (already
  restyled to tokens in the first pass) rather than risk a regression. Flagged as the one
  item in this module an owner-reviewed follow-up should prioritise.
- **`useUnsavedChangesGuard` vs kit `unsaved-changes.tsx`:** re-checked; unchanged from
  the first pass's finding. Kit's `useUnsavedChanges`/its `alert-dialog.tsx` pairing has
  no three-button ("Stay" / "Leave without saving" / "Save and leave") form, which this
  hook's dialog genuinely needs for workflow steps/runs with an offered inline save. Kept,
  tokens already applied.

Verification (second pass): `npx tsc --noEmit` filtered to this module's folders — clean.
`npm run test:unit` — 69/69 pass, unchanged.

## Settings, people, roles, access, holidays, leave, audit

Folders: `app/settings/**`, `app/dashboard/{employees,roles}/**`, `components/{employees,roles,role-builder,permissions,holidays,leave,audit}/**`.

### Kept for owner decision

- **Access-rights and role screens kept v2e's permission model and data (D1).** `app/settings/system/access-rights/page.tsx`
  follows FRONTEND_RULES_ACCESS.md §40's presentation (scope selects, module/sub-section
  grid, badges) but the underlying grid shape, module/action/scope vocabulary and the
  "subject eligibility" panel are v2e's own and were not restructured to match §40's
  exact column layout — only restyled to tokens and migrated off the native `<select>`.
- **Hand-rolled overlay shells in the employee/role import and detail flows** (`AddEmployeeModal.tsx`,
  `ImportEmployeesModal.tsx`, `ImportJobRolesModal.tsx`, `ImportHolidaysModal.tsx`, the edit/delete
  dialogs inside `app/dashboard/employees/[employeeId]/page.tsx`, and the slide-in drawers
  `RoleFormDrawer.tsx`/`RoleInfoPanel.tsx`) still use their own `fixed inset-0` backdrop + manual
  open/close state instead of `Dialog`/`Sheet`. These are multi-step wizards (file upload, column
  mapping, validation, undo) and an always-mounted slide-in drawer animated by `translate-x`, not a
  simple open/close dialog; porting them onto `Dialog`/`Sheet`'s own open/close and focus-management
  contract is real behavioural surgery (each has 2-5 internal steps and async state), not a restyle,
  so it was left on v2e's existing shell, with colours/radii/shadows already on tokens
  (`bg-surface`, `shadow-menu`, `bg-black/40` backdrop kept — not yet the shared `--backdrop` token).
  Flagged per D12/ADAPTERS.md's own note that this is real follow-up work, not a rushed wrapper.
- **Holiday calendars kept (per brief), restyled to tokens only**: `HolidayCalendar.tsx`,
  `OrgHolidayCalendar.tsx`, `CascadeTargetTree.tsx`, `WorkingDaysStrip.tsx`/`WorkingWeekStrip.tsx` keep
  their existing custom grid/strip visuals, now on kit colour/spacing/radius/shadow tokens.
- **Employee import modal re-skinned in place (D11)**: `ImportEmployeesModal.tsx` keeps its own
  structure (not unified with the other four product import modals) — colours, weights and spacing
  moved to tokens; the overlay shell itself is the D12 item above.

### Not done / follow-up

- `fixed inset-0` hand-rolled overlays: 10 occurrences across 7 files (listed above) not converted to
  `Dialog`/`Sheet`/`AlertDialog` — see "Kept for owner decision". Still not done after the second pass
  either: given the second pass's time went to the toast correctness bug below plus the mandatory
  adapter migrations, the overlay conversions (the coordinator's item 1) did not get done. These remain
  real follow-up work, not a rushed wrapper — see the reasoning in "Kept for owner decision" above.
- Adapter imports: down from 17 files to 13. Migrated off this pass: `StyledSelect` (access-rights'
  two `ScopeSelect`s, `EmployeePermissionsPanel`'s override-scope select, `HolidayFormModal`'s type
  select — all now `select.tsx` directly), `ConfirmDialog` (access-rights' role-delete confirmation,
  now `alert-dialog.tsx` directly), and `useToast` (all 7 call sites in this module, now `sonner.tsx`'s
  `toast` directly). Still on the adapter and not migrated: `Modal` (4 files: `AddEmployeeModal`,
  `ImportEmployeesModal`, `ImportJobRolesModal`, `ImportHolidaysModal` — these are the same multi-step
  wizard shells listed as `fixed inset-0` follow-up above, so migrating `Modal`→`Dialog` there is the
  same piece of work as the overlay conversion, not separate), `DatePicker` (6 files), `ResponsiveTable`
  (5 files). `StyledSelect` also remains on 2 files (`AddEmployeeModal`'s and the employee detail
  page's department/role/reports-to pickers) where the option list is data-driven and can exceed 6
  items, so each needs a considered `Select` vs `SearchableSelect` choice rather than a mechanical swap
  — not done this pass.
- `toLocaleDateString` with no year — **resolved this pass**: the coordinator added
  `formatDayMonth`/`formatWeekday` to `lib/format.ts` (commit 78600ae); `OrgHolidayList.tsx` and
  `PendingHolidayReviewer.tsx` now use them. Zero `toLocale*String` calls remain in this module.
- PageHeader (§11, §12.3), Button/icon-button/TextLink migration (§6), and switch/checkbox/radio-group
  migration — the coordinator's items 3 and 4 — were **not attempted this pass**. Given the toast bug
  (below) ate a large share of the second pass's time, and the mandatory adapter migrations were
  prioritised per the coordinator's explicit ordering, these are honestly left undone: no page in this
  module gives its title/breadcrumb/primary action through `PageHeader` yet, hand-rolled `<button>`
  markup is still widespread (41 files had at least one `<button` as of the second pass), and no
  switch/checkbox in this module was checked against `switch.tsx`/`checkbox.tsx`/`radio-group.tsx`.
  This is the single largest remaining item for this module, same as other modules reported.
- Pagination (D5): `app/dashboard/employees/page.tsx`, `app/dashboard/roles/page.tsx` and the audit
  log list render unbounded/current-loading lists with no server pagination added, per the brief.
- `z-60`/`z-70`/`z-50` on the hand-rolled overlays above are ad-hoc numbers, not the shared
  `--z-dialog`/`--z-popover` tokens (section 5.5) — left alongside the overlay shells themselves
  rather than partially tokenising one piece of a file that otherwise keeps its own stacking logic.

### A bug found and fixed in this module's own earlier work

The first pass's `useToast`→`sonner` codemod (commit `8cd2a26`) used a lazy regex
(`addToast\(([\s\S]*?),\s*'TYPE'\)`) to rewrite call sites. For any call whose toast type was a runtime
expression rather than a literal (`addToast(msg, cond ? 'warning' : 'success')`), the regex's lazy
`[\s\S]*?` skipped past that call (no literal `'success'`/`'error'` immediately before its own closing
paren) and matched against the *next* call's literal type instead, silently merging the two: the first
call's text became the wrapper, and the second call's own type argument was deleted. Net effect: several
genuine `success`/`error` toasts were swapped or silently dropped (e.g. "Access saved" fired as an error
toast; a load failure fired as if it succeeded). `npx tsc --noEmit` did not catch most of these (sonner's
functions all accept a plain string, so the swap type-checks fine) — only the two calls that happened to
leave a literal second argument on a type-mismatched function (`toast.success(msg, 'error')`) surfaced as
TS2559 errors. Found by re-deriving every call site from the commit's own diff and comparing by hand
against the live file. Fixed in commit `00216a3` across `access-rights/page.tsx` (10 swapped calls),
`leave-rules/page.tsx` (2), `MyLeavePanel.tsx` (2), and `ImportEmployeesModal.tsx`/`ImportJobRolesModal.tsx`
(2 each, rewritten as explicit `if/else` since sonner has no single call taking the type as a runtime
string). Recorded here in case another module's agent used the same regex pattern on their own
`useToast` call sites — worth a quick grep for `addToast\(.*\?.*:.*'(success|error|warning)'` elsewhere.

### Visual changes the owner will notice

- All `font-semibold`/`font-bold`/`font-extrabold` in this module (49 files touched by the sweep)
  now render at `font-medium` (weight 500) per kit §3.
- Hex/rgba colours (card backgrounds, borders, shadows, grey icon tints, a few dark "chip"
  colours) replaced with kit tokens: `bg-white` → `bg-surface`, `rounded-[12px]` → `rounded-card`,
  `rounded-[10px]`/`rounded-[8px]`/`rounded-[6px]` → `rounded-xl`/`rounded-lg`/`rounded-md`,
  assorted `shadow-[...]` → `shadow-card`/`shadow-menu`, `text-[#CBD5E1]` → `text-text-muted`, the
  dark "undo toast" and a few status chips → `bg-text-primary`/`text-surface`.
- Off-scale spacing (`p-5`, `gap-5`, `mt-7`, `py-10`, `py-16`, `py-20`, etc. — 31 files) moved to the
  nearest kit scale value (5→4, 7→6, 9/10→8, 11/14/16/20→12); card padding and empty-state vertical
  padding are slightly tighter than before in a few places (e.g. a `py-20` empty state is now `py-12`).
- Native `<select>` elements (access-rights scope pickers, the employee edit form's department/job
  role/employment type/status/reports-to fields, the permission-override scope picker, the holiday
  type picker) are now the kit-styled `StyledSelect` dropdown instead of the browser's native control.
- Dates that used `toLocaleDateString('en-IN', ...)`/`toLocaleString()` ad hoc (holidays list, leave
  dates, audit timestamps, import batch timestamps — 9 files) now render through `lib/format.ts`'s
  `formatDate`/`formatDateTime`, which is the same "12 Aug 2026" / "12 Aug 2026, 3:45 PM" shape these
  already produced, so no visible format change is expected there.

### Self-check results (this module's folders only, after the second pass)

- hex/rgba outside globals.css: none.
- `font-(semibold|bold|extrabold|black)`: none.
- native `confirm()/alert()/prompt()`: none found.
- native `<select`: none (two remaining grep hits are code comments, not markup).
- off-scale spacing (5/7/9/10/11/14/16/20): none.
- `fixed inset-0`: 10 remaining, documented above as kept/follow-up (unchanged from pass 1).
- `text-xs/sm/base/lg/xl/2xl` and arbitrary `text-[Npx]`: none remaining; all on kit type tokens,
  nothing below 12px.
- `toLocale(Date|Time)?String`: **0 remaining** (was 4; resolved via the coordinator's
  `formatDayMonth`/`formatWeekday` additions to `lib/format.ts`).
- adapter imports (`Modal|ConfirmDialog|StyledSelect|DatePicker|ResponsiveTable|Toast`): 11 files
  remain (was 17) — `Modal` (4), `DatePicker` (6, one of which is also `Modal`), `ResponsiveTable`
  (5), `StyledSelect` (2). `ConfirmDialog`'s last call site (`MyLeavePanel.tsx`'s cancel-leave
  confirmation) is now also migrated to `alert-dialog.tsx` directly — 0 `ConfirmDialog` imports
  remain in this module. See "Not done / follow-up" for the rest.
- `PageHeader` adoption: 0 of this module's pages — not attempted this pass, see follow-up.
- `npx tsc --noEmit` filtered to this module's folders: clean after every commit below.

### Commits

Pass 1: `78df27d` (tokens/weights/spacing/dates), `ff3dcaa` (native `<select>`→`StyledSelect`).
Pass 2 (this round): `5065052` (type scale to kit tokens), `5c86f5b` (last 4 `toLocale` calls to
`lib/format.ts`'s new `formatDayMonth`/`formatWeekday`), `8cd2a26` (`useToast`→`sonner` — **introduced
the toast-swap bug described above**), `00216a3` (fixes that bug by hand), `550465f`
(`StyledSelect`/`ConfirmDialog`→`select.tsx`/`alert-dialog.tsx` directly, 3 files), plus one more commit
migrating `MyLeavePanel.tsx`'s `ConfirmDialog` to `alert-dialog.tsx`.

## M1a — Tasks pages (`app/dashboard/tasks/**`, excluding `tickets/**` and `workflows/**`)

*(Revised after a second pass — the coordinator corrected that `components/shell/page-header.tsx`
is available with breadcrumb support, and asked for PageHeader adoption, overlay conversion,
adapter migration and a Button/Badge/Tooltip/EmptyState/type-token pass. See "Second pass" below
for what that added; "Kept for owner decision" / "Not done" reflect the state after both passes.)*

### Kept for owner decision

- **Kit says:** destructive/irreversible actions confirm through `alert-dialog.tsx`, danger by
  default, closing only via Cancel or the action (§15, §24 rule 3). **v2e did:** 7 native
  `confirm()` calls in `masters/page.tsx` (category/stage/type/priority/resolver-group delete,
  ticket-template archive) plus 3 hand-rolled confirmation overlays in `recurring/page.tsx` and
  `[taskId]/page.tsx`. **Done:** all 10 now use `components/ui/alert-dialog.tsx` directly (a shared
  local `ConfirmDeleteDialog` in `masters/page.tsx`, inline `AlertDialog` in the other two), each
  keeping its own wording and verb.
- **Kit says:** every screen's title/breadcrumb/actions come through `PageHeader` (§11, §12.3), and
  no back-arrow button on a desktop/tablet page (§1 rule 11, §11.2). **v2e did:** every page hand-
  rolled its own `<h1>`, and several used a bordered `ArrowLeft` icon button or a "← Back"/"← Reports"
  text link as their way back. **Done:** all 20 pages in this module now give title/meta/actions
  through `PageHeader` with a `Tasks` (and, where applicable, `Tasks > Reports` / `Tasks > Recurring`
  / `Tasks > Reports > Person Scorecard`) breadcrumb trail, and every `ArrowLeft` back-arrow button
  is removed. On `[taskId]/page.tsx` the page's many status-dependent action buttons and its
  overflow menu (Activity log, Delete) are **not** folded into `PageHeader`'s single `actions` slot —
  they stay in their own row directly below the header, unchanged. They are not a single "one
  primary action" the way `PageHeader` models it (the page already has more than one button beside
  the title, pre-existing), and refactoring that button cluster's own hierarchy was out of scope for
  this pass; only the Edit pencil moved into `PageHeader`'s `actions`.
- **Kit says:** loading uses skeletons, never a spinner (§14 rule 1). **v2e does:** a hand-rolled
  `Spinner()` (a spinning-border div) is reused across most of `masters/page.tsx`'s tabs, and a
  handful of other pages use the same spinning-border div inline (`my`, `assigned`, `reports`,
  `people/[userId]`, etc.). **Not done:** each tab/page's content shape differs enough that a
  faithful skeleton needs per-screen layout work, not a drop-in swap; left as the largest remaining
  item (see below).

### Second pass (PageHeader, overlays; adapters and the type/button pass still open)

1. **PageHeader + breadcrumb, all 20 pages.** `my`, `assigned`, `escalated`, `cc`, `collective`,
   `archive`, `delegation`, `leave-approvals`, `people/[userId]`, `recurring`, `recurring/[id]`,
   `masters`, `page.tsx` (Work Overview), `reports.tsx` (Analytics), and `reports-new/{page,ageing,
   calendar,person-scorecard,person-scorecard/[userId]}` all now use `PageHeader`. Every
   `ArrowLeft` back-arrow button in this module's files is gone (confirmed by
   `grep -rn "ArrowLeft" app/dashboard/tasks` excluding tickets/workflows → no hits). Three in-form
   "back to list" arrow buttons in `masters/page.tsx` were dropped outright rather than converted —
   each form already has a Cancel button in its footer doing the same thing, so keeping the arrow
   too would have duplicated the action (§4 rule 2 reads this as one decision either way; dropping
   it was the smaller change). `people/[userId]`'s and `person-scorecard/[userId]`'s denied/no-
   access states keep a secondary `Button` ("Back to Overview"/"Back to roster") — that's a
   deliberate "no dead ends" exit, not a back-arrow icon button, so it stays.
2. **5 `fixed inset-0` overlays converted.** `archive/page.tsx`'s task-snapshot preview →
   `Dialog` (`size="lg"`). `recurring/page.tsx`'s stop/delete-template confirmation (a
   `createPortal` overlay with its own danger/primary wording per mode) → `AlertDialog`.
   `[taskId]/page.tsx`'s comment-delete and attachment-delete confirmations → `AlertDialog`; its
   Activity Log viewer → `Dialog` (`size="md"`). All five previously had hand-written
   Escape/backdrop-click/body-scroll-lock code, which the kit components now do themselves.
   `createPortal`'s import is gone from both files now that nothing in them uses it directly.
3. **`useToast` → `sonner` directly.** The 5 files that called `useToast().addToast(msg, type)`
   (`assigned`, `leave-approvals`, `my`, `page.tsx`, `[taskId]`) now import `toast` from
   `components/ui/sonner` and call `toast.success/warning/error/message(msg)` directly.
4. Several hand-rolled buttons that sat beside a new `PageHeader` were migrated to
   `components/ui/button.tsx` in the same edit (Create Task, New Recurring Task, New delegation,
   Download/Retry/Clear-filter actions, etc.); `reports/page.tsx`'s "Clear" filter button was also
   corrected from the `danger` variant to `secondary` — clearing a date filter isn't destructive.

### Not done / follow-up

- **17 call sites still import `StyledSelect` / `DatePicker` / `DateRangePicker` / `ResponsiveTable`**
  rather than the kit `select.tsx`/`searchable-select.tsx`/`date-picker.tsx`/`calendar.tsx`/
  `table.tsx` directly (`masters`, `page.tsx`, `recurring/[id]`, `[taskId]`, `reports.tsx`,
  `reports-new/{ageing,calendar,person-scorecard,person-scorecard/[userId]}`, `archive`,
  `leave-approvals`). Looked at `components/ui/DateRangePicker.tsx` specifically to judge whether
  this is worth forcing: it is already built directly on the kit's own `calendar.tsx` (react-day-
  picker `mode="range"`) and `popover.tsx` — it is not a leftover v2e-styled duplicate, it is a
  small reusable wrapper that keeps v2e's `{from, to}` ISO-string contract over the kit's own
  parts, the same relationship `date-picker.tsx` itself has to `calendar.tsx`. Per P3b's notes
  `StyledSelect`/`ResponsiveTable` are the same shape (thin adapters that render `select.tsx`/
  `searchable-select.tsx`/`table.tsx` underneath), so what a user actually sees is already kit-
  correct; only the import path says "adapter". Forcing every call site onto the kit name directly
  would mean manually counting each site's option list to pick `Select` vs `SearchableSelect` and
  re-deriving each table's column defs against `table.tsx`'s API, across several of this module's
  largest files (`masters.tsx` at ~1.9k lines, `[taskId].tsx` at ~2.3k) — real work, correctly
  flagged by the coordinator, not completed in this pass; a dedicated follow-up should do it file by
  file rather than as a mechanical sweep.
- **Spinners not converted to `Skeleton`.** `masters/page.tsx`'s shared `Spinner()` and the
  inline spinning-border divs on `my`, `assigned`, `escalated`, `cc`, `collective`, `reports.tsx`,
  `people/[userId]` and others still show a spinning circle instead of a content-shaped skeleton.
  Not attempted: a correct skeleton needs each screen's actual row/card shape, which is real design
  work per screen, not a class-name substitution.
- **Button/Badge/Tooltip/type-token sweep not done beyond what PageHeader/overlay/toast work
  already touched.** Status text colours, `text-[Npx]` arbitrary sizes, and `title=` native
  tooltips remain in several files (e.g. `reports-new/calendar/page.tsx`'s month-switcher buttons
  use `title=` instead of `Tooltip`; many report/detail pages still size headings with
  `text-[26px]`/`text-[22px]` rather than the §3 type tokens). This is a real, separately-sized
  pass across the same large files as the adapter migration above; not completed here.
- **[taskId]/page.tsx's action-button cluster** (status buttons, the overflow menu) is still a
  hand-built row, not re-modelled around `PageHeader`'s one-primary-action assumption — see "Kept
  for owner decision" above.
- **Unbounded lists (D5 / §1 rule 7):** `masters/page.tsx` (categories, priorities, statuses, types,
  resolver groups, templates), `recurring/page.tsx`, `archive/page.tsx` and others render every row
  the API returns, no pagination. No backend pagination endpoint exists for these yet, matching D5;
  not changed here.
- Native `<select>` elements: none found in this module's files.
- Data colours (task tag palette, calendar heat colours, chart series in `reports/page.tsx` and
  `reports-new/**`) left as data per D7, not touched.

### Visual changes the owner will notice

- Every page in this module now shows a `Tasks` (or `Tasks > Reports`, `Tasks > Recurring`)
  breadcrumb above its title, and no page shows a back-arrow button any more.
- `masters/page.tsx`'s 7 delete/archive/deactivate confirmations, `recurring/page.tsx`'s
  stop/delete-template confirmation, and `[taskId]/page.tsx`'s comment/attachment-delete
  confirmations now open a centred kit dialog instead of the browser's native confirm box or a
  hand-rolled one — same wording, same destructive intent, kit-styled and kit-animated.
  `[taskId]/page.tsx`'s Activity Log is now a proper `Dialog` instead of a hand-rolled panel.
- `font-semibold`/`font-bold` everywhere in this module now render at weight 500 (`font-medium`)
  per kit §3 — no more bold task titles, bold empty-state headings, or bold button labels.
- `bg-white` → `bg-surface`, ad-hoc `rounded-[Npx]` → `rounded-card`/`rounded-control`, and ad-hoc
  `shadow-[...rgba...]` → `shadow-card`/`shadow-dialog` across every card, panel, dropdown and
  tooltip in this module. No layout change, token-equivalent visual weight.
- Off-scale spacing (`p-5`, `gap-5`, `py-16`, `py-20`, etc.) rounded to the nearest kit scale value;
  a few empty-state blocks that used `py-16`/`py-20` are now slightly less tall (`py-12`).
- Dates that used `toLocaleDateString`/`toLocaleString` ad hoc and plain-number counts in
  `reports-new/{ageing,calendar,person-scorecard}` now render through `lib/format.ts`. The
  future-task banner on `[taskId]` also lost its ⌛ emoji (icons are Lucide-only per §23).
- Several primary buttons beside a page title (Create Task, New Recurring Task, New delegation,
  Download, Retry) now render as the kit's `Button` rather than a hand-rolled `<button>` — same
  label, kit's fixed height/hover/pressed/focus states.

### Self-check results (this module's folders, excluding `tickets/**` and `workflows/**`)

- hex/rgba outside globals.css: none.
- `font-(semibold|bold|extrabold|black)`: none.
- native `confirm()/alert()/prompt()`: none.
- native `<select`: none.
- off-scale spacing (5/7/9/10/11/14/16/20): none.
- `fixed inset-0`: none (all 5 converted).
- `toLocale(Date|Time)?String`: none.
- `ArrowLeft` (back-arrow buttons): none.
- adapter imports (`Modal|ConfirmDialog|StyledSelect|DatePicker|DateRangePicker|ResponsiveTable|
  Toast`): `Toast`/`useToast` gone; `Modal` (3 sites: `assigned`, `leave-approvals`, `my`),
  `StyledSelect` (6 sites: `masters`, `page.tsx`, `recurring/[id]`, `[taskId]`, `reports-new/
  {ageing,calendar}`), `DateRangePicker` (5 sites: `page.tsx`, `reports.tsx`, `reports-new/
  {person-scorecard,person-scorecard/[userId]}`), `ResponsiveTable` (3 sites: `archive`,
  `leave-approvals`, `reports.tsx`) still import the adapter path — documented above as follow-up.
- `npx tsc --noEmit` filtered to `app/dashboard/tasks/(?!tickets|workflows)`: clean, both passes.

### Commits

- `8e15953` — mechanical token/format sweep + `masters/page.tsx`'s 7 `confirm()` calls to
  `AlertDialog`.
- `02da0d7` — off-scale spacing rounded to the kit scale.
- `80495b3` — `useToast` adapter to `sonner` `toast` directly (5 files).
- `a9a831e` — My Tasks / Assigned by Me / Escalated / CC'd / Collective View onto `PageHeader`.
- `8888b10` — Archive / Delegation / Leave Approvals / `people/[userId]` / Recurring onto
  `PageHeader`, dropping back arrows.
- `41e20a1` — `masters/page.tsx` onto `PageHeader`, dropping 3 in-form back arrows.
- `17a7d74` — `reports-new/**` onto `PageHeader`, dropping back arrows.
- `21045fc` — `reports/page.tsx` (Analytics) onto `PageHeader`.
- `360e98e` — Work Overview (`page.tsx`) onto `PageHeader`.
- `29ff1b8` — `[taskId]` detail page onto `PageHeader`, dropping the back arrow.
- `af7fb2a` — archive snapshot modal to kit `Dialog`.
- `5aa0064` — recurring delete-confirm overlay to kit `AlertDialog`.
- `d86214a` — `[taskId]`'s 3 remaining overlays to kit `Dialog`/`AlertDialog`.

### Wave 2 finishing pass (W2)

Closed the three items the first pass left open above. Type scale: all `text-xs/sm/base/lg/xl/2xl/
3xl` and `text-[Npx]` arbitrary sizes (354 named + 180 arbitrary, the latter missed by the brief's
own count-regex — its trailing `\b` doesn't match before `]`) now use kit tokens; `bg-white`/
`text-white` (65) → `bg-surface`/`text-primary-foreground`. Spinners: `masters/page.tsx`'s shared
`Spinner()` (used by ~12 tabs) and every remaining inline spinning-border div across the module →
`Skeleton`, shaped to each screen's content; `masters/page.tsx`'s hand-rolled `role="switch"`
`Toggle` → kit `Switch`. Buttons: raw `<button>` count for this module went from 169 to 34, all
documented exceptions (row/cell click targets, segmented/tab/radio-style choice controls that
aren't literally `button.tsx` cases — all given the kit's focus-visible ring). Two hand-rolled
dropdown menus (`recurring/page.tsx`'s stop/delete popup, `[taskId]/page.tsx`'s kebab menu) moved
to kit `DropdownMenu`, dropping their own outside-click/Escape listeners. One true duplicate action
removed in `recurring/[id]/page.tsx` (a "View Task" button beside a task-title link going to the
same place, and a "Download" button beside a file-name button that already downloaded it).
Still open: the 17 `StyledSelect`/`DatePicker`/`DateRangePicker`/`ResponsiveTable` adapter imports
and native text `<input>`/`<textarea>` fields not yet moved to kit `Input`/`Textarea` (out of this
pass's scope per the W2 brief's checklist). `npx tsc --noEmit` filtered to this module: clean
throughout, commits `860b505`..`29a7723`.

## Governance (meetings, work log, decisions, rhythms, reports) and the dashboard home

Folders: `app/dashboard/governance/**`, `app/dashboard/page.tsx`, `app/dashboard/layout.tsx`,
`app/dashboard/more/**`, `app/dashboard/notifications/**`, `app/dashboard/performance/**`,
`app/dashboard/profile/**`, `components/meetings/**`, `components/work-logs/**`,
`components/delegation/**`, `components/dashboard/**`, `components/reports/**`,
`components/notifications/**`, `lib/reports/**`.

### What was done

- Tokens: every hex/rgba in this module's files replaced. Dynamic busy/free heat-scale colours
  (FindTimeDialog's density heatmap, WeekGrid's "today" tint and time-block hatch pattern) now
  use color-mix() over --success/--danger/--warning/--text-muted/--primary-subtle instead of
  hardcoded hex with manual opacity math - same visual read, token sourced. bg-white and ad-hoc
  rounded-[Npx]/shadow-[...rgba...] replaced with bg-surface/rounded-xl/rounded-lg/shadow-card/
  shadow-dialog across governance pages and meetings components.
- Weights: font-semibold/font-bold to font-medium throughout.
- Spacing: off-scale utilities (p-5, gap-7, py-9, etc.) snapped to the nearest section 5.1 scale
  value across all files that had them.
- Type sizes: sub-12px arbitrary sizes (text-[8px]..text-[11px]) bumped to text-meta (12px)
  across governance/meetings/work-logs/dashboard/reports.
- Native controls: work-log/access/page.tsx's two native <select>s to SearchableSelect; its two
  hand-rolled toggle switches to kit Switch; its hand-rolled checkbox list to kit Checkbox; its
  Add button to kit Button.
- Overlays to Dialog: WishModal, DemandModal, GoogleCalendarConnect (its connect/disconnect
  modal; its hand-rolled toast also moved to sonner's toast), and MeetingAttendeeSelector's
  attendee picker - all converted from hand-rolled fixed inset-0 plus backdrop markup to kit
  Dialog/DialogContent/DialogHeader/DialogBody/DialogFooter, keeping each one's own fields,
  validation and submit behaviour unchanged.
- PageHeader adoption: app/dashboard/page.tsx (dashboard home, section 11.4), governance/
  decisions, governance/meetings/reports, governance/meetings/rhythms, governance/reports,
  governance/work-log/demands, governance/work-log/review, dashboard/notifications,
  dashboard/performance, dashboard/profile now give their title/meta/breadcrumb/primary action
  through PageHeader instead of a hand-rolled h1 block. Two desktop back-arrow Links
  (governance/meetings/reports, governance/meetings/rhythms) removed and replaced by
  PageHeader's breadcrumb trail (section 1.11).
- Dates: toLocaleDateString/toLocaleString replaced with lib/format.ts's
  formatDate/formatDateTime/formatWeekday/formatDayMonth wherever they match "DD Mon YYYY" /
  "DD Mon YYYY, h:mm A"; where a caller genuinely needed a long weekday name with no kit helper
  (daily-update's day-of-week heading, work-log/review's log date), date-fns's format() is used
  instead of toLocaleDateString - still not browser-locale-dependent, and date-fns is already a
  pinned kit dependency.
- Loading state: dashboard/notifications's spinner replaced with Skeleton blocks (section 14).

### Kept for owner decision

- DateStatusTag.tsx (components/reports) hand-rolls its own status chip with inline
  style={{backgroundColor, color, border}} instead of badge.tsx, including a handed_over slate
  variant and a tooltip-via-title that explains the frozen lateness/new-owner story. Kit says
  "status is always a Badge" (2.4/4.1), but this chip's behaviour (freezing a figure at
  handover, a non-standard 5th colour, and a long explanatory tooltip) is bespoke reporting
  logic the kit's badge.tsx doesn't model. Kept as-is per D12 rather than force a lossy
  migration; flagged for a dedicated pass if the owner wants it unified with badge.tsx.
- Module filter pills on dashboard/notifications (All / Tasks / Projects / ...) stay as
  hand-rolled toggle buttons rather than tabs.tsx or section-tabs.tsx: they filter a list in
  place, not route to sibling views in the URL, so section-tabs.tsx (section 33, URL-driven)
  doesn't fit; kept restyled to tokens only.
- MeetingAttendeeSelector, GoogleCalendarConnect, WishModal, DemandModal dialogs keep their own
  multi-step internal state (search/select, connect/disconnect, send) inside DialogBody rather
  than being split into separate dialogs - matches D12 and the coordinator's note that
  multi-step flows keep their steps in the dialog body.

### Not done / follow-up (honest list)

- Adapters not migrated off in this module: DatePicker/TimeField call sites in
  components/meetings/{CreateMeetingModal,CreateTimeBlockModal,EditMeetingModal,FindTimeDialog,
  MeetingScheduleTab,CreateRhythmModal}.tsx and components/work-logs/DemandModal.tsx. These are
  the richer min/max/marked-dates and 12h-popover adapter contracts from P3; mechanically
  swapping each call site to the raw kit date-picker.tsx/time-picker.tsx across these
  scheduling-heavy files was judged a real review-each-call-site task, not a safe mechanical
  pass, given the risk of silently changing a recurrence/scheduling form's behaviour.
  useToast/Toast.tsx call sites in this module (meetings, work-logs, delegation) are still on
  the adapter; it is already a thin pass-through to sonner (P3), so no behaviour differs, but
  they were not rewritten to import toast from sonner directly.
- fixed inset-0 still hand-rolled in FindTimeDialog.tsx (a full-screen time-finder with its own
  per-person/aggregate grid, drag-select and heatmap - a genuinely different shape than Dialog),
  MonthDayPanel.tsx (a hover-tooltip-style popover anchored to a calendar cell, built as a
  fixed-position catcher, not a dialog), WeekGrid.tsx (a transparent click-outside catcher
  behind a floating panel, not an overlay itself) and PendingDrillDrawer.tsx (a right-edge
  drill-down drawer over a report table - a candidate for kit Sheet with side="right", but not
  attempted here: the drawer's sortable/stickied table body and backdrop-click-to-close needed a
  careful behavioural diff against sheet.tsx that there wasn't time to do safely). All four are
  logged rather than forced; each would benefit from a dedicated pass.
- PageHeader not adopted on the remaining pages in this module: governance/meetings/page.tsx
  (calendar/week/month/day view switcher with its own toolbar - its view controls are tightly
  coupled to the page body, not a plain header), governance/meetings/[meetingId]/page.tsx and
  governance/meetings/rhythms/[rhythmId]/page.tsx (detail pages needing a proper section 11.2
  breadcrumb trail plus record header treatment, not the list-page pattern used elsewhere in
  this pass), governance/work-log/access/page.tsx (controls migrated this pass; header left for
  follow-up), governance/work-log/page.tsx, governance/page.tsx, app/dashboard/more/**. Budget
  ran out before a correct-trail, correct-template pass on these.
- Pagination (D5): dashboard/notifications's list and the governance report/decision tables
  render whatever the API returns, unbounded - no server pagination exists to call. Noted per
  D5, not fixed.
- Status colours: did not do a full section 2.4 "one status to one colour map" audit of every
  status word across meetings/rhythms/work-log statuses against badge.tsx's variants; several
  already use Badge correctly post-P2, but the module-colour chips on dashboard/notifications
  were left as their own MODULE_COLORS map rather than converted to Badge, since module colour
  there is a category tag, not a section-2.4 status.

### Self-check results (this module's folders)

- hex/rgba outside globals.css: none.
- font-(semibold|bold|extrabold|black): none.
- native confirm()/alert()/prompt(): none (the one "confirm" hit is a local function name in
  FindTimeDialog.tsx, not a native dialog call).
- native <select: none.
- off-scale spacing (5/7/9/10/11/14/16/20): none.
- fixed inset-0: 4 remaining (FindTimeDialog, MonthDayPanel, WeekGrid, PendingDrillDrawer - see
  follow-up above).
- toLocale(Date|Time)?String: none.
- adapter imports (Modal|ConfirmDialog|StyledSelect|DatePicker|ResponsiveTable|Toast): still
  present in the 7 files listed under follow-up above.
- npx tsc --noEmit filtered to this module's folders: clean throughout.

### Commits

Work in this module landed in the shared worktree (all module agents commit into the same
working tree per the brief). This agent's own commit is a1b0b1f (tokens/weights/spacing/
native-controls/first Dialog migrations). A later batch (PageHeader adoption, back-arrow
removal, remaining token/date sweep) was staged by this agent but got folded into a concurrent
commit by another module agent (b3a0f9b, "goals-learning-communication") when the shared git
index was mid-commit at the same time - the content is this agent's, the attribution on that
commit is not. npx tsc --noEmit was clean for this module's folders at every checkpoint.

## Goals, Learning, Communication

Module folders: `app/goals/**`, `app/learning/**`, `app/communication/**`,
`components/{goals,learning,communication}/**`, `lib/learning/**`.

### Done

- Mechanical token pass over every file in the module: `font-semibold/bold` -> `font-medium`;
  off-scale spacing (`p-5`, `py-16`, `py-20`, `mb-5`, `gap-5`, etc.) mapped onto the section 5.1
  scale; arbitrary `text-[Npx]` mapped onto the kit type tokens; arbitrary `rounded-[Npx]` mapped
  onto `rounded-control`/`rounded-card`; `bg-white`/`text-white`/hex/rgba replaced with
  surface/text/primary-foreground tokens (`components/learning/OfficeViewer.tsx`'s injected
  `<style>` now reads CSS vars instead of hex).
- `toLocaleDateString`/`toLocaleString` call sites (announcements, bulletin, knowledge, messages,
  `GoalDetailView`, `GoalTrajectory`) now go through `lib/format.ts` instead of a second,
  locale-dependent formatter. `components/goals/shared.tsx`'s own `formatDate`/`formatDateTime`
  now delegate to `lib/format.ts`.
- `LearningAdminSidebar` and `CommunicationSidebar` (hand-rolled dark sidebars duplicating
  `ModuleSidebar`) migrated onto the shared `components/layout/ModuleSidebar` (section 4 rule 2,
  section 12.1).
- All 5 native `<select>` elements in the module (announcements/new, bulletin, knowledge/new)
  migrated to `StyledSelect`.
- `components/goals/shared.tsx`'s local `EmptyState`/`CountBadge` (duplicates of kit
  `empty-state.tsx` / `badge.tsx`'s `Count`) removed; every call site (`GoalListView`,
  `GoalDetailView`, `goals/dashboard`, `goals/my-check-ins`) now uses the kit component with the
  matching closed variant (`nothing-yet`, `nothing-found`, `not-found`, `failed`,
  `nothing-waiting`); `PermissionsUnavailable` now a thin wrapper over `EmptyState variant="failed"`.
- Every hand-rolled `fixed inset-0` overlay in the module converted to kit `Dialog`, behaviour
  preserved: `learning/paths/[pathId]`'s "Assign course"; `communication/company-policy/[policyId]`'s
  local `DialogShell` (used by its item add/edit and assign-employees modals - its hand-rolled
  checkbox row now uses kit `Checkbox`); `communication/messages`'s "New conversation";
  `components/learning/MaterialRow`'s per-row preview popup.
- Desktop back-arrow buttons (section 1 rule 11) removed in favour of `PageHeader`'s breadcrumb
  `trail` or a standalone `Breadcrumb`, with page content/handlers unchanged: `GoalDetailView`,
  `goals/dashboard`, `goals/my-check-ins`, `GoalListView` (full section 11.1 list-page header),
  `learning/my/[assignmentId]`, `learning/paths/builder`, `learning/paths/[pathId]`,
  `learning/paths/[pathId]/preview`, `communication/announcements/[id]`,
  `communication/bulletin/[boardId]`, `communication/bulletin/[boardId]/posts/[postId]`,
  `communication/knowledge/new`, `communication/knowledge/[postId]`,
  `communication/announcements/new`.
- Spot icon-button/tooltip fixes: `GoalDetailView`'s add-task button (`title=` attribute) moved to
  `Button` + `Tooltip` (section 6.3); `learning/paths/[pathId]`'s Preview/Edit/Archive/Restore/
  Delete controls moved to `Button`.
- Loader2 spinners on page-level loading states (goals/dashboard, goals/my-check-ins,
  learning/my/[assignmentId], learning/paths/[pathId]/preview) replaced with `Skeleton`.

### Kept for owner decision

- `components/learning/MaterialPreviewModal.tsx` keeps its own `fixed inset-0` overlay. It is a
  windowed document/media preview with a maximize-to-true-fullscreen toggle (Windows-style),
  which `dialog.tsx`'s fixed three-width/80vh-cap model (section 24) does not express - forcing it
  into Dialog would remove the maximize affordance document viewers are expected to have. Kept
  per D12; tokens already compliant.
- `components/learning/CourseViewer.tsx` keeps its own `fixed inset-0` fullscreen file viewer and
  its two `ArrowLeft`/"Back to..." links (one in its lesson-nav sidebar header, one in its
  collapsed-nav toolbar). This is an immersive, chromeless course-reading layout (its own lesson
  list, progress bar, collapse toggle) embedded inside `learning/my/[assignmentId]` and
  `learning/paths/[pathId]/preview`, not a section-11-template page with a header/breadcrumb band
  to anchor a `Breadcrumb` in. Treated as a D12 deviation.
- `learning/paths/[pathId]`'s materials/assignments/engagement tab bar stays local `useState`
  rather than `section-tabs.tsx`, which requires URL-backed state (section 33.4). Converting it
  changes observable behaviour (no deep-linking a tab via query param today; switching tabs would
  newly push/replace history) rather than only its appearance, so it was left and flagged here
  instead of converted under time pressure.

### Not done / follow-up

- Adapter call sites not migrated off `Modal`/`ConfirmDialog`/`StyledSelect`/`DatePicker`/
  `ResponsiveTable`/`Toast` in: `learning/paths/builder`, `learning/paths/[pathId]`,
  `communication/announcements/new`, `communication/bulletin`,
  `communication/company-policy/[policyId]`, `communication/knowledge/new`,
  `components/learning/EngagementPanel`, and all of `components/goals/{AddGoalTaskModal,
  CheckInHistory,CheckInModal,CreateGoalModal,EditGoalModal,GoalDetailView,GoalFormFields,
  GoalListView,GoalProjectsSection,LinkGoalModal,QuickCreateProjectModal,SupportGoalsSection}`.
  These adapters already render the kit's underlying primitives (`Modal` -> `dialog.tsx`,
  `ConfirmDialog` -> `alert-dialog.tsx` with a loading spinner/error banner not modelled by the
  kit file, `StyledSelect` -> `select.tsx`/`searchable-select.tsx`, `DatePicker` ->
  `date-picker.tsx`, `ResponsiveTable` -> `table.tsx`, `Toast` -> `sonner.tsx`) per
  `components/ui/ADAPTERS.md`, so the visible kit look is already there; only the import path
  differs. The goals module alone has ~12 files using these across dozens of call sites with
  per-call-site prop differences (richer `StyledSelectOption`/`DatePicker` props the kit file
  does not natively take), so a safe mechanical migration needs a dedicated pass per adapter
  rather than a rushed blanket swap under this session's time budget. `ConfirmDialog`'s
  delete-goal/delete-course confirmations specifically rely on its loading+error UI, which
  `alert-dialog.tsx` does not provide out of the box.
- `app/goals/scorecard/page.tsx`, `app/goals/strategy-map/page.tsx` (ReactFlow canvas, D6: tokens
  only) were covered by the mechanical token pass but not given a `PageHeader`/breadcrumb pass.
- `app/learning/page.tsx`, `app/learning/my/page.tsx`, `app/learning/progress/page.tsx`,
  `app/communication/page.tsx`, `communication/announcements/page.tsx`,
  `communication/bulletin/page.tsx`, `communication/knowledge/page.tsx`,
  `communication/messages/page.tsx` (list-style landing pages) were covered by the mechanical pass
  but not converted to the full section 11.1 list-page `PageHeader`/toolbar template. None have a
  back-arrow or `fixed inset-0` violation; what remains is moving their title/primary-action row
  into `PageHeader`.
- Status colour exceptions: did not run a full section 2.4 "one status to one colour map" audit
  across this module's own status chips (announcement priority, policy status, bulletin
  interaction mode) against `badge.tsx`'s `Badge`/`STATUS_ICON` - several are still local
  `Record<string,string>` colour maps rather than `Badge`.
- `components/goals/StrategyMapCanvas.tsx` keeps its dynamic `rgba()` helper over user-chosen
  node colours - data, per D7, not touched.
- `app/communication/messages/page.tsx`'s employee picker inside the "New conversation" `Dialog`
  keeps its own `max-h-48 overflow-y-auto` list, nested inside the Dialog's own scrolling body -
  a minor section 1.8 same-axis-scroll exception on a small, already-bounded list; not
  re-architected.

### Visual changes the owner will notice

- Goals/learning/communication detail and form pages lost their "<- Back to X" link at the top;
  there is now a breadcrumb trail above the title instead (same destination, one click either way).
- The dark `LearningAdminSidebar`/`CommunicationSidebar` now share the exact same sidebar chrome
  (colours, spacing, collapse animation, tooltip-on-collapse) as the Work/Governance/Settings
  module sidebars, instead of their own slightly different dark palette.
- Goals list/detail/dashboard/my-check-ins page titles, meta lines and primary actions now sit in
  the kit's `PageHeader` layout (consistent spacing/type scale with every other migrated module).
- "No goals yet"/"No goals match your filters"/"Nothing owed" empty states now render the kit's
  fixed icon+heading+action layout for their variant, rather than the module's own icon choice and
  copy layout (wording kept close to the original).

### Self-check results (this module's folders)

- hex/rgba outside globals.css: 7 hits, all in `components/goals/StrategyMapCanvas.tsx`'s dynamic
  `rgba()` over user-chosen data colours (D7, documented above) - no literal hex/rgba left
  anywhere else.
- font-(semibold|bold|extrabold|black): none.
- native confirm()/alert()/prompt(): none.
- native `<select`: none.
- off-scale spacing (5/7/9/10/11/14/16/20): none.
- fixed inset-0: 2 hits (MaterialPreviewModal, CourseViewer - documented D12 exceptions above).
- toLocale(Date|Time)?String: none.
- adapter imports (Modal|ConfirmDialog|StyledSelect|DatePicker|ResponsiveTable|Toast): 19 files,
  see "Not done / follow-up" above.
- npx tsc --noEmit, filtered to this module's folders: clean throughout.

### Commits

`ec795c0` (tokens/weights/spacing/colours/dates/sidebars/native-selects), further commits for
PageHeader/EmptyState/Dialog work on goals, 3 overlay-to-Dialog conversions (`b3a0f9b` - this
commit also picked up a concurrent commit from the Governance module agent due to a
shared-worktree race, see that agent's note above), MaterialRow's Dialog conversion, and
communication's back-arrow-to-breadcrumb pass (`5794728`). `npx tsc --noEmit` filtered to this
module's folders was clean at every commit.

## Entry, admin, and org visuals

### Kept for owner decision
- Login page (`app/(auth)/login/page.tsx`): the kit's sign-in-page.tsx template models two
  separate methods (email+password OR mobile+OTP). v2e's actual sign-in is one identifier
  field (email or phone, detected live) with a password — no OTP step exists in the live
  product despite the `FRONTEND_RULES_ACCESS.md` reference to "phone/OTP login". Restyled to
  kit tokens/components (Input, PasswordInput, Button, Banner, Label) but kept the one-field
  identifier + CountryCodeSelect behaviour rather than forcing it into the kit's two-method
  shape, since that would change sign-in logic (D1).
- Register page: kept the confirm-password field. `FRONTEND_RULES_ACCESS.md` section 32.3 says
  a password field needs no confirm field (the show/hide toggle makes a typo visible), but
  removing it here would drop a required field from the submitted form — a validation/behaviour
  change, not a restyle.
- `/admin` super-admin login page: was a bespoke dark-navy themed page, deliberately distinct
  from the regular workspace sign-in (a security/context signal). The kit defines no dark
  surface tokens (D9: no dark mode) and the brief forbids inventing new hex, so it now matches
  the light sign-in page's surface instead of keeping a dark theme. **Visual change the owner
  will notice** — the admin portal no longer looks visually distinct from `/login` at a glance;
  only the "Super administrator access only" copy and icon mark it. If the owner wants a
  deliberately distinct admin look back, that needs a dark-surface token addition to the kit
  itself (out of this module's scope — `components/ui/**` is read-only here).
- `components/dev/TimeTravelBar.tsx` (test-org time-travel widget): kept its own
  `toLocaleString` calls for the live ticking clock label (weekday + seconds) — `lib/format.ts`
  has no seconds-granularity or weekday format, and this is an internal QA tool, not a
  product screen.

### Not done / follow-up
- ReactFlow canvases (`components/process-hierarchy/ProcessCanvas.tsx`, `nodes.tsx`,
  `NodeDrawer.tsx`, `ArtifactLibrary.tsx`, `node-materials.tsx`, and
  `app/dashboard/process-hierarchy/page.tsx` / `[mapId]/page.tsx`) still have several
  hand-rolled `fixed inset-0`/`fixed z-*` context menus, a right-hand drawer, and a library
  panel that were **not** converted to kit Dialog/Sheet/Popover this pass — per D6 these canvases
  are "tokens only, no structural change", and converting their floating menus (which track a
  canvas pane's pixel position, not a trigger element) to Popover/Sheet would be real
  interaction-behaviour work, not a restyle, given the remaining time budget. Their hex/rgba was
  removed (now tokens/color-mix), and the ~45-call-site `useToast`→sonner migration and
  `toLocaleString`→`lib/format.ts` migration were done on the page-level file, but the
  drawer/menu/library components themselves were not restructured onto Sheet/Dialog, and still
  show in the self-check as using the `ResponsiveTable`/legacy-overlay pattern.
- `components/org-chart/DeptTableView.tsx`, `app/super-admin/{admins,groups,organizations}*`
  still call `ResponsiveTable` (the kit adapter over `table.tsx`, documented in
  `components/ui/ADAPTERS.md`) rather than `table.tsx` directly — its mobile card-list branch
  has no kit equivalent, so a forced migration would drop phone/tablet behaviour. Kept as the
  adapter per ADAPTERS.md.
- `app/dashboard/process-hierarchy/page.tsx` and `[mapId]/page.tsx` were not given a
  `PageHeader` — `[mapId]/page.tsx` (~1700 lines) is a canvas editor whose "header" is a dense
  toolbar (add/paste/lane/version controls) tightly coupled to canvas state, not a plain
  title+action row; doing this correctly needs a dedicated pass, not a mechanical swap, and
  the remaining time budget did not allow it. Logged honestly rather than forced.
- `components/culture-cards/**` was listed in this agent's folder set but the directory does
  not exist in this worktree (only `components/culture/**` does) — nothing to migrate there;
  flagging in case it's expected to exist from another branch.
- No full visual QA pass (hover/focus/loading states) was run on any converted screen; only
  `tsc --noEmit` was used to verify compile correctness.

### Visual changes the owner will notice
- `/admin` super-admin login: dark theme dropped, now matches the light `/login` page (see
  above).
- Login/register/forgot-password/select-org/admin pages: restyled fonts, spacing, radii, and
  button/input shapes to kit tokens — same layout and fields, different visual details
  (shadows, corner radii, type sizes) throughout.
- `super-admin/admins`, `super-admin/groups*`, `super-admin/organizations*`: native `<select>`
  elements replaced with `SearchableSelect`; native `confirm()` for revoking an admin replaced
  with a styled `AlertDialog`; `Modal` replaced with `Dialog`/`AlertDialog` on the organization
  detail page (Edit Member, Deactivate, Reactivate).
- Org-chart and identity/culture drawers (`DeptFormDrawer`, `DeptInfoPanel`,
  `IdentityFormDrawer`, `CultureManagerDrawer`) now slide in via the kit's `Sheet` component
  instead of a hand-rolled `fixed inset-y-0` panel — same open/close behaviour, same fields,
  different motion/shadow/focus details.

### Self-check results (this module's folders)
- hex/rgba outside globals.css: none.
- font-(semibold|bold|extrabold|black): none.
- native confirm()/alert()/prompt(): none.
- native `<select`: none.
- off-scale spacing (5/7/9/10/11/14/16/20): none.
- fixed inset-0: 6 remaining, all in the process-hierarchy canvas components/pages (listed
  above under follow-up) — D6 canvas scope, not converted this pass.
- toLocale(Date|Time)?String: 1 remaining (`components/dev/TimeTravelBar.tsx`, kept — see
  above).
- adapter imports (Modal|ConfirmDialog|StyledSelect|DatePicker|ResponsiveTable|Toast): only
  `ResponsiveTable` remains, in the files listed above (kept per ADAPTERS.md).
- `npx tsc --noEmit` filtered to this module's folders: clean after every commit.

### Commits (entry-admin-org)
98e87a4, 7a050ee, 6d87a94, 55ed44d, 494b6d2, 7cecdee, f49510b, 113164e, 4149faa, a7ffb6b,
plus the identity/culture/org-chart PageHeader follow-ups and the DeptInfoPanel spacing fix
committed after this entry was drafted.

## Settings / People (Wave 2 finishing pass)
Folders: `frontend/app/settings/**`, `frontend/app/dashboard/{employees,roles}/**`,
`frontend/components/{employees,roles,role-builder,permissions,holidays,leave,audit}/**`.

### What changed this pass
- All `bg/text-white`, `bg/text-black` violations fixed except avatar initials (see below):
  `text-white bg-primary` → `text-primary-foreground bg-primary` (and reverse order),
  `text-white bg-danger` → `text-on-danger bg-danger`, `bg-warning`/`bg-success` fills with
  `text-white` → `text-primary-foreground`, hand-rolled backdrop opacities
  (`bg-black/40`, `/50`, `/20`) → `bg-backdrop`, `bg-white/85` → `bg-surface/85`, a stray
  `hover:text-white` on toast close buttons → `hover:text-text-primary`.
- Starting count of `bg/text-white|black` in these folders was 63; after this pass: 7, all
  of the same kind (see Kept below). `tsc --noEmit` filtered to this folder set: clean.

### Kept for owner decision
- Avatar initials (`EmployeeNode`, `EmployeeTreeView`, `ReportsToSelect`,
  `dashboard/employees/page.tsx`, `dashboard/employees/[employeeId]/page.tsx`): `text-white`
  on a dynamically-generated `avatarColor(name)` background. The kit has no
  foreground-on-arbitrary-fill token; white is the only reliably readable choice against
  the generated palette, so these were left as-is rather than mapped to a token that may
  not contrast correctly against every generated color.

### Not done / follow-up (honest — this pass only completed the colour-token checklist item)
- **Raw `<button>` → kit `Button` (checklist item 2):** not started. ~176 raw buttons across
  this folder set still need per-button variant/size classification (§6.1) — this is the
  largest remaining item and needs file-by-file judgment (primary/secondary/ghost/danger,
  icon-only + Tooltip + aria-label), not mechanical.
- **PageHeader (checklist item 1):** not started. 20 `page.tsx` files listed as missing
  `PageHeader` at scan time still are: `settings/page.tsx`, `settings/organization/{company,
  culture,employees,employees/[employeeId],structure,roles,roles/[roleId]}/page.tsx`,
  `settings/organization/holidays/{page,configurations,departments,individuals,leave-rules,
  org}/page.tsx`, `settings/system/{access-rights,audit-logs}/page.tsx`,
  `dashboard/employees/{page,[employeeId]/page}.tsx`, `dashboard/roles/{page,[roleId]/page}.tsx`.
- **Type scale tokens (item 3)** and **Surfaces beyond white/black (item 4 remainder)**: not
  audited/converted this pass.
- **States → Skeleton/EmptyState/Badge/Tooltip/Banner/Label/Input/Textarea/checkbox-switch-
  radio (item 5):** not done.
- **Overlay → Dialog/Sheet migration (item 6):** not done. Confirmed hand-rolled
  `fixed inset-0` still present in: `AddEmployeeModal.tsx`, `ImportEmployeesModal.tsx`,
  `ImportJobRolesModal.tsx`, `components/holidays/ImportHolidaysModal.tsx`,
  `RoleFormDrawer.tsx`, `RoleInfoPanel.tsx`, `dashboard/employees/[employeeId]/page.tsx`
  (two overlays) — these are exactly the ones named in the W2 brief as needing Dialog(lg)/
  Sheet(side right) conversion.
- Reason: this pass was time-boxed to the mechanical, lowest-risk, highest-confidence item
  (colour tokens) and verified it fully rather than attempting the much larger button/
  PageHeader/overlay conversions shallowly. Those remain open and should be picked up next.

### Visual changes the owner will notice
- Primary/danger/warning/success filled buttons and pills: text color token changed from
  literal white to `text-primary-foreground`/`text-on-danger` — same visual white in the
  current theme, but now theme-aware.
- Modal/drawer backdrops standardized to the kit's `bg-backdrop` token instead of ad-hoc
  `bg-black/NN` opacities — backdrop darkness may shift slightly to match the kit's value.
- Toast "dismiss" (X) buttons in holiday screens: hover color changed from white (invisible
  on a light toast) to `text-text-primary`, fixing what looks like a pre-existing contrast bug.
