import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { descendantIds, ancestorChain, DeptNode } from '../holidays/dept-tree.util';
import {
  CreateBridgeDto,
  SetDeptUnifyDto,
  SetDeptUpwardDto,
  SetEmployeeManualOverrideDto,
  UpdateAssigneeSettingsDto,
} from './dto/assignee-visibility.dto';
import { swallow } from '../common/swallow';

// Member roles that, by default, see everyone (full-visibility list). Distinct from
// "is an admin" — granting full visibility never confers admin powers elsewhere.
const DEFAULT_FULL_VISIBILITY_ROLES = ['org_admin', 'hr_manager'];
const SENIOR_LEVELS = new Set(['senior', 'head']);

const GRAPH_TTL_MS = 60_000; // safety backstop; primary freshness is event invalidation
const CONFIG_TTL_MS = 5_000;

export interface ProfileLite {
  user_id: string;
  name: string;
  department_id: string;
  department_name: string;
  role_id: string | null;
  role_title: string;
  role_level: string;
  member_role: string | null;
  reporting_to_user_id: string | null;
}

interface OrgGraph {
  activeUserIds: string[];
  profiles: Map<string, ProfileLite>;
  deptOf: Map<string, string>;
  memberRoleOf: Map<string, string>;
  directManagerOf: Map<string, string | null>;
  childrenOf: Map<string, string[]>;
  deptMembers: Map<string, Set<string>>;
  deptSeniors: Map<string, Set<string>>; // head_user + senior/head roles
  deptAllowUpward: Map<string, boolean>;
  // dept → every member of its enclosing unified subtree (Feature: treat sub-departments
  // as one pool). Absent when the dept is not inside any unify-flagged subtree.
  unifyPoolOf: Map<string, Set<string>>;
  // from-dept → bridges, each with its precomputed reach (cascade-aware) member set.
  bridgesFrom: Map<
    string,
    { to: string; depth: 'head_senior' | 'whole_dept'; includeSub: boolean; reach: Set<string> }[]
  >;
  // Per-employee manual override (the most-granular layer), keyed by the target employee.
  manualOverrideOf: Map<string, ManualOverride>;
}

interface OrgConfig {
  masterOverride: boolean;
  fullVisRoles: string[];
  fullVisUsers: string[];
  configRoles: string[];
}

export interface ResolveTrace {
  reason: 'master_override' | 'full_visibility' | 'base_default';
  bridges_used?: { to_department_id: string; depth: string; match_count: number; include_sub?: boolean }[];
  direct_manager_included?: boolean;
  // The most-granular per-employee override is applied on top of the above.
  manual_added_count?: number;
  manual_removed_count?: number;
}

// Why a single person ended up in (or was held out of) an employee's resolved pool.
export type ReasonCode =
  | 'self'
  | 'subordinate'
  | 'direct_manager'
  | 'department'
  | 'unified_subtree'
  | 'bridge'
  | 'full_visibility'
  | 'master_override'
  | 'manual_add';

export interface ManualOverride {
  added: Set<string>;
  removed: Set<string>;
}

export interface ResolveResult {
  pool: Set<string>;
  trace: ResolveTrace;
  // Per-person provenance for every id in `pool` (the strongest rule that included them).
  provenance: Map<string, ReasonCode>;
  // People a rule would have included but a manual removal holds out (would_be_reason = null
  // when they weren't in the rule pool either — a no-op removal kept for transparency).
  removed: { user_id: string; would_be_reason: ReasonCode | null }[];
}

/**
 * Resolves the assignee picker pool for a user, following the deterministic pipeline:
 *   1 master override → all
 *   2 full-visibility list (users+roles) → all
 *   3 governing exception, most-specific wins (user > role > department):
 *       narrow → shortlist + self; widen → all
 *       none   → base default = own dept (±upward switch) + subordinates + direct manager + self
 *                + unified subtree pool (when the dept sits inside a unify-flagged subtree)
 *   4 direct reporting manager always assignable (even cross-department)
 *   5 cross-dept bridges from the user's dept (cascade-aware; base default only)
 *   6 self always included
 *
 * @Global so employees/departments/roles services can call invalidate() without circular deps.
 */
@Injectable()
export class AssigneeVisibilityService {
  private readonly graphCache = new Map<string, { value: OrgGraph; expires: number }>();
  private readonly configCache = new Map<string, { value: OrgConfig; expires: number }>();

