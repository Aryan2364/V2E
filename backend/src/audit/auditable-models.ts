/**
 * Registry deciding which Prisma models are captured by the universal audit
 * extension, and how each maps onto a human-readable `audit_logs` row.
 *
 * Strategy: denylist + smart defaults. Everything is auditable EXCEPT the
 * denylisted ephemeral / high-churn / recursive tables. High-value models get
 * an explicit config (clean resource key, label field, relation hints); all
 * other allowed models fall back to a derived default. This keeps coverage
 * complete without hand-maintaining 120 entries.
 */

export interface RelationHint {
  /** Target Prisma model name (PascalCase) whose row the FK points at. */
  model: string;
  /** Field on the target used as the display label (defaults to name/title). */
  labelField?: string;
}

export interface ModelAuditConfig {
  /** Stable resource key written to audit_logs.resource. */
  resource: string;
  /** Fields tried in order to derive a human entity_label. */
  labelFields: string[];
  /** Fields excluded from diffs, on top of the global ignore set. */
  ignoreFields?: string[];
  /** FK field name → how to resolve it to a label at read time. */
  relationLabels?: Record<string, RelationHint>;
}

/** Never audited — recursion, ephemera, high-churn, or legacy feeds we federate. */
export const AUDIT_DENYLIST = new Set<string>([
  // Recursion / the audit store itself
  'AuditLog',
  // Notifications (high-churn, ephemeral)
  'Notification',
  'NotificationMaster',
  'WorkflowNotification',
  'TicketNotification',
  'PushSubscription',
  // Legacy per-module feeds — federated into audit_logs, not re-audited
  'TaskActivityLog',
  'TicketActivityLog',
  'ProjectActivityLog',
  'AssigneeVisibilityAuditLog',
  // Reactions / read-receipts / chat — high churn, low audit value
  'AnnouncementRead',
  'BulletinReaction',
  'KnowledgeReaction',
  'Message',
  'ConversationMember',
  // Learning — per-open view tracking + recomputed progress counters (high churn).
  // Meaningful learning events (assign/complete/publish/content edits) stay audited.
  'LearningItemView',
  'LearningItemProgress',
  'LearningPathProgress',
  // Internal counters / join bookkeeping
  'WorkflowRoundRobinTracker',
  'TicketRoundRobinTracker',
]);

/** Excluded from every diff — auto-managed or noise. */
export const GLOBAL_IGNORE_FIELDS = new Set<string>([
  'id',
  'created_at',
  'updated_at',
  'organization_id',
  // Simulated-clock bookkeeping on Organization — never audit-worthy
  'sim_epoch',
  'sim_anchor',
  'sim_replayed_until',
]);

/** FK field names resolved the same way across every resource. */
export const GLOBAL_RELATION_LABELS: Record<string, RelationHint> = {
  actor_user_id: { model: 'User' },
  user_id: { model: 'User' },
  assigned_to_user_id: { model: 'User' },
  assigned_by_user_id: { model: 'User' },
  assignee_user_id: { model: 'User' },
  reassigned_to_user_id: { model: 'User' },
  created_by: { model: 'User' },
  created_by_user_id: { model: 'User' },
  updated_by: { model: 'User' },
  owner_id: { model: 'User' },
  owner_user_id: { model: 'User' },
  manager_id: { model: 'User' },
  manager_user_id: { model: 'User' },
  reports_to_id: { model: 'User' },
  requester_id: { model: 'User' },
  requester_user_id: { model: 'User' },
  approver_user_id: { model: 'User' },
  changed_by_user_id: { model: 'User' },
  removed_by_user_id: { model: 'User' },
  department_id: { model: 'Department' },
  dept_id: { model: 'Department' },
  role_id: { model: 'Role' },
  system_role_id: { model: 'SystemRole' },
};

