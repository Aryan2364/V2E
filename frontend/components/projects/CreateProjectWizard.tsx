'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Loader2, ChevronLeft, X, Search, Check } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { projectsApi } from '@/lib/api/projects'
import { tasksApi } from '@/lib/api/tasks'
import { getNow } from '@/lib/clock'
import TemplatePicker from './TemplatePicker'
import DatePicker from '@/components/ui/DatePicker'
import StyledSelect from '@/components/ui/StyledSelect'
import GoalsMultiSelectField from './GoalsMultiSelectField'
import type { ProjectTemplate } from '@/lib/types/projects'
import type { EligibleAssigneeUser } from '@/lib/types/tasks'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const avatarColors = ['bg-primary', 'bg-text-secondary', 'bg-success', 'bg-warning', 'bg-danger', 'bg-text-secondary']
function avatarColor(name: string): string {
  let h = 0; for (let i = 0; i < name.length; i++) h += name.charCodeAt(i)
  return avatarColors[h % avatarColors.length]
}
function getInitials(name: string): string {
  return name.split(' ').map((n) => n[0] ?? '').join('').toUpperCase().slice(0, 2) || '?'
}

// ─── User search dropdown ─────────────────────────────────────────────────────

function UserSearchDropdown({
  orgId,
  placeholder = 'Search by name…',
  selected,
  onSelect,
  excludeIds = [],
}: {
  orgId: string
  placeholder?: string
  selected: EligibleAssigneeUser | null
  onSelect: (u: EligibleAssigneeUser | null) => void
  excludeIds?: string[]
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<EligibleAssigneeUser[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const fetch = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    setLoading(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await tasksApi.getEligibleAssignees(orgId, q || undefined, 'name')
        const flat = data.departments.flatMap((d) => d.users).filter((u) => !excludeIds.includes(u.user_id))
        setResults(flat)
      } catch { setResults([]) }
      finally { setLoading(false) }
    }, 200)
  }, [orgId, excludeIds.join(',')])  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (open) fetch(query)
  }, [query, open]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  if (selected) {
    return (
      <div className="flex items-center gap-2 h-10 px-3 rounded-[8px] border border-border bg-white">
        <div className={`w-6 h-6 rounded-full ${avatarColor(selected.name)} flex items-center justify-center text-white text-[10px] font-medium shrink-0`}>
          {getInitials(selected.name)}
        </div>
        <span className="text-sm text-text-primary flex-1 truncate">{selected.name}</span>
        <span className="text-xs text-text-muted truncate">{selected.role_title}</span>
        <button
          type="button"
          onClick={() => onSelect(null)}
          className="p-0.5 rounded-xs hover:bg-surface-control text-text-muted hover:text-text-primary transition-colors shrink-0"
        >
          <X size={13} />
        </button>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="w-full h-10 pl-8 pr-3 rounded-[8px] border border-border text-sm text-text-primary placeholder:text-text-muted bg-white focus:border-primary focus:outline-hidden transition-colors"
        />
      </div>
      {open && (
        <div className="absolute z-20 mt-1 w-full bg-surface border border-border-light rounded-lg shadow-menu max-h-48 overflow-y-auto">
          {loading ? (
            <div className="px-4 py-3 text-sm text-text-muted">Searching…</div>
          ) : results.length === 0 ? (
            <div className="px-4 py-3 text-sm text-text-muted">No users found</div>
          ) : results.map((u) => (
            <button
              key={u.user_id}
              type="button"
              onClick={() => { onSelect(u); setQuery(''); setOpen(false) }}
              className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-surface-sunken transition-colors text-left"
            >
              <div className={`w-7 h-7 rounded-full ${avatarColor(u.name)} flex items-center justify-center text-white text-[10px] font-medium shrink-0`}>
                {getInitials(u.name)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text-primary truncate">{u.name}</p>
                <p className="text-xs text-text-muted truncate">{u.role_title} · {u.department_name}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Multi-user search (for members step) ─────────────────────────────────────

function MultiUserSearch({
  orgId,
  excludeIds,
  onAdd,
}: {
  orgId: string
  excludeIds: string[]
  onAdd: (u: EligibleAssigneeUser) => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<EligibleAssigneeUser[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const fetch = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    setLoading(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await tasksApi.getEligibleAssignees(orgId, q || undefined, 'name')
        setResults(data.departments.flatMap((d) => d.users))
      } catch { setResults([]) }
      finally { setLoading(false) }
    }, 200)
  }, [orgId])

  useEffect(() => {
    if (open) fetch(query)
  }, [query, open]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setOpen(true)}
          placeholder="Search team members to add…"
          className="w-full h-10 pl-8 pr-3 rounded-[8px] border border-border text-sm text-text-primary placeholder:text-text-muted bg-white focus:border-primary focus:outline-hidden transition-colors"
        />
      </div>
      {open && (
        <div className="absolute z-20 mt-1 w-full bg-surface border border-border-light rounded-lg shadow-menu max-h-56 overflow-y-auto">
          {loading ? (
            <div className="px-4 py-3 text-sm text-text-muted">Searching…</div>
          ) : results.length === 0 ? (
            <div className="px-4 py-3 text-sm text-text-muted">No users found</div>
          ) : results.map((u) => {
            const already = excludeIds.includes(u.user_id)
            return (
              <button
                key={u.user_id}
                type="button"
                onClick={() => { if (!already) { onAdd(u); setQuery(''); setOpen(false) } }}
                disabled={already}
                className={`w-full flex items-center gap-3 px-3 py-2.5 transition-colors text-left ${already ? 'opacity-50 cursor-not-allowed' : 'hover:bg-surface-sunken'}`}
              >
                <div className={`w-7 h-7 rounded-full ${avatarColor(u.name)} flex items-center justify-center text-white text-[10px] font-medium shrink-0`}>
                  {getInitials(u.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text-primary truncate">{u.name}</p>
                  <p className="text-xs text-text-muted truncate">{u.role_title} · {u.department_name}</p>
                </div>
                {already && <Check size={14} className="text-success shrink-0" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface WizardMember {
  user_id: string
  name: string
  role_title: string
  role: 'manager' | 'editor' | 'viewer'
  task_visibility: 'own_tasks_only' | 'all_member_tasks'
}

interface CreateProjectWizardProps {
  templates: ProjectTemplate[]
}

// ─── Wizard ───────────────────────────────────────────────────────────────────

export default function CreateProjectWizard({ templates }: CreateProjectWizardProps) {
  const { user } = useAuth()
  const router = useRouter()
  const orgId = user?.organizationId ?? ''

  const [step, setStep] = useState(1)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Step 1 fields
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [pmUser, setPmUser] = useState<EligibleAssigneeUser | null>(null)
  const [budget, setBudget] = useState('')
  const [currency, setCurrency] = useState('INR')
  const [templateId, setTemplateId] = useState<string | null>(null)
  const [goalIds, setGoalIds] = useState<string[]>([])

  // Step 2 fields
  const [members, setMembers] = useState<WizardMember[]>([])

  const inputCls = 'w-full h-10 px-3 rounded-[8px] border border-border text-sm text-text-primary placeholder:text-text-muted bg-white focus:border-primary focus:outline-hidden transition-colors'
  const labelCls = 'block text-sm font-medium text-text-secondary mb-1.5'

  const todayStr = getNow().toISOString().split('T')[0]

  function handleDateChange(val: string, setter: (v: string) => void) {
    if (!val) { setter(''); return }
    const year = parseInt(val.split('-')[0], 10)
    if (isNaN(year) || year < 2000 || year > 2100) {
      setter('')
      setError(`Year must be between 2000 and 2100`)
      return
    }
    setError('')
    setter(val)
  }
  // End date must be >= today and >= startDate (whichever is later)
  const endDateMin = startDate && startDate > todayStr ? startDate : todayStr

  // All IDs already in the project (creator + PM + added members)
  const takenIds = [
    ...(user?.id ? [user.id] : []),
    ...(pmUser ? [pmUser.user_id] : []),
    ...members.map((m) => m.user_id),
  ]

  function validateStep1() {
    if (!name.trim()) { setError('Project name is required'); return false }
    if (!pmUser) { setError('Project manager is required'); return false }
    if (startDate && new Date(startDate).getFullYear() < 2000) { setError('Start date cannot be before year 2000'); return false }
    if (startDate && new Date(startDate).getFullYear() > 2100) { setError('Start date year cannot exceed 2100'); return false }
    if (endDate) {
      if (new Date(endDate).getFullYear() > 2100) { setError('End date year cannot exceed 2100'); return false }
      if (endDate < todayStr) { setError('End date must be today or in the future'); return false }
      if (startDate && endDate < startDate) { setError('End date cannot be before start date'); return false }
    }
    if (budget !== '' && Number(budget) < 0) { setError('Budget cannot be negative'); return false }
    setError(''); return true
  }

  function addMember(u: EligibleAssigneeUser) {
    if (members.some((m) => m.user_id === u.user_id)) return
    setMembers((prev) => [...prev, { user_id: u.user_id, name: u.name, role_title: u.role_title, role: 'viewer', task_visibility: 'own_tasks_only' }])
  }

  function updateMember(uid: string, patch: Partial<WizardMember>) {
    setMembers((prev) => prev.map((m) => m.user_id === uid ? { ...m, ...patch } : m))
  }

  function removeMember(uid: string) {
    setMembers((prev) => prev.filter((m) => m.user_id !== uid))
  }

  async function handleCreate() {
    setSaving(true)
    setError('')
    try {
      const project = await projectsApi.create(orgId, {
        name: name.trim(),
        description: description.trim() || undefined,
        project_manager_user_id: pmUser!.user_id,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
        planned_budget: budget ? Number(budget) : undefined,
        currency: currency || 'INR',
        template_id: templateId ?? undefined,
        goal_ids: goalIds.length ? goalIds : undefined,
      })

      await Promise.all(
        members.map((m) =>
          projectsApi.addMember(orgId, project.id, {
            user_id: m.user_id,
            role: m.role,
            task_visibility: m.task_visibility,
          })
        )
      )

      router.push(`/dashboard/projects/${project.id}`)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to create project'
      setError(msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-2xl">
      {/* Steps indicator */}
      <div className="flex items-center gap-3 mb-8">
        {[1, 2].map((s) => (
          <div key={s} className="flex items-center gap-2">
            <div className={['w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium', s === step ? 'bg-primary text-white' : s < step ? 'bg-success-bg text-success' : 'bg-surface-control text-text-muted'].join(' ')}>
              {s}
            </div>
            <span className={`text-sm font-medium ${s === step ? 'text-text-primary' : 'text-text-muted'}`}>
              {s === 1 ? 'Project Setup' : 'Add Members'}
            </span>
            {s < 2 && <div className="w-8 h-px bg-surface-control-pressed" />}
          </div>
        ))}
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-[8px] border border-danger-border bg-danger-bg text-sm text-danger">{error}</div>
      )}

      {step === 1 && (
        <div className="bg-surface border border-border-light rounded-card p-6 shadow-card space-y-4">
          <div>
            <label className={labelCls}>Project name <span className="text-danger">*</span></label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Website Redesign Q3" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Brief description..." rows={3} className="w-full px-3 py-2 rounded-[8px] border border-border text-sm text-text-primary placeholder:text-text-muted bg-white focus:border-primary focus:outline-hidden resize-none" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Start date</label>
              <DatePicker value={startDate} onChange={(iso) => handleDateChange(iso, setStartDate)} min="2000-01-01" max="2100-12-31" placeholder="Select date" />
            </div>
            <div>
              <label className={labelCls}>End date</label>
              <DatePicker value={endDate} onChange={(iso) => handleDateChange(iso, setEndDate)} min={endDateMin} max="2100-12-31" placeholder="Select date" />
            </div>
          </div>
          <div>
            <label className={labelCls}>Project manager <span className="text-danger">*</span></label>
            <UserSearchDropdown
              orgId={orgId}
              placeholder="Search by name…"
              selected={pmUser}
              onSelect={setPmUser}
              excludeIds={user?.id ? [user.id] : []}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Planned budget</label>
              <input type="number" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="0" min="0" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Currency</label>
              <StyledSelect
                value={currency}
                onChange={setCurrency}
                options={['INR', 'USD', 'EUR', 'GBP'].map((c) => ({ value: c, label: c }))}
              />
            </div>
          </div>
          <div>
            <label className={labelCls}>Start from template</label>
            <TemplatePicker templates={templates} selected={templateId} onSelect={setTemplateId} />
          </div>
          {/* The goals this project exists to move — it can serve several. */}
          <GoalsMultiSelectField orgId={orgId} value={goalIds} onChange={setGoalIds} />
          <div className="flex justify-end pt-2">
            <button type="button" onClick={() => { if (validateStep1()) setStep(2) }} className="h-10 px-6 rounded-[8px] bg-primary hover:bg-primary-hover text-white text-sm font-medium transition-colors">
              Next: Add Members
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="bg-surface border border-border-light rounded-card p-6 shadow-card">
          <p className="text-sm text-text-secondary mb-4">
            You and the project manager are automatically added. Add additional team members below.
          </p>

          {/* Auto-added members */}
          <div className="space-y-2 mb-4">
            {user && (
              <div className="flex items-center gap-3 p-3 bg-surface-sunken rounded-[8px] border border-border-light">
                <div className={`w-7 h-7 rounded-full ${avatarColor(user.name)} flex items-center justify-center text-white text-[10px] font-medium shrink-0`}>
                  {getInitials(user.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text-primary truncate">{user.name}</p>
                  <p className="text-xs text-text-muted">You (creator)</p>
                </div>
                <span className="text-xs text-text-secondary bg-surface-control border border-border-light rounded-[6px] px-2 py-1">Owner</span>
              </div>
            )}
            {pmUser && pmUser.user_id !== user?.id && (
              <div className="flex items-center gap-3 p-3 bg-surface-sunken rounded-[8px] border border-border-light">
                <div className={`w-7 h-7 rounded-full ${avatarColor(pmUser.name)} flex items-center justify-center text-white text-[10px] font-medium shrink-0`}>
                  {getInitials(pmUser.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text-primary truncate">{pmUser.name}</p>
                  <p className="text-xs text-text-muted">{pmUser.role_title} · Project Manager</p>
                </div>
                <span className="text-xs text-text-secondary bg-surface-control border border-border-light rounded-[6px] px-2 py-1">Manager</span>
              </div>
            )}
          </div>

          {/* Search to add */}
          <div className="mb-4">
            <MultiUserSearch orgId={orgId} excludeIds={takenIds} onAdd={addMember} />
          </div>

          {/* Added members */}
          {members.length === 0 ? (
            <p className="text-sm text-text-muted mb-6">No additional members added.</p>
          ) : (
            <div className="space-y-2 mb-6">
              {members.map((m) => (
                <div key={m.user_id} className="flex items-center gap-3 p-3 bg-surface-sunken rounded-[8px] border border-border-light">
                  <div className={`w-7 h-7 rounded-full ${avatarColor(m.name)} flex items-center justify-center text-white text-[10px] font-medium shrink-0`}>
                    {getInitials(m.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text-primary truncate">{m.name}</p>
                    <p className="text-xs text-text-muted truncate">{m.role_title}</p>
                  </div>
                  <StyledSelect
                    value={m.role}
                    onChange={(v) => updateMember(m.user_id, { role: v as 'manager' | 'editor' | 'viewer' })}
                    size="sm"
                    wrapperClassName="w-[110px]"
                    options={[
                      { value: 'manager', label: 'Manager' },
                      { value: 'editor', label: 'Editor' },
                      { value: 'viewer', label: 'Viewer' },
                    ]}
                  />
                  <StyledSelect
                    value={m.task_visibility}
                    onChange={(v) => updateMember(m.user_id, { task_visibility: v as 'own_tasks_only' | 'all_member_tasks' })}
                    size="sm"
                    wrapperClassName="w-[120px]"
                    options={[
                      { value: 'own_tasks_only', label: 'Own tasks' },
                      { value: 'all_member_tasks', label: 'All tasks' },
                    ]}
                  />
                  <button type="button" onClick={() => removeMember(m.user_id)} className="p-1 rounded-xs hover:bg-danger-bg text-danger transition-colors">
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-between">
            <button type="button" onClick={() => setStep(1)} className="h-10 px-4 rounded-[8px] border-2 border-primary text-primary-text text-sm font-medium hover:bg-primary-subtle transition-colors flex items-center gap-1.5">
              <ChevronLeft size={16} /> Back
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={handleCreate}
              className="h-10 px-6 rounded-[8px] bg-primary hover:bg-primary-hover text-white text-sm font-medium disabled:bg-surface-control-pressed disabled:text-text-muted transition-colors flex items-center gap-2"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              {saving ? 'Creating...' : 'Create Project'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
