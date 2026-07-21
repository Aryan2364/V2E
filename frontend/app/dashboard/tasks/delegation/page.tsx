'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Lock, ArrowRightLeft, User, CalendarClock, Target } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { usePermissions } from '@/lib/auth/use-permissions'
import { useEntitlements } from '@/lib/auth/use-entitlements'
import { getEmployees } from '@/lib/api/employees'
import { delegationsApi, type Delegation, type DelegationView } from '@/lib/api/delegations'
import DelegationModal from '@/components/delegation/DelegationModal'
import DelegationDetailModal from '@/components/delegation/DelegationDetailModal'
import { StatusPill, fmtDate } from '@/components/delegation/delegationUtils'

interface EmployeeOption {
  user_id: string
  name: string
  role_title?: string | null
  department_name?: string | null
}

const TAB_META: Record<DelegationView, { label: string; empty: string }> = {
  all: { label: 'All', empty: 'No delegations in your organization yet.' },
  mine: { label: 'Delegated by me', empty: 'You haven’t delegated anything yet.' },
  incoming: { label: 'Delegated to me', empty: 'Nothing has been delegated to you yet.' },
}

function DelegationCard({ d, onClick }: { d: Delegation; onClick: () => void }) {
  const metCount = d.criteria.filter((c) => c.is_met).length
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left bg-white border border-[#E2E8F0] rounded-[12px] p-4 hover:border-[#CBD5E1] hover:shadow-[0_1px_3px_rgba(0,0,0,0.08)] transition-all flex flex-col gap-3"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-[15px] font-semibold text-[#0F172A] leading-snug line-clamp-2">{d.title}</h3>
        <StatusPill status={d.status} />
      </div>
      <p className="text-sm text-[#475569] line-clamp-2">{d.outcome}</p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-[#64748B] mt-auto pt-1">
        <span className="inline-flex items-center gap-1.5">
          <User size={13} className="text-[#94A3B8]" />
          {d.owner?.name ?? 'Unknown'}
        </span>
        {d.first_check_in && (
          <span className="inline-flex items-center gap-1.5">
            <CalendarClock size={13} className="text-[#94A3B8]" />
            {fmtDate(d.first_check_in)}
          </span>
        )}
        {d.criteria.length > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <Target size={13} className="text-[#94A3B8]" />
            {metCount}/{d.criteria.length}
          </span>
        )}
      </div>
    </button>
  )
}