const EXPLICIT: Record<string, ModelAuditConfig> = {
  Goal: {
    resource: 'goal',
    labelFields: ['title'],
    relationLabels: { owner_user_id: { model: 'User' }, department_id: { model: 'Department' } },
  },
  GoalLink: {
    resource: 'goal_link',
    // No text field of its own — the label is derived from the two goals.
    labelFields: [],
    relationLabels: {
      supporting_goal_id: { model: 'Goal', labelField: 'title' },
      supported_goal_id: { model: 'Goal', labelField: 'title' },
    },
  },
  Task: {
    resource: 'task',
    labelFields: ['title'],
    relationLabels: {
      status_id: { model: 'TaskStatus', labelField: 'name' },
      priority_id: { model: 'TaskPriority', labelField: 'name' },
      category_id: { model: 'TaskCategory', labelField: 'name' },
    },
  },
  TaskAssignee: { resource: 'task', labelFields: [] },
  // Append-only deadline paper trail. Rows are never updated, so the audit value is
  // the create snapshot (from → to, who, why) — which the default diff already gives.
  TaskDeadlineRevision: { resource: 'task', labelFields: [] },
  TaskComment: { resource: 'task', labelFields: [] },
  TaskChecklist: { resource: 'task', labelFields: ['title'] },
  TaskStatus: { resource: 'task_status', labelFields: ['name'] },
  TaskPriority: { resource: 'task_priority', labelFields: ['name'] },
  TaskCategory: { resource: 'task_category', labelFields: ['name'] },
  Ticket: {
    resource: 'ticket',
    labelFields: ['title', 'subject'],
    relationLabels: {
      status_id: { model: 'TicketStatus', labelField: 'name' },
      priority_id: { model: 'TicketPriority', labelField: 'name' },
      category_id: { model: 'TicketCategory', labelField: 'name' },
      type_id: { model: 'TicketType', labelField: 'name' },
    },
  },
  TicketStatus: { resource: 'ticket_status', labelFields: ['name'] },
  TicketPriority: { resource: 'ticket_priority', labelFields: ['name'] },
  TicketCategory: { resource: 'ticket_category', labelFields: ['name'] },
  TicketType: { resource: 'ticket_type', labelFields: ['name'] },
  Project: {
    resource: 'project',
    labelFields: ['name', 'title'],
    // Recomputed counters — excluded so progress recalcs don't flood the log.
    ignoreFields: ['total_tasks', 'completed_tasks', 'completion_percentage', 'total_milestones', 'achieved_milestones'],
  },
  ProjectMilestone: {
    resource: 'project',
    labelFields: ['name', 'title'],
    ignoreFields: ['total_tasks', 'completed_tasks', 'completion_percentage'],
    relationLabels: { project_id: { model: 'Project', labelField: 'name' } },
  },
  ProjectTask: { resource: 'project', labelFields: ['title', 'name'] },
  ProjectMember: { resource: 'project', labelFields: [] },
  Employee: { resource: 'employee', labelFields: ['name'] },
  EmployeeProfile: {
    resource: 'employee',
    labelFields: ['display_name', 'name'],
    relationLabels: { department_id: { model: 'Department' }, role_id: { model: 'Role' } },
  },
  Department: { resource: 'department', labelFields: ['name'] },
  Role: { resource: 'role', labelFields: ['name'] },
  SystemRole: { resource: 'system_role', labelFields: ['name'] },
  RolePermission: {
    resource: 'access_right',
    labelFields: [],
    relationLabels: { system_role_id: { model: 'SystemRole' } },
  },
  UserPermissionOverride: {
    resource: 'access_right',
    labelFields: [],
    relationLabels: { user_id: { model: 'User' } },
  },
  OrgModuleEntitlement: { resource: 'access_right', labelFields: ['module'] },
  SystemRoleModuleScope: { resource: 'access_right', labelFields: ['module'] },
  HolidayMaster: { resource: 'holiday', labelFields: ['name', 'title'] },
  OrgHoliday: { resource: 'holiday', labelFields: ['name', 'title'] },
  DepartmentHoliday: { resource: 'holiday', labelFields: ['name', 'title'] },
  IndividualHoliday: { resource: 'holiday', labelFields: ['name', 'title'] },
  WorkflowTemplate: { resource: 'workflow', labelFields: ['name', 'title'] },
  WorkflowInstance: {
    resource: 'workflow',
    labelFields: ['name', 'title'],
    relationLabels: { template_id: { model: 'WorkflowTemplate', labelField: 'name' } },
  },
  WorkflowInstanceStep: {
    resource: 'workflow',
    labelFields: ['name', 'title'],
    relationLabels: { assigned_to_user_id: { model: 'User' } },
  },
  Meeting: { resource: 'meeting', labelFields: ['title', 'name'] },
  MeetingActionItem: { resource: 'meeting', labelFields: ['title', 'description'] },
  MeetingDecision: { resource: 'meeting', labelFields: ['title', 'description'] },
  Announcement: { resource: 'announcement', labelFields: ['title'] },
  BulletinPost: { resource: 'bulletin', labelFields: ['title'] },
  KnowledgePost: { resource: 'knowledge', labelFields: ['title'] },
  LearningPath: { resource: 'learning_path', labelFields: ['title', 'name'] },
  Organization: { resource: 'organization', labelFields: ['name'] },
  OrgIdentity: { resource: 'organization', labelFields: ['name'] },
  CultureStandard: { resource: 'culture', labelFields: ['name', 'title'] },
  CompanyPolicy: { resource: 'company_policy', labelFields: ['title', 'name'] },
  WorkLogDemand: { resource: 'work_log', labelFields: ['title', 'name'] },
  WorkLogSubmission: { resource: 'work_log', labelFields: [] },
  DailyUpdate: { resource: 'work_log', labelFields: [] },
};

