'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { TaskDetailCtx } from './types'

export function TaskCompletionModeCard({ ctx }: { ctx: TaskDetailCtx }) {
  const { d, task, flags } = ctx
  const { canEdit, assignees } = flags
  const [editingCompletionMode, setEditingCompletionMode] = useState(false)
  const [completionModeDraft, setCompletionModeDraft] = useState<'any_can_complete' | 'all_must_complete'>('any_can_complete')
  const [savingCompletionMode, setSavingCompletionMode] = useState(false)

  async function handleSaveCompletionMode() {
    if (completionModeDraft === task.completion_mode) { setEditingCompletionMode(false); return }
    setSavingCompletionMode(true)
    try {
      await d.saveCompletionMode(completionModeDraft)
      setEditingCompletionMode(false)
    } finally {
      setSavingCompletionMode(false)
    }
  }

  return (
        <div className="bg-surface border border-border-light rounded-card shadow-card overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 bg-warning-bg border-b border-warning-border">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-warning" />
              <p className="text-meta font-medium text-warning uppercase tracking-widest">Completion Mode</p>
            </div>
            {/* Editable only when it matters — 2+ assignees — and the viewer can edit. */}
            {canEdit && assignees.length > 1 && (!editingCompletionMode ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-warning hover:text-warning"
                onClick={() => {
                  setCompletionModeDraft(task.completion_mode === 'all_must_complete' ? 'all_must_complete' : 'any_can_complete')
                  setEditingCompletionMode(true)
                }}
              >
                Edit
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  className="bg-warning border-warning text-primary-foreground hover:bg-warning hover:border-warning"
                  onClick={handleSaveCompletionMode}
                  loading={savingCompletionMode}
                  loadingLabel="Saving"
                >
                  Save
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditingCompletionMode(false)}
                >
                  Cancel
                </Button>
              </div>
            ))}
          </div>
          <div className="p-4">
            {editingCompletionMode ? (
              <div className="space-y-2">
                {([
                  { value: 'any_can_complete', label: 'Any assignee can complete' },
                  { value: 'all_must_complete', label: 'All assignees must complete' },
                ] as const).map((opt) => {
                  const active = completionModeDraft === opt.value
                  return (
                    <label
                      key={opt.value}
                      className={[
                        'flex items-center gap-2.5 rounded-control border px-3 py-2.5 cursor-pointer outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-primary-ring transition-colors',
                        active ? 'border-primary bg-primary-subtle' : 'border-border-light bg-surface hover:border-border',
                      ].join(' ')}
                    >
                      <input
                        type="radio"
                        name="completion_mode"
                        value={opt.value}
                        checked={active}
                        onChange={() => setCompletionModeDraft(opt.value)}
                        className="accent-primary"
                      />
                      <span className={`text-body font-medium ${active ? 'text-primary-text' : 'text-text-primary'}`}>{opt.label}</span>
                    </label>
                  )
                })}
              </div>
            ) : (
              <p className="text-body font-medium text-text-primary">
                {task.completion_mode === 'all_must_complete'
                  ? 'All assignees must complete'
                  : 'Any assignee can complete'}
              </p>
            )}
          </div>
        </div>
  )
}
