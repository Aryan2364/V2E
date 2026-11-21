import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataScope, OverrideEffect, PermissionAction } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { Principal, PermissionsService, ResourcePermissions } from './permissions.service';
import {
  ALL_FEATURE_LEAVES,
  ALL_MODULE_KEYS,
  ALL_SUBJECT_LEAVES,
  PERMISSION_REGISTRY,
  isValidLeaf,
  supportsAction,
  axisOf,
  kindOf,
  isEntitlementControlled,
  isGovernanceEntitlementKey,
  entitlementKeyOf,
  LEGACY_GOVERNANCE_KEY,
} from './permission-registry';
import { isContentLeaf, rowScopeOf } from './scope-registry';

const NONE: ResourcePermissions = { read: false, write: false, edit: false, delete: false };

// The 3-level data-scope model surfaced in the UI: Own / My Team / Company.
// (`department` remains in the enum for legacy rows but is never authored.)
const ALLOWED_SCOPES: DataScope[] = [DataScope.own, DataScope.team, DataScope.org];
const assertScope = (s: DataScope | null | undefined): void => {
  if (s != null && !ALLOWED_SCOPES.includes(s)) {
    throw new BadRequestException(`Unsupported data scope "${s}"`);
  }
};

interface RolePermissionEntry {
  system_role_id: string;
  feature_key: string;
  action: PermissionAction;
  allowed: boolean;
  scope?: DataScope | null;
}

