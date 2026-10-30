'use client'

import React from 'react'
import { ChevronRight, Plus } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { useToast } from '@/components/ui/Toast'
import { PermissionTooltip } from '@/components/ui/permission-tooltip'
import { meetingsApi } from '@/lib/api/meetings'
import { apiErrorMessage } from '@/lib/tasks/api-error'
import { fmtDate } from '@/lib/phone-format'
import type { Meeting } from '@/lib/types/meetings'
import { PhoneSheet } from '../PhoneSheet'
import { PhoneButton, PhoneField, PHONE_INPUT, ROW, ROW_BLOCK, cx } from '../primitives'
import { ConfirmSheet, EDIT_REASON, PersonField, useMeetingPeople } from './meetingShared'

/*
 * Decisions - the computer's DecisionsTab (meetings/[meetingId]/page.tsx
 * 491-527): log a decision (text, owner, one-line reason of at most 280
 * characters) and delete one. Both stop when the meeting is closed or
 * cancelled (line 497). The computer cannot edit a decision, so neither can this.
 */
export function MeetingDecisionsSection({
  orgId,
  meeting,
  locked,
  canEdit,
  onChanged,
}: {
  orgId: string
  meeting: Meeting
  locked: boolean
  canEdit: boolean
  onChanged: (m: Meeting) => void
}) {
  const { addToast } = useToast()
  const { user } = useAuth()
  const decisions = meeting.decisions ?? []
  const [mode, setMode] = React.useState<{ id: string | null } | null>(null)
  const [decision, setDecision] = React.useState('')
  const [owner, setOwner] = React.useState('')
  const [reason, setReason] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const { people, loading, failed, retry } = useMeetingPeople(user?.organizationId ?? orgId, mode !== null || decisions.length > 0)
  const nameOf = (id: string | null) => (id ? people.find((p) => p.user_id === id)?.name ?? 'Owner' : null)
  const viewing = mode?.id ? decisions.find((d) => d.id === mode.id) ?? null : null

  async function run(fn: () => Promise<Meeting>, ok: string): Promise<boolean> {
    setBusy(true)
    setError(null)
    try {
      onChanged(await fn())
      addToast(ok, 'success')
      return true
    } catch (e) {
      const msg = apiErrorMessage(e, 'Could not do that. Try again.')
      setError(msg)
      addToast(msg, 'error')
      return false
    } finally {
      setBusy(false)
    }
  }

  function openAdd() {
    setDecision('')
    setOwner('')
    setReason('')
    setError(null)
    setMode({ id: null })
  }

  async function add() {
    if (!decision.trim()) {
      setError('Enter the decision.')
      return
    }
    const ok = await run(
      () => meetingsApi.addDecision(orgId, meeting.id, { decision: decision.trim(), owner_user_id: owner || undefined, reason: reason || undefined }),
      'Decision logged',
    )
    if (ok) setMode(null)
  }

  async function remove() {
    if (!viewing) return
    const ok = await run(() => meetingsApi.deleteDecision(orgId, meeting.id, viewing.id), 'Decision deleted')
    if (ok) {
      setConfirmDelete(false)
      setMode(null)
    }
  }

  return (
    <section className="flex flex-col gap-[8px]">
      <h3 className="text-label font-medium text-text-secondary">Decisions · {decisions.length}</h3>
      <div className={ROW_BLOCK}>
        {decisions.length === 0 ? <p className="px-[16px] py-[12px] text-body text-text-secondary">No decisions logged.</p> : null}
        {decisions.map((d) => (
          <button key={d.id} type="button" className={ROW} onClick={() => { setError(null); setMode({ id: d.id }) }}>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body font-medium text-text-primary">{d.decision}</span>
              <span className="block truncate text-meta text-text-secondary">
                {nameOf(d.owner_user_id) ? `${nameOf(d.owner_user_id)} · ` : ''}
                {fmtDate(d.decided_on)}
              </span>
            </span>
            <ChevronRight aria-hidden className="size-[18px] shrink-0 text-text-secondary" />
          </button>
        ))}
        {!locked ? (
          <div className="[&>span]:flex [&>span]:w-full">
            <PermissionTooltip allowed={canEdit} reason={EDIT_REASON}>
              <button type="button" disabled={!canEdit} className={cx(ROW, 'text-primary-text disabled:text-text-secondary disabled:cursor-not-allowed')} onClick={openAdd}>
                <Plus aria-hidden className="size-[18px]" /> Log a decision
              </button>
            </PermissionTooltip>
          </div>
        ) : null}
      </div>

      <PhoneSheet
        open={mode !== null}
        onOpenChange={(o) => !o && setMode(null)}
        title={viewing ? 'Decision' : 'Log a decision'}
        footer={
          viewing ? undefined : (
            <PhoneButton variant="primary" loading={busy} onClick={() => void add()}>
              Log decision
            </PhoneButton>
          )
        }
      >
        {viewing ? (
          <div className="flex flex-col gap-[16px]">
            <dl className="flex flex-col gap-[12px]">
              <div>
                <dt className="text-meta text-text-secondary">Decision</dt>
                <dd className="whitespace-pre-wrap text-body text-text-primary">{viewing.decision}</dd>
              </div>
              <div>
                <dt className="text-meta text-text-secondary">Owner</dt>
                <dd className="text-body text-text-primary">{nameOf(viewing.owner_user_id) ?? 'None'}</dd>
              </div>
              <div>
                <dt className="text-meta text-text-secondary">Decided on</dt>
                <dd className="text-body text-text-primary">{fmtDate(viewing.decided_on)}</dd>
              </div>
              {viewing.reason ? (
                <div>
                  <dt className="text-meta text-text-secondary">Reason</dt>
                  <dd className="text-body text-text-primary">{viewing.reason}</dd>
                </div>
              ) : null}
            </dl>
            {!locked ? (
              <div className="[&>span]:flex [&>span]:w-full">
                <PermissionTooltip allowed={canEdit} reason={EDIT_REASON}>
                  <PhoneButton fullWidth disabled={!canEdit} className="border-danger text-danger active:bg-danger-bg" onClick={() => setConfirmDelete(true)}>
                    Delete decision
                  </PhoneButton>
                </PermissionTooltip>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col gap-[16px]">
            <PhoneField label="Decision" htmlFor="dc-text" required error={error}>
              <textarea id="dc-text" value={decision} onChange={(e) => setDecision(e.target.value)} rows={3} maxLength={1000} aria-invalid={error ? true : undefined} className={`${PHONE_INPUT} min-h-[88px] py-[10px]`} />
            </PhoneField>
            <PersonField label="Owner" htmlFor="dc-owner" value={owner} onChange={setOwner} people={people} loading={loading} failed={failed} onRetry={retry} placeholder="Nobody yet" />
            <PhoneField label="One-line reason" htmlFor="dc-reason">
              <input id="dc-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={280} className={PHONE_INPUT} />
            </PhoneField>
          </div>
        )}
      </PhoneSheet>

      <ConfirmSheet
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete decision"
        body="This removes the decision from the meeting record."
        confirmLabel="Delete"
        busy={busy}
        destructive
        onConfirm={() => void remove()}
      />
    </section>
  )
}
