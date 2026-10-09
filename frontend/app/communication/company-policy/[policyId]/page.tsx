'use client'

import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Plus, Pencil, Trash2, Users, Loader2,
  Play, FileText, Link2, BookOpen, X, Check,
} from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { useToast } from '@/components/ui/Toast'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import PermissionTooltip from '@/components/ui/PermissionTooltip'
import { POLICY_BASE, POLICY_REASONS, PolicyBreadcrumb, policyHref, usePolicyPermissions } from '@/components/company-policy/shared'
import {
  getPolicy, publishPolicy, archivePolicy, deletePolicy,
  addItem, updateItem, deleteItem,
  assignPolicy, getAssignments,
} from '@/lib/api/company-policy'
import { getEmployees } from '@/lib/api/employees'
import type { CompanyPolicy, CompanyPolicyItem, CompanyPolicyAssignment, PolicyContentType, PolicyStatus } from '@/lib/types/company-policy'
import type { EmployeeProfile } from '@/lib/types'
import ResponsiveTable, { type ResponsiveColumn } from '@/components/ui/ResponsiveTable'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<PolicyStatus, { bg: string; text: string; label: string }> = {
  draft:     { bg: 'bg-[#FEF9C3]', text: 'text-[#CA8A04]', label: 'Draft' },
  published: { bg: 'bg-[#DCFCE7]', text: 'text-[#16A34A]', label: 'Published' },
  archived:  { bg: 'bg-[#F1F5F9]', text: 'text-[#475569]', label: 'Archived' },
}

const TYPE_ICONS: Record<PolicyContentType, React.ElementType> = {
  video: Play, document: FileText, url: Link2, article: BookOpen,
}

const TYPE_LABELS: Record<PolicyContentType, string> = {
  video: 'Video', document: 'Document', url: 'URL', article: 'Article',
}

const TYPE_COLORS: Record<PolicyContentType, string> = {
  video: 'bg-[#FEE2E2] text-[#DC2626]',
  document: 'bg-[#FEF9C3] text-[#CA8A04]',
  url: 'bg-[#DBEAFE] text-[#2563EB]',
  article: 'bg-[#DCFCE7] text-[#16A34A]',
}

const ASSIGN_STATUS: Record<string, { bg: string; text: string; label: string }> = {
  not_started: { bg: 'bg-[#F1F5F9]', text: 'text-[#475569]', label: 'Not Started' },
  acknowledged: { bg: 'bg-[#DCFCE7]', text: 'text-[#16A34A]', label: 'Acknowledged' },
}

function StatusBadge({ status }: { status: PolicyStatus }) {
  const cfg = STATUS_CONFIG[status]
  return <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${cfg.bg} ${cfg.text}`}>{cfg.label}</span>
}

function TypeBadge({ type }: { type: PolicyContentType }) {
  const Icon = TYPE_ICONS[type]
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${TYPE_COLORS[type]}`}>
      <Icon size={10} />
      {TYPE_LABELS[type]}
    </span>
  )
}

function errorMessage(e: unknown, fallback: string): string {
  const m = (e as { response?: { data?: { message?: unknown } } })?.response?.data?.message
  if (Array.isArray(m)) return m.join(', ')
  return typeof m === 'string' && m ? m : fallback
}

