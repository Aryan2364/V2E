'use client'

import React, { useCallback, useState } from 'react'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import { workflowsApi, workflowErrorMessage } from '@/lib/api/workflows'
import type { WorkflowTemplate } from '@/lib/types/workflows'
import StartWorkflowModal from './StartWorkflowModal'

type Target = Pick<WorkflowTemplate, 'id' | 'name' | 'steps'>

type ChangeKind = 'archived' | 'restored' | 'paused' | 'resumed'

/**
 * Start / pause / resume / archive / restore for a workflow, shared by the list, My
 * Workflows, the workflow page and the builder so they behave identically. Render
 * `dialogs` once.
 */
export function useWorkflowActions(orgId: string, onChanged: (change: { id: string; kind: ChangeKind; workflow?: WorkflowTemplate }) => void) {
  const { addToast } = useToast()
  const [startTarget, setStartTarget] = useState<Target | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<Target | null>(null)
  const [archiving, setArchiving] = useState(false)
  const [archiveError, setArchiveError] = useState<string | null>(null)

  const start = useCallback((w: Target) => setStartTarget(w), [])
  const archive = useCallback((w: Target) => {
    setArchiveError(null)
    setArchiveTarget(w)
  }, [])

  const restore = useCallback(
    async (w: Target) => {
      try {
        const updated = await workflowsApi.restoreWorkflow(orgId, w.id)
        addToast(`“${w.name}” restored as a draft`, 'success')
        onChanged({ id: w.id, kind: 'restored', workflow: updated && typeof updated === 'object' && 'id' in updated ? updated : undefined })
      } catch (e) {
        addToast(workflowErrorMessage(e, 'The workflow could not be restored. Try again.'), 'error')
      }
    },
    [orgId, addToast, onChanged],
  )

  /** Pause (Live → Paused) or resume (Paused → Live) — immediate, with a toast. */
  const setPaused = useCallback(
    async (w: Target, pause: boolean) => {
      try {
        const updated = pause ? await workflowsApi.pauseWorkflow(orgId, w.id) : await workflowsApi.resumeWorkflow(orgId, w.id)
        addToast(
          pause ? `“${w.name}” paused. Runs in progress continue.` : `“${w.name}” resumed`,
          'success',
        )
        onChanged({ id: w.id, kind: pause ? 'paused' : 'resumed', workflow: updated && typeof updated === 'object' && 'id' in updated ? updated : undefined })
      } catch (e) {
        addToast(workflowErrorMessage(e, pause ? 'The workflow could not be paused. Try again.' : 'The workflow could not be resumed. Try again.'), 'error')
      }
    },
    [orgId, addToast, onChanged],
  )

  async function confirmArchive() {
    if (!archiveTarget) return
    setArchiving(true)
    setArchiveError(null)
    try {
      await workflowsApi.archiveWorkflow(orgId, archiveTarget.id)
      addToast(`“${archiveTarget.name}” archived`, 'success')
      onChanged({ id: archiveTarget.id, kind: 'archived' })
      setArchiveTarget(null)
    } catch (e) {
      setArchiveError(workflowErrorMessage(e, 'The workflow could not be archived. Try again.'))
    } finally {
      setArchiving(false)
    }
  }

  const dialogs = (
    <>
      <StartWorkflowModal orgId={orgId} workflow={startTarget} onClose={() => setStartTarget(null)} />
      <ConfirmDialog
        open={!!archiveTarget}
        title={`Archive “${archiveTarget?.name ?? ''}”?`}
        message="No new runs will start. Runs in progress continue. You can restore it later."
        confirmLabel="Archive workflow"
        danger
        loading={archiving}
        error={archiveError}
        onConfirm={confirmArchive}
        onCancel={() => !archiving && setArchiveTarget(null)}
      />
    </>
  )

  return { start, archive, restore, pause: (w: Target) => setPaused(w, true), resume: (w: Target) => setPaused(w, false), dialogs }
}