// ─── Module grouping (drives the audit filter UI) ──────────────────────────────
//
// `resource` keys are entity-level (task, task_status, …). Users navigate by
// MODULE — the top-nav / permission-registry concept (Tasks, Tickets, …). This
// map groups resources under their module so the audit filter can offer a clean
// Module dropdown, with a dependent Type dropdown only where a module spans more
// than one entity. Mirrors PERMISSION_REGISTRY's module taxonomy.

export interface AuditResourceFacet {
  /** resource key as stored in audit_logs.resource. */
  key: string;
  /** Human label, shown in the Type dropdown (scoped to its module). */
  label: string;
  /**
   * Legacy / derived alias kept for filtering + table labels but hidden from the
   * Type dropdown — e.g. pre-consolidation `role_permission` rows that now write
   * `access_right`. Keeps old entries categorized without cluttering the UI.
   */
  hidden?: boolean;
}

export interface AuditModuleDef {
  /** Stable module key. */
  key: string;
  /** Human label, shown in the Module dropdown. */
  label: string;
  /** Entity types that roll up to this module. */
  resources: AuditResourceFacet[];
}

export const AUDIT_MODULES: AuditModuleDef[] = [
  {
    key: 'goals',
    label: 'Goals',
    resources: [
      { key: 'goal', label: 'Goals' },
      { key: 'goal_link', label: 'Goal links' },
      { key: 'goal_check_in', label: 'Check-ins' },
    ],
  },
  {
    key: 'tasks',
    label: 'Tasks',
    resources: [
      { key: 'task', label: 'Tasks' },
      { key: 'task_status', label: 'Statuses' },
      { key: 'task_priority', label: 'Priorities' },
      { key: 'task_category', label: 'Categories' },
    ],
  },
  {
    key: 'tickets',
    label: 'Tickets',
    resources: [
      { key: 'ticket', label: 'Tickets' },
      { key: 'ticket_status', label: 'Statuses' },
      { key: 'ticket_priority', label: 'Priorities' },
      { key: 'ticket_category', label: 'Categories' },
      { key: 'ticket_type', label: 'Types' },
    ],
  },
  {
    key: 'projects',
    label: 'Projects',
    resources: [{ key: 'project', label: 'Projects' }],
  },
  {
    key: 'governance',
    label: 'Governance',
    resources: [
      { key: 'meeting', label: 'Meetings' },
      { key: 'work_log', label: 'Work logs' },
      { key: 'workflow', label: 'Workflows' },
    ],
  },
  {
    key: 'communication',
    label: 'Communication',
    resources: [
      { key: 'announcement', label: 'Announcements' },
      { key: 'bulletin', label: 'Bulletin posts' },
      { key: 'knowledge', label: 'Knowledge base' },
    ],
  },
  {
    key: 'learning',
    label: 'Learning',
    resources: [
      { key: 'learning_path', label: 'Learning paths' },
      { key: 'learning_item', label: 'Learning items', hidden: true },
    ],
  },
  {
    key: 'ecs',
    label: 'ESS',
    resources: [{ key: 'company_policy', label: 'Company policies' }],
  },
  {
    key: 'holidays',
    label: 'Holidays',
    resources: [{ key: 'holiday', label: 'Holidays & working days' }],
  },
  {
    key: 'people',
    label: 'People',
    resources: [{ key: 'employee', label: 'Employees' }],
  },
  {
    key: 'organization',
    label: 'Organization',
    resources: [
      { key: 'organization', label: 'Company profile' },
      { key: 'department', label: 'Departments' },
      { key: 'role', label: 'Job roles' },
      { key: 'culture', label: 'Culture standards' },
    ],
  },
  {
    key: 'administration',
    label: 'Administration',
    resources: [
      { key: 'system_role', label: 'System roles' },
      { key: 'access_right', label: 'Access rights' },
      // Legacy keys written before access-right consolidation.
      { key: 'role_permission', label: 'Access rights', hidden: true },
      { key: 'user_permission_override', label: 'Access rights', hidden: true },
      { key: 'org_module_entitlement', label: 'Access rights', hidden: true },
      { key: 'system_role_module_scope', label: 'Access rights', hidden: true },
    ],
  },
];

