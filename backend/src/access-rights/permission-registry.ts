import { PermissionAction } from '@prisma/client';

/**
 * Permission registry — the single source of truth for the module → sub-module →
 * feature tree. Leaf keys (the dotted `key`) are the ONLY thing stored in the DB
 * (`RolePermission.feature_key`, `UserPermissionOverride.feature_key`,
 * `SubjectEligibilityPolicy.subject_key`, `UserSubjectOverride.subject_key`).
 * The tree position exists only for UI grouping and for `moduleOf()` (which the
 * entitlement ceiling keys off).
 *
 * Two axes:
 *  - actor   — can a principal open/use a feature (read/write/edit/delete).
 *  - subject — can a user be acted upon by others (assigned/invited/...). Addressed
 *              by `subject_key`; not action-scoped.
 *
 * Two kinds of actor leaf:
 *  - feature — governed by JobRole permissions ∪ user overrides (Layer 2 + 3).
 *  - admin   — governed ONLY by OrganizationMember.is_admin (platform administration).
 *
 * Legacy keys (`goals`, `meetings`, `access_rights`) are registered verbatim so
 * existing `@RequirePermission(...)` decorators and `AccessRight` rows stay valid
 * through the MemberRole-collapse bridge; finer leaves are added alongside them.
 */

export type Axis = 'actor' | 'subject';
export type LeafKind = 'admin' | 'feature';

export interface PermissionLeaf {
  key: string;
  label: string;
  description?: string;
  axis: Axis;
  kind: LeafKind;
  /** Actions this actor leaf exposes. Empty for subject leaves. */
  actions: PermissionAction[];
}

export interface PermissionSubModule {
  key: string;
  label: string;
  features: PermissionLeaf[];
}

/** Entitlement ceiling states a module can be seeded/set to. Mirrors the Prisma `EntitlementState` enum. */
export type EntitlementDefault = 'full' | 'preview' | 'off';

export interface PermissionModule {
  key: string;
  label: string;
  /** When true, this module sits under the per-org entitlement ceiling. */
  entitlementControlled: boolean;
  /**
   * State a *new* org is seeded to for this module. Defaults to `full` (the
   * vendor sells everything on by default and downgrades later). Set to `off`
   * for modules that must stay dark until the vendor explicitly hands them over
   * per-org. Ignored for non-entitlement-controlled modules.
   */
  defaultEntitlement?: EntitlementDefault;
  subModules: PermissionSubModule[];
}

const A_ALL: PermissionAction[] = [
  PermissionAction.read,
  PermissionAction.write,
  PermissionAction.edit,
  PermissionAction.delete,
];
const A_NONE: PermissionAction[] = [];
// "Manage" capability — create/edit/delete, with viewing left open to all members.
const A_MANAGE: PermissionAction[] = [
  PermissionAction.write,
  PermissionAction.edit,
  PermissionAction.delete,
];

// Helpers to keep the tree terse.
const feature = (
  key: string,
  label: string,
  actions: PermissionAction[] = A_ALL,
  description?: string,
): PermissionLeaf => ({ key, label, description, axis: 'actor', kind: 'feature', actions });

const admin = (key: string, label: string, description?: string): PermissionLeaf => ({
  key,
  label,
  description,
  axis: 'actor',
  kind: 'admin',
  actions: A_ALL,
});

const subject = (key: string, label: string, description?: string): PermissionLeaf => ({
  key,
  label,
  description,
  axis: 'subject',
  kind: 'feature',
  actions: A_NONE,
});

