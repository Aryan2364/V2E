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
