/**
 * Task tags — shared constants and name normalisation (TASK_TAGS_PLAN.md §2, §6.1).
 *
 * Tags store a palette KEY, never a hex: the frontend maps each key to fill /
 * text / border tokens in globals.css, so a re-theme changes every tag at once
 * and no tag can ever render as unreadable yellow-on-yellow. Order matters — it
 * is the tie-break when the server auto-picks a colour for a new tag.
 */
export const TAG_COLORS = ['slate', 'ochre', 'indigo', 'rose', 'teal', 'green', 'violet', 'amber'] as const;
export type TagColor = (typeof TAG_COLORS)[number];

export const TAG_NAME_MAX_LENGTH = 40;
export const TAG_DESCRIPTION_MAX_LENGTH = 200;
export const MAX_TAGS_PER_TASK = 10;

/** `POST masters/tags` guard against runaway scripts and paste accidents. */
export const TAG_CREATE_RATE_LIMIT = 30;
export const TAG_CREATE_RATE_WINDOW_MS = 60 * 60 * 1000;

/** `|` is the import cell delimiter and `,` the CSV/filter delimiter — neither may appear in a name. */
export const TAG_NAME_FORBIDDEN = /[|,]/;

/** Permission leaves (permission-registry.ts). */
export const TAG_CREATE_LEAF = 'tasks.tags.create';
export const TAG_MANAGE_LEAF = 'tasks.config.tags.manage';

/** Display form: trimmed, inner whitespace runs collapsed to one space. */
export function normalizeTagName(raw: string): string {
  return String(raw ?? '').trim().replace(/\s+/g, ' ');
}

/** Uniqueness / import-matching key: the display form, lower-cased. */
export function tagNameKey(raw: string): string {
  return normalizeTagName(raw).toLowerCase();
}