export const PERMISSION_REGISTRY: PermissionModule[] = [
  {
    key: 'goals',
    label: 'Goals',
    entitlementControlled: true,
    subModules: [
      {
        key: 'goals.general',
        label: 'Goals',
        features: [
          // Legacy umbrella leaf — keep the exact key `goals` so existing rows/decorators resolve.
          feature('goals', 'Goals', A_ALL, 'Objectives, goals and sub-goals'),
          subject('goals.subject.ownable', 'Can own a goal'),
        ],
      },
    ],
  },
  {
    key: 'tasks',
    label: 'Tasks',
    entitlementControlled: true,
    subModules: [
      {
        key: 'tasks.management',
        label: 'Task management',
        features: [
          feature('tasks.task.manage', 'Tasks'),
          feature('tasks.assignment.reassign', 'Reassign tasks', [PermissionAction.edit]),
          feature('tasks.archive.view', 'View archive', [PermissionAction.read]),
          subject('tasks.subject.assignable', 'Can be assigned a task'),
        ],
      },
      {
        key: 'tasks.configuration',
        label: 'Task configuration',
        features: [
          feature('tasks.config.settings.manage', 'Task settings', A_MANAGE,
            'Edit general task master settings (reminders, reopen window, escalation, archive-view roles)'),
          feature('tasks.config.categories.manage', 'Task categories', A_MANAGE,
            'Create, edit and deactivate task categories'),
          feature('tasks.config.priorities.manage', 'Task priorities', A_MANAGE,
            'Create, edit, reorder and deactivate task priorities'),
          feature('tasks.config.statuses.manage', 'Task statuses', A_MANAGE,
            'Create, edit, reorder and deactivate task statuses'),
          feature('tasks.config.checklist_templates.manage', 'Checklist templates', A_MANAGE,
            'Create, edit and delete task checklist templates'),
          feature('tasks.config.assignee_visibility.manage', 'Assignee visibility', A_MANAGE,
            'Configure who each user can assign tasks to (per-employee edits, bridges, department switches)'),
        ],
      },
    ],
  },
  {
    key: 'governance',
    label: 'Governance',
    entitlementControlled: true,
    subModules: [
      {
        key: 'governance.meetings',
        label: 'Meetings',
        features: [
          // Legacy umbrella leaf — keep the exact key `meetings`.
          feature('meetings', 'Meetings', A_ALL, 'Meetings, agendas, action items and decisions'),
          subject('meetings.subject.invitable', 'Can be invited to a meeting'),
        ],
      },
      {
        key: 'governance.work_logs',
        label: 'Work logs',
        features: [
          feature('work_logs.log.manage', 'Work logs'),
          subject('work_logs.subject.demandable', 'Can be asked for a work log'),
        ],
      },
    ],
  },
  {
    key: 'tickets',
    label: 'Tickets',
    entitlementControlled: true,
    subModules: [
      {
        key: 'tickets.management',
        label: 'Ticket management',
        features: [
          feature('tickets.ticket.manage', 'Tickets'),
          subject('tickets.subject.assignable', 'Can be assigned a ticket'),
        ],
      },
    ],
  },
  {
    key: 'workflows',
    label: 'Workflows',
    entitlementControlled: true,
    // Workflow authorization is currently enforced by its own owner/access model.
    // Keeping this module leafless adds the commercial entitlement ceiling without
    // exposing permission switches that the workflow service would not enforce.
    subModules: [],
  },
  {
    key: 'projects',
    label: 'Projects',
    entitlementControlled: true,
    subModules: [
      {
        key: 'projects.management',
        label: 'Project management',
        features: [
          feature('projects.project.manage', 'Projects'),
          subject('projects.subject.member', 'Can be a project member'),
        ],
      },
    ],
  },
  {
    // Delegation lives inside the Work area (a section of the Work sidebar). It is
    // sold separately and stays OFF for every org until the vendor hands it over
    // per-org from the super-admin portal — hence `defaultEntitlement: 'off'`.
    // Leafless for now (no permission switches) — the page is a placeholder to be
    // designed; the module exists so the commercial ceiling + nav gating work.
    key: 'delegation',
    label: 'Delegation',
    entitlementControlled: true,
    defaultEntitlement: 'off',
    subModules: [
      {
        key: 'delegation.management',
        label: 'Delegation management',
        features: [
          // `write` = who may CREATE (delegate); `delete` = who may remove one. Both
          // default OFF for non-admins (admins hold them implicitly), so delegation
          // is admin-only until a role is granted it on the Access Rights page. Read
          // and edit stay participation-based (delegator/owner) — no dead toggles.
          feature(
            'delegation.delegation.manage',
            'Delegations',
            [PermissionAction.write, PermissionAction.delete],
            'Who can delegate (create) and delete delegations',
          ),
        ],
      },
    ],
  },
  {
    key: 'learning',
    label: 'Learning',
    entitlementControlled: true,
    subModules: [
      {
        key: 'learning.paths',
        label: 'Learning paths',
        features: [feature('learning.path.manage', 'Learning paths')],
      },
    ],
  },
  {
    key: 'process_hierarchy',
    label: 'Process Hierarchy',
    entitlementControlled: true,
    subModules: [
      {
        key: 'process_hierarchy.management',
        label: 'Process maps',
        features: [
          // Single content leaf. Row-level visibility is attachment-based and enforced
          // by ProcessAccessService, so this leaf is registered `self_scoped` in
          // scope-registry.ts (NOT wired into ScopeService.listWhere). read = Viewer,
          // read+write+edit = Contributor, delete reserved for admins.
          feature('process_hierarchy.map.manage', 'Process hierarchy maps'),
        ],
      },
    ],
  },
  {
    key: 'communication',
    label: 'Communication',
    entitlementControlled: true,
    subModules: [
      {
        key: 'communication.general',
        label: 'Communication',
        features: [
          feature('communication.bulletin.manage', 'Bulletin'),
          feature('communication.announcements.manage', 'Announcements'),
          feature('communication.knowledge.manage', 'Knowledge base'),
        ],
      },
    ],
  },
  {
    key: 'ecs',
    label: 'ESS',
    entitlementControlled: true,
    subModules: [
      {
        key: 'ecs.policies',
        label: 'Company policies',
        features: [feature('ecs.policy.manage', 'Company policies')],
      },
    ],
  },
  {
    key: 'performance',
    label: 'Performance',
    entitlementControlled: true,
    subModules: [
      {
        key: 'performance.general',
        label: 'Performance',
        features: [feature('performance.review.manage', 'Performance')],
      },
    ],
  },
  {
    // Holiday & working-day management (HR-owned). Core HR, not entitlement-controlled.
    // "Manage" = create/edit/delete; viewing holidays/working days is open to all members.
    // Replaces the old bespoke per-scope toggles that lived on the Holidays settings page.
    key: 'holidays',
    label: 'Holidays',
    entitlementControlled: false,
    subModules: [
      {
        key: 'holidays.management',
        label: 'Holiday management',
        features: [
          feature('holidays.org.manage', 'Org-level holidays', A_MANAGE, 'Create, edit and delete organization-wide holidays and working days'),
          feature('holidays.department.manage', 'Department holidays', A_MANAGE, 'Manage department holidays and working-day overrides'),
          feature('holidays.individual.manage', 'Individual holidays', A_MANAGE, 'Manage individual employees’ holidays and working days'),
        ],
      },
    ],
  },
  {
    // Core HR/people — not a sold module, so not under the entitlement ceiling.
    key: 'employees',
    label: 'Employees',
    entitlementControlled: false,
    subModules: [
      {
        key: 'employees.directory',
        label: 'Employee directory',
        features: [feature('employees.profile.manage', 'Manage employee records')],
      },
    ],
  },
  {
    // Organization setup config (HR-owned). Not a sold module, so not under the
    // entitlement ceiling. Governed by feature permissions; org admins hold it
    // implicitly (see ADMIN_IMPLIED_FEATURE_LEAVES in permissions.service.ts) and
    // it can be delegated to non-admins via the Access Rights UI.
    key: 'organization',
    label: 'Organization',
    entitlementControlled: false,
    subModules: [
      {
        key: 'organization.structure',
        label: 'Department structure',
        features: [
          feature(
            'settings.organization.structure',
            'Manage department structure',
            A_ALL,
            'Create, edit, arrange, and delete departments in the org chart',
          ),
        ],
      },
    ],
  },
  {
    // Platform administration — never under the entitlement ceiling, governed by is_admin.
    key: 'admin',
    label: 'Administration',
    entitlementControlled: false,
    subModules: [
      {
        key: 'admin.platform',
        label: 'Platform administration',
        features: [
          // Legacy key `access_rights` kept verbatim (was the meta-permission).
          admin('access_rights', 'Manage access rights', 'Configure who can do what across the software'),
          admin('admin.users.invite', 'Invite users & assign roles'),
          admin('admin.system.config', 'System & module configuration'),
        ],
      },
    ],
  },
];

