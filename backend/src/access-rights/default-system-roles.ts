import { DataScope, PermissionAction, Prisma } from '@prisma/client';

/**
 * Default System Roles seeded into every org alongside the locked Administrator.
 *
 * They are intentionally is_system:false / is_admin:false:
 *   - is_admin:false  → they get access ONLY through the explicit RolePermission
 *                       rows below (no Settings/admin leaves), and their data
 *                       scope is honoured (is_admin would force org scope and
 *                       bypass the whole permission matrix).
 *   - is_system:false → admins may rename, retune or delete them in the Access
 *                       Control UI; only Administrator stays locked.
 *
 * The three roles share ONE grant matrix and differ only by default_scope. We
 * leave every RolePermission.scope null so the scope cascade in
 * permissions.service.ts resolves each scopable work leaf to the role's
 * default_scope (own / team / org).
 *
 * Delete is reserved for Administrator only: no default (non-admin) role is ever
 * granted the `delete` action. Work content is granted read+write+edit.
 */

const RWE: PermissionAction[] = [
  PermissionAction.read,
  PermissionAction.write,
  PermissionAction.edit,
];
const READ: PermissionAction[] = [PermissionAction.read];

interface RoleGrant {
  feature_key: string;
  actions: PermissionAction[];
}

interface DefaultRoleBlueprint {
  name: string;
  description: string;
  default_scope: DataScope;
  grants: RoleGrant[];
}

/** Create/view/edit (NO delete) on the work-content modules these roles operate. */
const WORK_CONTENT_GRANTS: RoleGrant[] = [
  { feature_key: 'tasks.task.manage', actions: RWE }, // scopable
  { feature_key: 'tasks.tags.create', actions: [PermissionAction.write] }, // org config; create tags while tagging (option C)
  { feature_key: 'goals', actions: RWE }, // scopable (legacy key)
  { feature_key: 'meetings', actions: RWE }, // scopable (legacy key)
  { feature_key: 'tickets.ticket.manage', actions: RWE }, // scopable
  { feature_key: 'projects.project.manage', actions: RWE }, // scopable
  { feature_key: 'work_logs.log.manage', actions: RWE }, // self_scoped (module owns visibility)
  { feature_key: 'process_hierarchy.map.manage', actions: RWE }, // self_scoped (attachment-based); everyone is a Contributor, delete stays admin-only
];

/** Read-only access to broadcast / org-default content (scope is ignored on these). */
const BROADCAST_READ_GRANTS: RoleGrant[] = [
  { feature_key: 'communication.announcements.manage', actions: READ },
  { feature_key: 'communication.bulletin.manage', actions: READ },
  { feature_key: 'communication.knowledge.manage', actions: READ },
  { feature_key: 'learning.path.manage', actions: READ },
  { feature_key: 'ecs.policy.manage', actions: READ },
  { feature_key: 'performance.review.manage', actions: READ },
  { feature_key: 'employees.profile.manage', actions: READ }, // directory VIEW only
];

const COMMON_GRANTS: RoleGrant[] = [...WORK_CONTENT_GRANTS, ...BROADCAST_READ_GRANTS];

export const DEFAULT_SYSTEM_ROLE_BLUEPRINTS: DefaultRoleBlueprint[] = [
  {
    name: 'Employee',
    description:
      'Can create, view and edit their own work, and view company-wide announcements, policies and the people directory.',
    default_scope: DataScope.own,
    grants: COMMON_GRANTS,
  },
  {
    name: 'Manager',
    description:
      "Can create, view and edit their team's work, and view company-wide announcements, policies and the people directory.",
    default_scope: DataScope.team,
    grants: COMMON_GRANTS,
  },
  {
    name: 'Leadership',
    description:
      'Can create, view and edit company-wide work, and view company-wide announcements, policies and the people directory. Cannot delete records or access Settings.',
    default_scope: DataScope.org,
    grants: COMMON_GRANTS,
  },
];

/**
 * Idempotently seed the three default System Roles for one org. Safe to re-run:
 * an existing role with the same name (case-insensitive, matching the UI clash
 * rule in PermissionAdminService.createSystemRole) is left completely untouched —
 * we never clobber an admin-customized role.
 *
 * `tx` is a Prisma transaction client (or the PrismaClient itself in scripts).
 */
export async function seedDefaultSystemRoles(
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<{ created: string[]; skipped: string[] }> {
  const created: string[] = [];
  const skipped: string[] = [];

  for (const bp of DEFAULT_SYSTEM_ROLE_BLUEPRINTS) {
    const existing = await tx.systemRole.findFirst({
      where: {
        organization_id: organizationId,
        name: { equals: bp.name, mode: 'insensitive' },
      },
      select: { id: true },
    });
    if (existing) {
      skipped.push(bp.name);
      continue;
    }

    const role = await tx.systemRole.create({
      data: {
        organization_id: organizationId,
        name: bp.name,
        description: bp.description,
        is_system: false,
        is_admin: false,
        default_scope: bp.default_scope,
      },
    });

    await tx.rolePermission.createMany({
      data: bp.grants.flatMap((g) =>
        g.actions.map((action) => ({
          organization_id: organizationId,
          system_role_id: role.id,
          feature_key: g.feature_key,
          action,
          allowed: true,
          scope: null, // inherit default_scope via the cascade
        })),
      ),
      skipDuplicates: true,
    });
    created.push(bp.name);
  }

  return { created, skipped };
}
