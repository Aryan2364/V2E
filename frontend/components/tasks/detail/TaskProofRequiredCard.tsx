'use client'


import type { TaskDetailCtx } from './types'

export function TaskProofRequiredCard({ ctx }: { ctx: TaskDetailCtx }) {
  const { task, flags } = ctx
  const { isAllMustComplete } = flags
  if (!task.proof_required) return null
  const ps = task.proof_summary
  const required = ps?.required_user_ids?.length ?? 0
  const submitted = ps?.submitted_user_ids?.length ?? 0
  const done = isAllMustComplete ? (required > 0 && submitted >= required) : !!ps?.task_has_any_proof
  const label = isAllMustComplete
    ? (done ? 'All submitted' : `${submitted}/${required} submitted`)
    : (done ? 'Submitted' : 'Pending submission')
  return (
    <div className="bg-surface border border-border-light rounded-card shadow-card overflow-hidden">
      <div className={`flex items-center gap-2 px-4 py-2.5 border-b ${done ? 'bg-success-bg border-success-border' : 'bg-danger-bg border-danger-border'}`}>
        <span className={`w-2 h-2 rounded-full ${done ? 'bg-success' : 'bg-danger'}`} />
        <p className={`text-meta font-medium uppercase tracking-widest ${done ? 'text-success' : 'text-danger'}`}>
          Proof Required
        </p>
      </div>
      <div className="p-4">
        <p className={`text-body font-medium ${done ? 'text-success' : 'text-warning'}`}>{label}</p>
      </div>
    </div>
  )
}
