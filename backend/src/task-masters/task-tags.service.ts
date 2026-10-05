import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PermissionAction, Prisma, TaskTag } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionsService, Principal } from '../access-rights/permissions.service';
import { CreateTagDto } from './dto/create-tag.dto';
import { UpdateTagDto } from './dto/update-tag.dto';
import {
  normalizeTagName,
  TAG_COLORS,
  TAG_CREATE_LEAF,
  TAG_CREATE_RATE_LIMIT,
  TAG_CREATE_RATE_WINDOW_MS,
  TAG_DESCRIPTION_MAX_LENGTH,
  TAG_MANAGE_LEAF,
  TAG_NAME_FORBIDDEN,
  TAG_NAME_MAX_LENGTH,
  TagColor,
  tagNameKey,
} from './task-tag.constants';

/** Master row returned by every tag route (TASK_TAGS_PLAN.md §10.1). */
export interface TaskTagDto {
  id: string;
  organization_id: string;
  name: string;
  color: TagColor;
  description: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  // Only for admins and holders of tasks.config.tags.manage (cleanup data).
  usage_count?: number;
  created_by?: { id: string; name: string } | null;
}

/**
 * Task tags — org-wide coloured labels (TASK_TAGS_PLAN.md, option C).
 *
 * Tags are org CONFIGURATION, not participant content: there is no row scope to
 * apply, so every route is the action gate (decorator, or the service check for
 * create) plus the `organization_id` filter on every query. Every `:id` route
 * resolves the tag with `findFirst({ id, organization_id })` → 404 before acting.
 */
