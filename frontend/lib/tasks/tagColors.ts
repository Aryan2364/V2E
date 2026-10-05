import { TAG_COLORS, type TagColor } from '@/lib/types/tasks'

/**
 * Tag palette key → the classes that paint it. The colours themselves live only in
 * app/globals.css (`--tag-<key>-*` tokens and the `.tag-chip-*` / `.tag-dot-*` rules),
 * never inline (kit §1 rule 2). Those rules sit outside Tailwind's layers, so these
 * names are safe to build from data — Tailwind does not need to see them.
 */
const CHIP: Record<TagColor, string> = {
  slate: 'tag-chip-slate',
  ochre: 'tag-chip-ochre',
  indigo: 'tag-chip-indigo',
  rose: 'tag-chip-rose',
  teal: 'tag-chip-teal',
  green: 'tag-chip-green',
  violet: 'tag-chip-violet',
  amber: 'tag-chip-amber',
}

const DOT: Record<TagColor, string> = {
  slate: 'tag-dot-slate',
  ochre: 'tag-dot-ochre',
  indigo: 'tag-dot-indigo',
  rose: 'tag-dot-rose',
  teal: 'tag-dot-teal',
  green: 'tag-dot-green',
  violet: 'tag-dot-violet',
  amber: 'tag-dot-amber',
}

/** Plain-language names for the swatch picker's labels and tooltips. */
export const TAG_COLOR_LABELS: Record<TagColor, string> = {
  slate: 'Slate',
  ochre: 'Ochre',
  indigo: 'Indigo',
  rose: 'Rose',
  teal: 'Teal',
  green: 'Green',
  violet: 'Violet',
  amber: 'Amber',
}

/** An unknown key (e.g. a palette shrunk after the row was written) falls back to slate. */
export function normalizeTagColor(color: string | null | undefined): TagColor {
  return (TAG_COLORS as string[]).includes(color ?? '') ? (color as TagColor) : 'slate'
}

/** Fill + text + border classes for a chip. Pair with a `border` width class. */
export function tagChipClass(color: string | null | undefined, inactive = false): string {
  return inactive ? 'tag-chip-inactive' : CHIP[normalizeTagColor(color)]
}

/** Full-strength fill for a dot or swatch (option markers, the colour picker). */
export function tagDotClass(color: string | null | undefined, inactive = false): string {
  return inactive ? 'tag-dot-inactive' : DOT[normalizeTagColor(color)]
}
