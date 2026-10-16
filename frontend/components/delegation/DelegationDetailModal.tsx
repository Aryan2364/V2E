'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  CalendarClock,
  CheckCircle2,
  Circle,
  Pencil,
  Trash2,
  CheckSquare,
  ExternalLink,
  User,
  Loader2,
} from 'lucide-react'
import Modal from '@/components/ui/Modal'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import Tooltip from '@/components/ui/tooltip'
import { useToast } from '@/components/ui/Toast'
import { delegationsApi, type Delegation } from '@/lib/api/delegations'
import { StatusPill, fmtDate } from './delegationUtils'

interface Props {
  isOpen: boolean
  onClose: () => void
  orgId: string
  delegation: Delegation
  /** Delegator or admin — may edit / complete. */
  canManage: boolean
  /** Holds the `delete` permission on the Delegations leaf (Access Rights). */
  canDelete: boolean
  onChanged: (d: Delegation) => void
  onDeleted: (id: string) => void
  onEdit: () => void
}

export default function DelegationDetailModal({
  isOpen,
  onClose,
  orgId,
  delegation,
  canManage,
  canDelete,
  onChanged,
  onDeleted,
  onEdit,
}: Props) {
  const { addToast } = useToast()
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<null | 'delete'>(null)

  const isActive = delegation.status === 'active'
  const metCount = delegation.criteria.filter((c) => c.is_met).length

  async function run(action: () => Promise<Delegation | { success: boolean }>, key: string) {
    setBusy(key)
    try {
      const res = await action()
      if ('id' in (res as Delegation)) onChanged(res as Delegation)
      return res
    } catch (err: any) {
      addToast(err?.response?.data?.message ?? 'Action failed.', 'error')
      throw err
    } finally {
      setBusy(null)
    }
  }

  async function toggleCriterion(cId: string, next: boolean) {
    try {
      const updated = await delegationsApi.toggleCriterion(orgId, delegation.id, cId, next)
      onChanged(updated)
    } catch (err: any) {
      addToast(err?.response?.data?.message ?? 'Could not update criterion.', 'error')
    }
  }

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title={delegation.title} size="lg">
        <div className="flex flex-col gap-4">
          {/* Status + owner line */}
          <div className="flex flex-wrap items-center gap-3">
            <StatusPill status={delegation.status} />
            <span className="inline-flex items-center gap-1.5 text-body text-text-secondary">
              <User size={14} className="text-text-muted" />
              Owner: <span className="font-medium text-text-primary">{delegation.owner?.name ?? 'Unknown'}</span>
            </span>
            <span className="text-body text-text-muted">·</span>
            <span className="text-body text-text-secondary">
              By <span className="font-medium text-text-primary">{delegation.created_by?.name ?? 'Unknown'}</span>
            </span>
          </div>

          {/* Outcome */}
          <section>
            <h4 className="text-meta font-medium text-text-muted uppercase tracking-wider mb-1">Outcome</h4>
            <p className="text-[15px] text-text-primary whitespace-pre-wrap">{delegation.outcome}</p>
          </section>

          {/* KRA */}
          {delegation.kra && (
            <section>
              <h4 className="text-meta font-medium text-text-muted uppercase tracking-wider mb-1">KRA</h4>
              <p className="text-[15px] text-text-primary whitespace-pre-wrap">{delegation.kra}</p>
            </section>
          )}

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-[10px] border border-border-light p-3">
              <p className="text-meta font-medium text-text-muted uppercase tracking-wider mb-1">Fully running by</p>
              <p className="text-body font-medium text-text-primary flex items-center gap-1.5">
                <CalendarClock size={14} className="text-text-muted" />
                {fmtDate(delegation.running_by)}
              </p>
            </div>
            <div className="rounded-[10px] border border-border-light p-3">
              <p className="text-meta font-medium text-text-muted uppercase tracking-wider mb-1">First check-in</p>
              <p className="text-body font-medium text-text-primary flex items-center gap-1.5">
                <CalendarClock size={14} className="text-text-muted" />
                {fmtDate(delegation.first_check_in)}
              </p>
            </div>
          </div>

          {/* Success criteria */}
          {delegation.criteria.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-meta font-medium text-text-muted uppercase tracking-wider">Success criteria</h4>
                <span className="text-meta font-medium text-text-secondary">
                  {metCount}/{delegation.criteria.length} met
                </span>
              </div>
              <ul className="flex flex-col gap-1.5">
                {delegation.criteria.map((c) => (
                  <li key={c.id} className="flex items-start gap-2.5">
                    <Tooltip label={c.is_met ? 'Mark not met' : 'Mark met'}>
                    <button
                      type="button"
                      onClick={() => toggleCriterion(c.id, !c.is_met)}
                      disabled={!isActive}
                      aria-label={c.is_met ? 'Mark not met' : 'Mark met'}
                      className="mt-0.5 shrink-0 disabled:cursor-not-allowed"
                    >
                      {c.is_met ? (
                        <CheckCircle2 size={18} className="text-success" />
                      ) : (
                        <Circle size={18} className="text-muted" />
                      )}
                    </button>
                    </Tooltip>
                    <div className="min-w-0">
                      <p className={`text-body ${c.is_met ? 'text-text-muted line-through' : 'text-text-primary'}`}>
                        {c.description}
                      </p>
                      {c.target && <p className="text-meta text-text-muted">Target: {c.target}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Linked review task */}
          {delegation.review_task_id && (
            <button
              type="button"
              onClick={() => router.push(`/dashboard/tasks/${delegation.review_task_id}`)}
              className="flex items-center gap-2 text-body font-medium text-primary-text hover:text-primary-text transition-colors self-start"
            >
              <CheckSquare size={15} /> Open review task <ExternalLink size={13} />
            </button>
          )}

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-border-light">
            {canManage && isActive && (
              <>
                <button
                  type="button"
                  onClick={onEdit}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-body font-medium text-primary-text border-2 border-primary hover:bg-primary-subtle transition-colors"
                >
                  <Pencil size={14} /> Edit
                </button>
                <button
                  type="button"
                  disabled={busy === 'complete'}
                  onClick={() =>
                    run(() => delegationsApi.complete(orgId, delegation.id), 'complete').then(() =>
                      addToast('Delegation marked complete.', 'success'),
                    )
                  }
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-body font-medium text-primary-foreground bg-success hover:bg-success disabled:opacity-60 transition-colors"
                >
                  {busy === 'complete' ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                  Mark complete
                </button>
              </>
            )}
            {canDelete && (
              <button
                type="button"
                onClick={() => setConfirm('delete')}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-body font-medium text-danger hover:bg-danger-bg transition-colors ml-auto"
              >
                <Trash2 size={14} /> Delete
              </button>
            )}
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirm === 'delete'}
        title="Delete this delegation?"
        message="The delegation record will be permanently removed. The linked review task is left as-is."
        confirmLabel="Delete"
        danger
        loading={busy === 'delete'}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          await run(() => delegationsApi.remove(orgId, delegation.id), 'delete')
          setConfirm(null)
          onDeleted(delegation.id)
          onClose()
          addToast('Delegation deleted.', 'success')
        }}
      />
    </>
  )
}
