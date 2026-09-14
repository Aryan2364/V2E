import { DataScope } from '@prisma/client';
import { isValidLeaf } from './permission-registry';
import { ACTIVE_ASSIGNEE } from '../tasks/active-assignee';

/**
 * Data-scope registry — the single source of truth for ROW-LEVEL visibility.
 *
 * The permission registry answers "can this actor do `action` on module X?".
 * This registry answers the orthogonal "of the rows they may read, WHICH ones"
 * for each CONTENT leaf, and records — explicitly, so it can't be silently
 * forgotten — how every content leaf is scoped:
 *
 *  - `scopable`    — filtered by core participants; provides `whereForUsers`.
 *  - `self_scoped` — the module already enforces its own row visibility
 *                    (e.g. work-logs' WorkLogReaderGrant + manager hierarchy);
 *                    ScopeService delegates and never double-filters.
 *  - `org_default` — broadcast-by-nature (announcements/bulletin/knowledge,
 *                    the learning catalog, policy documents); everyone in the
 *                    org is the intended audience, so NO row filter is applied.
 *
 * Decision C: only CORE participants count (owner / assigner / assignee). CC,
 * watchers, voters, commenters and audit actors are deliberately excluded.
 *
 * Messaging is intentionally absent: it is membership-only (ConversationMember)
 * and must NEVER be hierarchy-scoped, so it carries no content leaf here.
 */

export type RowScopeClass = 'scopable' | 'self_scoped' | 'org_default';

/** Builds the participant OR-where fragment for a set of visible user ids. */
export type WhereForUsers = (userIds: string[]) => Record<string, unknown>;

export interface ContentLeafPolicy {
  rowScope: RowScopeClass;
  /** Required iff rowScope === 'scopable'. */
  whereForUsers?: WhereForUsers;
  note?: string;
}

/**
 * Every CONTENT leaf in the software. A leaf present here is "content": superadmin
 * (vendor) is denied content and may only ever see metadata — see PermissionsService.
 */
export const CONTENT_LEAF_POLICY: Record<string, ContentLeafPolicy> = {
  'tasks.task.manage': {
    rowScope: 'scopable',
    whereForUsers: (ids) => ({
      OR: [
        { created_by_user_id: { in: ids } },
        // Participation is the LIVE roster: being taken off a task ends the row-level
        // visibility it granted (both for the person and for anyone scoped over them).
        { assignees: { some: { ...ACTIVE_ASSIGNEE, user_id: { in: ids }, is_cc: false } } },
      ],
    }),
  },
  // Goals are company-wide by design: the module permission is the whole gate,
  // and every goal in the org is visible to anyone holding it. Declared
  // org_default (not removed) so the System Roles screen stops offering a Goals
  // scope dropdown that would silently do nothing.
  goals: { rowScope: 'org_default', note: 'Goals are company-wide; no row-level scope.' },
  meetings: {
    rowScope: 'scopable',
    whereForUsers: (ids) => ({
      OR: [
        { created_by_user_id: { in: ids } },
        { attendees: { some: { user_id: { in: ids } } } },
      ],
    }),
  },
  'tickets.ticket.manage': {
    rowScope: 'scopable',
    whereForUsers: (ids) => ({
      OR: [
        { raised_by_user_id: { in: ids } },
        { assigned_to_user_id: { in: ids } },
        { escalations: { some: { escalate_to_user_id: { in: ids } } } },
      ],
    }),
  },
  'projects.project.manage': {
    rowScope: 'scopable',
    whereForUsers: (ids) => ({
      OR: [
        { created_by_user_id: { in: ids } },
        { project_manager_user_id: { in: ids } },
        { members: { some: { user_id: { in: ids } } } },
      ],
    }),
  },
  // Self-scoped: module owns its own row visibility; ScopeService delegates.
  'work_logs.log.manage': {
    rowScope: 'self_scoped',
    note: 'WorkLogReaderGrant + manager hierarchy + admin (readableWriterIds).',
  },
  'process_hierarchy.map.manage': {
    rowScope: 'self_scoped',
    note: 'ProcessAccessService: map owner + admin + ProcessNodeAccess attachment cascade (dept/role/user) with per-node exclude/restriction.',
  },
  // Broadcast / org-default content — everyone in the org is the audience.
  'learning.path.manage': {
    rowScope: 'org_default',
    note: 'Course catalog is org-wide; personal assignments/progress are already self-own-scoped.',
  },
  'ecs.policy.manage': {
    rowScope: 'org_default',
    note: 'Policy documents are org-wide mandatory; assignments are self-own-scoped.',
  },
  'communication.bulletin.manage': { rowScope: 'org_default' },
  'communication.announcements.manage': { rowScope: 'org_default' },
  'communication.knowledge.manage': { rowScope: 'org_default' },
  'performance.review.manage': { rowScope: 'org_default', note: 'Derived from Goals; no own records.' },
  'employees.profile.manage': { rowScope: 'org_default', note: 'Org directory / people config.' },
};

// ─── Derived lookups ───────────────────────────────────────────────────────────

export const isContentLeaf = (key: string): boolean => key in CONTENT_LEAF_POLICY;
export const scopePolicyOf = (key: string): ContentLeafPolicy | undefined => CONTENT_LEAF_POLICY[key];
export const rowScopeOf = (key: string): RowScopeClass | undefined => CONTENT_LEAF_POLICY[key]?.rowScope;

export const SCOPABLE_LEAVES: string[] = Object.entries(CONTENT_LEAF_POLICY)
  .filter(([, p]) => p.rowScope === 'scopable')
  .map(([k]) => k);

export const SELF_SCOPED_LEAVES: string[] = Object.entries(CONTENT_LEAF_POLICY)
  .filter(([, p]) => p.rowScope === 'self_scoped')
  .map(([k]) => k);

/** Default when a granted read action carries no explicit scope (Decision D). */
export const DEFAULT_SCOPE: DataScope = DataScope.own;

/**
 * Boot-time static validation (fail loud): every content leaf must reference a real
 * permission leaf, and every `scopable` leaf must carry a participant where-builder.
 */
export function validateScopeRegistry(): void {
  for (const [key, pol] of Object.entries(CONTENT_LEAF_POLICY)) {
    if (!isValidLeaf(key)) {
      throw new Error(
        `scope-registry references unknown permission leaf "${key}". ` +
          `Add it to permission-registry.ts or fix the key.`,
      );
    }
    if (pol.rowScope === 'scopable' && typeof pol.whereForUsers !== 'function') {
      throw new Error(`Scopable content leaf "${key}" is missing whereForUsers().`);
    }
  }
}