  constructor(private readonly prisma: PrismaService) {}

  invalidate(orgId: string) {
    this.graphCache.delete(orgId);
    this.configCache.delete(orgId);
  }

  // ─── Public resolution ────────────────────────────────────────────────────────

  async resolve(orgId: string, userId: string): Promise<ResolveResult> {
    const [cfg, g] = await Promise.all([this.getConfig(orgId), this.getGraph(orgId)]);
    const all = new Set(g.activeUserIds);
    const pool = new Set<string>();
    const provenance = new Map<string, ReasonCode>();
    const trace: ResolveTrace = { reason: 'base_default' };
    // First reason wins — branches below run in priority order, so a stronger reason is
    // never clobbered by a weaker one.
    const mark = (id: string, reason: ReasonCode) => {
      pool.add(id);
      if (!provenance.has(id)) provenance.set(id, reason);
    };

    // ── Rule pool (the live base, identical precedence to before) ──────────────────
    const memberRole = g.memberRoleOf.get(userId) ?? null;
    const deptId = g.deptOf.get(userId) ?? null;
    if (cfg.masterOverride) {
      // 1 — master override
      all.forEach((id) => mark(id, 'master_override'));
      trace.reason = 'master_override';
    } else if ((memberRole && cfg.fullVisRoles.includes(memberRole)) || cfg.fullVisUsers.includes(userId)) {
      // 2 — full-visibility list
      all.forEach((id) => mark(id, 'full_visibility'));
      trace.reason = 'full_visibility';
    } else {
      // 3 — base default (hierarchy + department ± upward, unify, bridges)
      this.markBaseDefault(g, userId, deptId, mark, trace);
    }

    // self always assignable (and labelled as such).
    pool.add(userId);
    provenance.set(userId, 'self');

    // ── Most-granular layer: per-employee manual override (wins over everything) ────
    const removed: { user_id: string; would_be_reason: ReasonCode | null }[] = [];
    const ov = g.manualOverrideOf.get(userId);
    if (ov) {
      let added = 0;
      for (const id of ov.added) {
        if (!all.has(id)) continue;
        if (!pool.has(id)) mark(id, 'manual_add');
        added++;
      }
      let removedCount = 0;
      for (const id of ov.removed) {
        if (id === userId) continue; // self can never be removed
        if (pool.has(id)) {
          removed.push({ user_id: id, would_be_reason: provenance.get(id) ?? null });
          pool.delete(id);
          provenance.delete(id);
          removedCount++;
        } else if (all.has(id)) {
          removed.push({ user_id: id, would_be_reason: null });
          removedCount++;
        }
      }
      if (added) trace.manual_added_count = added;
      if (removedCount) trace.manual_removed_count = removedCount;
    }

    return { pool, trace, provenance, removed };
  }

  /** Profile data for the org (active employees) — used to render picker items / explain. */
  async getProfiles(orgId: string): Promise<Map<string, ProfileLite>> {
    return (await this.getGraph(orgId)).profiles;
  }

  /** All user IDs reporting (directly or transitively) to `userId`. Used by Work Log. */
  async getSubordinateUserIds(orgId: string, userId: string): Promise<string[]> {
    const g = await this.getGraph(orgId);
    return [...this.getSubordinates(g, userId)];
  }

  /** Whether `candidateId` sits below `managerId` in the reporting hierarchy. */
  async isSubordinate(orgId: string, managerId: string, candidateId: string): Promise<boolean> {
    const g = await this.getGraph(orgId);
    return this.getSubordinates(g, managerId).has(candidateId);
  }

  /** All active user ids in a department. Used by data-scope (`department` scope). */
  async getDepartmentMemberIds(orgId: string, deptId: string): Promise<string[]> {
    const g = await this.getGraph(orgId);
    return [...(g.deptMembers.get(deptId) ?? [])];
  }

  /** The actor's own department id (null when they have no active profile). */
  async getActorDepartmentId(orgId: string, userId: string): Promise<string | null> {
    const g = await this.getGraph(orgId);
    return g.deptOf.get(userId) ?? null;
  }

