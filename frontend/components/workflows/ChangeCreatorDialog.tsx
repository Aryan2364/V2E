'use client'

import React, { useEffect, useState } from 'react'
import { UserCog } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import StyledSelect from '@/components/ui/StyledSelect'
import { useToast } from '@/components/ui/Toast'
import { workflowsApi, workflowErrorMessage } from '@/lib/api/workflows'
import type { OrgMemberOption, PersonRef, WorkflowTemplate } from '@/lib/types/workflows'
import { BTN, ErrorBanner, InfoTip } from './shared'

/**
 * Admins only: hand the creator role — the permanent editor no one can remove — to another
 * active member (e.g. when the creator leaves). The server records who changed it.
 */
export default function ChangeCreatorDialog({
  orgId,
  open,
  workflow,
  current,
  members,
  membersLoading,
  onClose,
  onChanged,
}: {
  orgId: string
  open: boolean
  workflow: Pick<WorkflowTemplate, 'id' | 'name'>
  current: PersonRef | null
  /** Active members of the organisation. */
  members: OrgMemberOption[]
  membersLoading: boolean
  onClose: () => void
  onChanged: (updated: WorkflowTemplate | null) => void
}) {
  const { addToast } = useToast()
  const [picked, setPicked] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setPicked('')
      setError(null)
      setBusy(false)
    }
  }, [open])

  const options = members.filter((m) => m.user_id !== current?.id).map((m) => ({ value: m.user_id, label: m.email ? `${m.name} · ${m.email}` : m.name }))
  const pickedName = members.find((m) => m.user_id === picked)?.name

  async function save(e?: React.FormEvent) {
    e?.preventDefault()
    if (!picked || busy) return
    setBusy(true)
    setError(null)
    try {
      const updated = await workflowsApi.changeCreator(orgId, workflow.id, picked)
      addToast(`${pickedName ?? 'The new creator'} is now the creator of “${workflow.name}”`, 'success')
      onChanged(updated && typeof updated === 'object' && 'id' in updated ? updated : null)
    } catch (err) {
      setError(workflowErrorMessage(err, 'The creator could not be changed. Try again.'))
      setBusy(false)
    }
  }

  return (
    <Modal isOpen={open} onClose={() => !busy && onClose()} title="Change creator" size="md" closeOnEscape={!busy}>
      <form onSubmit={save} className="flex flex-col gap-5">
        <p className="text-[15px] text-[#1E293B] leading-relaxed">
          The creator of <span className="font-semibold text-[#0F172A]">{workflow.name}</span> is always an editor and can’t be removed.
          {current ? (
            <>
              {' '}
              Now: <span className="font-semibold text-[#0F172A]">{current.name}</span>.
            </>
          ) : null}
        </p>

        <div>
          <span id="new-creator-label" className="block text-sm font-medium text-[#374151] mb-2">
            New creator <span className="text-[#DC2626]">*</span>{' '}
            <InfoTip label="New creator" text="Only active members can be chosen. The previous creator stays an editor until someone removes them." />
          </span>
          <div aria-labelledby="new-creator-label">
            <StyledSelect
              value={picked}
              onChange={setPicked}
              options={options}
              placeholder={membersLoading ? 'Loading people…' : 'Choose a person'}
              disabled={busy || membersLoading}
              searchable
              searchPlaceholder="Search people…"
            />
          </div>
        </div>

        {error && <ErrorBanner message={error} />}

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-1">
          <button type="button" onClick={onClose} disabled={busy} className={BTN.quiet}>
            Cancel
          </button>
          <button type="submit" disabled={busy || !picked} className={BTN.primary}>
            <UserCog size={16} />
            {busy ? 'Saving…' : 'Change creator'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
