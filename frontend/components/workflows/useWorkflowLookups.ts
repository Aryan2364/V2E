'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { workflowsApi } from '@/lib/api/workflows'
import { tasksApi } from '@/lib/api/tasks'
import type { OrgMemberOption, WorkflowChecklistTemplateOption } from '@/lib/types/workflows'
import type { TaskCategory, TaskPriority } from '@/lib/types/tasks'

export interface WorkflowLookups {
  status: 'loading' | 'ready' | 'partial'
  members: OrgMemberOption[]
  /** Department + job role per person, so same-name people can be told apart in pickers. */
  memberDetails: Map<string, { role_title: string | null; department_name: string | null }>
  categories: TaskCategory[]
  priorities: TaskPriority[]
  /** From GET /meta; 'preview' turns every write off. undefined until it lands. */
  moduleAccess: 'full' | 'preview' | undefined
  /** Checklist templates the current user may add to a step (from GET /meta). */
  checklistTemplates: WorkflowChecklistTemplateOption[]
  categoryNames: Map<string, string>
  priorityNames: Map<string, string>
  /** Lists that failed to load, named for the person reading the warning. */
  failed: string[]
  reload: () => void
}

/**
 * The lists the step, "How it starts" and people editors pick from: org members, checklist
 * templates, and task categories / priorities.
 * Each list loads on its own, so one failure never blanks the others.
 */
export function useWorkflowLookups(orgId: string, enabled = true): WorkflowLookups {
  const [members, setMembers] = useState<OrgMemberOption[]>([])
  const [memberDetails, setMemberDetails] = useState<WorkflowLookups['memberDetails']>(new Map())
  const [categories, setCategories] = useState<TaskCategory[]>([])
  const [priorities, setPriorities] = useState<TaskPriority[]>([])
  const [moduleAccess, setModuleAccess] = useState<'full' | 'preview' | undefined>(undefined)
  const [checklistTemplates, setChecklistTemplates] = useState<WorkflowChecklistTemplateOption[]>([])
  const [failed, setFailed] = useState<string[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'partial'>('loading')
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (!orgId || !enabled) return
    let cancelled = false
    setStatus('loading')
    const fails: string[] = []
    Promise.all([
      workflowsApi.listMembers(orgId).then(setMembers).catch(() => fails.push('people')),
      // Same directory the task form's pickers use (department + role). Optional: without
      // it the pickers still work, just without department groups.
      tasksApi
        .getEligibleAssignees(orgId)
        .then((res) => {
          const map: WorkflowLookups['memberDetails'] = new Map()
          res.departments.forEach((dept) =>
            dept.users.forEach((u) =>
              map.set(u.user_id, { role_title: u.role_title ?? null, department_name: u.department_name ?? dept.department_name ?? null }),
            ),
          )
          setMemberDetails(map)
        })
        .catch(() => setMemberDetails(new Map())),
      workflowsApi
        .getMeta(orgId)
        .then((m) => {
          setModuleAccess(m?.module_access === 'preview' ? 'preview' : 'full')
          setChecklistTemplates(Array.isArray(m?.checklist_templates) ? m.checklist_templates : [])
        })
        .catch(() => fails.push('workflow settings')),
      tasksApi.getCategories(orgId).then((c) => setCategories(c ?? [])).catch(() => fails.push('task categories')),
      tasksApi.getPriorities(orgId).then((p) => setPriorities(p ?? [])).catch(() => fails.push('task priorities')),
    ]).then(() => {
      if (cancelled) return
      setFailed(fails)
      setStatus(fails.length ? 'partial' : 'ready')
    })
    return () => {
      cancelled = true
    }
  }, [orgId, enabled, nonce])

  const categoryNames = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories])
  const priorityNames = useMemo(() => new Map(priorities.map((p) => [p.id, p.label])), [priorities])
  const reload = useCallback(() => setNonce((n) => n + 1), [])

  return { status, members, memberDetails, categories, priorities, moduleAccess, checklistTemplates, categoryNames, priorityNames, failed, reload }
}
