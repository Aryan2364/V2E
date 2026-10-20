# Kit pending: the named z-layer classes generate no CSS

**Found:** 21 Oct 2026, in v2e (owner report: "+ Add tag" from the task page showed through the notifications panel and scrolled with it).

**Defect.** `app/globals.css` defines the layers as plain variables (`--z-sticky`, `--z-shell`, `--z-dialog`, `--z-popover`, `--z-toast`, `--z-tooltip`) and says to use them as `z-(--z-dialog)`. But the kit's own components use the bare names: `z-shell` (shell/app-bar.tsx, shell/progress-bar.tsx), `z-tooltip` (shell/content-area.tsx), and in v2e's copies of components/ui `z-dialog`, `z-popover`, `z-sticky`, `z-toast`. Tailwind 4 has no z-index theme namespace, so these classes compile to nothing: computed `z-index: auto`. Layering then depends on DOM order, and any later `position: relative` element paints over a header panel.

**Fix applied in v2e** (`frontend/app/globals.css`, beside `@utility tap-area`):

```css
@utility z-sticky { z-index: var(--z-sticky); }
@utility z-shell { z-index: var(--z-shell); }
@utility z-dialog { z-index: var(--z-dialog); }
@utility z-popover { z-index: var(--z-popover); }
@utility z-toast { z-index: var(--z-toast); }
@utility z-tooltip { z-index: var(--z-tooltip); }
```

**Proposal for the kit:** add the same six utilities to the kit's `globals.css`, so both spellings (`z-shell` and `z-(--z-shell)`) work, and update the "Use as z-(--z-dialog)" comment.
