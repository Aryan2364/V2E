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

### Kept for owner decision

- **Kit says:** destructive/irreversible actions confirm through `alert-dialog.tsx`, danger by
  default, closing only via Cancel or the action (§15, §24 rule 3). **v2e did:** 7 native
  `confirm()` calls in `masters/page.tsx` (category/stage/type/priority/resolver-group delete,
  ticket-template archive). **Done:** replaced all 7 with a shared local `ConfirmDeleteDialog`
  built on `components/ui/alert-dialog.tsx`; each keeps its own wording and verb ("Remove stage",
  "Deactivate", "Archive", "Delete"). This is the direct kit component, not the `ConfirmDialog`
  adapter.
- **Kit says:** no back-arrow button on a desktop/tablet page; use breadcrumbs instead (§1 rule
  11, §11.2). **v2e does:** several task pages use a bordered `ArrowLeft` icon button or a
  "← Back" text row as their way back to a list: `masters/page.tsx`'s three in-form "Back to
  templates/resolver groups" buttons, `people/[userId]/page.tsx`, `recurring/[id]/page.tsx`,
  `reports-new/{ageing,calendar,person-scorecard,person-scorecard/[userId]}/page.tsx`, and
  `[taskId]/page.tsx`'s small header back arrow. **Why kept:** this module's detail/report pages
  were not given `PageHeader`'s breadcrumb trail before this pass arrived (that plumbing is a
  structural change, out of scope for a presentation-only pass per D1), so removing the back
  control without it would leave some of these screens with no way back at all. Left as-is;
  flagging for a follow-up pass that wires each of these pages through `PageHeader`'s `breadcrumb`
  prop (§11.2) and then drops the arrow buttons.
- **Kit says:** every screen's title/breadcrumb/actions come through `PageHeader` (§11, §12.3).
  **v2e does:** none of this module's pages use `PageHeader` yet; each hand-rolls its own
  `<h1>`/toolbar row. Not touched this pass — adopting `PageHeader` across ~20 pages is a page-
  structure change (headers, action placement, breadcrumb wiring) bigger than the token/weight/
  spacing/dialog sweep done here, and risks moving primary actions in ways D1 asks us to avoid
  without closer per-page review. Recorded as the single largest remaining item for this module.
- **Kit says:** loading uses skeletons, never a spinner (§14 rule 1). **v2e does:** a hand-rolled
  `Spinner()` (a spinning-border div) is reused across most of `masters/page.tsx`'s tabs. Not
  migrated to `Skeleton` this pass — each tab's content shape differs enough that a faithful
  skeleton needs per-tab layout work, not a drop-in swap.

### Not done / follow-up

- **5 hand-rolled `fixed inset-0` overlays**, not converted to `Dialog`/`Sheet`: `archive/page.tsx`
  (task-snapshot preview), `recurring/page.tsx` (the "pick a template type" picker), and
  `[taskId]/page.tsx` (three: an assignee-switch confirmation, a document picker, and an image/
  file preview lightbox). Each has custom animation/backdrop/mobile-sheet behaviour hand-built
  to match the kit's own `dialog.tsx`/`sheet.tsx` shapes already (slide-up on mobile, centred on
  desktop); re-platforming them onto the real components is safe in principle but each needs a
  focused pass to verify no interaction (escape handling, backdrop click, Android back) regresses.
- **17 call sites still import the adapters** (`StyledSelect`, `DatePicker`/`DateRangePicker`,
  `ResponsiveTable`, `useToast`) rather than the kit components directly. Per P3b's notes these
  adapters already render the real kit component underneath, so the *visual* result is already kit-
  correct; only the import path is the adapter. Left alone this pass to avoid prop-shape churn in
  already-large files; a follow-up can migrate call sites one at a time per ADAPTERS.md.
- **Unbounded lists (D5 / §1 rule 7):** `masters/page.tsx` (categories, priorities, statuses, types,
  resolver groups, templates), `recurring/page.tsx`, `archive/page.tsx` and others render every row
  the API returns, no pagination. No backend pagination endpoint exists for these yet, matching D5;
  not changed here.
- Native `<select>` elements: none found in this module's files.
- Data colours (task tag palette, calendar heat colours, chart series in `reports/page.tsx` and
  `reports-new/**`) left as data per D7, not touched.

### Visual changes the owner will notice

- `font-semibold`/`font-bold` everywhere in this module now render at weight 500 (`font-medium`)
  per kit §3 — no more bold task titles, bold empty-state headings, or bold button labels.
- `bg-white` → `bg-surface`, ad-hoc `rounded-[Npx]` → `rounded-card`/`rounded-control`, and ad-hoc
  `shadow-[...rgba...]` → `shadow-card`/`shadow-dialog` across every card, panel, dropdown and
  tooltip in this module (archive, assigned, cc, collective, delegation, escalated, leave-
  approvals, masters, my, page, people/[userId], recurring + recurring/[id], reports + reports-new/
  *, [taskId]). No layout change, token-equivalent visual weight.
- Off-scale spacing (`p-5`, `gap-5`, `py-16`, `py-20`, etc.) rounded to the nearest kit scale value;
  a few empty-state blocks that used `py-16`/`py-20` are now slightly less tall (`py-12`).
- `masters/page.tsx`'s 7 delete/archive/deactivate confirmations now open a centred dialog instead
  of the browser's native confirm box — same wording, same destructive intent, kit-styled instead
  of OS-styled.
- Dates that used `toLocaleDateString`/`toLocaleString` ad hoc (archive snapshot, leave-approval
  dates, recurring-template stats and reminder dates, scorecard dates, the future-task banner on
  `[taskId]`) and plain-number counts in `reports-new/{ageing,calendar,person-scorecard}` now render
  through `lib/format.ts` — "DD Mon YYYY" / "DD Mon YYYY, h:mm A" and Indian number grouping instead
  of each file's own browser-locale formatting. The future-task banner also lost its ⌛ emoji
  (icons are Lucide-only per §23).

### Self-check results (this module's folders, excluding `tickets/**` and `workflows/**`)

- hex/rgba outside globals.css: none.
- `font-(semibold|bold|extrabold|black)`: none.
- native `confirm()/alert()/prompt()`: none.
- native `<select`: none.
- off-scale spacing (5/7/9/10/11/14/16/20): none.
- `fixed inset-0`: 5 remaining, documented above as follow-up.
- `toLocale(Date|Time)?String`: none.
- adapter imports (`Modal|ConfirmDialog|StyledSelect|DatePicker|ResponsiveTable|Toast`): 17 files,
  documented above as follow-up.
- `npx tsc --noEmit` filtered to `app/dashboard/tasks/(?!tickets|workflows)`: clean.

### Commits

- `8e15953` — mechanical token/format sweep + `masters/page.tsx`'s 7 `confirm()` calls to
  `AlertDialog`.
- `02da0d7` — off-scale spacing rounded to the kit scale.

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
