# Wave 2 — finishing pass brief (shared by all wave-2 agents)

Wave 1 (see `P5-BRIEF.md`) moved every module onto kit tokens, weights, spacing, dates, and converted
most overlays. A scan shows what's still not kit-shaped. You finish ONE folder group (given in your
prompt). Same ground rules as `P5-BRIEF.md` — read it first (worktree, never push, never edit the kit or
shared folders, presentation only, keep phone branches, explicit `git add`, commit after each folder,
Co-Authored-By line, tsc filter, no `next build`). Do not spawn sub-agents. Then read
`frontend/FRONTEND_RULES.md` §3, §6, §11, §13, §14, §19 again before editing.

## Settled: thin adapters stay
`StyledSelect`, `DatePicker`, `DateRangePicker`, `Modal`, `ConfirmDialog`, `ResponsiveTable`,
`TimeField`, `MultiSelect` now only map props onto kit components. Leave their call sites alone; this
wave is about what users see.

## The checklist (work through it file by file)
1. **Page header.** Every `page.tsx` that renders a screen (not a redirect) gives its title, breadcrumb
   `trail` and primary action through `PageHeader` from `@/components/shell/page-header`. Delete the
   hand-made `<h1>`/title row it replaces. No desktop back arrows. Sign-in pages are exempt (§11.7).
   Canvas pages with a dense toolbar: PageHeader for title+trail, toolbar stays below it.
2. **Buttons.** Every `<button>` that is a button in the §6 sense (an action with a label or an icon)
   becomes `Button` from `@/components/ui/button` with the right variant per §6.1 — `primary` (one per
   area), `secondary`, `ghost`, `danger` (also `in-field`, `on-brand` for those contexts) — and size
   `default` / `sm` / `lg` (icon-only: `icon` / `icon-sm` / `icon-lg`). Read `button.tsx` first. Icon-only buttons get `aria-label` and a
   `Tooltip`. Keep `onClick`, `disabled`, `type`, and any `data-*`/`aria-*` exactly. Leave a raw
   `<button>` only when it's a whole row/card/cell click target, a canvas control, or a segmented
   control that is already a kit pattern — and make sure it has a styled hover and focus-visible ring
   (tokens). Text-only links that navigate → `TextLink` or `Link` styled per §6.6.
3. **Type scale.** `text-xs|sm|base|lg|xl|2xl|3xl` and `text-[Npx]` → kit tokens per §3:
   page title `text-page-title`, section heading `text-section`, card heading `text-card-heading`,
   body `text-body`, label `text-label`, meta/timestamps/counts `text-meta`. Nothing below 12px.
   Inputs keep the kit input's own size.
4. **Surfaces.** `bg-white` → `bg-surface`; `text-white` → `text-primary-foreground` on a primary fill,
   `text-on-brand` on a band/sidebar, `text-on-danger` on danger; `bg-black/…` backdrops → the kit
   overlay components or `bg-backdrop`.
5. **States.** Spinners/“Loading…” text → `Skeleton` in the shape of the content (rows for a list, a
   few blocks for a detail). Hand-written empty messages → `EmptyState` (`nothing-yet` /
   `nothing-found` / `failed` …). Status shown as coloured text or a hand-made pill → `Badge`. Native
   `title=` → `Tooltip`. Error boxes → `Banner`. Form labels → `Label`; text inputs → `Input`;
   textareas → `Textarea`; checkboxes/switches/radios → kit `checkbox`/`switch`/`radio-group`.
6. Remaining `fixed inset-0` in your folders → kit Dialog/Sheet/AlertDialog/Popover where behaviour
   can be kept; canvases (ReactFlow) are exempt (D6).

Behaviour must not change: same handlers, same conditions, same text (except fixing capitalisation
per §37.1 on headings/buttons, which is allowed), same routes.

## Done means
For your folders: `grep -rEo "\btext-(\[[0-9]+px\]|xs|sm|base|lg|xl|2xl|3xl)\b"` → 0;
`grep -rE "\b(bg|text)-(white|black)\b"` → 0; every screen `page.tsx` contains `PageHeader`; raw
`<button>` count reduced to the justified exceptions; tsc filter clean. Update your module's section in
`REVIEW-kit-alignment.md` (re-read the file first; keep other sections intact) with what changed and
anything left. Report in under 200 words with the before/after counts.
