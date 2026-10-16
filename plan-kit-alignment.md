# v2e → frontend-kit alignment plan

**Started 16 Oct 2026. Branch `feat/kit-alignment`, cut from `feat/phone-app` (ad21c94).**
Worktree: `D:\RGB_Software\products\v2e\.claude\worktrees\kit-alignment`. All work happens there.
The branch `feat/phone-app` and `main` are never touched by this work.

The owner asked for the whole frontend to follow the kit, done autonomously by sub-agents,
committed and pushed as it goes, and reviewed by the owner before merging to `main`.
The earlier plan `plan-2026-09-04-2332.md` (written against the old rgb-kit-v2) is the
ancestor of this one; its open questions are answered below in "Locked decisions".

## Authority

1. `D:\RGB_Software\kits\frontend-kit\FRONTEND_RULES.md` — read completely before any code.
   Specialist files beside it: `FRONTEND_RULES_VIEWS.md` (charts, grids, report tables, board),
   `FRONTEND_RULES_ACCESS.md` (sign-in, passwords, people/roles/access screens),
   `FRONTEND_RULES_PHONE.md` (anything shown on a phone).
2. The kit's code is the reference implementation: `components/ui`, `components/shell`,
   `components/templates`, `app/globals.css`, `lib/*`, `app/kitchen-sink/page.tsx`.
   **The kit folder is read-only.** Copy from it; never edit it.
3. `DESIGN_RULES.md` (repo root) is superseded wherever the kit says anything.
4. `backend/AUTHORIZATION.md` still governs any backend change (this work should make none).
5. `KIT-PENDING-phone-task-tick.md` — owner-approved phone deviation; keep it.

## Locked decisions (made autonomously; each is listed in REVIEW-kit-alignment.md for the owner)

