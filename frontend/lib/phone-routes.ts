/**
 * V2E's phone screens - FRONTEND_RULES_PHONE.md 41.1 rules 1 to 3, 41.11.
 *
 * THE ONE LIST OF WHAT RUNS ON A PHONE. Any address not matched here is a
 * computer-only screen: on a phone the shell shows the 41.11 page for it
 * ("This screen works on a computer"), never a squeezed desktop page. A new
 * route therefore stays on the computer until it is added here on purpose
 * (41.1 rule 1: "a screen not listed stays on the computer").
 *
 * Same addresses on both layouts (41.2 rule 4): a link from a notification,
 * WhatsApp or email opens the same record on any device. The phone shell
 * (components/phone/PhoneShell.tsx) reads this list; desktop never does.
 *
 * Plain data and pure functions, no React and no "use client", so the server
 * (redirects, metadata) and the browser read the same answers.
 */

/** My work, the phone's home (41.15). The phone opens here after sign-in. */
export const PHONE_HOME = '/dashboard/tasks/my'

/** The More tab (41.4 rule 15). A phone-only address; on desktop it opens the dashboard. */
export const MORE_HREF = '/dashboard/more'

/** Notification choices (41.18 rule 3), one row in More. Phone-only address. */
export const NOTIFICATION_CHOICES_HREF = '/dashboard/more/notifications'

/** The Given tab's address (slice 5). Exported so screens can link/fall back to it. */
export const GIVEN_HREF = '/dashboard/tasks/assigned'

/** Recurring templates (slice 5, §5.6, D8) - same address desktop uses. */
export const RECURRING_TEMPLATES_HREF = '/dashboard/tasks/recurring'

/** A recurring template's instances (slice 5, §5.6) - same address desktop uses. */
export function recurringInstancesHref(templateId: string): string {
  return `${RECURRING_TEMPLATES_HREF}/${templateId}`
}

/** A task's record - the same address desktop uses. */
export function taskHref(taskId: string): string {
  return `/dashboard/tasks/${taskId}`
}

/**
 * Edit task (phone only). Desktop edits in a dialog on the record, so on
 * desktop this address forwards to the record.
 */
export function taskEditHref(taskId: string): string {
  return `${taskHref(taskId)}/edit`
}

/** Tasks I am CC'd on - the same address desktop uses. */
export const CC_TASKS_HREF = '/dashboard/tasks/cc'

/**
 * Edit a recurring template (phone only). Desktop edits in a dialog, so on
 * desktop this address forwards to the template's instances.
 */
export function recurringEditHref(templateId: string): string {
  return `${recurringInstancesHref(templateId)}/edit`
}

/** A workflow run - the same address desktop uses (workflow notifications link here). */
export function workflowRunHref(templateId: string, instanceId: string): string {
  return `/dashboard/tasks/workflows/${templateId}/instances/${instanceId}`
}

/** A meeting's record - the same address desktop uses. */
export function meetingHref(meetingId: string): string {
  return `/dashboard/governance/meetings/${meetingId}`
}

/**
 * Edit a meeting (phone only). Desktop edits in a dialog, so on desktop this
 * address forwards to the meeting.
 */
export function meetingEditHref(meetingId: string): string {
  return `${meetingHref(meetingId)}/edit`
}

/** A recurring meeting series - the same address desktop uses. */
export function meetingRhythmHref(rhythmId: string): string {
  return `/dashboard/governance/meetings/rhythms/${rhythmId}`
}

/** The phone screens slice 1/5 know how to draw. */
export type PhoneScreenKey =
  | 'my-work'
  | 'given'
  | 'meetings'
  | 'notifications'
  | 'more'
  | 'notification-choices'
  | 'task-record'
  | 'give-task'
  | 'task-edit'
  | 'cc-tasks'
  | 'recurring-edit'
  | 'workflow-run'
  | 'meeting-edit'
  | 'meeting-rhythm'
  | 'meeting-record'
  | 'meeting-create'
  | 'recurring-templates'
  | 'recurring-instances'