  /** How many people a bridge of the given depth would currently expose in the target dept. */
  async countBridgeTargets(
    orgId: string,
    toDeptId: string,
    depth: 'head_senior' | 'whole_dept',
  ): Promise<number> {
    const g = await this.getGraph(orgId);
    const slice = depth === 'whole_dept' ? g.deptMembers.get(toDeptId) : g.deptSeniors.get(toDeptId);
    return slice ? slice.size : 0;
  }

  /** Full explanation for "why can X assign to Y" debugging. */
  async explain(orgId: string, userId: string) {
    const { pool, trace } = await this.resolve(orgId, userId);
    const g = await this.getGraph(orgId);
    const users = [...pool]
      .map((id) => g.profiles.get(id))
      .filter((p): p is ProfileLite => !!p)
      .sort((a, b) => a.name.localeCompare(b.name));
    return { user_id: userId, trace, total: pool.size, users };
  }

  // ─── Base default (Hierarchy + Department, ± upward switch) ──────────────────────

  private markBaseDefault(
    g: OrgGraph,
    userId: string,
    deptId: string | null,
    mark: (id: string, reason: ReasonCode) => void,
    trace: ResolveTrace,
  ): void {
    mark(userId, 'self');
    for (const sub of this.getSubordinates(g, userId)) mark(sub, 'subordinate');

    // Your direct reporting manager is always assignable, even when they sit in a
    // different (e.g. parent) department — you fundamentally report to them. The
    // own-department + upward rules below only ever reach managers inside your own
    // department, so without this a cross-department manager would be invisible.
    const directManager = g.directManagerOf.get(userId) ?? null;
    if (directManager) {
      mark(directManager, 'direct_manager');
      trace.direct_manager_included = true;
    }

    if (deptId) {
      const members = g.deptMembers.get(deptId) ?? new Set<string>();
      const allowUpward = g.deptAllowUpward.get(deptId) ?? false;
      if (allowUpward) {
        members.forEach((id) => mark(id, 'department'));
      } else {
        // Keep the direct manager; drop ancestors strictly above the manager.
        const ancestors = this.getAncestors(g, userId);
        members.forEach((id) => {
          if (ancestors.has(id) && id !== directManager) return;
          mark(id, 'department');
        });
      }

      // Unified subtree: when this dept sits inside a unify-flagged subtree, everyone in
      // that subtree assigns to everyone (one big department) — added on top, bypassing
      // the upward switch within the pool.
      const unify = g.unifyPoolOf.get(deptId);
      if (unify) unify.forEach((id) => mark(id, 'unified_subtree'));

      // Cross-department bridges from this user's department (reach is precomputed, and
      // already includes descendant departments when the bridge cascades).
      const bridgesUsed: { to_department_id: string; depth: string; match_count: number; include_sub?: boolean }[] = [];
      for (const b of g.bridgesFrom.get(deptId) ?? []) {
        b.reach.forEach((id) => mark(id, 'bridge'));
        bridgesUsed.push({ to_department_id: b.to, depth: b.depth, match_count: b.reach.size, include_sub: b.includeSub });
      }
      if (bridgesUsed.length) trace.bridges_used = bridgesUsed;
    }
  }

  private getSubordinates(g: OrgGraph, userId: string): Set<string> {
    const out = new Set<string>();
    const visit = (uid: string) => {
      for (const child of g.childrenOf.get(uid) ?? []) {
        if (out.has(child)) continue;
        out.add(child);
        visit(child);
      }
    };
    visit(userId);
    return out;
  }

  private getAncestors(g: OrgGraph, userId: string): Set<string> {
    const out = new Set<string>();
    let cur = g.directManagerOf.get(userId) ?? null;
    while (cur && !out.has(cur)) {
      out.add(cur);
      cur = g.directManagerOf.get(cur) ?? null;
    }
    return out;
  }

  // ─── Cached config + graph ──────────────────────────────────────────────────────

  private async getConfig(orgId: string): Promise<OrgConfig> {
    const cached = this.configCache.get(orgId);
    if (cached && cached.expires > Date.now()) return cached.value;

    const tm = await this.prisma.taskMaster.findUnique({ where: { organization_id: orgId } });
    const asArr = (v: unknown, fallback: string[]): string[] =>
      Array.isArray(v) ? (v as string[]) : fallback;
    const value: OrgConfig = {
      masterOverride: tm?.assignee_master_override ?? false,
      fullVisRoles: asArr(tm?.assignee_full_visibility_roles, DEFAULT_FULL_VISIBILITY_ROLES),
      fullVisUsers: asArr(tm?.assignee_full_visibility_users, []),
      configRoles: asArr(tm?.assignee_visibility_config_roles, DEFAULT_FULL_VISIBILITY_ROLES),
    };
    this.configCache.set(orgId, { value, expires: Date.now() + CONFIG_TTL_MS });
    return value;
  }

