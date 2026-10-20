'use client'

import { Skeleton } from '@/components/ui/skeleton'
import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/lib/auth/context'
import { projectsApi } from '@/lib/api/projects'
import { tasksApi } from '@/lib/api/tasks'
import { getNow } from '@/lib/clock'
import type { Project, ProjectMember } from '@/lib/types/projects'
import type { EligibleAssigneeUser } from '@/lib/types/tasks'
import MemberRow from '@/components/projects/MemberRow'
import DatePicker from '@/components/ui/DatePicker'
import StyledSelect from '@/components/ui/StyledSelect'
import GoalsMultiSelectField from '@/components/projects/GoalsMultiSelectField'
import { ChevronLeft, Plus, Loader2, Trash2, Search, X, Check } from 'lucide-react'
import { Label } from '@/components/ui/label'

// ─── Avatar helpers ────────────────────────────────────────────────────────────

const avatarColors = ['bg-primary', 'bg-text-secondary', 'bg-success', 'bg-warning', 'bg-danger', 'bg-text-secondary']
function avatarColor(name: string): string {
  let h = 0; for (let i = 0; i < name.length; i++) h += name.charCodeAt(i)
  return avatarColors[h % avatarColors.length]
}
function getInitials(name: string): string {
  return name.split(' ').map((n) => n[0] ?? '').join('').toUpperCase().slice(0, 2) || '?'
}

// ─── User search (single select) ──────────────────────────────────────────────