@Injectable()
export class TaskTagsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
  ) {}

  // ─── Read ──────────────────────────────────────────────────────────────────

  /** Every org member may list tags (pickers, filters). Usage + creator only for curators. */
  async listTags(orgId: string, principal: Principal, includeInactive = false): Promise<TaskTagDto[]> {
    const rows = await this.prisma.taskTag.findMany({
      where: { organization_id: orgId, ...(includeInactive ? {} : { is_active: true }) },
      orderBy: { name_key: 'asc' },
    });
    if (!(await this.canCurate(orgId, principal))) return rows.map((r) => this.toDto(r));
    return this.withUsage(orgId, rows);
  }

  // ─── Create ────────────────────────────────────────────────────────────────

  /**
   * Create a tag, or hand back the existing one. `created` tells the controller
   * whether to answer 201 (new) or 200 (an active tag with this name already
   * existed — so two people creating "Audit" at once both get the same tag).
   */
  async createTag(
    orgId: string,
    principal: Principal,
    dto: CreateTagDto,
  ): Promise<{ tag: TaskTagDto; created: boolean }> {
    // Two leaves can authorise this, so it can't be a single @RequirePermission.
    const allowed =
      (await this.permissions.hasEffective(orgId, principal, TAG_CREATE_LEAF, PermissionAction.write)) ||
      (await this.permissions.hasEffective(orgId, principal, TAG_MANAGE_LEAF, PermissionAction.write));
    if (!allowed) throw new ForbiddenException('Only people allowed to create task tags can do this.');

    const name = this.assertValidName(dto.name);
    const nameKey = tagNameKey(name);

    const existing = await this.findByKey(orgId, nameKey);
    if (existing) return { tag: this.toDto(this.assertActiveMatch(existing)), created: false };

    // Only real creations count against the limit — re-selecting an existing tag never does.
    const recent = await this.prisma.taskTag.count({
      where: {
        organization_id: orgId,
        created_by_user_id: principal.userId,
        created_at: { gte: new Date(Date.now() - TAG_CREATE_RATE_WINDOW_MS) },
      },
    });
    if (recent >= TAG_CREATE_RATE_LIMIT) {
      throw new HttpException(
        `You've created ${TAG_CREATE_RATE_LIMIT} tags in the last hour. Pick an existing tag or try again later.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const color = dto.color ?? (await this.pickColor(orgId));
    try {
      const tag = await this.prisma.taskTag.create({
        data: {
          organization_id: orgId,
          name,
          name_key: nameKey,
          color,
          description: this.cleanDescription(dto.description),
          created_by_user_id: principal.userId,
        },
      });
      return { tag: this.toDto(tag), created: true };
    } catch (err) {
      // Lost a race on (organization_id, name_key): someone created it a moment ago.
      if (isUniqueViolation(err)) {
        const winner = await this.findByKey(orgId, nameKey);
        if (winner) return { tag: this.toDto(this.assertActiveMatch(winner)), created: false };
      }
      throw err;
    }
  }

  // ─── Update ────────────────────────────────────────────────────────────────

  async updateTag(orgId: string, tagId: string, dto: UpdateTagDto): Promise<TaskTagDto> {
    const tag = await this.findTagOrFail(orgId, tagId);
    const data: Prisma.TaskTagUpdateInput = {};

    if (dto.name !== undefined) {
      const name = this.assertValidName(dto.name);
      const nameKey = tagNameKey(name);
      if (nameKey !== tag.name_key) {
        const clash = await this.prisma.taskTag.findFirst({
          where: { organization_id: orgId, name_key: nameKey, NOT: { id: tag.id } },
          select: { id: true, name: true },
        });
        if (clash) throw this.nameClash(clash);
      }
      data.name = name;
      data.name_key = nameKey;
    }
    if (dto.color !== undefined) {
      if (!(TAG_COLORS as readonly string[]).includes(dto.color)) throw new BadRequestException('Unknown tag colour');
      data.color = dto.color;
    }
    if (dto.description !== undefined) data.description = this.cleanDescription(dto.description);
    if (dto.is_active !== undefined) data.is_active = dto.is_active;

    try {
      const updated = await this.prisma.taskTag.update({ where: { id: tag.id }, data });
      return (await this.withUsage(orgId, [updated]))[0];
    } catch (err) {
      if (isUniqueViolation(err) && data.name_key) {
        const clash = await this.findByKey(orgId, data.name_key as string);
        if (clash) throw this.nameClash(clash);
      }
      throw err;
    }
  }

  // ─── Delete ────────────────────────────────────────────────────────────────

  /**
   * Hard-delete a tag nothing has ever used; otherwise deactivate it (it stays on
   * its tasks and templates but can't be added anywhere new).
   *
   * The decision counts EVERY link, including links on soft-deleted tasks: those
   * links are kept (archives and restores depend on them) and the FK is RESTRICT,
   * so such a tag can't be hard-deleted anyway. The `usage_count` users see
   * (withUsage) counts live tasks only, so a tag showing "0 tasks" — where the
   * frontend enables Delete — can still come back `{ result: 'deactivated' }` if
   * it only sits on deleted tasks. The frontend already handles that result with
   * a toast, so this is the intended (if rare) path, not an error.
   */
  async deleteTag(orgId: string, tagId: string): Promise<{ result: 'deleted' | 'deactivated' }> {
    const tag = await this.findTagOrFail(orgId, tagId);
    const [links, templates] = await Promise.all([
      // All links, deleted tasks included — see above.
      this.prisma.taskTagLink.count({ where: { tag_id: tag.id, organization_id: orgId } }),
      this.prisma.recurringTemplate.count({ where: { organization_id: orgId, tag_ids: { has: tag.id } } }),
    ]);

    if (links === 0 && templates === 0) {
      try {
        await this.prisma.taskTag.deleteMany({ where: { id: tag.id, organization_id: orgId } });
        return { result: 'deleted' };
      } catch (err) {
        // A task was tagged between the count and the delete (FK RESTRICT) — fall back.
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003')) throw err;
      }
    }
    await this.prisma.taskTag.update({ where: { id: tag.id }, data: { is_active: false } });
    return { result: 'deactivated' };
  }

  // ─── Merge ─────────────────────────────────────────────────────────────────

  /**
   * Fold `sourceId` into `intoId` (e.g. "urgent" + "Urgent!"), in one transaction:
   * re-point the source's links (a task already carrying the target keeps just the
   * one), rewrite recurring templates' `tag_ids`, then delete the source tag.
   * The route requires manage `edit`; `delete` is checked here because the source
   * tag is destroyed.
   */
  async mergeTag(
    orgId: string,
    principal: Principal,
    sourceId: string,
    intoId: string,
  ): Promise<{ moved: number; into: TaskTagDto }> {
    if (!(await this.permissions.hasEffective(orgId, principal, TAG_MANAGE_LEAF, PermissionAction.delete))) {
      throw new ForbiddenException('Merging deletes a tag, so it needs both edit and delete on task tags');
    }
    if (sourceId === intoId) throw new BadRequestException('A tag cannot be merged into itself');

    const source = await this.findTagOrFail(orgId, sourceId);
    const target = await this.prisma.taskTag.findFirst({ where: { id: intoId, organization_id: orgId } });
    if (!target) throw new NotFoundException('The tag to merge into was not found');
    if (!target.is_active) {
      throw new BadRequestException(`Reactivate '${target.name}' before merging another tag into it`);
    }

    // Two merges (or a merge and a tagging) racing can hit the (task_id, tag_id)
    // unique index between our read and write — P2002. Re-run the whole merge once
    // from a fresh read; if it still collides, tell the user instead of a 500.
    let moved: number;
    try {
      moved = await this.runMerge(orgId, source.id, target.id);
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      try {
        moved = await this.runMerge(orgId, source.id, target.id);
      } catch (retryErr) {
        if (isUniqueViolation(retryErr)) throw new ConflictException('Tags changed while merging. Try again.');
        throw retryErr;
      }
    }

    const fresh = await this.findTagOrFail(orgId, target.id);
    return { moved, into: (await this.withUsage(orgId, [fresh]))[0] };
  }

  /** One merge attempt, all-or-nothing. Returns how many links were re-pointed. */
  private runMerge(orgId: string, sourceId: string, targetId: string): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const sourceLinks = await tx.taskTagLink.findMany({
        where: { tag_id: sourceId, organization_id: orgId },
        select: { id: true, task_id: true },
      });
      const alreadyTagged = new Set(
        (
          await tx.taskTagLink.findMany({
            where: {
              tag_id: targetId,
              organization_id: orgId,
              task_id: { in: sourceLinks.map((l) => l.task_id) },
            },
            select: { task_id: true },
          })
        ).map((l) => l.task_id),
      );
      const toMove = sourceLinks.filter((l) => !alreadyTagged.has(l.task_id)).map((l) => l.id);
      const { count } = toMove.length
        ? await tx.taskTagLink.updateMany({
            where: { id: { in: toMove }, organization_id: orgId },
            data: { tag_id: targetId },
          })
        : { count: 0 };
      // What's left on the source are tasks that already carry the target.
      await tx.taskTagLink.deleteMany({ where: { tag_id: sourceId, organization_id: orgId } });

      const templates = await tx.recurringTemplate.findMany({
        where: { organization_id: orgId, tag_ids: { has: sourceId } },
        select: { id: true, tag_ids: true },
      });
      for (const t of templates) {
        const next = [...new Set(t.tag_ids.map((id) => (id === sourceId ? targetId : id)))];
        await tx.recurringTemplate.update({ where: { id: t.id }, data: { tag_ids: next } });
      }

      await tx.taskTag.deleteMany({ where: { id: sourceId, organization_id: orgId } });
      return count;
    });
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  /** Usage counts and creators are cleanup data — curators (and admins) only. */
  private async canCurate(orgId: string, principal: Principal): Promise<boolean> {
    if (principal.isAdmin) return true;
    for (const action of [PermissionAction.write, PermissionAction.edit, PermissionAction.delete]) {
      if (await this.permissions.hasEffective(orgId, principal, TAG_MANAGE_LEAF, action)) return true;
    }
    return false;
  }

  private async withUsage(orgId: string, rows: TaskTag[]): Promise<TaskTagDto[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const creatorIds = [...new Set(rows.map((r) => r.created_by_user_id))];
    const [counts, creators] = await Promise.all([
      this.prisma.taskTagLink.groupBy({
        by: ['tag_id'],
        // Live tasks only: a soft-deleted task's links are kept for the archive but
        // aren't "use" anyone can see or clean up (deleteTag still counts them).
        where: { organization_id: orgId, tag_id: { in: ids }, task: { is_deleted: false } },
        _count: { _all: true },
      }),
      this.prisma.user.findMany({ where: { id: { in: creatorIds } }, select: { id: true, name: true } }),
    ]);
    const countBy = new Map(counts.map((c) => [c.tag_id, c._count._all]));
    const creatorBy = new Map(creators.map((u) => [u.id, u]));
    return rows.map((r) => ({
      ...this.toDto(r),
      usage_count: countBy.get(r.id) ?? 0,
      created_by: creatorBy.get(r.created_by_user_id) ?? null,
    }));
  }

  /** The least-used palette colour among the org's active tags; ties go to palette order. */
  private async pickColor(orgId: string): Promise<TagColor> {
    const used = await this.prisma.taskTag.groupBy({
      by: ['color'],
      where: { organization_id: orgId, is_active: true },
      _count: { _all: true },
    });
    const countBy = new Map(used.map((u) => [u.color, u._count._all]));
    let best: TagColor = TAG_COLORS[0];
    for (const c of TAG_COLORS) {
      if ((countBy.get(c) ?? 0) < (countBy.get(best) ?? 0)) best = c;
    }
    return best;
  }

  /** Service-side name rules, so a caller bypassing the DTO can't store a bad name. */
  private assertValidName(raw: string): string {
    const name = normalizeTagName(raw);
    if (!name) throw new BadRequestException('Tag name is required');
    if (name.length > TAG_NAME_MAX_LENGTH) {
      throw new BadRequestException(`Tag names can be at most ${TAG_NAME_MAX_LENGTH} characters`);
    }
    if (TAG_NAME_FORBIDDEN.test(name)) throw new BadRequestException('Tag names cannot contain commas or pipes');
    return name;
  }

  private cleanDescription(raw: string | null | undefined): string | null {
    const d = typeof raw === 'string' ? raw.trim() : '';
    if (d.length > TAG_DESCRIPTION_MAX_LENGTH) {
      throw new BadRequestException(`Descriptions can be at most ${TAG_DESCRIPTION_MAX_LENGTH} characters`);
    }
    return d || null;
  }

  private findByKey(orgId: string, nameKey: string) {
    return this.prisma.taskTag.findFirst({ where: { organization_id: orgId, name_key: nameKey } });
  }

  /**
   * An exact-name match on create: active → reuse it; inactive → 409 carrying
   * `tag_id`, so a curator can offer "Reactivate it" instead of a dead end.
   */
  private assertActiveMatch(tag: TaskTag): TaskTag {
    if (tag.is_active) return tag;
    throw new ConflictException({ message: `'${tag.name}' exists but is deactivated`, tag_id: tag.id });
  }

  private nameClash(clash: { id: string; name: string }) {
    return new ConflictException({ message: `A tag named '${clash.name}' already exists`, tag_id: clash.id });
  }

  private async findTagOrFail(orgId: string, tagId: string): Promise<TaskTag> {
    const tag = await this.prisma.taskTag.findFirst({ where: { id: tagId, organization_id: orgId } });
    if (!tag) throw new NotFoundException('Tag not found');
    return tag;
  }

  /** Strip the internal columns (`name_key`, `created_by_user_id`). */
  private toDto(tag: TaskTag): TaskTagDto {
    return {
      id: tag.id,
      organization_id: tag.organization_id,
      name: tag.name,
      color: tag.color as TagColor,
      description: tag.description,
      is_active: tag.is_active,
      created_at: tag.created_at,
      updated_at: tag.updated_at,
    };
  }
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}