/** Bucket for present-but-unmapped resources (derived-default models). */
export const OTHER_MODULE_KEY = '__other';

const RESOURCE_TO_MODULE = new Map<string, string>();
for (const m of AUDIT_MODULES) {
  for (const r of m.resources) RESOURCE_TO_MODULE.set(r.key, m.key);
}

/** Every resource key explicitly mapped to a module. */
export const MAPPED_RESOURCES: string[] = [...RESOURCE_TO_MODULE.keys()];

/** Module key a resource rolls up to, or null if unmapped. */
export function moduleForResource(resource: string): string | null {
  return RESOURCE_TO_MODULE.get(resource) ?? null;
}

/** Resource keys belonging to a module (empty for unknown / Other). */
export function resourcesForModule(moduleKey: string): string[] {
  return AUDIT_MODULES.find((m) => m.key === moduleKey)?.resources.map((r) => r.key) ?? [];
}

/** Humanize a raw resource key for the Other bucket. */
export function humanizeResource(resource: string): string {
  return resource.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** PascalCase model name → snake_case default resource key. */
function defaultResource(model: string): string {
  return model
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
}

const DEFAULT_LABEL_FIELDS = ['title', 'name', 'subject', 'label', 'display_name'];

/**
 * Resolve the audit config for a model, or `null` if it must not be audited.
 * Allowed-but-unmapped models get a derived default so coverage stays complete.
 */
export function auditConfigFor(model: string): ModelAuditConfig | null {
  if (AUDIT_DENYLIST.has(model)) return null;
  const explicit = EXPLICIT[model];
  if (explicit) return explicit;
  return { resource: defaultResource(model), labelFields: DEFAULT_LABEL_FIELDS };
}