// ─── Derived lookups (single source of truth) ──────────────────────────────────

interface LeafIndexEntry {
  leaf: PermissionLeaf;
  moduleKey: string;
  subModuleKey: string;
  entitlementControlled: boolean;
}

const LEAF_INDEX = new Map<string, LeafIndexEntry>();
for (const mod of PERMISSION_REGISTRY) {
  for (const sub of mod.subModules) {
    for (const leaf of sub.features) {
      if (LEAF_INDEX.has(leaf.key)) {
        throw new Error(`Duplicate permission leaf key in registry: "${leaf.key}"`);
      }
      LEAF_INDEX.set(leaf.key, {
        leaf,
        moduleKey: mod.key,
        subModuleKey: sub.key,
        entitlementControlled: mod.entitlementControlled,
      });
    }
  }
}

export const LEAF_BY_KEY: ReadonlyMap<string, PermissionLeaf> = new Map(
  [...LEAF_INDEX.entries()].map(([k, v]) => [k, v.leaf]),
);

export const isValidLeaf = (key: string): boolean => LEAF_INDEX.has(key);

export const moduleOf = (key: string): string | undefined => LEAF_INDEX.get(key)?.moduleKey;

/** Human module label for a leaf, e.g. "goals" → "Goals", "tasks.task.manage" → "Tasks". */
export const moduleLabelOf = (key: string): string | undefined => {
  const moduleKey = LEAF_INDEX.get(key)?.moduleKey;
  return moduleKey ? PERMISSION_REGISTRY.find((m) => m.key === moduleKey)?.label : undefined;
};

