# Colour map — hex → kit token (P2)

Driving data for `frontend/scripts/kit-colour-codemod.mjs`. Scope: every `.ts`/`.tsx`
under `app/`, `components/`, `lib/`, except `lib/install-settings.ts` (kit §1.1
exception: the phone manifest/status-bar colours can't read a CSS token) and
`lib/org-chart-colors.ts` (a generated categorical palette assigned to org-chart
nodes at runtime — user-facing module/department identity, left as data, same
reasoning as the tag palette in `app/globals.css`).

Three role tables below because the same hex plays different roles depending on
the Tailwind prefix it sits on (a slate used as `text-[#0F172A]` wants
`text-primary`; the same hex as `bg-[#0F172A]` wants a dark surface, which the
kit doesn't have as a light-theme surface — see "Dark-ground exceptions").

## TEXT (text-, placeholder-, decoration-, caret-)

| hex | token | note |
|---|---|---|
| `#0F172A` | `text-primary` | darkest heading/body text |
| `#1E293B` | `text-primary` | body text |
| `#172554` | `text-primary` | |
| `#374151` | `text-secondary` | |
| `#475569` | `text-secondary` | the most common secondary-text grey |
| `#334155` | `text-secondary` | |
| `#64748B` | `text-muted` | v2e's old helper/muted grey |
| `#94A3B8` | `text-muted` | floor per §2.3 — never lighter; v2e's `--border-strong`/placeholder grey used as text maps up to muted, not down |
| `#6B7280` | `text-muted` | |
| `#2563EB`, `#1D4ED8`, `#1E40AF`, `#3B82F6` | `primary-text` | brand-as-text (links, active tab) |
| `#16A34A`, `#15803D`, `#166534`, `#047857`, `#059669`, `#065F46`, `#22C55E`, `#65A30D` | `success` | status text |
| `#D97706`, `#92400E`, `#B45309`, `#A16207`, `#CA8A04`, `#9A3412`, `#78350F`, `#713F12`, `#854D0E`, `#C2410C` | `warning` | status text |
| `#DC2626`, `#B91C1C`, `#991B1B`, `#EF4444`, `#E11D48`, `#BE123C` | `danger` | status text |
| `#FFFFFF`, `#FFF`, `#000`, `#000000` | `primary-foreground` / `text-primary` | see "Pure black/white" below |
| violet/purple/pink/cyan/indigo used as plain text (`#7C3AED`,`#8B5CF6`,`#4C1D95`,`#5B21B6`,`#6D28D9`,`#4338CA`,`#3730A3`,`#9333EA`,`#DB2777`,`#BE185D`,`#EC519E`,`#0891B2`,`#0E7490`,`#0369A1`,`#0EA5E9`,`#F59E0B`,`#FBBF24`,`#EA580C` etc.) | `text-secondary` | decorative/role-identity colour used as text, not status (D8: no info-blue; same reasoning extended to the other decorative hues — they carry no meaning on their own, so the neutral reads correctly and the badge's own coloured chip/dot still carries the identity) |

## FILL (bg-, divide-, gradient from/via/to, fill (non-svg-series))

| hex | token | note |
|---|---|---|
| `#EFF6FF`, `#DBEAFE`, `#F0F9FF`, `#E0E7FF`, `#EEF2FF` | `primary-subtle` | light brand tint fills |
| `#2563EB`, `#1D4ED8`, `#1E40AF`, `#3B82F6` | `primary` / `primary-hover` / `primary-pressed` / `primary-ring` respectively | exact brand fills |
| `#F8FAFC`, `#F8FAFF`, `#F8FBFF`, `#FAFAFA`, `#FAFBFC`, `#FBFCFE`, `#FCFDFE` | `surface-sunken` | page-ground tints |
| `#F1F5F9`, `#F3F4F6`, `#E5E7EB`, `#EEF1F5`, `#EEF2F7`, `#EEF2F8`, `#E8EDF3`, `#E9EEF4` | `surface-control` | neutral fill / ghost hover |
| `#E2E8F0`, `#CBD5E1` | `surface-control-pressed` | darker neutral fill |
| `#DCFCE7`, `#D1FAE5`, `#A7F3D0`, `#ECFDF5`, `#F0FDF4`, `#BBF7D0` | `success-bg` | |
| `#FEF3C7`, `#FEF9C3`, `#FEFCE8`, `#FFFBEB`, `#FED7AA`, `#FFF7ED` | `warning-bg` | |
| `#FEE2E2`, `#FEF2F2`, `#FFE4E6`, `#FFF1F2`, `#FFF5F5`, `#FBCFE8`, `#FDF2F8`, `#FECDD3` | `danger-bg` | |
| `#E0F2FE`, `#BAE6FD`, `#F3E8FF`, `#F5F3FF`, `#EDE9FE`, `#FDF4FF`, `#E9D5FF` | `surface-control` | decorative pastel fills (info/violet/etc, D8: neutral) |
| `#0B1220` | `text-primary` (used as an overlay/scrim tint, not a surface) | see note in script comments |
| `#FFFFFF`, `#FFF`, `#FFFFFF` on brand | `surface` (plain white bg) / `primary-foreground` (white text/icon on a brand fill) | disambiguated by the codemod's surrounding class, see script |
| `#000`, `#000000` as a bg | `text-primary` (used only in hand-rolled overlays/backdrops — replaced with `var(--backdrop)` by hand, not this script) | flagged for manual pass |
| violet/purple/pink/cyan family used as a fill (role badges, avatars, decorative chips outside the tag/org-chart data palettes) | `surface-control` | D8 extended: decorative, not status — the darker same-hue token (if any) that sits alongside it as text still carries identity via `text-secondary`, which is why these don't collapse to invisible |

## BORDER (border-, ring-, outline-, accent-, divide- used as a rule)

| hex | token |
|---|---|
| `#2563EB`, `#1D4ED8` | `primary` / `primary-hover` |
| `#3B82F6` | `primary-ring` |
| `#BFDBFE`, `#93C5FD` | `primary-border` |
| `#E2E8F0` | `border-light` |
| `#CBD5E1` | `border` |
| `#94A3B8` | `border-strong` |
| `#86EFAC`, `#BBF7D0` | `success-border` |
| `#FCD34D`, `#FDE68A` | `warning-border` |
| `#FCA5A5`, `#FECACA` | `danger-border` |
| violet/pink/cyan/indigo borders (decorative) | `border-light` or `border` (whichever the surrounding fill already uses) |

## Pure black / white and dark-ground exceptions

- `#FFFFFF`/`#FFF` as **text** on a coloured fill (status pill, primary button) → `primary-foreground` (brand) or `on-danger`/`on-success` style (status — the kit only names `on-danger`; a white-on-success/warning pill keeps literal `#FFFFFF` → **left for hand pass**, flagged by the script, not silently mapped, since the kit has no `on-success`/`on-warning` token yet).
- `#FFFFFF`/`#FFF` as **bg** → `surface`.
- `#000`/`#000000` as a bg (used for drag-ghosts/overlays) → `var(--backdrop)`, done by hand, not the script (the script flags, doesn't rewrite, pure black backgrounds — too easy to catch a legitimate opaque black elsewhere).

## Opacity suffixes, prefixes, important

`bg-[#2563EB]/10` → `bg-primary/10`. `hover:`, `focus:`, `active:`, `group-hover:`,
`disabled:`, `data-[...]:` prefixes are preserved verbatim before the class.
A trailing `!` (important) is preserved. Arbitrary-property forms
(`[background-color:#2563EB]`, `style={{ color: '#2563EB' }}`) are handled by the
hand pass (task 5's "what the class-codemod can't"), not this script.

## Left as data (not touched by the script)

- `lib/install-settings.ts` — kit §1.1 exception.
- `lib/org-chart-colors.ts` — generated categorical palette for org-chart nodes.
- `app/globals.css` tag palette (`--tag-*`) — user-chosen tag colours, D7.
- Any `theme-color` meta / manifest colour — same exception as install-settings.