@Injectable()
export class PermissionAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly permissions: PermissionsService,
  ) {}

  /** The permission tree for the UI to render (actor-feature leaves + subject leaves). */
  async getRegistry(orgId: string) {
    const entitlementRows = await this.prisma.orgModuleEntitlement.findMany({
      where: { organization_id: orgId },
      select: { module_key: true, state: true },
    });
    const entitlementByModule = new Map(entitlementRows.map((row) => [row.module_key, row.state]));

    return {
      modules: PERMISSION_REGISTRY.filter(
        (m) => !m.entitlementControlled || (entitlementByModule.get(m.key) ?? 'off') !== 'off',
      ).map((m) => ({
        key: m.key,
        label: m.label,
        entitlementControlled: m.entitlementControlled,
        entitlementState: m.entitlementControlled ? entitlementByModule.get(m.key) ?? 'off' : 'full',
        subModules: m.subModules.map((s) => ({
          key: s.key,
          label: s.label,
          features: s.features.map((f) => ({
            key: f.key,
            label: f.label,
            description: f.description,
            axis: f.axis,
            kind: f.kind,
            actions:
              m.entitlementControlled && entitlementByModule.get(m.key) === 'preview'
                ? f.actions.filter((action) => action === PermissionAction.read)
                : f.actions,
          })),
        })),
      })),
    };
  }

  // ─── System Role permission matrix (Layer 2) ─────────────────────────────────

  async getRoleMatrix(orgId: string) {
    const [roles, rows, moduleScopes] = await Promise.all([
      this.prisma.systemRole.findMany({
        where: { organization_id: orgId },
        orderBy: [{ is_system: 'desc' }, { name: 'asc' }],
      }),
      this.prisma.rolePermission.findMany({ where: { organization_id: orgId } }),
      this.prisma.systemRoleModuleScope.findMany({
        where: { system_role: { organization_id: orgId } },
      }),
    ]);

    const allow = new Map(rows.map((r) => [`${r.system_role_id}:${r.feature_key}:${r.action}`, r.allowed]));
    const scopeAt = new Map(rows.map((r) => [`${r.system_role_id}:${r.feature_key}:${r.action}`, r.scope]));
    const permissions: Record<string, Record<string, ResourcePermissions>> = {};
    // scopes[roleId][leafKey][action] = DataScope (line tier) — only for scopable leaves.
    const scopes: Record<string, Record<string, Partial<Record<PermissionAction, DataScope>>>> = {};
    // moduleScopesByRole[roleId][moduleKey] = DataScope (module tier).
    const moduleScopesByRole: Record<string, Record<string, DataScope>> = {};
    for (const ms of moduleScopes) {
      (moduleScopesByRole[ms.system_role_id] ??= {})[ms.module_key] = ms.scope;
    }

    for (const role of roles) {
      const perLeaf: Record<string, ResourcePermissions> = {};
      const perLeafScope: Record<string, Partial<Record<PermissionAction, DataScope>>> = {};
      for (const leaf of ALL_FEATURE_LEAVES) {
        perLeaf[leaf.key] = {
          read: leaf.actions.includes('read') ? allow.get(`${role.id}:${leaf.key}:read`) ?? false : false,
          write: leaf.actions.includes('write') ? allow.get(`${role.id}:${leaf.key}:write`) ?? false : false,
          edit: leaf.actions.includes('edit') ? allow.get(`${role.id}:${leaf.key}:edit`) ?? false : false,
          delete: leaf.actions.includes('delete') ? allow.get(`${role.id}:${leaf.key}:delete`) ?? false : false,
        };
        if (rowScopeOf(leaf.key) === 'scopable') {
          const perAction: Partial<Record<PermissionAction, DataScope>> = {};
          for (const action of leaf.actions) {
            const s = scopeAt.get(`${role.id}:${leaf.key}:${action}`);
            if (s) perAction[action] = s; // null/absent ⇒ inherits module/default (cascade)
          }
          perLeafScope[leaf.key] = perAction;
        }
      }
      permissions[role.id] = perLeaf;
      scopes[role.id] = perLeafScope;
    }

    return {
      systemRoles: roles.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        is_system: r.is_system,
        is_admin: r.is_admin,
        default_scope: r.default_scope,
        module_scopes: moduleScopesByRole[r.id] ?? {},
      })),
      permissions,
      scopes,
      scopableLeaves: ALL_FEATURE_LEAVES.filter((l) => rowScopeOf(l.key) === 'scopable').map((l) => l.key),
    };
  }

  async updateRoleMatrix(orgId: string, actorId: string, entries: RolePermissionEntry[]) {
    // Validate before writing anything (fail loud, atomic-ish).
    const roles = await this.prisma.systemRole.findMany({
      where: { organization_id: orgId },
      select: { id: true, is_system: true },
    });
    const roleById = new Map(roles.map((r) => [r.id, r]));
    for (const e of entries) {
      const role = roleById.get(e.system_role_id);
      if (!role) throw new BadRequestException('This system role does not exist.');
      // The Administrator (system) role is locked — full access, never editable.
      if (role.is_system) {
        throw new BadRequestException(`"Administrator" is a system role and cannot be modified.`);
      }
      if (!isValidLeaf(e.feature_key) || axisOf(e.feature_key) !== 'actor') {
        throw new BadRequestException(`Unknown feature "${e.feature_key}"`);
      }
      // Admin-permanence: admin leaves are resolver-derived (is_admin) and never stored.
      if (kindOf(e.feature_key) === 'admin') {
        throw new BadRequestException(
          `"${e.feature_key}" is a core admin permission and cannot be configured here.`,
        );
      }
      if (!supportsAction(e.feature_key, e.action)) {
        throw new BadRequestException(`Feature "${e.feature_key}" does not support action "${e.action}"`);
      }
      assertScope(e.scope);
    }

    for (const e of entries) {
      // Scope only applies to scopable content leaves; ignore it elsewhere.
      const scope = rowScopeOf(e.feature_key) === 'scopable' ? e.scope ?? null : null;
      const before = await this.prisma.rolePermission.findUnique({
        where: {
          organization_id_system_role_id_feature_key_action: {
            organization_id: orgId,
            system_role_id: e.system_role_id,
            feature_key: e.feature_key,
            action: e.action,
          },
        },
      });
      if ((before?.allowed ?? false) === e.allowed && (before?.scope ?? null) === scope) continue; // no-op

      await this.prisma.rolePermission.upsert({
        where: {
          organization_id_system_role_id_feature_key_action: {
            organization_id: orgId,
            system_role_id: e.system_role_id,
            feature_key: e.feature_key,
            action: e.action,
          },
        },
        create: {
          organization_id: orgId,
          system_role_id: e.system_role_id,
          feature_key: e.feature_key,
          action: e.action,
          allowed: e.allowed,
          scope,
          updated_by_user_id: actorId,
        },
        update: { allowed: e.allowed, scope, updated_by_user_id: actorId },
      });

      await this.audit.record({
        orgId,
        actorId,
        action: before ? 'update' : 'create',
        resource: 'role_permission',
        entityId: `${e.system_role_id}:${e.feature_key}:${e.action}`,
        entityLabel: `${e.feature_key} · ${e.action}`,
        changes: {
          allowed: { before: before?.allowed ?? false, after: e.allowed },
          scope: { before: before?.scope ?? null, after: scope },
        },
      });
    }

    return this.getRoleMatrix(orgId);
  }

  // ─── System Role CRUD + module-scope cascade ─────────────────────────────────

  /** Lightweight list for pickers (e.g. Add Employee). Any org member may read it. */
  async listSystemRoles(orgId: string) {
    // Order: non-admin roles by widening data scope (own → team → org), then the
    // admin role last — i.e. Employee, Manager, Leadership, …, Administrator.
    // `default_scope` is a DataScope enum declared own/team/department/org, so an
    // ascending sort yields the scope hierarchy without a hand-maintained list.
    const systemRoles = await this.prisma.systemRole.findMany({
      where: { organization_id: orgId },
      orderBy: [{ is_admin: 'asc' }, { default_scope: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, is_system: true, is_admin: true },
    });
    return { systemRoles };
  }

  private async getSystemRoleOrThrow(orgId: string, id: string) {
    const role = await this.prisma.systemRole.findFirst({ where: { id, organization_id: orgId } });
    if (!role) throw new NotFoundException('System role not found');
    return role;
  }

  async createSystemRole(
    orgId: string,
    actorId: string,
    input: { name: string; description?: string; default_scope?: DataScope },
  ) {
    const name = input.name.trim();
    if (!name) throw new BadRequestException('A role name is required');
    assertScope(input.default_scope);
    const clash = await this.prisma.systemRole.findFirst({
      where: { organization_id: orgId, name: { equals: name, mode: 'insensitive' } },
      select: { id: true },
    });
    if (clash) throw new BadRequestException(`A role named "${name}" already exists`);

    const role = await this.prisma.systemRole.create({
      data: {
        organization_id: orgId,
        name,
        description: input.description?.trim() || null,
        is_system: false,
        is_admin: false,
        default_scope: input.default_scope ?? DataScope.own,
      },
    });
    await this.audit.record({
      orgId, actorId, action: 'create', resource: 'system_role',
      entityId: role.id, entityLabel: role.name,
      changes: { name: { before: null, after: role.name } },
    });
    return this.getRoleMatrix(orgId);
  }

  async updateSystemRole(
    orgId: string,
    actorId: string,
    id: string,
    input: { name?: string; description?: string; default_scope?: DataScope },
  ) {
    const role = await this.getSystemRoleOrThrow(orgId, id);
    if (role.is_system) {
      throw new BadRequestException(`"Administrator" is a system role and cannot be edited.`);
    }
    assertScope(input.default_scope);
    const name = input.name?.trim();
    if (name && name.toLowerCase() !== role.name.toLowerCase()) {
      const clash = await this.prisma.systemRole.findFirst({
        where: { organization_id: orgId, name: { equals: name, mode: 'insensitive' }, id: { not: id } },
        select: { id: true },
      });
      if (clash) throw new BadRequestException(`A role named "${name}" already exists`);
    }

    const updated = await this.prisma.systemRole.update({
      where: { id },
      data: {
        ...(name ? { name } : {}),
        ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
        ...(input.default_scope !== undefined ? { default_scope: input.default_scope } : {}),
      },
    });
    await this.audit.record({
      orgId, actorId, action: 'update', resource: 'system_role',
      entityId: id, entityLabel: updated.name,
      changes: {
        name: { before: role.name, after: updated.name },
        default_scope: { before: role.default_scope, after: updated.default_scope },
      },
    });
    return this.getRoleMatrix(orgId);
  }

  async deleteSystemRole(orgId: string, actorId: string, id: string) {
    const role = await this.getSystemRoleOrThrow(orgId, id);
    if (role.is_system) {
      throw new BadRequestException(`"Administrator" is a system role and cannot be deleted.`);
    }
    // Block while employees still hold this access role — reassign them first
    // (rather than silently stripping their access via the SET NULL FK).
    const assigned = await this.prisma.employeeProfile.count({
      where: { organization_id: orgId, system_role_id: id },
    });
    if (assigned > 0) {
      throw new BadRequestException(
        `${assigned} employee${assigned === 1 ? '' : 's'} still ${assigned === 1 ? 'has' : 'have'} the "${role.name}" access role. ` +
          'Reassign them to another role before deleting it.',
      );
    }
    await this.prisma.systemRole.delete({ where: { id } });
    await this.audit.record({
      orgId, actorId, action: 'delete', resource: 'system_role',
      entityId: id, entityLabel: role.name,
      changes: { name: { before: role.name, after: null } },
    });
    return this.getRoleMatrix(orgId);
  }

  /** Set or clear a module-tier scope override (the middle tier of the cascade). */
  async setModuleScope(
    orgId: string,
    actorId: string,
    systemRoleId: string,
    moduleKey: string,
    scope: DataScope | null,
  ) {
    const role = await this.getSystemRoleOrThrow(orgId, systemRoleId);
    if (role.is_system) {
      throw new BadRequestException(`"Administrator" is a system role and cannot be modified.`);
    }
    if (!ALL_MODULE_KEYS.includes(moduleKey)) {
      throw new BadRequestException(`Unknown module "${moduleKey}"`);
    }
    assertScope(scope);

    const where = { system_role_id_module_key: { system_role_id: systemRoleId, module_key: moduleKey } };
    const before = await this.prisma.systemRoleModuleScope.findUnique({ where });
    if (scope === null) {
      if (before) await this.prisma.systemRoleModuleScope.delete({ where });
    } else {
      await this.prisma.systemRoleModuleScope.upsert({
        where,
        create: { system_role_id: systemRoleId, module_key: moduleKey, scope },
        update: { scope },
      });
    }
    await this.audit.record({
      orgId, actorId, action: before ? 'update' : 'create', resource: 'system_role_module_scope',
      entityId: `${systemRoleId}:${moduleKey}`, entityLabel: `${role.name} · ${moduleKey}`,
      changes: { scope: { before: before?.scope ?? null, after: scope } },
    });
    return this.getRoleMatrix(orgId);
  }

  // ─── Subject eligibility org defaults ────────────────────────────────────────

  async getSubjectPolicies(orgId: string) {
    const [rows, entitlementRows] = await Promise.all([
      this.prisma.subjectEligibilityPolicy.findMany({ where: { organization_id: orgId } }),
      this.prisma.orgModuleEntitlement.findMany({
        where: { organization_id: orgId },
        select: { module_key: true, state: true },
      }),
    ]);
    const byKey = new Map(rows.map((r) => [r.subject_key, r.default_eligible]));
    const entitlementByModule = new Map(entitlementRows.map((row) => [row.module_key, row.state]));
    return {
      policies: ALL_SUBJECT_LEAVES.filter((leaf) => {
        if (!isEntitlementControlled(leaf.key)) return true;
        const entKey = entitlementKeyOf(leaf.key)!;
        const state =
          entitlementByModule.get(entKey) ??
          (isGovernanceEntitlementKey(entKey)
            ? entitlementByModule.get(LEGACY_GOVERNANCE_KEY)
            : undefined);
        return state === 'full';
      }).map((leaf) => ({
          subject_key: leaf.key,
          label: leaf.label,
          default_eligible: byKey.get(leaf.key) ?? true,
        })),
    };
  }

  async updateSubjectPolicies(
    orgId: string,
    actorId: string,
    entries: { subject_key: string; default_eligible: boolean }[],
  ) {
    for (const e of entries) {
      if (!isValidLeaf(e.subject_key) || axisOf(e.subject_key) !== 'subject') {
        throw new BadRequestException(`Unknown subject permission "${e.subject_key}"`);
      }
    }
    for (const e of entries) {
      const before = await this.prisma.subjectEligibilityPolicy.findUnique({
        where: { organization_id_subject_key: { organization_id: orgId, subject_key: e.subject_key } },
      });
      if ((before?.default_eligible ?? true) === e.default_eligible) continue;
      await this.prisma.subjectEligibilityPolicy.upsert({
        where: { organization_id_subject_key: { organization_id: orgId, subject_key: e.subject_key } },
        create: { organization_id: orgId, subject_key: e.subject_key, default_eligible: e.default_eligible, updated_by_user_id: actorId },
        update: { default_eligible: e.default_eligible, updated_by_user_id: actorId },
      });
      await this.audit.record({
        orgId,
        actorId,
        action: before ? 'update' : 'create',
        resource: 'subject_policy',
        entityId: e.subject_key,
        entityLabel: e.subject_key,
        changes: { default_eligible: { before: before?.default_eligible ?? true, after: e.default_eligible } },
      });
    }
    return this.getSubjectPolicies(orgId);
  }

  // ─── Per-user view + overrides (Layer 3) ─────────────────────────────────────

  private async principalForUser(
    orgId: string,
    userId: string,
  ): Promise<Principal & { systemRoleName: string | null }> {
    const [profile, member, user] = await Promise.all([
      this.prisma.employeeProfile.findFirst({
        where: { organization_id: orgId, user_id: userId },
        include: { system_role: { select: { id: true, name: true, is_admin: true } } },
      }),
      this.prisma.organizationMember.findUnique({
        where: { organization_id_user_id: { organization_id: orgId, user_id: userId } },
        select: { is_admin: true },
      }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { is_super_admin: true } }),
    ]);
    return {
      userId,
      systemRoleId: profile?.system_role_id ?? null,
      systemRoleName: profile?.system_role?.name ?? null,
      isAdmin: (member?.is_admin ?? false) || (profile?.system_role?.is_admin ?? false),
      isSuperAdmin: user?.is_super_admin ?? false,
    };
  }

  /** Inherited (from job role) + overrides + effective, per feature leaf, for the employee panel. */
  async getUserPermissions(orgId: string, userId: string) {
    const principal = await this.principalForUser(orgId, userId);

    const [baseRows, overrideRows, subjectOverrides] = await Promise.all([
      principal.systemRoleId
        ? this.prisma.rolePermission.findMany({ where: { organization_id: orgId, system_role_id: principal.systemRoleId } })
        : Promise.resolve([]),
      this.prisma.userPermissionOverride.findMany({ where: { organization_id: orgId, user_id: userId } }),
      this.prisma.userSubjectOverride.findMany({ where: { organization_id: orgId, user_id: userId } }),
    ]);
    const baseAllow = new Map(baseRows.map((r) => [`${r.feature_key}:${r.action}`, r.allowed]));
    const overrideMap = new Map(overrideRows.map((r) => [`${r.feature_key}:${r.action}`, r.effect]));
    const overrideScope = new Map(overrideRows.map((r) => [`${r.feature_key}:${r.action}`, r.scope]));

    const [effective, effectiveScopes] = await Promise.all([
      this.permissions.resolveEffectiveForUser(orgId, principal),
      this.permissions.resolveScopesForUser(orgId, principal),
    ]);

    const actionsBlock = (leafKey: string, src: (a: PermissionAction) => boolean): ResourcePermissions => ({
      read: src('read'),
      write: src('write'),
      edit: src('edit'),
      delete: src('delete'),
    });

    const leaves = ALL_FEATURE_LEAVES.map((leaf) => ({
      key: leaf.key,
      inherited: actionsBlock(leaf.key, (a) =>
        leaf.actions.includes(a) ? baseAllow.get(`${leaf.key}:${a}`) ?? false : false,
      ),
      overrides: {
        read: overrideMap.get(`${leaf.key}:read`) ?? null,
        write: overrideMap.get(`${leaf.key}:write`) ?? null,
        edit: overrideMap.get(`${leaf.key}:edit`) ?? null,
        delete: overrideMap.get(`${leaf.key}:delete`) ?? null,
      } as Record<PermissionAction, OverrideEffect | null>,
      scopable: rowScopeOf(leaf.key) === 'scopable',
      override_scopes: {
        read: overrideScope.get(`${leaf.key}:read`) ?? null,
        write: overrideScope.get(`${leaf.key}:write`) ?? null,
        edit: overrideScope.get(`${leaf.key}:edit`) ?? null,
        delete: overrideScope.get(`${leaf.key}:delete`) ?? null,
      } as Record<PermissionAction, DataScope | null>,
      effective_scopes: effectiveScopes[leaf.key] ?? {},
      effective: effective[leaf.key] ?? NONE,
    }));

    const subjectByKey = new Map(subjectOverrides.map((s) => [s.subject_key, s.effect]));

    return {
      user_id: userId,
      system_role: principal.systemRoleId ? { id: principal.systemRoleId, name: principal.systemRoleName } : null,
      is_admin: principal.isAdmin,
      is_super_admin: principal.isSuperAdmin,
      leaves,
      subject_overrides: ALL_SUBJECT_LEAVES.map((leaf) => ({
        subject_key: leaf.key,
        label: leaf.label,
        override: subjectByKey.get(leaf.key) ?? null,
      })),
    };
  }

  async setUserOverride(
    orgId: string,
    actorId: string,
    userId: string,
    feature_key: string,
    action: PermissionAction,
    effect: OverrideEffect | null,
    scope?: DataScope | null,
    reason?: string,
  ) {
    if (!isValidLeaf(feature_key) || axisOf(feature_key) !== 'actor') {
      throw new BadRequestException(`Unknown feature "${feature_key}"`);
    }
    if (kindOf(feature_key) === 'admin') {
      throw new BadRequestException(
        `"${feature_key}" is a core admin permission and cannot be overridden per user.`,
      );
    }
    if (!supportsAction(feature_key, action)) {
      throw new BadRequestException(`Feature "${feature_key}" does not support action "${action}"`);
    }
    await this.ensureMember(orgId, userId);
    const effScope = rowScopeOf(feature_key) === 'scopable' ? scope ?? null : null;

    const where = {
      organization_id_user_id_feature_key_action: {
        organization_id: orgId,
        user_id: userId,
        feature_key,
        action,
      },
    };
    const before = await this.prisma.userPermissionOverride.findUnique({ where });

    if (effect === null) {
      if (before) {
        await this.prisma.userPermissionOverride.delete({ where });
        await this.audit.record({
          orgId, actorId, action: 'delete', resource: 'user_permission_override',
          entityId: `${userId}:${feature_key}:${action}`, entityLabel: `${feature_key} · ${action}`,
          changes: { effect: { before: before.effect, after: null } },
        });
      }
    } else {
      await this.prisma.userPermissionOverride.upsert({
        where,
        create: { organization_id: orgId, user_id: userId, feature_key, action, effect, scope: effScope, reason, updated_by_user_id: actorId },
        update: { effect, scope: effScope, reason, updated_by_user_id: actorId },
      });
      await this.audit.record({
        orgId, actorId, action: before ? 'update' : 'create', resource: 'user_permission_override',
        entityId: `${userId}:${feature_key}:${action}`, entityLabel: `${feature_key} · ${action}`,
        changes: { effect: { before: before?.effect ?? null, after: effect }, scope: { before: before?.scope ?? null, after: effScope } },
      });
    }
    return this.getUserPermissions(orgId, userId);
  }

  async setUserSubjectOverride(
    orgId: string,
    actorId: string,
    userId: string,
    subject_key: string,
    effect: OverrideEffect | null,
    reason?: string,
  ) {
    if (!isValidLeaf(subject_key) || axisOf(subject_key) !== 'subject') {
      throw new BadRequestException(`Unknown subject permission "${subject_key}"`);
    }
    await this.ensureMember(orgId, userId);

    const where = {
      organization_id_user_id_subject_key: { organization_id: orgId, user_id: userId, subject_key },
    };
    const before = await this.prisma.userSubjectOverride.findUnique({ where });

    if (effect === null) {
      if (before) {
        await this.prisma.userSubjectOverride.delete({ where });
        await this.audit.record({
          orgId, actorId, action: 'delete', resource: 'user_subject_override',
          entityId: `${userId}:${subject_key}`, entityLabel: subject_key,
          changes: { effect: { before: before.effect, after: null } },
        });
      }
    } else {
      await this.prisma.userSubjectOverride.upsert({
        where,
        create: { organization_id: orgId, user_id: userId, subject_key, effect, reason, updated_by_user_id: actorId },
        update: { effect, reason, updated_by_user_id: actorId },
      });
      await this.audit.record({
        orgId, actorId, action: before ? 'update' : 'create', resource: 'user_subject_override',
        entityId: `${userId}:${subject_key}`, entityLabel: subject_key,
        changes: { effect: { before: before?.effect ?? null, after: effect } },
      });
    }
    return this.getUserPermissions(orgId, userId);
  }

  private async ensureMember(orgId: string, userId: string) {
    const member = await this.prisma.organizationMember.findUnique({
      where: { organization_id_user_id: { organization_id: orgId, user_id: userId } },
      select: { id: true },
    });
    if (!member) throw new NotFoundException('User is not a member of this organization');
  }

  // ─── Effective permissions for the current principal (/me, UI gating) ────────

  async getMyEffective(orgId: string, principal: Principal) {
    const [leaves, scopes] = await Promise.all([
      this.permissions.resolveEffectiveForUser(orgId, principal),
      this.permissions.resolveScopesForUser(orgId, principal),
    ]);
    return { leaves, scopes, is_admin: principal.isAdmin, is_super_admin: principal.isSuperAdmin };
  }
}
