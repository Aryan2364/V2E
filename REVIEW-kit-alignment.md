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
