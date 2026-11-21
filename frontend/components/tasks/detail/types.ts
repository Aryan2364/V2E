import type { Task, TaskStatus } from '@/lib/types/tasks'
import type { TaskDetail } from '@/lib/hooks/useTaskDetail'
import type { TaskFlags } from '@/lib/tasks/detail-rules'
import type { useAuth } from '@/lib/auth/context'

export type DetailUser = ReturnType<typeof useAuth>['user']

/** What every section of the computer's task page needs: the data layer, the derived rules and who is looking. */
export interface TaskDetailCtx {
  d: TaskDetail
  task: Task
  flags: TaskFlags
  orgId: string
  taskId: string
  user: DetailUser
  /** The Status control only moves a task between OPEN states. */
  openStatuses: TaskStatus[]
  /** Seconds left in the undo window (0 when none). */
  reopenSecondsLeft: number
}
