'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth/context'
import { usePermissions } from '@/lib/auth/use-permissions'
import { tasksApi } from '@/lib/api/tasks'
import { getNow } from '@/lib/clock'
import type { Task, TaskMasterConfig } from '@/lib/types/tasks'

const TASK_LEAF = 'tasks.task.manage'

// One config fetch per org, shared by every task drawer / detail page on screen.
const configCache = new Map<string, TaskMasterConfig | null>()
const configInflight = new Map<string, Promise<TaskMasterConfig | null>>()

function loadConfig(orgId: string): Promise<TaskMasterConfig | null> {
  const hit = configInflight.get(orgId)
  if (hit) return hit
  const req = tasksApi
    .getConfig(orgId)
    .catch(() => null)
    .then((cfg) => {
      configCache.set(orgId, cfg)
      configInflight.delete(orgId)
      return cfg
    })
  configInflight.set(orgId, req)
  return req
}

type EditableTask = Pick<Task, 'created_by_user_id' | 'created_at'> & {
  assignees?: { user_id: string; is_cc: boolean }[]
}

/**
 * May the current user edit this task's fields (its tags, today)? Mirrors the backend's
 * `updateTask` gate — `findTaskOrFail(isWrite)` then `assertAssignerRights`:
 *
 * 1. A task created in a simulated future is read-only for everyone.
 * 2. Its creator may edit it.
 * 3. An org admin may edit it.
 * 4. Anyone else needs the org's task-edit gate (`task_edit_roles` open to members)
 *    AND `tasks.task.manage` edit, with a data scope that covers the task's creator or
 *    one of its working (non-CC) assignees.
 *
 * Returns `undefined` while the answer is not known yet (permissions or the org's task
 * config still loading) — show the value without edit controls, never a guess.
 *
 * Scope caveat: an `own` scope is decided here exactly (the user must be a working
 * assignee). A `team` scope depends on the reporting line, which the browser does not
 * have, so it is answered optimistically; the server re-checks every save and the
 * caller's rollback + toast covers a refusal (kit §26.5).
 *
 * Pass `config` when the page already holds the org's task config; otherwise it is
 * fetched once per org and shared.
 */
export function useCanEditTask(
  task: EditableTask | null | undefined,
  config?: TaskMasterConfig | null,
): boolean | undefined {
  const { user } = useAuth()
  const perms = usePermissions()
  const orgId = user?.organizationId ?? ''
  const provided = config !== undefined

  const [fetched, setFetched] = useState<TaskMasterConfig | null | undefined>(() =>
    orgId && configCache.has(orgId) ? configCache.get(orgId) : undefined,
  )
  useEffect(() => {
    if (provided || !orgId) return
    if (configCache.has(orgId)) {
      setFetched(configCache.get(orgId))
      return
    }
    let cancelled = false
    void loadConfig(orgId).then((cfg) => {
      if (!cancelled) setFetched(cfg)
    })
    return () => {
      cancelled = true
    }
  }, [orgId, provided])

  if (!task || !user) return undefined
  if (new Date(task.created_at) > getNow()) return false
  if (task.created_by_user_id === user.id) return true
  if (perms.loading) return undefined
  if (perms.isAdmin) return true

  const cfg = provided ? config : fetched
  if (cfg === undefined) return undefined
  // A failed config load (null) skips this gate rather than locking everyone out; the
  // server still enforces it.
  if (cfg && !(cfg.task_edit_roles ?? []).includes('employee')) return false

  if (!perms.can(TASK_LEAF, 'edit')) return false
  const scope = perms.scopeFor(TASK_LEAF, 'edit')
  if (scope === 'own') {
    return (task.assignees ?? []).some((a) => a.user_id === user.id && !a.is_cc)
  }
  return true
}

export default useCanEditTask