  private async getGraph(orgId: string): Promise<OrgGraph> {
    const cached = this.graphCache.get(orgId);
    if (cached && cached.expires > Date.now()) return cached.value;

    const [profiles, departments, members, bridges, overrides] = await Promise.all([
      this.prisma.employeeProfile.findMany({
        where: { organization_id: orgId, status: 'active' },
        include: {
          user: { select: { id: true, name: true, is_active: true } },
          department: { select: { id: true, name: true } },
          role: { select: { id: true, title: true, level: true } },
        },
      }),
      this.prisma.department.findMany({
        where: { organization_id: orgId },
        select: {
          id: true,
          parent_department_id: true,
          head_user_id: true,
          assignee_allow_upward: true,
          assignee_unify_subtree: true,
        },
      }),
      this.prisma.organizationMember.findMany({
        where: { organization_id: orgId, is_active: true },
        select: { user_id: true, is_admin: true },
      }),
      this.prisma.assigneeCrossDeptBridge.findMany({ where: { organization_id: orgId } }),
      this.prisma.employeeAssigneeManualOverride.findMany({
        where: { organization_id: orgId },
      }),
    ]);

    // MemberRole was removed; collapse to an admin/member pseudo-role so the legacy
    // role-keyed visibility configs (full_visibility_roles, role exceptions) still
    // target admins. Non-admins all map to 'employee'.
    const memberRoleOf = new Map<string, string>(members.map((m) => [m.user_id, m.is_admin ? 'org_admin' : 'employee']));
    const profileMap = new Map<string, ProfileLite>();
    const deptOf = new Map<string, string>();
    const directManagerOf = new Map<string, string | null>();
    const childrenOf = new Map<string, string[]>();
    const deptMembers = new Map<string, Set<string>>();
    const deptSeniors = new Map<string, Set<string>>();
    const activeUserIds: string[] = [];

    for (const p of profiles) {
      if (!p.user.is_active) continue;
      activeUserIds.push(p.user_id);
      profileMap.set(p.user_id, {
        user_id: p.user_id,
        name: p.user.name,
        department_id: p.department_id,
        department_name: p.department.name,
        role_id: p.role.id,
        role_title: p.role.title,
        role_level: p.role.level,
        member_role: memberRoleOf.get(p.user_id) ?? null,
        reporting_to_user_id: p.reporting_to_user_id ?? null,
      });
      deptOf.set(p.user_id, p.department_id);
      directManagerOf.set(p.user_id, p.reporting_to_user_id ?? null);
      if (p.reporting_to_user_id) {
        const arr = childrenOf.get(p.reporting_to_user_id) ?? [];
        arr.push(p.user_id);
        childrenOf.set(p.reporting_to_user_id, arr);
      }
      if (!deptMembers.has(p.department_id)) deptMembers.set(p.department_id, new Set());
      deptMembers.get(p.department_id)!.add(p.user_id);
      if (SENIOR_LEVELS.has(p.role.level)) {
        if (!deptSeniors.has(p.department_id)) deptSeniors.set(p.department_id, new Set());
        deptSeniors.get(p.department_id)!.add(p.user_id);
      }
    }

    const deptAllowUpward = new Map<string, boolean>();
    for (const d of departments) {
      deptAllowUpward.set(d.id, d.assignee_allow_upward);
      // The configured head counts toward the "head + senior" bridge slice (if active).
      if (d.head_user_id && profileMap.has(d.head_user_id)) {
        if (!deptSeniors.has(d.id)) deptSeniors.set(d.id, new Set());
        deptSeniors.get(d.id)!.add(d.head_user_id);
      }
    }

    // Department tree (for unify pools + cascading bridge reach). deptSeniors is now
    // complete (heads folded in above), so reach sets can be precomputed here.
    const deptNodes: DeptNode[] = departments.map((d) => ({
      id: d.id,
      parent_department_id: d.parent_department_id ?? null,
    }));
    const sliceOf = (deptId: string, depth: 'head_senior' | 'whole_dept') =>
      depth === 'whole_dept' ? deptMembers.get(deptId) : deptSeniors.get(deptId);
    const bridgeReach = (toId: string, depth: 'head_senior' | 'whole_dept', includeSub: boolean) => {
      const targets = includeSub ? [toId, ...descendantIds(deptNodes, toId)] : [toId];
      const out = new Set<string>();
      for (const t of targets) sliceOf(t, depth)?.forEach((id) => out.add(id));
      return out;
    };

    const bridgesFrom: OrgGraph['bridgesFrom'] = new Map();
    for (const b of bridges) {
      const arr = bridgesFrom.get(b.from_department_id) ?? [];
      const depth = b.depth as 'head_senior' | 'whole_dept';
      arr.push({
        to: b.to_department_id,
        depth,
        includeSub: b.include_sub_departments,
        reach: bridgeReach(b.to_department_id, depth, b.include_sub_departments),
      });
      bridgesFrom.set(b.from_department_id, arr);
    }

    // Unify pools: each dept maps to the member set of its *highest* unify-flagged ancestor's
    // subtree (self + all descendants). Computed once per distinct root.
    const unifyEnabled = new Set(departments.filter((d) => d.assignee_unify_subtree).map((d) => d.id));
    const unifyPoolOf = new Map<string, Set<string>>();
    if (unifyEnabled.size) {
      const poolByRoot = new Map<string, Set<string>>();
      for (const d of departments) {
        const root = ancestorChain(deptNodes, d.id).find((id) => unifyEnabled.has(id));
        if (!root) continue;
        let pool = poolByRoot.get(root);
        if (!pool) {
          pool = new Set<string>();
          for (const dz of [root, ...descendantIds(deptNodes, root)]) {
            deptMembers.get(dz)?.forEach((id) => pool!.add(id));
          }
          poolByRoot.set(root, pool);
        }
        unifyPoolOf.set(d.id, pool);
      }
    }

    const asIds = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);
    const manualOverrideOf = new Map<string, ManualOverride>();
    for (const o of overrides) {
      manualOverrideOf.set(o.employee_user_id, {
        added: new Set(asIds(o.added_user_ids)),
        removed: new Set(asIds(o.removed_user_ids)),
      });
    }

