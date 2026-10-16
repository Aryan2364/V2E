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
