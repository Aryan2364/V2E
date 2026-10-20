'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { ChevronLeft, X, Search, Check } from 'lucide-react'
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
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { InlineFieldError } from '@/components/ui/inline-field-error'
import { useUnsavedChanges } from '@/components/ui/unsaved-changes'
import Tooltip from '@/components/ui/tooltip'

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
      <div className="flex items-center gap-2 h-10 px-3 rounded-[8px] border border-border bg-surface">
        <div className={`w-6 h-6 rounded-full ${avatarColor(selected.name)} flex items-center justify-center text-primary-foreground text-meta font-medium shrink-0`}>
          {getInitials(selected.name)}
        </div>
        <span className="text-body text-text-primary flex-1 truncate">{selected.name}</span>
        <span className="text-meta text-text-muted truncate">{selected.role_title}</span>
        <Button type="button" variant="in-field" size="icon-sm" onClick={() => onSelect(null)} aria-label="Clear selection" className="shrink-0">
          <X size={13} />
        </Button>
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
          className="w-full h-10 pl-8 pr-3 rounded-[8px] border border-border text-body text-text-primary placeholder:text-text-muted bg-surface focus:border-primary focus:outline-hidden transition-colors"
        />
      </div>
      {open && (
        <div className="absolute z-20 mt-1 w-full bg-surface border border-border-light rounded-lg shadow-menu max-h-48 overflow-y-auto">
          {loading ? (
            <div className="px-4 py-3 text-body text-text-muted">Searching…</div>
          ) : results.length === 0 ? (
            <div className="px-4 py-3 text-body text-text-muted">No users found</div>
          ) : results.map((u) => (
            <button
              key={u.user_id}
              type="button"
              onClick={() => { onSelect(u); setQuery(''); setOpen(false) }}
              className="outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-primary-ring w-full flex items-center gap-3 px-3 py-2.5 hover:bg-surface-sunken transition-colors text-left"
            >
              <div className={`w-7 h-7 rounded-full ${avatarColor(u.name)} flex items-center justify-center text-primary-foreground text-meta font-medium shrink-0`}>
                {getInitials(u.name)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-body font-medium text-text-primary truncate">{u.name}</p>
                <p className="text-meta text-text-muted truncate">{u.role_title} · {u.department_name}</p>
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
          className="w-full h-10 pl-8 pr-3 rounded-[8px] border border-border text-body text-text-primary placeholder:text-text-muted bg-surface focus:border-primary focus:outline-hidden transition-colors"
        />
      </div>
      {open && (
        <div className="absolute z-20 mt-1 w-full bg-surface border border-border-light rounded-lg shadow-menu max-h-56 overflow-y-auto">
          {loading ? (
            <div className="px-4 py-3 text-body text-text-muted">Searching…</div>
          ) : results.length === 0 ? (
            <div className="px-4 py-3 text-body text-text-muted">No users found</div>
          ) : results.map((u) => {
            const already = excludeIds.includes(u.user_id)
            return (
              <button
                key={u.user_id}
                type="button"
                onClick={() => { if (!already) { onAdd(u); setQuery(''); setOpen(false) } }}
                disabled={already}
                className={`outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-primary-ring w-full flex items-center gap-3 px-3 py-2.5 transition-colors text-left ${already ? 'opacity-50 cursor-not-allowed' : 'hover:bg-surface-sunken'}`}
              >
                <div className={`w-7 h-7 rounded-full ${avatarColor(u.name)} flex items-center justify-center text-primary-foreground text-meta font-medium shrink-0`}>
                  {getInitials(u.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-body font-medium text-text-primary truncate">{u.name}</p>
                  <p className="text-meta text-text-muted truncate">{u.role_title} · {u.department_name}</p>
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
  // Field errors sit under the field that is wrong; focus goes to the first one (kit 11.3, 39.3).
  type FieldKey = 'name' | 'pm' | 'start' | 'end' | 'budget'
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldKey, string>>>({})
  const clearErr = (k: FieldKey) => setFieldErrors((p) => (p[k] ? { ...p, [k]: undefined } : p))
  // A new project exists only once created: leaving a filled-in wizard asks first (kit 11.3 rule 10).
  const unsaved = useUnsavedChanges({
    changed: !saving && (name.trim() !== '' || description.trim() !== '' || startDate !== '' || endDate !== '' || pmUser !== null || budget !== '' || templateId !== null || goalIds.length > 0),
    noun: 'project',
    mode: 'create',
  })

  // Step 2 fields
  const [members, setMembers] = useState<WizardMember[]>([])

  const inputCls = 'w-full h-10 px-3 rounded-[8px] border border-border text-body text-text-primary placeholder:text-text-muted bg-surface focus:border-primary focus:outline-hidden transition-colors'
  const labelCls = 'block text-body font-medium text-text-secondary mb-1.5'

  const todayStr = getNow().toISOString().split('T')[0]

  function handleDateChange(val: string, setter: (v: string) => void) {
    if (!val) { setter(''); return }
    const year = parseInt(val.split('-')[0], 10)
    if (isNaN(year) || year < 2000 || year > 2100) {
      setter('')
      return
    }
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
    const errs: Partial<Record<FieldKey, string>> = {}
    if (!name.trim()) errs.name = 'Enter a name for the project.'
    if (!pmUser) errs.pm = 'Choose the project manager.'
    if (startDate && new Date(startDate).getFullYear() < 2000) errs.start = 'Choose a start date in the year 2000 or later.'
    else if (startDate && new Date(startDate).getFullYear() > 2100) errs.start = 'Choose a start date before the year 2100.'
    if (endDate) {
      if (new Date(endDate).getFullYear() > 2100) errs.end = 'Choose an end date before the year 2100.'
      else if (endDate < todayStr) errs.end = 'Choose an end date that is today or later.'
      else if (startDate && endDate < startDate) errs.end = 'Choose an end date on or after the start date.'
    }
    if (budget !== '' && Number(budget) < 0) errs.budget = 'Enter a budget of zero or more.'
    setFieldErrors(errs)
    const firstBad = (['name', 'pm', 'start', 'end', 'budget'] as FieldKey[]).find((k) => errs[k])
    if (firstBad) {
      requestAnimationFrame(() => {
        const el = document.getElementById(`project-${firstBad}`)
        ;(el?.matches('input,textarea,button') ? el : el?.querySelector<HTMLElement>('input,button'))?.focus()
      })
      return false
    }
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
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Could not create the project. Try again.'
      setError(msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-2xl">
      {unsaved.warning}
      {/* Steps indicator */}
      <div className="flex items-center gap-3 mb-8">
        {[1, 2].map((s) => (
          <div key={s} className="flex items-center gap-2">
            <div className={['w-8 h-8 rounded-full flex items-center justify-center text-body font-medium', s === step ? 'bg-primary text-primary-foreground' : s < step ? 'bg-success-bg text-success' : 'bg-surface-control text-text-muted'].join(' ')}>
              {s}
            </div>
            <span className={`text-body font-medium ${s === step ? 'text-text-primary' : 'text-text-muted'}`}>
              {s === 1 ? 'Project setup' : 'Add members'}
            </span>
            {s < 2 && <div className="w-8 h-px bg-surface-control-pressed" />}
          </div>
        ))}
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-[8px] border border-danger-border bg-danger-bg text-body text-danger">{error}</div>
      )}

      {step === 1 && (
        <div className="bg-surface border border-border-light rounded-card p-6 shadow-card space-y-4">
          <div>
            <Label className="mb-2" htmlFor="project-name" required>Project name</Label>
            <input id="project-name" value={name} onChange={(e) => { setName(e.target.value); clearErr('name') }} placeholder="For example, Website redesign Q3" aria-invalid={fieldErrors.name ? true : undefined} className={`${inputCls} max-w-[480px] aria-invalid:border-danger`} />
            <InlineFieldError>{fieldErrors.name}</InlineFieldError>
          </div>
          <div>
            <Label className="mb-2">Description</Label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="w-full px-3 py-2 rounded-[8px] border border-border text-body text-text-primary placeholder:text-text-muted bg-surface focus:border-primary focus:outline-hidden resize-none" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="mb-2" htmlFor="project-start">Start date</Label>
              <DatePicker id="project-start" invalid={!!fieldErrors.start} value={startDate} onChange={(iso) => { handleDateChange(iso, setStartDate); clearErr('start') }} min="2000-01-01" max="2100-12-31" placeholder="Select date" />
              <InlineFieldError>{fieldErrors.start}</InlineFieldError>
            </div>
            <div>
              <Label className="mb-2" htmlFor="project-end">End date</Label>
              <DatePicker id="project-end" invalid={!!fieldErrors.end} value={endDate} onChange={(iso) => { handleDateChange(iso, setEndDate); clearErr('end') }} min={endDateMin} max="2100-12-31" placeholder="Select date" />
              <InlineFieldError>{fieldErrors.end}</InlineFieldError>
            </div>
          </div>
          <div>
            <Label className="mb-2" required>Project manager</Label>
            <div id="project-pm">
            <UserSearchDropdown
              orgId={orgId}
              placeholder="Search by name"
              selected={pmUser}
              onSelect={(u) => { setPmUser(u); clearErr('pm') }}
              excludeIds={user?.id ? [user.id] : []}
            />
            </div>
            <InlineFieldError>{fieldErrors.pm}</InlineFieldError>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="mb-2" htmlFor="project-budget">Planned budget</Label>
              <input id="project-budget" type="number" value={budget} onChange={(e) => { setBudget(e.target.value); clearErr('budget') }} placeholder="For example, 500000" min="0" aria-invalid={fieldErrors.budget ? true : undefined} className={`${inputCls} aria-invalid:border-danger`} />
              <InlineFieldError>{fieldErrors.budget}</InlineFieldError>
            </div>
            <div>
              <Label className="mb-2">Currency</Label>
              <StyledSelect
                value={currency}
                onChange={setCurrency}
                options={['INR', 'USD', 'EUR', 'GBP'].map((c) => ({ value: c, label: c }))}
              />
            </div>
          </div>
          <div>
            <Label className="mb-2">Start from template</Label>
            <TemplatePicker templates={templates} selected={templateId} onSelect={setTemplateId} />
          </div>
          {/* The goals this project exists to move — it can serve several. */}
          <GoalsMultiSelectField orgId={orgId} value={goalIds} onChange={setGoalIds} />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" data-leaves-page onClick={() => router.push('/dashboard/projects')}>Cancel</Button>
            <Button type="button" onClick={() => { if (validateStep1()) setStep(2) }}>
              Next: add members
            </Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="bg-surface border border-border-light rounded-card p-6 shadow-card">
          <p className="text-body text-text-secondary mb-4">
            You and the project manager are automatically added. Add additional team members below.
          </p>

          {/* Auto-added members */}
          <div className="space-y-2 mb-4">
            {user && (
              <div className="flex items-center gap-3 p-3 bg-surface-sunken rounded-[8px] border border-border-light">
                <div className={`w-7 h-7 rounded-full ${avatarColor(user.name)} flex items-center justify-center text-primary-foreground text-meta font-medium shrink-0`}>
                  {getInitials(user.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-body font-medium text-text-primary truncate">{user.name}</p>
                  <p className="text-meta text-text-muted">You (creator)</p>
                </div>
                <span className="text-meta text-text-secondary bg-surface-control border border-border-light rounded-[6px] px-2 py-1">Owner</span>
              </div>
            )}
            {pmUser && pmUser.user_id !== user?.id && (
              <div className="flex items-center gap-3 p-3 bg-surface-sunken rounded-[8px] border border-border-light">
                <div className={`w-7 h-7 rounded-full ${avatarColor(pmUser.name)} flex items-center justify-center text-primary-foreground text-meta font-medium shrink-0`}>
                  {getInitials(pmUser.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-body font-medium text-text-primary truncate">{pmUser.name}</p>
                  <p className="text-meta text-text-muted">{pmUser.role_title} · Project Manager</p>
                </div>
                <span className="text-meta text-text-secondary bg-surface-control border border-border-light rounded-[6px] px-2 py-1">Manager</span>
              </div>
            )}
          </div>

          {/* Search to add */}
          <div className="mb-4">
            <MultiUserSearch orgId={orgId} excludeIds={takenIds} onAdd={addMember} />
          </div>

          {/* Added members */}
          {members.length === 0 ? (
            <p className="text-body text-text-muted mb-6">No additional members added.</p>
          ) : (
            <div className="space-y-2 mb-6">
              {members.map((m) => (
                <div key={m.user_id} className="flex items-center gap-3 p-3 bg-surface-sunken rounded-[8px] border border-border-light">
                  <div className={`w-7 h-7 rounded-full ${avatarColor(m.name)} flex items-center justify-center text-primary-foreground text-meta font-medium shrink-0`}>
                    {getInitials(m.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-body font-medium text-text-primary truncate">{m.name}</p>
                    <p className="text-meta text-text-muted truncate">{m.role_title}</p>
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
                  <Tooltip label="Remove member">
                    <Button type="button" variant="ghost" size="icon" onClick={() => removeMember(m.user_id)} aria-label="Remove member">
                      <X size={13} />
                    </Button>
                  </Tooltip>
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-between">
            <Button type="button" variant="secondary" onClick={() => setStep(1)} disabled={saving}>
              <ChevronLeft size={16} /> Back
            </Button>
            <Button type="button" disabled={saving} loading={saving} loadingLabel="Creating" onClick={handleCreate}>
              Create project
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