export type PhoneRoute = {
  key: PhoneScreenKey
  /** The app bar title (41.4 rule 3). */
  title: string
  /**
   * The screen this one sits under (41.4 rule 7). A screen with a parent is
   * below the top level: back arrow, no tab bar (41.4 rule 11).
   */
  parent?: string
  /**
   * The module entitlement the screen belongs to, if any (MainLayout's
   * ROUTE_MODULES and lib/governance-nav.ts). A module switched off for the
   * organisation hides its tab and shows "not enabled" on its screen.
   */
  entitlement?: string
}

/*
 * Sub-addresses of /dashboard/tasks that are their own (computer-only) pages,
 * not a task id. Kept in step with app/dashboard/tasks/*.
 */
const TASK_SECTIONS = new Set([
  'archive',
  'assigned',
  'cc',
  'collective',
  'delegation',
  'escalated',
  'leave-approvals',
  'masters',
  'my',
  'people',
  'recurring',
  'reports',
  'reports-new',
  'tickets',
  'workflows',
])

/*
 * Sub-addresses of /dashboard/governance/meetings that are not a meeting id.
 * Rhythms and reports are planning and analysis: computer only even though
 * Meetings is on the phone (41.1, 41.10 rule 4).
 */
const MEETING_SECTIONS = new Set(['rhythms', 'reports', 'new'])

/** The Meetings tab's address. Exported so meeting screens can link/fall back to it. */
export const MEETINGS_HREF = '/dashboard/governance/meetings'

/** Create meeting (41.1, 41.10 rule 4: phone-only — desktop creates via a modal). */
const MEETING_CREATE_HREF = `${MEETINGS_HREF}/new`

const EXACT: Record<string, PhoneRoute> = {
  [PHONE_HOME]: { key: 'my-work', title: 'My work', entitlement: 'tasks' },
  '/dashboard/tasks/assigned': { key: 'given', title: 'Given', entitlement: 'tasks' },
  '/dashboard/tasks/new': { key: 'give-task', title: 'Give task', parent: PHONE_HOME, entitlement: 'tasks' },
  [MEETINGS_HREF]: { key: 'meetings', title: 'Meetings', entitlement: 'governance.meetings' },
  [MEETING_CREATE_HREF]: {
    key: 'meeting-create',
    title: 'Create meeting',
    parent: MEETINGS_HREF,
    entitlement: 'governance.meetings',
  },
  [CC_TASKS_HREF]: { key: 'cc-tasks', title: "CC'd to me", parent: MORE_HREF, entitlement: 'tasks' },
  '/dashboard/notifications': { key: 'notifications', title: 'Notifications' },
  [MORE_HREF]: { key: 'more', title: 'More' },
  [NOTIFICATION_CHOICES_HREF]: {
    key: 'notification-choices',
    title: 'Notification choices',
    parent: MORE_HREF,
  },
  [RECURRING_TEMPLATES_HREF]: {
    key: 'recurring-templates',
    title: 'Recurring tasks',
    parent: GIVEN_HREF,
    entitlement: 'tasks',
  },
}

function trimSlash(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
}

/** The phone screen for an address, or null when the address is computer-only. */
export function phoneRouteFor(rawPathname: string): PhoneRoute | null {
  const pathname = trimSlash(rawPathname)
  const exact = EXACT[pathname]
  if (exact) return exact

  const task = /^\/dashboard\/tasks\/([^/]+)$/.exec(pathname)
  if (task && !TASK_SECTIONS.has(task[1])) {
    return { key: 'task-record', title: 'Task', parent: PHONE_HOME, entitlement: 'tasks' }
  }

  const taskEdit = /^\/dashboard\/tasks\/([^/]+)\/edit$/.exec(pathname)
  if (taskEdit && !TASK_SECTIONS.has(taskEdit[1])) {
    return { key: 'task-edit', title: 'Edit task', parent: taskHref(taskEdit[1]), entitlement: 'tasks' }
  }

  const recurringEdit = /^\/dashboard\/tasks\/recurring\/([^/]+)\/edit$/.exec(pathname)
  if (recurringEdit) {
    return {
      key: 'recurring-edit',
      title: 'Edit recurring task',
      parent: recurringInstancesHref(recurringEdit[1]),
      entitlement: 'tasks',
    }
  }

  const recurringInstance = /^\/dashboard\/tasks\/recurring\/([^/]+)$/.exec(pathname)
  if (recurringInstance) {
    return {
      key: 'recurring-instances',
      title: 'Recurring task',
      parent: RECURRING_TEMPLATES_HREF,
      entitlement: 'tasks',
    }
  }

  const workflowRun = /^\/dashboard\/tasks\/workflows\/([^/]+)\/instances\/([^/]+)$/.exec(pathname)
  if (workflowRun) {
    return { key: 'workflow-run', title: 'Workflow', parent: PHONE_HOME, entitlement: 'workflows' }
  }

  const meetingEdit = /^\/dashboard\/governance\/meetings\/([^/]+)\/edit$/.exec(pathname)
  if (meetingEdit && !MEETING_SECTIONS.has(meetingEdit[1])) {
    return {
      key: 'meeting-edit',
      title: 'Edit meeting',
      parent: meetingHref(meetingEdit[1]),
      entitlement: 'governance.meetings',
    }
  }

  const meetingRhythm = /^\/dashboard\/governance\/meetings\/rhythms\/([^/]+)$/.exec(pathname)
  if (meetingRhythm) {
    return {
      key: 'meeting-rhythm',
      title: 'Recurring meeting',
      parent: MEETINGS_HREF,
      entitlement: 'governance.meetings',
    }
  }

  const meeting = /^\/dashboard\/governance\/meetings\/([^/]+)$/.exec(pathname)
  if (meeting && !MEETING_SECTIONS.has(meeting[1])) {
    return {
      key: 'meeting-record',
      title: 'Meeting',
      parent: MEETINGS_HREF,
      entitlement: 'governance.meetings',
    }
  }

  return null
}