export const isEntitlementControlled = (key: string): boolean =>
  LEAF_INDEX.get(key)?.entitlementControlled ?? false;

export const kindOf = (key: string): LeafKind | undefined => LEAF_INDEX.get(key)?.leaf.kind;

export const axisOf = (key: string): Axis | undefined => LEAF_INDEX.get(key)?.leaf.axis;

export const actionsFor = (key: string): PermissionAction[] => LEAF_INDEX.get(key)?.leaf.actions ?? [];

export const supportsAction = (key: string, action: PermissionAction): boolean =>
  actionsFor(key).includes(action);

const allLeaves = (): PermissionLeaf[] => [...LEAF_INDEX.values()].map((e) => e.leaf);

export const ALL_FEATURE_LEAVES: PermissionLeaf[] = allLeaves().filter(
  (l) => l.axis === 'actor' && l.kind === 'feature',
);
export const ALL_ADMIN_LEAVES: PermissionLeaf[] = allLeaves().filter((l) => l.kind === 'admin');
export const ALL_SUBJECT_LEAVES: PermissionLeaf[] = allLeaves().filter((l) => l.axis === 'subject');

/** All top-level module keys (for entitlement seeding / nav). */
export const ALL_MODULE_KEYS: string[] = PERMISSION_REGISTRY.map((m) => m.key);
export const ENTITLEMENT_MODULE_KEYS: string[] = PERMISSION_REGISTRY.filter(
  (m) => m.entitlementControlled,
).map((m) => m.key);

/**
 * Per-module seed state for a NEW org. Most modules default to `full`; a module
 * can opt into `off` (e.g. Delegation) so it stays dark until the vendor hands it
 * over per-org. Existing orgs are unaffected — a module with no stored row already
 * reads as `off` via `entitlementMap`.
 */
export const ENTITLEMENT_DEFAULT_BY_KEY: Record<string, EntitlementDefault> =
  Object.fromEntries(
    PERMISSION_REGISTRY.filter((m) => m.entitlementControlled).map((m) => [
      m.key,
      m.defaultEntitlement ?? 'full',
    ]),
  );
