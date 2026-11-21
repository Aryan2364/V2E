import { AccessSubject, TemplateCapabilities, WorkflowRole } from './workflow-template.types'
import { Principal } from '../access-rights/permissions.service'
import { workflowRoleOf } from './run-access'

export function isAdminPrincipal(p: Principal): boolean {
  return !!(p.isAdmin || p.isSuperAdmin)
}

/**
 * view (design + all instances): admins, editors (the creator + `edit` grants) and
 * viewers (`view` grants) — whatever the status. edit + manage people: admins and
 * editors. Start by hand: ONLY the people chosen under "Manually" (`trigger` grants —
 * editors and admins are not starters unless listed), while "Manually" is on and it
 * is active. Change creator: admins.
 */
export function capabilitiesFor(t: Omit<AccessSubject, 'id' | 'name'>, p: Principal): TemplateCapabilities {
  const admin = isAdminPrincipal(p)
  const r = workflowRoleOf(t, p.userId)
  const manual = t.manual_start_enabled !== false
  const role: WorkflowRole = r.isCreator
    ? 'creator'
    : r.isEditor
      ? 'editor'
      : r.isViewer
        ? 'viewer'
        : admin
          ? 'admin'
          : r.isStarter
            ? 'starter'
            : null
  return {
    can_view: admin || r.isEditor || r.isViewer,
    can_edit: admin || r.isEditor,
    can_trigger: r.isStarter && manual && t.status === 'active',
    can_manage_access: admin || r.isEditor,
    can_change_creator: admin,
    is_starter: r.isStarter,
    is_creator: r.isCreator,
    role,
  }
}