/**
 * Addresses that have no phone screen of their own but a phone answer: the
 * dashboard is where sign-in, the installed app (manifest start_url) and old
 * links land, and on a phone it opens My work (41.15).
 */
export function phoneRedirectFor(rawPathname: string): string | null {
  return trimSlash(rawPathname) === '/dashboard' ? PHONE_HOME : null
}

/**
 * Where a signed-in person lands: unchanged on desktop (super admins to the
 * organisations list, everyone else to the dashboard); My work on a phone.
 * A super admin has no phone screens, so lands where they always did and sees
 * the 41.11 page there.
 */
export function signedInHome(
  user: { isSuperAdmin: boolean },
  layout: 'phone' | 'desktop',
): string {
  if (user.isSuperAdmin) return '/super-admin/organizations'
  return layout === 'phone' ? PHONE_HOME : '/dashboard'
}

/*
 * The app bar title for a computer-only screen (41.11), from the area the
 * address belongs to. Longest prefix wins; unknown addresses read "V2E".
 */
const AREA_TITLES: { prefix: string; title: string }[] = [
  { prefix: '/dashboard/tasks/tickets', title: 'Tickets' },
  { prefix: '/dashboard/tasks/workflows', title: 'Workflows' },
  { prefix: '/dashboard/tasks/leave-approvals', title: 'Leave approvals' },
  { prefix: '/dashboard/tasks/reports', title: 'Task reports' },
  { prefix: '/dashboard/tasks', title: 'Tasks' },
  { prefix: '/dashboard/governance/meetings/rhythms', title: 'Meeting rhythms' },
  { prefix: '/dashboard/governance/meetings/reports', title: 'Meeting reports' },
  { prefix: '/dashboard/governance', title: 'Governance' },
  { prefix: '/dashboard/projects', title: 'Projects' },
  { prefix: '/dashboard/performance', title: 'Performance' },
  { prefix: '/dashboard/profile', title: 'My profile' },
  { prefix: '/dashboard/employees', title: 'Employees' },
  { prefix: '/dashboard/org-chart', title: 'Org chart' },
  { prefix: '/dashboard/process-hierarchy', title: 'Processes' },
  { prefix: '/dashboard', title: 'Dashboard' },
  { prefix: '/goals', title: 'Goals' },
  { prefix: '/learning', title: 'Learning' },
  { prefix: '/communication', title: 'Communication' },
  { prefix: '/settings', title: 'Settings' },
  { prefix: '/super-admin', title: 'Administration' },
]

export function computerOnlyTitle(rawPathname: string): string {
  const pathname = trimSlash(rawPathname)
  const match = AREA_TITLES.filter(
    (a) => pathname === a.prefix || pathname.startsWith(`${a.prefix}/`),
  ).sort((a, b) => b.prefix.length - a.prefix.length)[0]
  return match?.title ?? 'V2E'
}