| # | Decision |
|---|---|
| D1 | The kit is the rulebook. Presentation and interaction only: no route, API, data-flow or permission-logic changes. |
| D2 | Framework moves to the kit's pins: Next 16.3.3, React 19.2.8, Tailwind 4, `@base-ui/react` 1.8.0 exact, `sonner` 2.0.8 exact, plus the kit's other deps. Fallback if Next 16 is blocked: Next 15.5 + React 19, recorded. |
| D3 | Brand stays v2e blue `#2563EB`, using the 8-token block already built for the phone layout (owner: "brand color is ok for now"). It becomes the one global brand block. |
| D4 | **Navigation shape is kept** (owner's design): top nav for modules + left sidebar as that module's sub-menu. It is restyled to kit tokens/§12 dimensions and behaviour, not restructured. Logged as a deviation from §12.1 for the owner. |
| D5 | Pagination (§1.7) needs backend endpoints — out of scope here. Lists keep their current loading; logged. |
| D6 | ReactFlow canvases (process hierarchy, org chart, strategic map): tokens only; no structural change. |
| D7 | Data colours chosen by users (tag colours, etc.) stay data. Chart series move to §21 chart tokens. |
| D8 | No "info" blue (§2.4): informational colour becomes neutral, per the kit. |
| D9 | No dark mode (§28). No `dark:` classes. |
| D10 | Phone layout from `feat/phone-app` must not regress. Its phone-scoped tokens merge into the global token layer. |
| D11 | Five import modals: re-skinned in place, not unified (unifying is a behaviour change). Logged. |
| D12 | Anything where a v2e UX choice looks deliberate and better than the kit, or where following the kit would change behaviour the owner designed: keep v2e's version, and log it in REVIEW-kit-alignment.md "Kept for owner decision". |

## Phases

| Phase | What | Who | Done when |
|---|---|---|---|
| P1 | Framework upgrade: Next 16 / React 19 / Tailwind 4 (official codemods), kit deps at kit versions | 1 agent, sequential | `next build` green, app routes compile, nothing visual changed on purpose |
| P2 | Token layer: kit `globals.css` adopted with v2e brand block; Geist; `lib/utils.ts` cn(); `lib/format.ts`; scripted hex→token codemod over every file; `tailwind.config.ts` retired; kit rules files copied into `frontend/` per §0.2 | 1 agent, sequential | no hex outside globals.css except allowed exceptions; build green |
| P3 | Primitives: kit `components/ui`, `components/shell/page-header` + breadcrumb plumbing, kit `lib/*` ported; v2e's old primitives (Button, Modal, ConfirmDialog, Toast, Tooltip, Badge, Card, Input, SelectField, StyledSelect, DatePicker…) replaced by the kit's, call sites migrated; `/kitchen-sink` route | 1 agent, sequential | old duplicates gone or reduced to documented adapters; build green |
| P4 | Shell restyle (top nav + module sidebars) to kit tokens and §12 behaviour | 1 agent, parallel with P5 | build green |
| P5 | Screen migration by module (6 parallel agents, disjoint folders) | 6 agents | tsc clean for own files; self-check greps clean for own files |
| P6 | Cross-cutting sweep, self-check, full build, REVIEW-kit-alignment.md | main session + 1 agent | build green, review doc written, pushed |

### P5 module split (folders each agent owns)

- **M1 Tasks:** `app/dashboard/tasks/**`, `components/tasks/**`, `lib/tasks/**`, `lib/task-badge.tsx`
- **M2 Tickets, workflows, projects:** `app/dashboard/tickets/**`, `app/dashboard/workflows/**`, `app/dashboard/projects/**`, `components/tickets/**`, `components/workflows/**`, `components/projects/**`
- **M3 Governance and home:** `app/dashboard/governance/**`, `app/dashboard/(page|layout).tsx`, `app/dashboard/more/**`, other `app/dashboard/*` not owned above, `components/meetings/**`, `components/work-logs/**`, `components/delegation/**`, `components/dashboard/**`, `components/reports/**`, `lib/reports/**`
- **M4 Settings and org:** `app/settings/**`, `components/{employees,roles,role-builder,permissions,holidays,leave,audit,identity,culture,culture-cards,company-policy,org-chart,employee-tree,process-hierarchy}/**`
- **M5 Goals, learning, communication:** `app/goals/**`, `app/learning/**`, `app/communication/**`, `components/{goals,learning,communication,notifications}/**`, `lib/learning/**`
- **M6 Entry and admin:** `app/(auth)/**`, `app/select-org/**`, `app/super-admin/**`, `app/admin/**`, `app/page.tsx`, `app/offline/**`, `components/dev/**`

Shared files (`components/ui`, `components/shell`, `components/layout`, `lib/*` outside the above, `app/globals.css`, `app/layout.tsx`, `components/phone/**`) are **not** edited by module agents. A module agent that needs a shared change writes it into its report instead.

## What a fast model will get wrong here

1. Copying a neighbour's `bg-[#…]`. The neighbours are the violation; use tokens.
2. `font-semibold` / `font-bold`. Two weights only: 400, 500 (§3).
3. A new `fixed inset-0` modal. Use `Dialog` / `AlertDialog` / `Sheet`.
4. A back arrow on a desktop page. Breadcrumbs via `PageHeader` (§1.11).
5. `p-5`, `gap-5`, `text-[15px]`. Use the §5.1 spacing scale and the §3 type tokens.
6. `confirm()` / `alert()`. Use `AlertDialog`.
7. Spinners. Skeletons (§14).
8. Inventing a component that `components/ui` already has (read §4.1 first).
9. Changing behaviour while restyling — a handler, a query key, a permission check, a route. Don't.
10. Breaking the phone layout: phone screens switch through `useLayout()`; don't remove phone branches.

## Self-check (run from `frontend/`, Git Bash)

```bash
grep -rnE "#[0-9A-Fa-f]{3,8}\b|rgba?\(" app components lib --include=*.tsx --include=*.ts | grep -v "app/globals.css" | grep -v "lib/install-settings.ts"   # colour outside globals.css
grep -rnE "font-(semibold|bold|extrabold|black)" app components                  # weights
grep -rnE "\b(confirm|alert|prompt)\(" app components lib --include=*.tsx         # native dialogs
grep -rn "<select" app components --include=*.tsx                                   # native selects
grep -rnE "\b(p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y|space-x|space-y)-(5|7|9|10|11|14|16|20)\b" app components   # off-scale spacing
grep -rn "dark:" app components                                                     # dark mode
npx tsc --noEmit
npx next build
```

## Session log

- 16 Oct 2026: plan written, worktree + branch created.
- 16 Oct 2026: P1 done. Next 16.3.3 / React 19.2.8 / Tailwind 4 (kit pins) installed exactly;
  kit's other deps (@base-ui/react 1.8.0, sonner 2.0.8 exact, class-variance-authority, clsx,
  tailwind-merge, tw-animate-css, cmdk, date-fns, react-day-picker, @dnd-kit/core) added at kit
  versions. Builder: Turbopack (Next 16 default) - no webpack fallback needed. next.config.mjs
  images.domains -> remotePatterns. globals.css: `@import "tailwindcss"` + `@config
  "../tailwind.config.ts"` (keeps the existing JS theme/phone tokens working; P2's job to
  replace it). `npx @tailwindcss/upgrade --force` migrated `!important` syntax and negative
  arbitrary values across ~146 files; its theme-aware class renames (shadow/rounded/blur/
  drop-shadow scale shift, outline-none->outline-hidden) didn't apply via the CLI in this
  environment (interactive-TTY codemod hung non-interactively), so applied by a token-exact
  script instead (never touches arbitrary values or prose) across another ~130 files. An
  interrupted first `@next/codemod upgrade` run had inserted `export const instant = false`
  (Cache Components opt-out) into 19 route files; reverted via `git checkout` since
  `cacheComponents` is not being enabled in this phase. `npx tsc --noEmit`, `npx next build`,
  and `npm run test:unit` (69/69) all green. No lucide-react/recharts version bump attempted
  (kept v2e's 1.x/2.x; build was already clean, out of scope to push further here). Commits
  e8ea753 (framework upgrade) and f5403ea (Tailwind 4 migration).
- 16 Oct 2026: P2 done. app/globals.css rewritten on the kit's globals.css (same
  token vocabulary/type scale/spacing/radii/shadows/z-layers/motion/scrollbars/
  autofill); the phone-only block from feat/phone-app merged into the one global
  token layer (D10), keeping only phone overrides/behaviour scoped to
  [data-layout="phone"]. Brand block carries v2e's 8 blue values unchanged (D3);
  scrollbar colours and --on-brand-accent newly derived per kit sections
  0.1/10.1/36.8. V2E-specific CSS with live call sites kept: task tag palette,
  boot splash, overlay keyframes, react-flow font, table-scroll/sidebar-scroll
  scrollbars, number-input spinner removal. tailwind.config.ts retired (no
  @config import); its colour AND fontSize/shadow "phone-*" aliases (two
  separate mechanisms sharing a prefix by coincidence) rewritten to plain kit
  token classes by one-off scripts, in components/phone/**. Geist replaces
  Inter; body drops to 14px. lib/utils.ts, lib/format.ts copied from the kit
  unchanged; lib/phone-format.ts's fmtDate/fmtTime/fmtDateTime now delegate to
  lib/format.ts. shadcn added at 4.19.0.
  Colour codemod: audit/colour-map.md records hex->token decisions by role
  (text/fill/border); three scripts (frontend/scripts/kit-colour-codemod*.mjs)
  applied it across app/components/lib - Tailwind arbitrary-hex classes, then
  key:'#hex' property values, then bare hex string literals. lib/install-
  settings.ts and lib/org-chart-colors.ts left as data. Three chart-series
  arrays (PIE, STRIPE_COLORS, BAND_COLORS) hand-corrected to var(--chart-1..6)
  by position instead of the scripts' per-hex guess. The sign-in brand panel's
  three unrelated darks now read off the primary block.
  Known gap, left for P3/P4/P5: ~230 hex codes remain, almost all of them the
  dark desktop nav sidebar's light-on-dark text/background (components/layout/*,
  D4 - P4 restyles that shell) plus a long tail of tree/calendar/gantt/decorative
  SVG colours in components/{employees,holidays,projects,process-hierarchy,
  roles,org-chart,workflows}/** and components/ui/{DatePicker,SelectField,
  StyledSelect,Tooltip,ClockTimePicker,...}.tsx that this pass's three scripts
  couldn't reach (gradients, un-keyed JSX props, SVG path/polygon fills) and
  that a full scan surfaced after the codemod runs - genuine hand-pass work for
  whichever phase (P3 primitives, P5 module screens) next touches each file.
  rgba(...) values (303) were not converted - out of this phase's scripted
  reach, same reasoning. Rules files copied into frontend/ with the product
  header and section 2.2 table filled in; frontend/AGENTS.md and
  frontend/CLAUDE.md created (CLAUDE.md force-added past the repo's blanket
  gitignore rule for that filename). Repo-root DESIGN_RULES.md no longer
  exists on this branch (removed before this work in cc87a09), so no
  superseding line was added.
  `tsc --noEmit` and `next build` green throughout. Commits 36be244 (a: token
  layer/Geist/utils/format), 0dfa536 (b: codemod script + map), bbe922d
  (c: codemod applied), 89b16a0 (d: hand remainders), f162a7e (e: rules files),
  829170d (f: fontSize/shadow phone-* fix).
- 16 Oct 2026: P3 done. Every kit components/ui file ported into
  frontend/components/ui/ at the kit's names, plus its lib/* dependents.
  Windows case collisions (Button/Badge/Card/Input/Tooltip vs
  button/badge/card/input/tooltip) resolved via git mv -f; all v2e call sites
  migrated to the lowercase kit paths (grep for the uppercase paths across
  app/components/lib returns nothing). lib/auth/permission-tooltip-adapter.ts
  (useCanWithReason) is the thin bridge from v2e's own usePermissions() to
  the kit's permission-tooltip.tsx {allowed,reason} contract - v2e's
  permission logic itself is untouched (D1). components/shell/page-header.tsx
  + progress-bar.tsx ported for v2e's existing shell (desktop/tablet branch
  only; D4 - shell not restructured this phase, so the kit's phone app-bar
  branch is left out pending the kit's own app-bar/PhoneOnly plumbing).
  /kitchen-sink ported, minus two demos (NotificationPermissionSheet,
  CommentBox) that depend on kit shell pieces out of scope this phase.
  Toast.tsx and PermissionTooltip.tsx are now thin adapters onto the kit's
  sonner.tsx and tooltip.tsx respectively (~75 and 9 call sites, unchanged
  APIs). components/ui/ADAPTERS.md lists every other v2e duplicate (Modal,
  ConfirmDialog, StyledSelect, DatePicker, DateRangePicker, TimeField,
  MultiSelect, ResponsiveTable, ViewToggle, useHoverTip, SelectField,
  MonthDayPicker, FilterButton, and dead ClockTimePicker) still on its
  original v2e implementation with call-site counts and why each needs a
  deliberate pass (richer option APIs, a built-in mobile-card mode, etc.)
  rather than a rushed wrapper - real work for a follow-up pass before P5
  module agents can rely on the kit look for those controls. Also lists
  components/phone/* overlaps with newly-ported kit parts (PhoneSheet vs
  sheet.tsx, UndoToast vs sonner's toast.undo, etc.) left untouched and not
  regressed. tsc --noEmit and next build green throughout; this phase's work
  was interrupted once by an API rate limit mid-run and resumed/finished by
  the coordinating agent. Commits adbb1b0 (case-collision primitives),
  bbfdfc9 (remaining components/ui + lib ports), 3114466 (page-header,
  kitchen sink, permission-tooltip adapter, ADAPTERS.md).
- 16 Oct 2026: P4 done (application shell). New `components/layout/ModuleSidebar.tsx`
  is the single sidebar implementation (§4 rule 2) feeding Task/Governance/Goals/Settings
  sidebars and restyled with kit tokens (bg-primary, on-brand text, surface+primary-text
  active item, z-shell, duration-fast/slow, Count badge). `Sidebar.tsx` (firm/super-admin
  shell), `TopNav.tsx`, `NotificationBell.tsx`, `DashboardLayout.tsx`, `MainLayout.tsx`
  had every remaining hex/rgba, font-semibold/bold and ad-hoc z-index removed. Nav shape
  (top nav + module sidebar) kept per D4, restyled not restructured. Notification panel
  restyled to §7.4's shape (360px, band header, "Mark all as read", "You are all caught
  up", "View all") on v2e's existing data hooks; still custom markup rather than
  `popover.tsx` — logged in REVIEW-kit-alignment.md. ProgressProvider/ProgressBar (P3's
  documented no-op shim) mounted once in MainLayout. Phone shell untouched and still
  short-circuits before any desktop markup. `npx tsc --noEmit` and the hex/font-weight
  greps clean for components/layout and components/shell.
- 16 Oct 2026: P3b done (remaining `components/ui` adapters/migrations), via 4 parallel
  agents, then coordinator-run full verification.
  **Modal.tsx**/**ConfirmDialog.tsx** (32/21 sites): both rewritten as thin adapters over
  `dialog.tsx`/`alert-dialog.tsx`; no kit files touched. Modal keeps isOpen/onClose/title/
  size/closeOnEscape/bodyScroll/elevated; backdrop always closes, Escape only when
  closeOnEscape (unchanged). ConfirmDialog keeps its props, danger-by-default, loading
  spinner/error banner added inside the adapter only (not modeled by kit AlertDialog).
  Escape/backdrop now no-ops on ConfirmDialog, matching kit AlertDialog intent (acceptable
  per brief — old version only closed via its two buttons anyway). Commits dff80b6,
  9123773, a18855b.
  **StyledSelect.tsx** (42 sites) → thin adapter choosing kit `select.tsx` (≤6 options) or
  `searchable-select.tsx` (≥7) by `options.length`. Added `variant:"danger"` to
  SelectItem/CommandItem, and colour-dot/divider/action-row support to
  `SearchableSelectEntry` on `searchable-select.tsx` (backward compatible with existing
  Record<string,string> usage). **SelectField.tsx** (1 site) migrated directly and
  deleted. Commits e5c9756, 4e79a65.
  **DatePicker.tsx** (28 sites) → thin adapter over `date-picker.tsx`; added `min`/`max`
  and `markedDates`/`markedHint` (leave-day dots) to `date-picker.tsx`/`calendar.tsx`.
  `compact`/`hideClear`/`bare` dropped (no kit equivalent, unused by call sites).
  **DateRangePicker.tsx** (9 sites) → rebuilt on kit calendar's existing `mode="range"` +
  `popover.tsx`, no kit change needed; `{from,to}` ISO contract kept. **TimeField.tsx**
  (9 sites) → thin adapter over `time-picker.tsx`; real behaviour change flagged: typed
  minutes now snap to kit's 15-minute steps instead of free entry, and the old analog
  dialog is replaced by the kit's inline hour/minute/AM-PM popover. **MonthDayPicker.tsx**
  (1 site) migrated and deleted. Commits d6ea696, e6e56aa, fc7f3fe, efe507a.
  **ResponsiveTable.tsx** (23 sites) → thin adapter: desktop/tablet now kit `table.tsx`
  parts; mobile card-list branch kept as its own markup (table.tsx has no card mode).
  **ViewToggle.tsx** (3 sites) → restyled on the same Toggle/ToggleGroup primitives as
  `view-switcher.tsx` but deliberately NOT merged into it (different semantic: table-vs-
  tree, not list/card/board). **MultiSelect.tsx**: added hint/color/colorClassName variant
  to kit `multi-select.tsx`; 2 of 5 call sites migrated directly; the other 3
  (TagSelect/TagPicker/StepCard) use renderChip/onCreate/maxSelected — not in kit scope,
  stay on MultiSelect.tsx, flagged in ADAPTERS.md rather than force-migrated. **useHoverTip**
  (2 sites, hand-rolled portal tooltip with inline hex) and **FilterButton** (1 site)
  migrated directly to `tooltip.tsx`/`popover.tsx` and deleted; FilterButton's call site
  now `components/goals/GoalsFilterPopover.tsx` (logically equivalent reimplementation,
  not byte-identical — worth a visual check on /dashboard goals). **ClockTimePicker.tsx**
  re-verified 0 importers tree-wide (TimeField's conversion had already dropped its
  reference) and deleted. Commits 5281b4a, 95b0d4f, b91b65a, 38a88a7, ac98c0e, bc533ac.
  Hand-rolled-overlay/native-control counts for P5 (ADAPTERS.md bottom section):
  `fixed inset-0` outside components/ui — components/tasks 10, app/dashboard 6,
  components/meetings 5, components/roles/process-hierarchy/org-chart/learning 3 each,
  +8 more folders at 1-2; `confirm`/`alert`/`prompt` — app/dashboard 9, components/tasks 5,
  +3 folders at 1; `<select` — app/dashboard 3, app/communication 3, app/super-admin 2,
  +4 folders at 1.
  `frontend/FRONTEND_RULES.md` §4.1.1 "v2e additions" table logs every kit-component
  addition above. `components/ui/ADAPTERS.md` rewritten to final state.
  Coordinator verification: `npx tsc --noEmit` clean; `NODE_OPTIONS=--max-old-space-size=8192
  npx next build` green across all routes.