    const value: OrgGraph = {
      activeUserIds,
      profiles: profileMap,
      deptOf,
      memberRoleOf,
      directManagerOf,
      childrenOf,
      deptMembers,
      deptSeniors,
      deptAllowUpward,
      unifyPoolOf,
      bridgesFrom,
      manualOverrideOf,
    };
    this.graphCache.set(orgId, { value, expires: Date.now() + GRAPH_TTL_MS });
    return value;
  }

  // ─── Admin: edit config / exceptions / bridges / upward switch ───────────────────
  // Authorization is enforced at the route layer via
  // @RequirePermission('tasks.config.assignee_visibility.manage', …); the actorUserId
  // params below are retained for audit logging.

  private async ensureMaster(orgId: string) {
    return this.prisma.taskMaster.upsert({
      where: { organization_id: orgId },
      create: { organization_id: orgId },
      update: {},
    });
  }

  private async audit(
    orgId: string,
    actorUserId: string,
    action: string,
    data: { target?: unknown; before?: unknown; after?: unknown },
  ): Promise<void> {
    await this.prisma.assigneeVisibilityAuditLog
      .create({
        data: {
          organization_id: orgId,
          actor_user_id: actorUserId,
          action,
          target: (data.target ?? null) as never,
          before: (data.before ?? null) as never,
          after: (data.after ?? null) as never,
        },
      })
      .catch(swallow('assignee-visibility.audit', null));
  }

  /** Full admin view for the masters UI. */
  async getAdminView(orgId: string) {
    const tm = await this.ensureMaster(orgId);
    const [bridges, departments, g] = await Promise.all([
      this.prisma.assigneeCrossDeptBridge.findMany({
        where: { organization_id: orgId },
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.department.findMany({
        where: { organization_id: orgId },
        select: {
          id: true,
          name: true,
          parent_department_id: true,
          color: true,
          assignee_allow_upward: true,
          assignee_unify_subtree: true,
        },
        orderBy: { name: 'asc' },
      }),
      this.getGraph(orgId),
    ]);
    const deptName = new Map(departments.map((d) => [d.id, d.name]));
    const deptNodes: DeptNode[] = departments.map((d) => ({
      id: d.id,
      parent_department_id: d.parent_department_id ?? null,
    }));
    // Cascade-aware reach size: a bridge that includes sub-departments counts the union
    // across the target and all its descendants.
    const reachSize = (toId: string, depth: string, includeSub: boolean) => {
      const targets = includeSub ? [toId, ...descendantIds(deptNodes, toId)] : [toId];
      const set = new Set<string>();
      for (const t of targets) {
        (depth === 'whole_dept' ? g.deptMembers.get(t) : g.deptSeniors.get(t))?.forEach((id) => set.add(id));
      }
      return set.size;
    };

    return {
      settings: {
        master_override: tm.assignee_master_override,
        full_visibility_roles: tm.assignee_full_visibility_roles,
        full_visibility_users: tm.assignee_full_visibility_users,
        config_roles: tm.assignee_visibility_config_roles,
      },
      bridges: bridges.map((b) => ({
        id: b.id,
        from_department_id: b.from_department_id,
        from_department_name: deptName.get(b.from_department_id) ?? null,
        to_department_id: b.to_department_id,
        to_department_name: deptName.get(b.to_department_id) ?? null,
        depth: b.depth,
        include_sub_departments: b.include_sub_departments,
        match_count: reachSize(b.to_department_id, b.depth, b.include_sub_departments),
      })),
      departments,
    };
  }

  async updateSettings(orgId: string, actorUserId: string, dto: UpdateAssigneeSettingsDto) {
    const before = await this.ensureMaster(orgId);
    const data: Record<string, unknown> = {};
    if (dto.master_override !== undefined) data.assignee_master_override = dto.master_override;
    if (dto.full_visibility_roles !== undefined)
      data.assignee_full_visibility_roles = dto.full_visibility_roles;
    if (dto.full_visibility_users !== undefined)
      data.assignee_full_visibility_users = dto.full_visibility_users;
    if (dto.config_roles !== undefined) {
      if (!Array.isArray(dto.config_roles) || dto.config_roles.length === 0) {
        throw new BadRequestException('At least one role must be able to edit these settings');
      }
      data.assignee_visibility_config_roles = dto.config_roles;
    }
    const updated = await this.prisma.taskMaster.update({
      where: { organization_id: orgId },
      data: data as never,
    });
    this.invalidate(orgId);
    const subset = (m: typeof updated) => ({
      master_override: m.assignee_master_override,
      full_visibility_roles: m.assignee_full_visibility_roles,
      full_visibility_users: m.assignee_full_visibility_users,
      config_roles: m.assignee_visibility_config_roles,
    });
    await this.audit(orgId, actorUserId, 'settings_updated', {
      before: subset(before),
      after: subset(updated),
    });
    return subset(updated);
  }

  async createBridge(orgId: string, actorUserId: string, dto: CreateBridgeDto) {
    if (dto.from_department_id === dto.to_department_id)
      throw new BadRequestException('A bridge must connect two different departments');
    const depts = await this.prisma.department.findMany({
      where: { organization_id: orgId, id: { in: [dto.from_department_id, dto.to_department_id] } },
      select: { id: true },
    });
    if (depts.length !== 2)
      throw new BadRequestException('Both departments must exist in this organization');
    const exists = await this.prisma.assigneeCrossDeptBridge.findFirst({
      where: {
        organization_id: orgId,
        from_department_id: dto.from_department_id,
        to_department_id: dto.to_department_id,
      },
    });
    if (exists) throw new BadRequestException('A bridge for this direction already exists');
    const created = await this.prisma.assigneeCrossDeptBridge.create({
      data: {
        organization_id: orgId,
        from_department_id: dto.from_department_id,
        to_department_id: dto.to_department_id,
        depth: dto.depth,
        include_sub_departments: dto.include_sub_departments ?? false,
        created_by: actorUserId,
      },
    });
    this.invalidate(orgId);
    await this.audit(orgId, actorUserId, 'bridge_created', {
      target: { id: created.id },
      after: dto as unknown,
    });
    return created;
  }

  async deleteBridge(orgId: string, actorUserId: string, id: string) {
    const bridge = await this.prisma.assigneeCrossDeptBridge.findFirst({
      where: { id, organization_id: orgId },
    });
    if (!bridge) throw new NotFoundException('Bridge not found');
    await this.prisma.assigneeCrossDeptBridge.delete({ where: { id } });
    this.invalidate(orgId);
    await this.audit(orgId, actorUserId, 'bridge_deleted', { target: { id }, before: bridge as unknown });
    return { ok: true };
  }

  async setDepartmentUpward(orgId: string, actorUserId: string, dto: SetDeptUpwardDto) {
    const dept = await this.prisma.department.findFirst({
      where: { id: dto.department_id, organization_id: orgId },
    });
    if (!dept) throw new NotFoundException('Department not found');
    const updated = await this.prisma.department.update({
      where: { id: dto.department_id },
      data: { assignee_allow_upward: dto.allow },
    });
    this.invalidate(orgId);
    await this.audit(orgId, actorUserId, 'upward_switch_changed', {
      target: { department_id: dto.department_id },
      before: { allow: dept.assignee_allow_upward },
      after: { allow: dto.allow },
    });
    return { id: updated.id, assignee_allow_upward: updated.assignee_allow_upward };
  }

  async setDepartmentUnify(orgId: string, actorUserId: string, dto: SetDeptUnifyDto) {
    const dept = await this.prisma.department.findFirst({
      where: { id: dto.department_id, organization_id: orgId },
    });
    if (!dept) throw new NotFoundException('Department not found');
    const updated = await this.prisma.department.update({
      where: { id: dto.department_id },
      data: { assignee_unify_subtree: dto.unify },
    });
    this.invalidate(orgId);
    await this.audit(orgId, actorUserId, 'unify_subtree_changed', {
      target: { department_id: dto.department_id },
      before: { unify: dept.assignee_unify_subtree },
      after: { unify: dto.unify },
    });
    return { id: updated.id, assignee_unify_subtree: updated.assignee_unify_subtree };
  }

  // ─── Admin: per-employee manual override (the most-granular layer) ────────────────

  /** The stored manual override for an employee (defaults when none exists yet). */
  async getEmployeeManualOverride(orgId: string, employeeUserId: string) {
    const row = await this.prisma.employeeAssigneeManualOverride.findUnique({
      where: { organization_id_employee_user_id: { organization_id: orgId, employee_user_id: employeeUserId } },
    });
    const asIds = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);
    return {
      employee_user_id: employeeUserId,
      added_user_ids: asIds(row?.added_user_ids),
      removed_user_ids: asIds(row?.removed_user_ids),
    };
  }

  async setEmployeeManualOverride(orgId: string, actorUserId: string, dto: SetEmployeeManualOverrideDto) {
    const exists = await this.prisma.employeeProfile.findFirst({
      where: { organization_id: orgId, user_id: dto.employee_user_id },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Employee not found in this organization');

    const added = [...new Set(dto.added_user_ids ?? [])].filter((id) => id !== dto.employee_user_id);
    // A person cannot be both added and removed; an explicit removal wins.
    const removed = [...new Set(dto.removed_user_ids ?? [])].filter(
      (id) => id !== dto.employee_user_id && !added.includes(id),
    );

    const before = await this.getEmployeeManualOverride(orgId, dto.employee_user_id);
    const updated = await this.prisma.employeeAssigneeManualOverride.upsert({
      where: { organization_id_employee_user_id: { organization_id: orgId, employee_user_id: dto.employee_user_id } },
      create: {
        organization_id: orgId,
        employee_user_id: dto.employee_user_id,
        added_user_ids: added as never,
        removed_user_ids: removed as never,
        created_by: actorUserId,
      },
      update: {
        added_user_ids: added as never,
        removed_user_ids: removed as never,
      },
    });
    this.invalidate(orgId);
    await this.audit(orgId, actorUserId, 'employee_manual_override_changed', {
      target: { employee_user_id: dto.employee_user_id },
      before,
      after: { employee_user_id: dto.employee_user_id, added_user_ids: added, removed_user_ids: removed },
    });
    return {
      employee_user_id: updated.employee_user_id,
      added_user_ids: added,
      removed_user_ids: removed,
    };
  }
}