// Dialog shell: portaled to <body> above the top nav, a full-width sheet on mobile.
function DialogShell({ title, onClose, size, children }: { title: string; onClose: () => void; size: 'md' | 'lg'; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  if (typeof document === 'undefined') return null
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className={`bg-white rounded-t-[16px] sm:rounded-[16px] w-full ${size === 'lg' ? 'sm:max-w-lg' : 'sm:max-w-md'} shadow-xl flex flex-col max-h-[90vh]`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E2E8F0] shrink-0">
          <h2 className="text-[16px] font-bold text-[#0F172A]">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="w-9 h-9 flex items-center justify-center text-[#475569] hover:text-[#0F172A] hover:bg-[#F1F5F9] rounded-[6px] transition-colors">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}

const assignmentColumns: ResponsiveColumn<CompanyPolicyAssignment>[] = [
  {
    key: 'employee',
    header: 'Employee',
    primary: true,
    render: (a) => (
      <>
        <p className="font-medium text-[#0F172A]">{a.employee_profile?.user.name ?? '—'}</p>
        <p className="text-xs text-[#475569]">{a.employee_profile?.user.email ?? ''}</p>
      </>
    ),
  },
  {
    key: 'role',
    header: 'Role',
    render: (a) => <span className="text-[#475569]">{a.employee_profile?.role?.title ?? '—'}</span>,
  },
  {
    key: 'status',
    header: 'Status',
    render: (a) => {
      const cfg = ASSIGN_STATUS[a.status] ?? ASSIGN_STATUS.not_started
      return <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${cfg.bg} ${cfg.text}`}>{cfg.label}</span>
    },
  },
  {
    key: 'assigned_on',
    header: 'Assigned On',
    render: (a) => (
      <span className="text-[#475569] text-xs">{new Date(a.assigned_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
    ),
  },
]

// ─── Item Modal ───────────────────────────────────────────────────────────────

interface ItemModalProps {
  policyId: string
  editing: CompanyPolicyItem | null
  onClose: () => void
  onSaved: (item: CompanyPolicyItem) => void
  orgId: string
}

function ItemModal({ policyId, editing, onClose, onSaved, orgId }: ItemModalProps) {
  const [form, setForm] = useState({
    title: editing?.title ?? '',
    content_type: (editing?.content_type ?? 'article') as PolicyContentType,
    content_url: editing?.content_url ?? '',
    content_body: editing?.content_body ?? '',
    description: editing?.description ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function set(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  async function handleSave() {
    if (!form.title.trim()) { setError('Title is required'); return }
    setSaving(true)
    setError('')
    try {
      const payload: any = {
        title: form.title.trim(),
        content_type: form.content_type,
        description: form.description.trim() || undefined,
      }
      if (form.content_type === 'article') {
        payload.content_body = form.content_body.trim() || undefined
      } else {
        payload.content_url = form.content_url.trim() || undefined
      }
      const saved = editing
        ? await updateItem(orgId, policyId, editing.id, payload)
        : await addItem(orgId, policyId, payload)
      onSaved(saved)
    } catch (err) {
      setError(errorMessage(err, 'Could not save this item. Try again.'))
    } finally {
      setSaving(false)
    }
  }

  const inputClass = 'w-full px-3 py-2.5 border border-[#CBD5E1] rounded-[8px] text-base sm:text-sm text-[#0F172A] placeholder:text-[#94A3B8] bg-white focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]'
  const labelClass = 'block text-sm font-medium text-[#374151] mb-1.5'

  return (
    <DialogShell title={editing ? 'Edit Item' : 'Add Item'} onClose={onClose} size="lg">

        <div className="overflow-y-auto px-6 py-5 flex flex-col gap-4">
          {error && <div className="text-sm text-[#DC2626] bg-[#FEE2E2] border border-[#FECACA] rounded-[8px] px-4 py-3">{error}</div>}

          <div>
            <label className={labelClass}>Title <span className="text-[#DC2626]">*</span></label>
            <input type="text" value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Item title" className={inputClass} />
          </div>

          <div>
            <label className={labelClass}>Content Type</label>
            <div className="grid grid-cols-2 gap-2">
              {(['article', 'video', 'document', 'url'] as PolicyContentType[]).map((type) => {
                const Icon = TYPE_ICONS[type]
                const active = form.content_type === type
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => set('content_type', type)}
                    className={['flex items-center gap-2 px-3 py-2.5 rounded-[8px] border-2 text-sm font-medium transition-all', active ? 'border-[#2563EB] bg-[#EFF6FF] text-[#2563EB]' : 'border-[#E2E8F0] text-[#475569] hover:border-[#CBD5E1]'].join(' ')}
                  >
                    <Icon size={15} />
                    {TYPE_LABELS[type]}
                  </button>
                )
              })}
            </div>
          </div>

          {form.content_type === 'article' ? (
            <div>
              <label className={labelClass}>Article Content</label>
              <textarea
                value={form.content_body}
                onChange={(e) => set('content_body', e.target.value)}
                placeholder="Write article content here…"
                rows={5}
                className={`${inputClass} resize-none`}
              />
            </div>
          ) : (
            <div>
              <label className={labelClass}>{TYPE_LABELS[form.content_type]} URL</label>
              <input type="url" value={form.content_url} onChange={(e) => set('content_url', e.target.value)} placeholder="https://" className={inputClass} />
            </div>
          )}

          <div>
            <label className={labelClass}>Description <span className="text-[#475569] font-normal">(optional)</span></label>
            <textarea value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Short description…" rows={2} className={`${inputClass} resize-none`} />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[#E2E8F0] shrink-0">
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 min-h-[44px] sm:min-h-0 text-sm font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-[8px] transition-colors disabled:bg-[#E2E8F0] disabled:text-[#94A3B8] disabled:cursor-not-allowed"
          >
            {saving && <Loader2 size={15} className="animate-spin" />}
            {editing ? 'Save Changes' : 'Add Item'}
          </button>
        </div>
    </DialogShell>
  )
}

// ─── Assign Modal ─────────────────────────────────────────────────────────────

function AssignModal({ policyId, orgId, onClose, onAssigned }: { policyId: string; orgId: string; onClose: () => void; onAssigned: () => void }) {
  const [employees, setEmployees] = useState<EmployeeProfile[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [assigning, setAssigning] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    getEmployees(orgId).then(setEmployees).catch(() => setLoadFailed(true)).finally(() => setLoading(false))
  }, [orgId])

  function toggle(id: string) {
    setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id])
  }

  async function handleAssign() {
    if (!selected.length) return
    setAssigning(true)
    setError('')
    try {
      await assignPolicy(orgId, policyId, selected)
      onAssigned()
      onClose()
    } catch (err) {
      setError(errorMessage(err, 'Could not assign this policy. Try again.'))
    } finally {
      setAssigning(false)
    }
  }

  return (
    <DialogShell title="Assign Employees" onClose={onClose} size="md">
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
          {loading ? (
            <div className="flex justify-center py-8"><div className="w-6 h-6 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin" /></div>
          ) : loadFailed ? (
            <p className="text-sm text-[#475569] text-center py-8">Employees could not be loaded. Close this and try again.</p>
          ) : employees.length === 0 ? (
            <p className="text-sm text-[#475569] text-center py-8">No employees found</p>
          ) : (
            employees.map((emp) => {
              const checked = selected.includes(emp.id)
              const name = emp.user?.name ?? 'Unknown'
              return (
                <button
                  key={emp.id}
                  onClick={() => toggle(emp.id)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-[8px] hover:bg-[#F8FAFC] transition-colors text-left"
                >
                  <div className={['w-5 h-5 rounded-[4px] border-2 flex items-center justify-center shrink-0 transition-colors', checked ? 'bg-[#2563EB] border-[#2563EB]' : 'border-[#CBD5E1]'].join(' ')}>
                    {checked && <Check size={11} className="text-white" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[#0F172A] truncate">{name}</p>
                    <p className="text-xs text-[#475569] truncate">{emp.role?.title ?? ''}</p>
                  </div>
                </button>
              )
            })
          )}
        </div>
        {error && (
          <div className="mx-6 mb-3 text-sm text-[#B91C1C] bg-[#FEF2F2] border border-[#FECACA] rounded-[8px] px-3 py-2">{error}</div>
        )}
        <div className="px-6 py-4 border-t border-[#E2E8F0] flex items-center justify-between shrink-0">
          <p className="text-sm text-[#475569]">{selected.length} selected</p>
          <div className="flex gap-3">
            <button
              onClick={handleAssign}
              disabled={!selected.length || assigning}
              className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-[8px] transition-colors disabled:bg-[#E2E8F0] disabled:text-[#94A3B8] disabled:cursor-not-allowed"
            >
              {assigning && <Loader2 size={13} className="animate-spin" />}
              Assign
            </button>
          </div>
        </div>
    </DialogShell>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type Pending =
  | { kind: 'policy' }
  | { kind: 'item'; item: CompanyPolicyItem }

export default function ManagePolicyPage() {
  const { policyId } = useParams<{ policyId: string }>()
  const { user } = useAuth()
  const router = useRouter()
  const orgId = user?.organizationId ?? ''
  const { addToast } = useToast()
  const { canWrite, canEdit, canDeleteItem, canDeletePolicy, canReadAssignments } = usePolicyPermissions()

  const [policy, setPolicy] = useState<CompanyPolicy | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [tab, setTab] = useState<'items' | 'assignments'>('items')
  const [assignments, setAssignments] = useState<CompanyPolicyAssignment[]>([])
  const [assignmentsLoaded, setAssignmentsLoaded] = useState(false)
  const [assignmentsFailed, setAssignmentsFailed] = useState(false)

  const [showItemModal, setShowItemModal] = useState(false)
  const [editingItem, setEditingItem] = useState<CompanyPolicyItem | null>(null)
  const [showAssignModal, setShowAssignModal] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [archiving, setArchiving] = useState(false)

  // Deletions confirm in-app (never a native confirm) and show failures inside the dialog.
  const [pendingDelete, setPendingDelete] = useState<Pending | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const load = useCallback(() => {
    if (!orgId || !policyId) return
    setStatus('loading')
    getPolicy(orgId, policyId)
      .then((p) => { setPolicy(p); setStatus('ready') })
      .catch(() => setStatus('failed'))
  }, [orgId, policyId])

  useEffect(() => { load() }, [load])

  // Assignments are an area of their own (the server gates them on reading policy
  // management), so the tab only exists for people who may read them.
  const showAssignmentsTab = canReadAssignments === true
  const activeTab = showAssignmentsTab ? tab : 'items'

  useEffect(() => {
    if (activeTab === 'assignments' && !assignmentsLoaded && orgId && policyId) {
      setAssignmentsFailed(false)
      getAssignments(orgId, policyId)
        .then((a) => { setAssignments(a); setAssignmentsLoaded(true) })
        .catch(() => setAssignmentsFailed(true))
    }
  }, [activeTab, assignmentsLoaded, orgId, policyId])

  async function handlePublish() {
    if (!policy) return
    setPublishing(true)
    try {
      setPolicy(await publishPolicy(orgId, policyId))
      addToast('Policy published', 'success')
    } catch (e) {
      addToast(errorMessage(e, 'Could not publish this policy'), 'error')
    } finally {
      setPublishing(false)
    }
  }

  async function handleArchive() {
    if (!policy) return
    setArchiving(true)
    try {
      setPolicy(await archivePolicy(orgId, policyId))
      addToast('Policy archived', 'success')
    } catch (e) {
      addToast(errorMessage(e, 'Could not archive this policy'), 'error')
    } finally {
      setArchiving(false)
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    setDeleting(true)
    setDeleteError(null)
    try {
      if (pendingDelete.kind === 'policy') {
        await deletePolicy(orgId, policyId)
        addToast('Policy deleted', 'success')
        router.push(POLICY_BASE)
        return
      }
      const itemId = pendingDelete.item.id
      await deleteItem(orgId, policyId, itemId)
      setPolicy((p) => p ? { ...p, items: (p.items ?? []).filter((i) => i.id !== itemId) } : p)
      addToast('Item removed', 'success')
      setPendingDelete(null)
    } catch (e) {
      setDeleteError(errorMessage(e, 'This could not be deleted. Try again.'))
    } finally {
      setDeleting(false)
    }
  }

  function handleItemSaved(item: CompanyPolicyItem) {
    setPolicy((p) => {
      if (!p) return p
      const items = editingItem
        ? (p.items ?? []).map((i) => i.id === item.id ? item : i)
        : [...(p.items ?? []), item]
      return { ...p, items }
    })
    setShowItemModal(false)
    setEditingItem(null)
  }

  if (status === 'loading') return <div className="flex justify-center py-20"><div className="w-8 h-8 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin" /></div>
  if (status === 'failed' || !policy) {
    return (
      <div>
        <PolicyBreadcrumb trail={[{ label: 'Company Policy', href: POLICY_BASE }, { label: 'Policy' }]} />
        <div className="bg-white border border-[#E2E8F0] rounded-[12px] p-8 flex flex-col items-center text-center gap-2">
          <p className="text-sm font-semibold text-[#0F172A]">This policy could not be loaded</p>
          <p className="text-sm text-[#475569]">It may have been deleted, or the connection dropped.</p>
          <div className="flex gap-3 mt-2">
            <button type="button" onClick={load} className="px-4 py-2 text-sm font-semibold text-[#2563EB] border-2 border-[#2563EB] rounded-[8px] hover:bg-[#EFF6FF] transition-colors">Retry</button>
            <Link href={POLICY_BASE} className="px-4 py-2 text-sm font-semibold text-[#475569] hover:text-[#0F172A] transition-colors">All policies</Link>
          </div>
        </div>
      </div>
    )
  }

  const itemCount = policy.items?.length ?? 0
  const assignedCount = policy._count?.assignments ?? 0
  const deleteMessage =
    pendingDelete?.kind === 'policy'
      ? `"${policy.title}" will be deleted with its ${itemCount} item${itemCount === 1 ? '' : 's'}${assignedCount ? ` and ${assignedCount} employee assignment${assignedCount === 1 ? '' : 's'}` : ''}. This cannot be undone.`
      : pendingDelete?.kind === 'item'
        ? `"${pendingDelete.item.title}" will be removed from this policy. This cannot be undone.`
        : undefined

  const outlineBtn = 'flex items-center gap-1.5 px-3 py-2 min-h-[40px] text-sm font-semibold rounded-[8px] transition-colors disabled:bg-[#E2E8F0] disabled:text-[#94A3B8] disabled:border-[#E2E8F0] disabled:cursor-not-allowed'

  return (
    <div className="w-full max-w-[1280px]">
      <PolicyBreadcrumb trail={[{ label: 'Company Policy', href: POLICY_BASE }, { label: policy.title }]} />

      {/* Header card */}
      <div className="bg-white border border-[#E2E8F0] rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.08)] p-6 mb-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <h1 className="text-[22px] sm:text-[28px] font-bold text-[#0F172A] leading-snug break-words">{policy.title}</h1>
            <div className="flex items-center gap-2.5 mt-1.5 flex-wrap">
              <StatusBadge status={policy.status} />
            </div>
            {policy.description && <p className="text-[14px] text-[#475569] mt-2 leading-relaxed break-words">{policy.description}</p>}
          </div>

          <div className="flex items-center gap-2 flex-wrap shrink-0">
            {canEdit === true ? (
              <Link
                href={`${policyHref(policyId)}/edit`}
                className={`${outlineBtn} text-[#475569] bg-white border border-[#CBD5E1] hover:border-[#2563EB] hover:text-[#2563EB]`}
              >
                <Pencil size={14} /> Edit
              </Link>
            ) : (
              <PermissionTooltip allowed={canEdit} reason={POLICY_REASONS.edit}>
                <button type="button" disabled className={`${outlineBtn} border border-[#E2E8F0]`}>
                  <Pencil size={14} /> Edit
                </button>
              </PermissionTooltip>
            )}
            {policy.status === 'draft' && (
              <PermissionTooltip
                allowed={canWrite === true && itemCount === 0 ? false : canWrite}
                reason={canWrite === true ? 'Add at least one item before publishing.' : POLICY_REASONS.create}
              >
                <button
                  onClick={handlePublish}
                  disabled={publishing || canWrite !== true || itemCount === 0}
                  className="flex items-center gap-1.5 px-3 py-2 min-h-[40px] text-sm font-semibold text-white bg-[#16A34A] hover:bg-[#15803D] rounded-[8px] transition-colors disabled:bg-[#E2E8F0] disabled:text-[#94A3B8] disabled:cursor-not-allowed"
                >
                  {publishing && <Loader2 size={13} className="animate-spin" />}
                  Publish
                </button>
              </PermissionTooltip>
            )}
            {policy.status === 'published' && (
              <PermissionTooltip allowed={canWrite} reason={POLICY_REASONS.create}>
                <button
                  onClick={handleArchive}
                  disabled={archiving || canWrite !== true}
                  className={`${outlineBtn} text-[#B45309] bg-[#FFFBEB] border border-[#FDE68A] hover:bg-[#FEF3C7]`}
                >
                  {archiving && <Loader2 size={13} className="animate-spin" />}
                  Archive
                </button>
              </PermissionTooltip>
            )}
            <PermissionTooltip allowed={canDeletePolicy} reason={POLICY_REASONS.deletePolicy}>
              <button
                onClick={() => { setDeleteError(null); setPendingDelete({ kind: 'policy' }) }}
                disabled={canDeletePolicy !== true}
                aria-label="Delete policy"
                className="w-10 h-10 flex items-center justify-center text-[#DC2626] bg-white border border-[#E2E8F0] rounded-[8px] hover:bg-[#FEE2E2] hover:border-[#FECACA] transition-colors disabled:bg-[#E2E8F0] disabled:text-[#94A3B8] disabled:cursor-not-allowed"
              >
                <Trash2 size={15} />
              </button>
            </PermissionTooltip>
          </div>
        </div>
      </div>

      {/* Tabs — with the tab's own action on the right of the bar */}
      <div className="flex items-end justify-between gap-3 border-b border-[#E2E8F0] mb-6 flex-wrap">
        <div className="flex gap-0">
          {(showAssignmentsTab ? (['items', 'assignments'] as const) : (['items'] as const)).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={['-mb-px px-5 py-2.5 min-h-[44px] text-sm font-semibold capitalize border-b-2 transition-colors', activeTab === t ? 'border-[#2563EB] text-[#2563EB]' : 'border-transparent text-[#475569] hover:text-[#0F172A]'].join(' ')}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="pb-2">
          {activeTab === 'items' ? (
            <PermissionTooltip allowed={canWrite} reason={POLICY_REASONS.create}>
              <button
                onClick={() => { setEditingItem(null); setShowItemModal(true) }}
                disabled={canWrite !== true}
                className="flex items-center gap-2 bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-sm font-semibold px-4 py-2 rounded-[8px] transition-colors disabled:bg-[#E2E8F0] disabled:text-[#94A3B8] disabled:cursor-not-allowed"
              >
                <Plus size={15} /> Add Item
              </button>
            </PermissionTooltip>
          ) : (
            <PermissionTooltip
              allowed={canWrite === true && policy.status !== 'published' ? false : canWrite}
              reason={canWrite === true ? 'Publish this policy before assigning it.' : POLICY_REASONS.create}
            >
              <button
                onClick={() => setShowAssignModal(true)}
                disabled={canWrite !== true || policy.status !== 'published'}
                className="flex items-center gap-2 bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-sm font-semibold px-4 py-2 rounded-[8px] transition-colors disabled:bg-[#E2E8F0] disabled:text-[#94A3B8] disabled:cursor-not-allowed"
              >
                <Users size={15} /> Assign Employees
              </button>
            </PermissionTooltip>
          )}
        </div>
      </div>

      {/* Items tab */}
      {activeTab === 'items' && (
        <div>
          {!policy.items?.length ? (
            <div className="text-center py-16 bg-white border border-[#E2E8F0] rounded-[12px] px-4">
              <FileText size={28} className="text-[#475569] mx-auto mb-3" />
              <p className="text-sm font-semibold text-[#0F172A]">No items yet</p>
              <p className="text-xs text-[#475569] mt-1">
                {canWrite === true ? 'Add articles, videos, documents or links to this policy.' : 'This policy has no content yet.'}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {policy.items.map((item, idx) => {
                const Icon = TYPE_ICONS[item.content_type]
                return (
                  <div key={item.id} className="bg-white border border-[#E2E8F0] rounded-[10px] px-4 py-3.5 flex items-center gap-3 sm:gap-4 hover:border-[#CBD5E1] transition-colors">
                    <span className="hidden sm:block text-[12px] font-bold text-[#475569] w-5 text-right shrink-0">{idx + 1}</span>
                    <div className={['w-8 h-8 rounded-[6px] flex items-center justify-center shrink-0', TYPE_COLORS[item.content_type].split(' ')[0]].join(' ')}>
                      <Icon size={15} className={TYPE_COLORS[item.content_type].split(' ')[1]} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-semibold text-[#0F172A] truncate">{item.title}</p>
                      {item.description && <p className="text-[12px] text-[#475569] truncate">{item.description}</p>}
                    </div>
                    <span className="hidden sm:inline-flex"><TypeBadge type={item.content_type} /></span>
                    <div className="flex items-center gap-1 shrink-0">
                      <PermissionTooltip allowed={canEdit} reason={POLICY_REASONS.edit}>
                        <button
                          onClick={() => { setEditingItem(item); setShowItemModal(true) }}
                          disabled={canEdit !== true}
                          aria-label={`Edit ${item.title}`}
                          className="w-9 h-9 flex items-center justify-center text-[#475569] hover:text-[#2563EB] hover:bg-[#EFF6FF] rounded-[6px] transition-colors disabled:text-[#CBD5E1] disabled:hover:bg-transparent disabled:cursor-not-allowed"
                        >
                          <Pencil size={14} />
                        </button>
                      </PermissionTooltip>
                      <PermissionTooltip allowed={canDeleteItem} reason={POLICY_REASONS.deleteItem}>
                        <button
                          onClick={() => { setDeleteError(null); setPendingDelete({ kind: 'item', item }) }}
                          disabled={canDeleteItem !== true}
                          aria-label={`Remove ${item.title}`}
                          className="w-9 h-9 flex items-center justify-center text-[#475569] hover:text-[#DC2626] hover:bg-[#FEE2E2] rounded-[6px] transition-colors disabled:text-[#CBD5E1] disabled:hover:bg-transparent disabled:cursor-not-allowed"
                        >
                          <Trash2 size={14} />
                        </button>
                      </PermissionTooltip>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Assignments tab */}
      {activeTab === 'assignments' && (
        <div>
          {assignmentsFailed ? (
            <div className="text-center py-16 bg-white border border-[#E2E8F0] rounded-[12px] px-4">
              <p className="text-sm font-semibold text-[#0F172A]">Assignments could not be loaded</p>
              <p className="text-xs text-[#475569] mt-1 mb-3">Check your connection and try again.</p>
              <button type="button" onClick={() => setAssignmentsLoaded(false)} className="px-4 py-2 text-sm font-semibold text-[#2563EB] border-2 border-[#2563EB] rounded-[8px] hover:bg-[#EFF6FF] transition-colors">Retry</button>
            </div>
          ) : !assignmentsLoaded ? (
            <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin" /></div>
          ) : assignments.length === 0 ? (
            <div className="text-center py-16 bg-white border border-[#E2E8F0] rounded-[12px] px-4">
              <Users size={28} className="text-[#475569] mx-auto mb-3" />
              <p className="text-sm font-semibold text-[#0F172A]">No assignments yet</p>
              <p className="text-xs text-[#475569] mt-1">
                {policy.status !== 'published' ? 'Publish this policy first to assign it to employees.' : 'Assign this policy to employees.'}
              </p>
            </div>
          ) : (
            <ResponsiveTable
              columns={assignmentColumns}
              rows={assignments}
              rowKey={(a) => a.id}
            />
          )}
        </div>
      )}

      {/* Modals */}
      {showItemModal && (
        <ItemModal
          policyId={policyId}
          orgId={orgId}
          editing={editingItem}
          onClose={() => { setShowItemModal(false); setEditingItem(null) }}
          onSaved={handleItemSaved}
        />
      )}
      {showAssignModal && (
        <AssignModal
          policyId={policyId}
          orgId={orgId}
          onClose={() => setShowAssignModal(false)}
          onAssigned={() => { setAssignmentsLoaded(false); setTab('assignments') }}
        />
      )}
      <ConfirmDialog
        open={!!pendingDelete}
        danger
        title={pendingDelete?.kind === 'policy' ? 'Delete this policy?' : 'Remove this item?'}
        message={deleteMessage}
        confirmLabel={pendingDelete?.kind === 'policy' ? 'Delete policy' : 'Remove item'}
        loading={deleting}
        error={deleteError}
        onConfirm={confirmDelete}
        onCancel={() => { if (!deleting) setPendingDelete(null) }}
      />
    </div>
  )
}
