# P5 — screen migration brief (shared by all module agents)

You migrate the screens and domain components of ONE module of the v2e frontend onto the RGB
frontend kit. Your module and the folders you own are given in your prompt. Work ONLY in the git
worktree `D:\RGB_Software\products\v2e\.claude\worktrees\kit-alignment` (frontend in `frontend/`).
Never touch `D:\RGB_Software\products\v2e` (main checkout). Never edit
`D:\RGB_Software\kits\frontend-kit` (read-only). Don't ask questions; decide, and record anything the
owner should decide. Quality over speed. Commit locally; **never push**.

Five other agents are working on other modules at the same time, in the same worktree.

## Read first (in this order)
1. `plan-kit-alignment.md` (worktree root) — locked decisions D1–D12 and "What a fast model will get wrong".
2. `frontend/FRONTEND_RULES.md` — **the whole file**. It is the authority. Plus `FRONTEND_RULES_VIEWS.md`
   if your module has charts/report tables/boards/grids, `FRONTEND_RULES_ACCESS.md` if it has sign-in,
   passwords, people/roles/access screens, and `FRONTEND_RULES_PHONE.md` §41.2–41.3 so you don't break
   phone branches.
3. `frontend/components/ui/ADAPTERS.md` — which old v2e primitives are now adapters over kit components.
4. The kit components in `frontend/components/ui/` and `frontend/components/shell/page-header.tsx`.
   `frontend/app/kitchen-sink/page.tsx` shows how each is used.
5. `REVIEW-kit-alignment.md` (worktree root) — append your findings here (see below).

## What to do on every screen and component you own
Presentation and interaction only (D1). Never change a handler's logic, a query key, an API call, a
route, a permission check, or what data is shown.

1. **Primitives:** use kit components. Migrate your call sites off the adapters listed in ADAPTERS.md
   to the kit component directly (Modal → Dialog, ConfirmDialog → AlertDialog, StyledSelect →
   Select/SearchableSelect, DatePicker → kit date-picker, ResponsiveTable → Table, useToast → sonner
   `toast`). Replace hand-rolled overlays (`fixed inset-0` modals/drawers) with Dialog/Sheet/AlertDialog,
   native `confirm/alert/prompt` with AlertDialog/toast, native `<select>` with Select/SearchableSelect,
   hand-rolled tabs with kit `tabs`/`section-tabs`, hand-rolled menus with `dropdown-menu`, hand-rolled
   empty messages with `EmptyState` (pick the right variant, §13), spinners with `Skeleton` (§14),
   `title=` tooltips with `Tooltip`, status text colours with `Badge` (§2.4, one status→colour map).
2. **Page structure:** each page gives its title/breadcrumb/actions through `PageHeader` (§11, §12.3).
   No back-arrow buttons on desktop pages (§1.11) — use the breadcrumb trail. Follow the §11 template
   that fits (list / detail / form / dashboard / settings / card view). One page title per screen.
3. **Typography:** only weights 400/500 (`font-medium`), never semibold/bold. Use the kit type tokens
   (`text-page-title`, `text-section`, `text-card-heading`, `text-body`, `text-label`, `text-meta`)
   instead of `text-[15px]`, `text-lg`, etc. Labels are text-secondary; never placeholder-as-label.
4. **Spacing:** only the §5.1 scale (1,2,3,4,6,8,12 → 4–48px). No `p-5`, `gap-5`, `[20px]`, etc.
   Radii/shadows from kit tokens (`rounded-control`, `rounded-card`, `shadow-card`…), not ad-hoc.
5. **Colour:** tokens only. Fix any hex/rgba left in your files. Decorative colours with no meaning →
   neutral (D8). User-chosen data colours stay data (record the file).
6. **Buttons:** §6 hierarchy — one primary per area, fixed sizes, icon buttons per §6.3, loading via
   `loading` prop, destructive via AlertDialog (§15). Text links via `TextLink`.
7. **Dates/numbers:** through `lib/format.ts` (§18). No `toLocaleDateString`/`toLocaleString` inline.
8. **Permissions in UI (§26):** an action the user may not perform is shown disabled with a reason via
   `PermissionTooltip` (use `useCanWithReason` from `lib/auth/permission-tooltip-adapter.ts` where a
   permission key is already checked); whole areas they can't use stay hidden. Don't invent new checks —
   express the existing ones.
9. **Text overflow (§8):** `Truncate` with tooltip only when cut. **Scrolling (§1.8, §10):** no nested
   same-axis scrollers. **Width (§17):** field widths per §17, table column widths via col-* tokens.
10. **Phone:** if a screen branches on `useLayout()`/`PhoneOnly` or lives under `components/phone`, keep
    the phone branch working exactly as now. Kit components switch to their phone form themselves.
11. **Keep good v2e UX (D12):** where v2e does something deliberately that the kit doesn't cover or
    that would change behaviour the owner designed (e.g. a special interaction, an inline editor, a
    custom visual like a gantt/tree/calendar), keep it restyled to tokens and record it in
    REVIEW-kit-alignment.md.
12. **Pagination (D5):** don't add server pagination. Note unbounded lists in the review doc.

Do NOT edit shared files: `frontend/components/ui/**`, `components/shell/**`, `components/layout/**`,
`components/phone/**`, `app/globals.css`, `app/layout.tsx`, `lib/**` outside your module's folders.
If you need a shared change (a kit component lacks a variant, an adapter bug), write it in your report
and work around it minimally in your own files.

## Verify (before each commit)
- `cd frontend && npx tsc --noEmit 2>&1 | grep -E "<your folders regex>"` → nothing. Errors elsewhere are
  other agents mid-edit; ignore them.
- Do NOT run `next build` (concurrent builds clash on `.next`); the main session builds after you.
- Self-check greps over YOUR folders only, all expected empty (or every remaining hit recorded):
  ```bash
  grep -rnE "#[0-9A-Fa-f]{3,8}\b|rgba?\(" <folders> --include=*.tsx --include=*.ts
  grep -rnE "font-(semibold|bold|extrabold|black)" <folders>
  grep -rnE "\b(confirm|alert|prompt)\(" <folders>
  grep -rn "<select" <folders>
  grep -rnE "\b(p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y|space-x|space-y)-(5|7|9|10|11|14|16|20)\b" <folders>
  grep -rnE "fixed inset-0" <folders>
  grep -rnE "toLocale(Date|Time)?String" <folders>
  grep -rnE "from ['\"]@/components/ui/(Modal|ConfirmDialog|StyledSelect|DatePicker|ResponsiveTable|Toast)['\"]" <folders>
  ```

## Commit
Commit often — at least one commit per sub-area (e.g. per page folder) — so work survives an
interruption. Explicit `git add <paths>` of YOUR files only (never `git add -A` / `git add .`; ignore
`frontend/public/pdf*.mjs`). If git reports `index.lock`, wait a few seconds and retry. Message format:
`refactor(<module>): <what> to kit` then a blank line then
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## REVIEW-kit-alignment.md
Append ONE section for your module at the end of the file (re-read the file right before editing; other
agents append too): `## <Module>` with sub-bullets **Kept for owner decision** (what kit says / what v2e
does / why kept), **Not done / follow-up** (honest list), **Visual changes the owner will notice**.
Commit it with your last commit.

## Report back (under 250 words)
Screens/components done vs not done, adapters you migrated off, shared-component changes needed,
self-check results, commit hashes.
