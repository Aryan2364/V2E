'use client'

import TaskChecklistCard from '@/components/tasks/TaskChecklistCard'
import ProofOfCompletionCard from '@/components/tasks/ProofOfCompletionCard'
import { TaskComments } from './TaskComments'
import type { TaskDetailCtx } from './types'

import type { WorkflowStepContext } from '@/lib/types/workflows'

/** Left panel - 60%; scrolls on its own within the viewport on lg+. */
export function TaskMainColumn({ ctx, stepCtx }: { ctx: TaskDetailCtx; stepCtx: WorkflowStepContext | null | undefined }) {
  const { d, task, flags, orgId, taskId, user } = ctx
  const { canEdit, assignees, isTaskTerminal } = flags
  return (
      <div className="flex-1 min-w-0 space-y-6 lg:min-h-0 lg:overflow-y-auto lg:pr-3">
        {/* Checklist — per-person in all_must_complete, shared otherwise */}
        {task.checklist && task.checklist.length > 0 && (
          <TaskChecklistCard
            task={task}
            orgId={orgId}
            taskId={taskId}
            currentUserId={user?.id ?? ''}
            canEdit={!!canEdit}
            onChanged={(updated) => d.setTask(updated)}
          />
        )}

        {/* Proof of completion — file-based, mode-aware (see ProofOfCompletionCard) */}
        {task.proof_required && (
          <ProofOfCompletionCard
            task={task}
            assignees={assignees}
            reloadToken={d.proofReloadToken}
            locked={isTaskTerminal}
            onChanged={() => { void d.reload(); d.bumpProof() }}
          />
        )}

      <TaskComments ctx={ctx} stepCtx={stepCtx} />
    </div>
  )
}