function UserSearchDropdown({ orgId, selected, onSelect, excludeIds = [] }: {
  orgId: string
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
        setResults(data.departments.flatMap((d) => d.users).filter((u) => !excludeIds.includes(u.user_id)))
      } catch { setResults([]) }
      finally { setLoading(false) }
    }, 200)
  }, [orgId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (open) fetch(query) }, [query, open]) // eslint-disable-line react-hooks/exhaustive-deps

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
        <button type="button" onClick={() => onSelect(null)} className="p-0.5 rounded-xs hover:bg-surface-control text-text-muted hover:text-text-primary transition-colors shrink-0">
          <X size={13} />
        </button>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} onFocus={() => setOpen(true)} placeholder="Search by name…"
          className="w-full h-10 pl-8 pr-3 rounded-[8px] border border-border text-body text-text-primary placeholder:text-text-muted bg-surface focus:border-primary focus:outline-hidden transition-colors" />
      </div>
      {open && (
        <div className="absolute z-20 mt-1 w-full bg-surface border border-border-light rounded-lg shadow-menu max-h-48 overflow-y-auto">
          {loading ? <div className="px-4 py-3 text-body text-text-muted">Searching…</div>
            : results.length === 0 ? <div className="px-4 py-3 text-body text-text-muted">No users found</div>
            : results.map((u) => (
              <button key={u.user_id} type="button" onClick={() => { onSelect(u); setQuery(''); setOpen(false) }}
                className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-surface-sunken transition-colors text-left">
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

// ─── Multi-user search (add member) ───────────────────────────────────────────

function MultiUserSearch({ orgId, excludeIds, onAdd }: {
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

  useEffect(() => { if (open) fetch(query) }, [query, open]) // eslint-disable-line react-hooks/exhaustive-deps

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
        <input value={query} onChange={(e) => setQuery(e.target.value)} onFocus={() => setOpen(true)} placeholder="Search team members to add…"
          className="w-full h-10 pl-8 pr-3 rounded-[8px] border border-border text-body text-text-primary placeholder:text-text-muted bg-surface focus:border-primary focus:outline-hidden transition-colors" />
      </div>
      {open && (
        <div className="absolute z-20 mt-1 w-full bg-surface border border-border-light rounded-lg shadow-menu max-h-56 overflow-y-auto">
          {loading ? <div className="px-4 py-3 text-body text-text-muted">Searching…</div>
            : results.length === 0 ? <div className="px-4 py-3 text-body text-text-muted">No users found</div>
            : results.map((u) => {
              const already = excludeIds.includes(u.user_id)
              return (
                <button key={u.user_id} type="button" onClick={() => { if (!already) { onAdd(u); setQuery(''); setOpen(false) } }} disabled={already}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 transition-colors text-left ${already ? 'opacity-50 cursor-not-allowed' : 'hover:bg-surface-sunken'}`}>
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

// ─── Page ─────────────────────────────────────────────────────────────────────

const STATUS_OPTS = [
  { value: 'active', label: 'Active' },
  { value: 'on_hold', label: 'On Hold' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
]

const inputCls = 'w-full h-10 px-3 rounded-[8px] border border-border text-body text-text-primary placeholder:text-text-muted bg-surface focus:border-primary focus:outline-hidden'
const labelCls = 'block text-body font-medium text-text-secondary mb-1.5'

export default function ProjectSettingsPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const router = useRouter()
  const orgId = user?.organizationId ?? ''
  const userId = user?.id ?? ''

  const [project, setProject] = useState<Project | null>(null)
  const [members, setMembers] = useState<ProjectMember[]>([])
  const [loading, setLoading] = useState(true)

  // Edit fields
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [pmUser, setPmUser] = useState<EligibleAssigneeUser | null>(null)
  const [status, setStatus] = useState('active')
  const [statusReason, setStatusReason] = useState('')
  const [plannedBudget, setPlannedBudget] = useState('')
  const [actualSpent, setActualSpent] = useState('')
  const [currency, setCurrency] = useState('INR')
  const [goalIds, setGoalIds] = useState<string[]>([])

  // Save / delete state
  const [saving, setSaving] = useState(false)
  const [deleteReason, setDeleteReason] = useState('')
  const [showDelete, setShowDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const todayStr = getNow().toISOString().split('T')[0]
  const endDateMin = startDate && startDate > todayStr ? startDate : todayStr

  function handleDateChange(val: string, setter: (v: string) => void) {
    if (!val) { setter(''); return }
    const year = parseInt(val.split('-')[0], 10)
    if (isNaN(year) || year < 2000 || year > 2100) {
      setter('')
      setError('Year must be between 2000 and 2100')
      return
    }
    setError('')
    setter(val)
  }

  // IDs already in the project (used to exclude from add-member search)
  const memberIds = members.map((m) => m.user_id)

  const load = useCallback(() => {
    if (!orgId || !id) return
    setLoading(true)
    Promise.all([
      projectsApi.get(orgId, id),
      projectsApi.listMembers(orgId, id),
      tasksApi.getEligibleAssignees(orgId).catch(() => ({ departments: [], total: 0 })),
    ]).then(([proj, mems, eligible]) => {
      setProject(proj)
      setMembers(mems)
      setName(proj.name)
      setDescription(proj.description ?? '')
      setStartDate(proj.start_date?.slice(0, 10) ?? '')
      setEndDate(proj.end_date?.slice(0, 10) ?? '')
      setStatus(proj.status)
      setStatusReason(proj.status_reason ?? '')
      setPlannedBudget(proj.planned_budget?.toString() ?? '')
      setActualSpent(proj.actual_spent?.toString() ?? '')
      setCurrency(proj.currency)
      setGoalIds((proj.goals ?? []).map((g) => g.goal.id))
      // Pre-fill PM user from eligible list
      const allUsers = eligible.departments.flatMap((d) => d.users)
      const pm = allUsers.find((u) => u.user_id === proj.project_manager_user_id)
      setPmUser(pm ?? { user_id: proj.project_manager_user_id, name: proj.project_manager_user_id.slice(0, 8), role_title: '', role_id: null, department_id: '', department_name: '', active_task_count: 0, frequency_count: 0, is_frequent: false, avatar_url: null })
    }).catch(() => setError('Failed to load project')).finally(() => setLoading(false))
  }, [orgId, id])

  useEffect(() => { load() }, [load])

  function validate() {
    if (!name.trim()) { setError('Project name is required'); return false }
    if (!pmUser) { setError('Project manager is required'); return false }
    if (startDate) {
      const y = new Date(startDate).getFullYear()
      if (y < 2000) { setError('Start date cannot be before year 2000'); return false }
      if (y > 2100) { setError('Start date year cannot exceed 2100'); return false }
    }
    if (endDate) {
      const y = new Date(endDate).getFullYear()
      if (y > 2100) { setError('End date year cannot exceed 2100'); return false }
      if (endDate < todayStr) { setError('End date must be today or in the future'); return false }
      if (startDate && endDate < startDate) { setError('End date cannot be before start date'); return false }
    }
    if (plannedBudget !== '' && Number(plannedBudget) < 0) { setError('Budget cannot be negative'); return false }
    if (actualSpent !== '' && Number(actualSpent) < 0) { setError('Actual spent cannot be negative'); return false }
    return true
  }

  async function handleSave() {
    if (!validate()) return
    setSaving(true); setError(''); setSuccess('')
    try {
      await projectsApi.update(orgId, id, {
        name: name.trim(),
        description: description.trim() || undefined,
        project_manager_user_id: pmUser!.user_id,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
        // The full set — sending it replaces this project's goal links.
        goal_ids: goalIds,
      })
      if (status !== project?.status || statusReason !== (project?.status_reason ?? '')) {
        const needsReason = status === 'on_hold' || status === 'cancelled'
        if (needsReason && !statusReason.trim()) {
          setError('Status reason is required for On Hold / Cancelled')
          setSaving(false); return
        }
        await projectsApi.updateStatus(orgId, id, {
          status,
          status_reason: statusReason.trim() || undefined,
        })
      }
      if (plannedBudget || actualSpent) {
        await projectsApi.updateBudget(orgId, id, {
          planned_budget: plannedBudget ? Number(plannedBudget) : undefined,
          actual_spent: actualSpent ? Number(actualSpent) : undefined,
          currency,
        })
      }
      setSuccess('Project updated successfully')
      load()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to update project'
      setError(msg)
    } finally {
      setSaving(false)
    }
  }

  async function handleAddMember(u: EligibleAssigneeUser) {
    try {
      await projectsApi.addMember(orgId, id, { user_id: u.user_id })
      load()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to add member'
      setError(msg)
    }
  }

  async function handleRemoveMember(uid: string) {
    await projectsApi.removeMember(orgId, id, uid)
    load()
  }

  async function handleUpdateMember(uid: string, patch: { role?: string; task_visibility?: string }) {
    await projectsApi.updateMember(orgId, id, uid, patch)
    load()
  }

  async function handleDelete() {
    if (!deleteReason.trim()) { setError('Deletion reason is required'); return }
    setDeleting(true)
    try {
      await projectsApi.delete(orgId, id, deleteReason.trim())
      router.push('/dashboard/projects')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to delete project'
      setError(msg)
      setDeleting(false)
    }
  }

  const needsReason = status === 'on_hold' || status === 'cancelled'

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64" />
      </div>
    )
  }

  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <p className="font-medium text-text-primary">Project not found</p>
        <Link href="/dashboard/projects" className="mt-2 text-body text-primary-text hover:underline">Back to Projects</Link>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <Link href={`/dashboard/projects/${id}`} className="inline-flex items-center gap-1.5 text-body text-text-secondary hover:text-text-primary transition-colors mb-3">
          <ChevronLeft size={15} /> Back to Project
        </Link>
        <h1 className="text-page-title font-medium text-text-primary leading-tight">Project Settings</h1>
        <p className="mt-1 text-body text-text-secondary">{project.name}</p>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-[8px] border border-danger-border bg-danger-bg text-body text-danger">{error}</div>
      )}
      {success && (
        <div className="px-4 py-3 rounded-[8px] border border-success-border bg-success-bg text-body text-success">{success}</div>
      )}

      {/* General */}
      <div className="bg-surface border border-border-light rounded-card p-6 shadow-card space-y-4">
        <h2 className="text-card-heading font-medium text-text-primary">General</h2>
        <div>
          <Label className="mb-2" required>Project name</Label>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
        </div>
        <div>
          <Label className="mb-2">Description</Label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
            className="w-full px-3 py-2 rounded-[8px] border border-border text-body text-text-primary placeholder:text-text-muted bg-surface focus:border-primary focus:outline-hidden resize-none" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="mb-2">Start date</Label>
            <DatePicker value={startDate} onChange={(iso) => handleDateChange(iso, setStartDate)} min="2000-01-01" max="2100-12-31" placeholder="Select date" />
          </div>
          <div>
            <Label className="mb-2">End date</Label>
            <DatePicker value={endDate} onChange={(iso) => handleDateChange(iso, setEndDate)} min={endDateMin} max="2100-12-31" placeholder="Select date" />
          </div>
        </div>
        <div>
          <Label className="mb-2" required>Project manager</Label>
          <UserSearchDropdown orgId={orgId} selected={pmUser} onSelect={setPmUser} />
        </div>
        {/* The goals this project serves. Clearing one unlinks just that pair. */}
        <GoalsMultiSelectField orgId={orgId} value={goalIds} onChange={setGoalIds} />
      </div>

      {/* Status */}
      <div className="bg-surface border border-border-light rounded-card p-6 shadow-card space-y-4">
        <h2 className="text-card-heading font-medium text-text-primary">Status</h2>
        <div>
          <Label className="mb-2">Project status</Label>
          <StyledSelect value={status} onChange={setStatus} options={STATUS_OPTS} />
        </div>
        {needsReason && (
          <div>
            <Label className="mb-2" required>Status reason</Label>
            <input value={statusReason} onChange={(e) => setStatusReason(e.target.value)}
              placeholder="Explain why the project is being put on hold or cancelled" className={inputCls} />
          </div>
        )}
      </div>

      {/* Budget */}
      <div className="bg-surface border border-border-light rounded-card p-6 shadow-card space-y-4">
        <h2 className="text-card-heading font-medium text-text-primary">Budget</h2>
        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2">
            <Label className="mb-2">Planned budget</Label>
            <input type="number" value={plannedBudget} onChange={(e) => setPlannedBudget(e.target.value)} min="0" className={inputCls} />
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
          <Label className="mb-2">Actual spent</Label>
          <input type="number" value={actualSpent} onChange={(e) => setActualSpent(e.target.value)} min="0" className={inputCls} />
        </div>
      </div>

      {/* Save */}
      <div className="flex justify-end">
        <button type="button" disabled={saving} onClick={handleSave}
          className="h-10 px-6 rounded-[8px] bg-primary hover:bg-primary-hover text-primary-foreground text-body font-medium disabled:opacity-60 transition-colors flex items-center gap-2">
          {saving && <Loader2 size={14} className="animate-spin" />}
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>

      {/* Members */}
      <div className="bg-surface border border-border-light rounded-card p-6 shadow-card space-y-4">
        <h2 className="text-card-heading font-medium text-text-primary">Members</h2>
        <MultiUserSearch orgId={orgId} excludeIds={memberIds} onAdd={handleAddMember} />
        <div className="space-y-1">
          {members.map((m) => (
            <MemberRow
              key={m.id}
              member={m}
              currentUserId={userId}
              canEdit
              onRoleChange={(uid, role) => handleUpdateMember(uid, { role })}
              onVisibilityChange={(uid, visibility) => handleUpdateMember(uid, { task_visibility: visibility })}
              onRemove={() => handleRemoveMember(m.user_id)}
            />
          ))}
        </div>
      </div>

      {/* Danger zone */}
      <div className="bg-surface border border-danger-border rounded-[12px] p-6 shadow-card space-y-4">
        <h2 className="text-card-heading font-medium text-danger">Danger Zone</h2>
        <p className="text-body text-text-secondary">
          Deleting a project is irreversible. All milestones and project task links will be removed.
          Tasks in the tasks system will not be deleted.
        </p>
        {!showDelete ? (
          <button type="button" onClick={() => setShowDelete(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-[8px] border border-danger-border text-danger text-body font-medium hover:bg-danger-bg transition-colors">
            <Trash2 size={14} /> Delete Project
          </button>
        ) : (
          <div className="space-y-3">
            <input value={deleteReason} onChange={(e) => setDeleteReason(e.target.value)} placeholder="Reason for deletion (required)"
              className="w-full h-10 px-3 rounded-[8px] border border-danger-border text-body text-text-primary placeholder:text-text-muted bg-surface focus:border-danger focus:outline-hidden" />
            <div className="flex gap-2">
              <button type="button" onClick={() => setShowDelete(false)}
                className="h-9 px-4 rounded-[8px] border border-border-light text-body font-medium text-text-secondary hover:bg-surface-sunken transition-colors">
                Cancel
              </button>
              <button type="button" disabled={deleting || !deleteReason.trim()} onClick={handleDelete}
                className="h-9 px-4 rounded-[8px] bg-danger hover:bg-danger-hover text-on-danger text-body font-medium disabled:opacity-60 transition-colors flex items-center gap-1.5">
                {deleting && <Loader2 size={13} className="animate-spin" />}
                Confirm Delete
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
