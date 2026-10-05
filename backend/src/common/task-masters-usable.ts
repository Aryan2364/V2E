import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MAX_TAGS_PER_TASK, TagColor } from '../task-masters/task-tag.constants';

/**
 * Task Masters (category / priority / department) referenced when creating or
 * editing a task — one-time OR recurring — must belong to the caller's own org
 * and (for category/priority) still be active. Skipping this lets a pasted
 * foreign/deactivated id become a stored cross-tenant reference that then
 * propagates onto every spawned instance and pollutes analytics
 * (see backend/AUTHORIZATION.md). Empty/undefined fields are skipped.
 * Throws BadRequest naming the offending catalog.
 *
 * Shared so the recurring service and the canonical tasks service enforce the
 * exact same rule; mirrors the `org-members.ts` helper convention.
 */
export async function assertMastersUsable(
  prisma: PrismaService,
  orgId: string,
  refs: { category_id?: string | null; priority_id?: string | null; department_id?: string | null },
): Promise<void> {
  const checks: Promise<void>[] = [];
  if (refs.category_id) {
    checks.push(
      prisma.taskCategory
        .findFirst({ where: { id: refs.category_id, organization_id: orgId, is_active: true }, select: { id: true } })
        .then((r) => {
          if (!r) throw new BadRequestException('Category not found or no longer active in this organization.');
        }),
    );
  }
  if (refs.priority_id) {
    checks.push(
      prisma.taskPriority
        .findFirst({ where: { id: refs.priority_id, organization_id: orgId, is_active: true }, select: { id: true } })
        .then((r) => {
          if (!r) throw new BadRequestException('Priority not found or no longer active in this organization.');
        }),
    );
  }
  if (refs.department_id) {
    checks.push(
      prisma.department
        .findFirst({ where: { id: refs.department_id, organization_id: orgId }, select: { id: true } })
        .then((r) => {
          if (!r) throw new BadRequestException('Department not found in this organization.');
        }),
    );
  }
  await Promise.all(checks);
}

// ─── Task tags ──────────────────────────────────────────────────────────────────

/** A client (or a transaction) able to read tags. */
type TagReader = PrismaService | Prisma.TransactionClient;

/**
 * Validate the `tag_ids` a client wants on a task (or recurring template, bulk
 * action, import row) and return them de-duplicated, in the order given.
 *
 *  - `undefined` passes straight through as `undefined` ("leave the tags
 *    unchanged" on an update); `[]` is a real value ("clear all").
 *  - At most MAX_TAGS_PER_TASK distinct ids.
 *  - Every id must be a tag of THIS org — a foreign or unknown id is a 400, never
 *    a stored cross-tenant reference (backend/AUTHORIZATION.md).
 *  - A NEWLY added id must also be active. Ids in `opts.keep` (the tags already on
 *    the task) may be inactive, so a task carrying a since-deactivated tag can
 *    still be saved without first stripping it.
 */
export async function assertTagsUsable(
  prisma: TagReader,
  orgId: string,
  tagIds: string[],
  opts?: { keep?: string[] },
): Promise<string[]>;
export async function assertTagsUsable(
  prisma: TagReader,
  orgId: string,
  tagIds: string[] | undefined,
  opts?: { keep?: string[] },
): Promise<string[] | undefined>;
export async function assertTagsUsable(
  prisma: TagReader,
  orgId: string,
  tagIds: string[] | undefined,
  opts?: { keep?: string[] },
): Promise<string[] | undefined> {
  if (tagIds === undefined) return undefined;
  if (!Array.isArray(tagIds) || tagIds.some((id) => typeof id !== 'string')) {
    throw new BadRequestException('tag_ids must be a list of tag ids.');
  }
  const ids = [...new Set(tagIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length > MAX_TAGS_PER_TASK) {
    throw new BadRequestException(`A task can have at most ${MAX_TAGS_PER_TASK} tags`);
  }
  if (ids.length === 0) return [];

  const rows = await prisma.taskTag.findMany({
    where: { id: { in: ids }, organization_id: orgId },
    select: { id: true, name: true, is_active: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw new BadRequestException(
      missing.length === 1
        ? 'Tag not found in this organization.'
        : `${missing.length} tags were not found in this organization.`,
    );
  }
  const keep = new Set(opts?.keep ?? []);
  const inactive = ids.filter((id) => !keep.has(id) && !byId.get(id)!.is_active).map((id) => byId.get(id)!.name);
  if (inactive.length > 0) {
    throw new BadRequestException(
      `${inactive.map((n) => `"${n}"`).join(', ')} ${inactive.length === 1 ? 'is' : 'are'} deactivated and can't be added to a task.`,
    );
  }
  return ids;
}

/** The light tag reference embedded in task and template responses (TASK_TAGS_PLAN.md §10.1). */
export interface TaskTagRef {
  id: string;
  name: string;
  color: TagColor;
  is_active: boolean;
}

/** Select for one tag reference. */
export const TAG_REF_FIELDS = { id: true, name: true, color: true, is_active: true } as const;

/**
 * Spread into a Task `include` (or `select`) to load its tags, sorted by name:
 *   `include: { ...TASK_INCLUDE, ...TASK_TAG_REF_SELECT }`
 * then run the result through `flattenTags()` so the join row never leaves the API.
 * Sorted on `name_key` — the same order as `name`, but case-insensitive.
 */
export const TASK_TAG_REF_SELECT = {
  tags: {
    select: { tag: { select: TAG_REF_FIELDS } },
    orderBy: { tag: { name_key: 'asc' } },
  },
} satisfies Prisma.TaskInclude;

type TagLinkRow = { tag: { id: string; name: string; color: string; is_active: boolean } };

/** Join rows (`{ tag: {...} }[]`) → `TaskTagRef[]`. Tolerates a missing relation. */
export function toTagRefs(links: TagLinkRow[] | null | undefined): TaskTagRef[] {
  return (links ?? []).map(({ tag }) => ({
    id: tag.id,
    name: tag.name,
    color: tag.color as TagColor,
    is_active: tag.is_active,
  }));
}

/**
 * Replace a loaded task's `tags` join rows with flat `TaskTagRef[]`. A row loaded
 * without the relation comes back with `tags: []`, so the response shape is stable.
 */
export function flattenTags<T extends { tags?: TagLinkRow[] }>(row: T): Omit<T, 'tags'> & { tags: TaskTagRef[] } {
  return { ...row, tags: toTagRefs(row.tags) };
}

/**
 * Resolve tag ids (e.g. `RecurringTemplate.tag_ids`) to refs in one query, for many
 * rows at once. Scoped to the org; unknown or foreign ids are simply absent.
 */
export async function loadTagRefMap(prisma: TagReader, orgId: string, tagIds: Iterable<string>): Promise<Map<string, TaskTagRef>> {
  const ids = [...new Set(tagIds)].filter(Boolean);
  if (ids.length === 0) return new Map();
  const rows = await prisma.taskTag.findMany({
    where: { id: { in: ids }, organization_id: orgId },
    select: TAG_REF_FIELDS,
  });
  return new Map(rows.map((r) => [r.id, { ...r, color: r.color as TagColor }]));
}

/** `tag_ids` + a map from `loadTagRefMap` → refs sorted by name, unknown ids dropped. */
export function tagRefsFor(tagIds: string[] | null | undefined, refs: Map<string, TaskTagRef>): TaskTagRef[] {
  return [...new Set(tagIds ?? [])]
    .map((id) => refs.get(id))
    .filter((r): r is TaskTagRef => !!r)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}