export default function DelegationPage() {
  const { user } = useAuth()
  const { isAdmin, can, loading: permsLoading } = usePermissions()
  // Both governed by the real Access Rights system (admins hold them implicitly):
  //   write  = who may delegate (create)   ·   delete = who may remove one.
  const canDelegate = can('delegation.delegation.manage', 'write')
  const canDelete = can('delegation.delegation.manage', 'delete')
  const { entitlements, loading: entLoading } = useEntitlements()
  const orgId = user?.organizationId ?? ''

  const [view, setView] = useState<DelegationView>('mine')
  const [lists, setLists] = useState<Record<string, Delegation[]>>({})
  const [employees, setEmployees] = useState<EmployeeOption[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Delegation | null>(null)
  const [detail, setDetail] = useState<Delegation | null>(null)

  // ── "Delegated to me" (incoming) intentionally hidden — 2026-07-20 ────────────
  // Manager's call: the incoming/tracking view is too much oversight for now. We
  // keep ALL the code — the backend `GET .../delegations?view=incoming` still works
  // and DelegationView still includes 'incoming' — and merely stop surfacing it, so
  // switching it back on later is a tiny change. TO RESTORE the recipient view:
  //   1) add 'incoming' back into `tabs` (below) and into `load()`'s `views`, and
  //   2) relax the `canDelegate` page gate further down so owners can open the page.
  // Because incoming is hidden, a pure recipient has nothing to see here, so the
  // whole Delegation area is limited to people who can delegate (see the nav gate in
  // TaskModuleSidebar.tsx, and the page gate below).
  const tabs: DelegationView[] = useMemo(() => {
    const t: DelegationView[] = []
    if (isAdmin) t.push('all')
    t.push('mine')
    // t.push('incoming') // ← hidden per the note above; re-add to restore the tab
    return t
  }, [isAdmin])

  // Keep the active tab valid (admins may sit on "all"; delegators on "by me").
  useEffect(() => {
    if (!tabs.includes(view)) setView('mine')
  }, [tabs, view])

  const enabled = entitlements ? entitlements['delegation'] !== 'off' : true

  const load = useCallback(async () => {
    if (!orgId || !enabled) return
    setLoading(true)
    try {
      // 'incoming' omitted — the "Delegated to me" view is hidden (see note above).
      const views: DelegationView[] = isAdmin ? ['all', 'mine'] : ['mine']
      const results = await Promise.all(views.map((v) => delegationsApi.list(orgId, v).catch(() => [])))
      const next: Record<string, Delegation[]> = {}
      views.forEach((v, i) => (next[v] = results[i]))
      setLists(next)
    } finally {
      setLoading(false)
    }
  }, [orgId, enabled, isAdmin])

  useEffect(() => {
    if (!orgId || !enabled) return
    getEmployees(orgId)
      .then((emps) =>
        setEmployees(
          (emps as any[]).map((e) => ({
            user_id: e.user_id,
            name: e.user?.name ?? e.name ?? e.email ?? 'Unknown',
            role_title: e.role?.title ?? e.role?.name ?? null,
            department_name: e.department?.name ?? null,
          })),
        ),
      )
      .catch(() => setEmployees([]))
    load()
  }, [orgId, enabled, load])

  // Keep the open detail card in sync after an edit/toggle/lifecycle change.
  function applyChange(updated: Delegation) {
    setLists((prev) => {
      const next: Record<string, Delegation[]> = {}
      for (const [k, arr] of Object.entries(prev)) {
        next[k] = arr.map((d) => (d.id === updated.id ? updated : d))
      }
      return next
    })
    setDetail((cur) => (cur && cur.id === updated.id ? updated : cur))
    // A status change can move an item in/out of tabs — refresh in the background.
    load()
  }

  function canManage(d: Delegation): boolean {
    return isAdmin || d.created_by_user_id === user?.id
  }

  if ((entLoading && !entitlements) || permsLoading) return null

  if (!enabled) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="w-16 h-16 rounded-full bg-[#F1F5F9] flex items-center justify-center mb-4">
          <Lock size={26} className="text-[#94A3B8]" />
        </div>
        <h1 className="text-[18px] font-semibold text-[#0F172A] mb-1">Delegation isn’t enabled</h1>
        <p className="text-sm text-[#475569] max-w-sm">
          This module isn’t part of your organization’s plan yet. Contact your administrator to have it turned on.
        </p>
      </div>
    )
  }

  // Delegation is a delegators-only tool while the "Delegated to me" view is hidden
  // (see the note near `tabs`). A user who can't delegate has nothing to see, so we
  // gate the whole page — matching the hidden nav entry. Loosen this when incoming
  // is restored so recipients (owners) can open the page again.
  if (!canDelegate) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="w-16 h-16 rounded-full bg-[#F1F5F9] flex items-center justify-center mb-4">
          <Lock size={26} className="text-[#94A3B8]" />
        </div>
        <h1 className="text-[18px] font-semibold text-[#0F172A] mb-1">Delegation isn’t available to you</h1>
        <p className="text-sm text-[#475569] max-w-sm">
          You don’t have permission to delegate. Contact your administrator if you need it.
        </p>
      </div>
    )
  }

  const current = lists[view] ?? []

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3 shrink-0">
        <div>
          <h1 className="text-[28px] font-bold text-[#0F172A]">Delegation</h1>
          <p className="text-sm text-[#475569] mt-0.5">Hand off outcomes and track them to a clear finish.</p>
        </div>
        {canDelegate && (
          <button
            type="button"
            onClick={() => {
              setEditing(null)
              setModalOpen(true)
            }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-[8px] text-sm font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] transition-colors"
          >
            <Plus size={16} /> New delegation
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-[#E2E8F0] mt-5 shrink-0">
        {tabs.map((t) => {
          const active = view === t
          const count = (lists[t] ?? []).length
          return (
            <button
              key={t}
              type="button"
              onClick={() => setView(t)}
              className={[
                'relative flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors',
                active ? 'text-[#2563EB]' : 'text-[#64748B] hover:text-[#0F172A]',
              ].join(' ')}
            >
              {TAB_META[t].label}
              {count > 0 && (
                <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-[999px] bg-[#2563EB] text-white text-[11px] font-semibold">
                  {count}
                </span>
              )}
              {active && <span className="absolute bottom-0 left-2 right-2 h-[2px] bg-[#2563EB] rounded-t-full" />}
            </button>
          )
        })}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto py-5">
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-40 rounded-[12px] bg-[#F1F5F9] animate-pulse" />
            ))}
          </div>
        ) : current.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-full bg-[#EFF6FF] flex items-center justify-center mb-4">
              <ArrowRightLeft size={28} className="text-[#2563EB]" />
            </div>
            <h2 className="text-[18px] font-semibold text-[#0F172A] mb-1">{TAB_META[view].empty}</h2>
            <p className="text-sm text-[#475569] max-w-xs">
              {canDelegate
                ? 'Create a delegation to hand an outcome to someone with clear success criteria.'
                : 'Delegations others hand to you will appear here.'}
            </p>
            {canDelegate && (
              <button
                type="button"
                onClick={() => {
                  setEditing(null)
                  setModalOpen(true)
                }}
                className="mt-5 flex items-center gap-2 px-5 py-2.5 rounded-[8px] text-sm font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] transition-colors"
              >
                <Plus size={16} /> New delegation
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {current.map((d) => (
              <DelegationCard key={d.id} d={d} onClick={() => setDetail(d)} />
            ))}
          </div>
        )}
      </div>

      {/* Create / edit modal */}
      <DelegationModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        orgId={orgId}
        employees={employees}
        currentUser={user ? { user_id: user.id, name: user.name } : undefined}
        existing={editing}
        onSaved={() => load()}
      />

      {/* Detail modal */}
      {detail && (
        <DelegationDetailModal
          isOpen={!!detail}
          onClose={() => setDetail(null)}
          orgId={orgId}
          delegation={detail}
          canManage={canManage(detail)}
          canDelete={canDelete}
          onChanged={applyChange}
          onDeleted={() => load()}
          onEdit={() => {
            setEditing(detail)
            setDetail(null)
            setModalOpen(true)
          }}
        />
      )}
    </div>
  )
}
