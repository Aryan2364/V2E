'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { getNow } from '@/lib/clock'
import { useReopenCountdown, useTaskDetail } from '@/lib/hooks/useTaskDetail'
import { canDeleteTask, deriveTaskFlags } from '@/lib/tasks/detail-rules'
import { TERMINAL_STATUS_PHASES } from '@/lib/types/tasks'
import type { WorkflowStepContext } from '@/lib/types/workflows'
import EditTaskModal from '@/components/tasks/EditTaskModal'
import WorkflowTaskBanner from '@/components/workflows/WorkflowTaskBanner'
import { Button } from '@/components/ui/button'
import { Eye } from 'lucide-react'
import { DetailSkeleton } from '@/components/tasks/detail/DetailSkeleton'
import { TaskDetailHeader } from '@/components/tasks/detail/TaskDetailHeader'
import { TaskActionPanels } from '@/components/tasks/detail/TaskActionPanels'
import { TaskMainColumn } from '@/components/tasks/detail/TaskMainColumn'
import { TaskSidebar } from '@/components/tasks/detail/TaskSidebar'
import { TaskActivityDialog } from '@/components/tasks/detail/TaskActivityDialog'
import { useTaskDetailPanels } from '@/components/tasks/detail/useTaskDetailPanels'
import type { TaskDetailCtx } from '@/components/tasks/detail/types'

export default function TaskDetailPage() {
  const { user } = useAuth()
  const params = useParams()
  const router = useRouter()
  const orgId = user?.organizationId ?? ''
  const taskId = params.taskId as string

  const d = useTaskDetail({ orgId, taskId, userId: user?.id, variant: 'full' })
  const panels = useTaskDetailPanels(d)
  // Workflow step task: its step context (from the banner). undefined = still loading.
  const [stepCtx, setStepCtx] = useState<WorkflowStepContext | null | undefined>(undefined)
  const { task } = d
  const reopenSecondsLeft = useReopenCountdown(task?.reopen_expires_at)

  if (!orgId) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <p className="font-medium text-text-primary">No organization found</p>
      </div>
    )
  }

  if (d.loading) {
    return <DetailSkeleton />
  }

  if (!task) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <p className="font-medium text-text-primary">Task not found</p>
        <Button variant="secondary" className="mt-3" onClick={() => router.back()}>
          Back to Tasks
        </Button>
      </div>
    )
  }

  // The Status control only moves a task between OPEN states; terminal states
  // (Complete / Incomplete) are reached via the actions and shown read-only here.
  const openStatuses = d.statuses.filter((s) => !TERMINAL_STATUS_PHASES.includes(s.type))
  const flags = deriveTaskFlags({ task, userId: user?.id, isAdmin: !!user?.is_admin, now: getNow(), openStatuses })
  // Mirror the backend rule (checkTaskPermission -> 'task_delete_roles'): delete is allowed
  // only for platform admins, or when the org opens it to all members.
  const canDelete = !!canDeleteTask(!!user?.is_admin, d.config)
  const ctx: TaskDetailCtx = { d, task, flags, orgId, taskId, user, openStatuses, reopenSecondsLeft }

  return (
    // On lg+, fill the fixed-height <main> so the two detail columns can scroll
    // independently instead of the whole page. On mobile it's a normal flowing page.
    <div className="space-y-6 max-w-7xl lg:h-full lg:flex lg:flex-col lg:overflow-hidden">
      <TaskDetailHeader ctx={ctx} panels={panels} canDelete={canDelete} />

      {/* Workflow step: which workflow and run this task belongs to, and Send back */}
      {task.workflow_instance_step_id && (
        <WorkflowTaskBanner
          orgId={orgId}
          taskId={taskId}
          workflowInstanceStepId={task.workflow_instance_step_id}
          fallback={task.workflow_step ?? null}
          onChanged={d.reload}
          onContext={setStepCtx}
        />
      )}

      {/* CC banner */}
      {flags.currentUserIsCC && (
        <div className="flex items-center gap-2 text-body text-warning bg-warning-bg border border-warning-border rounded-control px-3 py-2">
          <Eye size={14} className="shrink-0 text-warning" />
          You&apos;re CC&apos;d on this task — you can view and comment but cannot mark it complete.
        </div>
      )}

      {panels.showEditModal && (
        <EditTaskModal
          task={task}
          categories={d.categories}
          priorities={d.priorities}
          statuses={d.statuses}
          onClose={() => panels.setShowEditModal(false)}
          onSaved={(updated) => { d.applyTask(updated); panels.setShowEditModal(false) }}
        />
      )}

      <TaskActionPanels ctx={ctx} panels={panels} />

      {/* Description — right under the title, no box around it. */}
      {task.description && (
        <p className="text-body text-text-primary leading-relaxed whitespace-pre-wrap shrink-0 pl-8">{task.description}</p>
      )}

      <div className="flex flex-col lg:flex-row gap-6 lg:flex-1 lg:min-h-0">
        <TaskMainColumn ctx={ctx} stepCtx={stepCtx} />
        <TaskSidebar ctx={ctx} panels={panels} />
      </div>

      <TaskActivityDialog open={panels.showActivity} onOpenChange={panels.setShowActivity} logs={d.activityLogs} />
    </div>
  )
}
