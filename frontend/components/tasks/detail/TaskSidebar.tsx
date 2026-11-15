'use client'

import type { TaskDetailCtx } from './types'
import type { TaskDetailPanels } from './useTaskDetailPanels'
import { TaskStatusCard } from './TaskStatusCard'
import { TaskDetailsCard } from './TaskDetailsCard'
import { TaskAttachmentsCard } from './TaskAttachmentsCard'
import { TaskAssigneesCard } from './TaskAssigneesCard'
import { TaskCompletionModeCard } from './TaskCompletionModeCard'
import { TaskProofRequiredCard } from './TaskProofRequiredCard'

/** Right panel - 40%; scrolls on its own within the viewport on lg+. */
export function TaskSidebar({ ctx, panels }: { ctx: TaskDetailCtx; panels: TaskDetailPanels }) {
  return (
    <div className="w-full lg:w-80 shrink-0 space-y-4 lg:min-h-0 lg:overflow-y-auto lg:pr-3">
      <TaskStatusCard ctx={ctx} panels={panels} />
      <TaskDetailsCard ctx={ctx} />
      <TaskAttachmentsCard ctx={ctx} />
      <TaskAssigneesCard ctx={ctx} panels={panels} />
      <TaskCompletionModeCard ctx={ctx} />
      <TaskProofRequiredCard ctx={ctx} />
    </div>
  )
}
