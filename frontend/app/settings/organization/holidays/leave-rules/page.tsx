'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Save, Search, Info } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { useToast } from '@/components/ui/Toast'
import { leaveApi } from '@/lib/api/leave'
import { getEmployees } from '@/lib/api/employees'
import type { LeaveApprovalMode, LeaveMaster } from '@/lib/types/leave'

interface Person {
  user_id: string
  name: string
}

const MODES: { value: LeaveApprovalMode; label: string; hint: string }[] = [
  { value: 'self_mark', label: 'Self-mark (no approval)', hint: 'Employees book their own leave; it is approved automatically.' },
  { value: 'manager', label: 'Reporting manager', hint: 'Leave goes to the employee’s reporting manager.' },
  { value: 'approvers', label: 'Named approver(s)', hint: 'Leave goes to the people you choose below.' },
  { value: 'manager_or_approvers', label: 'Manager or named approver(s)', hint: 'Either the reporting manager or a named approver may decide.' },
]

function Toggle({ on, onChange }: { on: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      onClick={onChange}
      role="switch"
      aria-checked={on}
      className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${on ? 'bg-primary' : 'bg-surface-control-pressed'}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-surface shadow-xs transition-transform ${on ? 'translate-x-4' : 'translate-x-0'}`} />
    </button>
  )
}

function Card({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface border border-border-light rounded-card shadow-card p-4 space-y-4">
      <div>
        <h3 className="text-body font-medium text-text-primary">{title}</h3>
        {description && <p className="text-label text-text-secondary mt-0.5 leading-relaxed">{description}</p>}
      </div>
      {children}
    </div>
  )
}

function UserMultiSelect({ people, selected, onToggle }: { people: Person[]; selected: string[]; onToggle: (id: string) => void }) {
  const [q, setQ] = useState('')
  const filtered = useMemo(() => people.filter((p) => p.name.toLowerCase().includes(q.toLowerCase())), [people, q])
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="relative border-b border-border-light">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search people…"
          className="w-full pl-8 pr-3 py-2 text-body text-text-primary placeholder:text-text-muted focus:outline-hidden"
        />
      </div>
      <div className="max-h-48 overflow-y-auto divide-y divide-surface-control">
        {filtered.length === 0 && <p className="px-3 py-3 text-meta text-text-muted">No people found.</p>}
        {filtered.map((p) => {
          const on = selected.includes(p.user_id)
          return (
            <button
              key={p.user_id}
              type="button"
              onClick={() => onToggle(p.user_id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-body transition-colors ${on ? 'bg-primary-subtle' : 'hover:bg-surface-sunken'}`}
            >
              <span className={`w-4 h-4 rounded-[4px] border flex items-center justify-center shrink-0 ${on ? 'bg-primary border-primary' : 'border-border'}`}>
                {on && <span className="text-white text-meta leading-none">✓</span>}
              </span>
              <span className="text-text-primary">{p.name}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default function LeaveRulesPage() {
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''
  const { addToast } = useToast()

  const [master, setMaster] = useState<LeaveMaster | null>(null)
  const [people, setPeople] = useState<Person[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!orgId) return
    const [m, emps] = await Promise.all([
      leaveApi.getMaster(orgId),
      getEmployees(orgId).catch(() => []),
    ])
    setMaster(m)
    setPeople(emps.map((e) => ({ user_id: e.user_id, name: e.user?.name ?? 'Unknown' })))
  }, [orgId])

  useEffect(() => {
    setLoading(true)
    load().catch(() => addToast('Could not load leave rules', 'error')).finally(() => setLoading(false))
  }, [load, addToast])

  if (loading || !master) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const patch = (p: Partial<LeaveMaster>) => setMaster({ ...master, ...p })
  const showApprovers = master.approval_mode === 'approvers' || master.approval_mode === 'manager_or_approvers'
  const showAnyOne = showApprovers || master.approval_mode === 'manager_or_approvers'

  async function save() {
    if (!master) return
    setSaving(true)
    try {
      const saved = await leaveApi.updateMaster(orgId, {
        approval_mode: master.approval_mode,
        approver_user_ids: master.approver_user_ids,
        any_one_can_approve: master.any_one_can_approve,
        allow_override: master.allow_override,
        recurring_notice_days: master.recurring_notice_days,
      })
      setMaster(saved)
      addToast('Leave rules saved', 'success')
    } catch (e: any) {
      const m = e?.response?.data?.message ?? 'Could not save leave rules'
      addToast(Array.isArray(m) ? m.join(', ') : m, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-start gap-2 rounded-card border border-primary-border bg-primary-subtle p-4 text-body text-text-primary">
        <Info size={16} className="text-primary-text shrink-0 mt-0.5" />
        <p>
          These rules govern how employees apply for leave from <span className="font-medium">My Profile → Leave</span>, and approvers decide requests under <span className="font-medium">Work → Leave Approvals</span>.
          Leave makes a person show as <span className="font-medium">on leave</span> on the chosen dates regardless of approval — approval is for governance.
          On-leave employees still appear in the assignee picker; only <span className="font-medium">inactive</span> employees are hidden.
        </p>
      </div>

      <Card title="Who approves leave" description="Choose how a leave request is routed. There is no fixed HR role, so name the approvers explicitly when needed.">
        <div className="space-y-2">
          {MODES.map((m) => (
            <label key={m.value} className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="radio"
                name="approval_mode"
                checked={master.approval_mode === m.value}
                onChange={() => patch({ approval_mode: m.value })}
                className="accent-primary mt-0.5"
              />
              <span>
                <span className="text-body font-medium text-text-primary">{m.label}</span>
                <span className="block text-meta text-text-secondary">{m.hint}</span>
              </span>
            </label>
          ))}
        </div>

        {showApprovers && (
          <div>
            <label className="block text-meta font-medium text-text-secondary mb-2">Named approvers</label>
            <UserMultiSelect
              people={people}
              selected={master.approver_user_ids}
              onToggle={(id) =>
                patch({
                  approver_user_ids: master.approver_user_ids.includes(id)
                    ? master.approver_user_ids.filter((x) => x !== id)
                    : [...master.approver_user_ids, id],
                })
              }
            />
          </div>
        )}

        {showAnyOne && (
          <div className="flex items-center justify-between gap-4">
            <span className="text-body text-text-primary">Any one approver can decide (vs. requiring all)</span>
            <Toggle on={master.any_one_can_approve} onChange={() => patch({ any_one_can_approve: !master.any_one_can_approve })} />
          </div>
        )}
      </Card>

      <Card title="Unplanned leave & overrides" description="Allows an employee to declare leave directly (e.g. a sick day) and to take leave even after a rejection. The leave is flagged so approvers can see it.">
        <div className="flex items-center justify-between gap-4">
          <span className="text-body text-text-primary">Allow self-declared leave and override of a rejection</span>
          <Toggle on={master.allow_override} onChange={() => patch({ allow_override: !master.allow_override })} />
        </div>
      </Card>

      <Card title="Recurring task warnings" description="For recurring tasks, warn the task’s creator in advance when an assignee will be on leave on an upcoming occurrence.">
        <div className="flex items-center gap-3">
          <label className="text-body text-text-primary">Notify</label>
          <input
            type="number"
            min={0}
            max={60}
            value={master.recurring_notice_days}
            onChange={(e) => patch({ recurring_notice_days: Math.max(0, Math.min(60, Number(e.target.value) || 0)) })}
            className="w-20 border border-border rounded-lg px-3 py-2 text-body text-text-primary focus:border-2 focus:border-primary focus:outline-hidden bg-surface"
          />
          <span className="text-body text-text-primary">day(s) before the occurrence</span>
        </div>
      </Card>

      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="flex items-center gap-2 px-4 py-[10px] text-body font-medium text-white bg-primary rounded-lg hover:bg-primary-hover disabled:bg-surface-control-pressed disabled:text-text-muted transition-colors"
      >
        {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
        {saving ? 'Saving…' : 'Save leave rules'}
      </button>
    </div>
  )
}
