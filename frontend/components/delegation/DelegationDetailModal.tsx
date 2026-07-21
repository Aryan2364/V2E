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
        <div className="flex flex-col gap-5">
          {/* Status + owner line */}
          <div className="flex flex-wrap items-center gap-3">
            <StatusPill status={delegation.status} />
            <span className="inline-flex items-center gap-1.5 text-sm text-[#475569]">
              <User size={14} className="text-[#94A3B8]" />
              Owner: <span className="font-medium text-[#0F172A]">{delegation.owner?.name ?? 'Unknown'}</span>
            </span>
            <span className="text-sm text-[#94A3B8]">·</span>
            <span className="text-sm text-[#475569]">
              By <span className="font-medium text-[#0F172A]">{delegation.created_by?.name ?? 'Unknown'}</span>
            </span>
          </div>

          {/* Outcome */}
          <section>
            <h4 className="text-xs font-semibold text-[#64748B] uppercase tracking-wider mb-1">Outcome</h4>
            <p className="text-[15px] text-[#1E293B] whitespace-pre-wrap">{delegation.outcome}</p>
          </section>

          {/* KRA */}
          {delegation.kra && (
            <section>
              <h4 className="text-xs font-semibold text-[#64748B] uppercase tracking-wider mb-1">KRA</h4>
              <p className="text-[15px] text-[#1E293B] whitespace-pre-wrap">{delegation.kra}</p>
            </section>
          )}

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-[10px] border border-[#E2E8F0] p-3">
              <p className="text-xs font-semibold text-[#64748B] uppercase tracking-wider mb-1">Fully running by</p>
              <p className="text-sm font-medium text-[#0F172A] flex items-center gap-1.5">
                <CalendarClock size={14} className="text-[#94A3B8]" />
                {fmtDate(delegation.running_by)}
              </p>
            </div>
            <div className="rounded-[10px] border border-[#E2E8F0] p-3">
              <p className="text-xs font-semibold text-[#64748B] uppercase tracking-wider mb-1">First check-in</p>
              <p className="text-sm font-medium text-[#0F172A] flex items-center gap-1.5">
                <CalendarClock size={14} className="text-[#94A3B8]" />
                {fmtDate(delegation.first_check_in)}
              </p>
            </div>
          </div>

          {/* Success criteria */}
          {delegation.criteria.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-semibold text-[#64748B] uppercase tracking-wider">Success criteria</h4>
                <span className="text-xs font-medium text-[#475569]">
                  {metCount}/{delegation.criteria.length} met
                </span>
              </div>
              <ul className="flex flex-col gap-1.5">
                {delegation.criteria.map((c) => (
                  <li key={c.id} className="flex items-start gap-2.5">
                    <button
                      type="button"
                      onClick={() => toggleCriterion(c.id, !c.is_met)}
                      disabled={!isActive}
                      className="mt-0.5 shrink-0 disabled:cursor-not-allowed"
                      title={c.is_met ? 'Mark not met' : 'Mark met'}
                    >
                      {c.is_met ? (
                        <CheckCircle2 size={18} className="text-[#16A34A]" />
                      ) : (
                        <Circle size={18} className="text-[#CBD5E1]" />
                      )}
                    </button>
                    <div className="min-w-0">
                      <p className={`text-sm ${c.is_met ? 'text-[#94A3B8] line-through' : 'text-[#1E293B]'}`}>
                        {c.description}
                      </p>
                      {c.target && <p className="text-xs text-[#64748B]">Target: {c.target}</p>}
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
              className="flex items-center gap-2 text-sm font-medium text-[#2563EB] hover:text-[#1D4ED8] transition-colors self-start"
            >
              <CheckSquare size={15} /> Open review task <ExternalLink size={13} />
            </button>
          )}

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-[#F1F5F9]">
            {canManage && isActive && (
              <>
                <button
                  type="button"
                  onClick={onEdit}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-[8px] text-sm font-medium text-[#2563EB] border-2 border-[#2563EB] hover:bg-[#EFF6FF] transition-colors"
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
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-[8px] text-sm font-semibold text-white bg-[#16A34A] hover:bg-[#15803D] disabled:opacity-60 transition-colors"
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
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-[8px] text-sm font-medium text-[#DC2626] hover:bg-[#FEF2F2] transition-colors ml-auto"
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
