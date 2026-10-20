'use client'

import { useCallback, useEffect, useState } from 'react'
import { formatDate } from '@/lib/format'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Plus, Pencil, Trash2, Users, Loader2,
  Play, FileText, Link2, BookOpen,
} from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { useToast } from '@/components/ui/Toast'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { InlineFieldError } from '@/components/ui/inline-field-error'
import { useGuardedClose } from '@/lib/use-guarded-close'
import PermissionTooltip from '@/components/ui/PermissionTooltip'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { PageHeader } from '@/components/shell/page-header'
import Tooltip from '@/components/ui/tooltip'
import { POLICY_BASE, POLICY_REASONS, policyHref, usePolicyPermissions } from '@/components/company-policy/shared'
import {
  getPolicy, publishPolicy, archivePolicy, deletePolicy,
  addItem, updateItem, deleteItem,
  assignPolicy, getAssignments,
} from '@/lib/api/company-policy'
import { getEmployees } from '@/lib/api/employees'
import type { CompanyPolicy, CompanyPolicyItem, CompanyPolicyAssignment, PolicyContentType, PolicyStatus } from '@/lib/types/company-policy'
import type { EmployeeProfile } from '@/lib/types'
import ResponsiveTable, { type ResponsiveColumn } from '@/components/ui/ResponsiveTable'
import { Label } from '@/components/ui/label'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<PolicyStatus, { bg: string; text: string; label: string }> = {
  draft:     { bg: 'bg-warning-bg', text: 'text-warning', label: 'Draft' },
  published: { bg: 'bg-success-bg', text: 'text-success', label: 'Published' },
  archived:  { bg: 'bg-surface-control', text: 'text-text-secondary', label: 'Archived' },
}

const TYPE_ICONS: Record<PolicyContentType, React.ElementType> = {
  video: Play, document: FileText, url: Link2, article: BookOpen,
}

const TYPE_LABELS: Record<PolicyContentType, string> = {
  video: 'Video', document: 'Document', url: 'URL', article: 'Article',
}

const TYPE_COLORS: Record<PolicyContentType, string> = {
  video: 'bg-danger-bg text-danger',
  document: 'bg-warning-bg text-warning',
  url: 'bg-primary-subtle text-primary-text',
  article: 'bg-success-bg text-success',
}

const ASSIGN_STATUS: Record<string, { bg: string; text: string; label: string }> = {
  not_started: { bg: 'bg-surface-control', text: 'text-text-secondary', label: 'Not started' },
  acknowledged: { bg: 'bg-success-bg', text: 'text-success', label: 'Acknowledged' },
}

function StatusBadge({ status }: { status: PolicyStatus }) {
  const cfg = STATUS_CONFIG[status]
  return <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-meta font-medium ${cfg.bg} ${cfg.text}`}>{cfg.label}</span>
}

function TypeBadge({ type }: { type: PolicyContentType }) {
  const Icon = TYPE_ICONS[type]
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-meta font-medium ${TYPE_COLORS[type]}`}>
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

// Dialog shell, now a thin wrapper over the kit's dialog.tsx (section 24) in place
// of a hand-rolled `fixed inset-0` overlay: same title/onClose/size/children API,
// so neither call site below changed its own markup beyond the body/footer split
// dialog.tsx now owns (header and footer fixed, body scrolls — section 24 rule 1/6).
function DialogShell({ title, onClose, size, children }: { title: string; onClose: () => void; size: 'md' | 'lg'; children: React.ReactNode }) {
  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent size={size === 'lg' ? 'lg' : 'md'}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  )
}

const assignmentColumns: ResponsiveColumn<CompanyPolicyAssignment>[] = [
  {
    key: 'employee',
    header: 'Employee',
    primary: true,
    render: (a) => (
      <>
        <p className="font-medium text-text-primary">{a.employee_profile?.user.name ?? '—'}</p>
        <p className="text-meta text-text-secondary">{a.employee_profile?.user.email ?? ''}</p>
      </>
    ),
  },
  {
    key: 'role',
    header: 'Role',
    render: (a) => <span className="text-text-secondary">{a.employee_profile?.role?.title ?? '—'}</span>,
  },
  {
    key: 'status',
    header: 'Status',
    render: (a) => {
      const cfg = ASSIGN_STATUS[a.status] ?? ASSIGN_STATUS.not_started
      return <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-meta font-medium ${cfg.bg} ${cfg.text}`}>{cfg.label}</span>
    },
  },
  {
    key: 'assigned_on',
    header: 'Assigned On',
    render: (a) => (
      <span className="text-text-secondary text-meta">{formatDate(a.assigned_at)}</span>
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
  const [titleError, setTitleError] = useState('')
  const guarded = useGuardedClose({ open: true, values: form, noun: 'item', mode: editing ? 'edit' : 'create', onClose })

  function set(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  async function handleSave() {
    if (!form.title.trim()) {
      setTitleError('Enter a title for the item.')
      requestAnimationFrame(() => document.getElementById('policy-item-title')?.focus())
      return
    }
    setTitleError('')
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

  const inputClass = 'w-full px-3 py-2.5 border border-border rounded-control text-body sm:text-label text-text-primary placeholder:text-text-muted bg-surface focus:outline-hidden focus:border-primary focus:ring-1 focus:ring-primary'

  return (
    <>
    {guarded.warning}
    <DialogShell title={editing ? 'Edit item' : 'Add item'} onClose={guarded.requestClose} size="lg">

        <DialogBody className="flex flex-col gap-4">
          {error && <div className="text-label text-danger bg-danger-bg border border-danger-border rounded-control px-4 py-3">{error}</div>}

          <div>
            <Label className="mb-2" htmlFor="policy-item-title" required>Title</Label>
            <input id="policy-item-title" type="text" value={form.title} onChange={(e) => { set('title', e.target.value); if (titleError) setTitleError('') }} placeholder="For example, Leave policy" aria-invalid={titleError ? true : undefined} className={`${inputClass} max-w-[480px] aria-invalid:border-danger`} />
            <InlineFieldError>{titleError}</InlineFieldError>
          </div>

          <div>
            <Label className="mb-2">Content type</Label>
            <div className="grid grid-cols-2 gap-2">
              {(['article', 'video', 'document', 'url'] as PolicyContentType[]).map((type) => {
                const Icon = TYPE_ICONS[type]
                const active = form.content_type === type
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => set('content_type', type)}
                    aria-pressed={active}
                    className={['outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-primary-ring flex items-center gap-2 px-3 py-2.5 rounded-control border-2 text-label font-medium transition-all', active ? 'border-primary bg-primary-subtle text-primary-text' : 'border-border-light text-text-secondary hover:border-border'].join(' ')}
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
              <Label className="mb-2">Article content</Label>
              <textarea
                value={form.content_body}
                onChange={(e) => set('content_body', e.target.value)}
                                rows={5}
                className={`${inputClass} resize-none`}
              />
            </div>
          ) : (
            <div>
              <Label className="mb-2">{TYPE_LABELS[form.content_type]} URL</Label>
              <input type="url" value={form.content_url} onChange={(e) => set('content_url', e.target.value)} placeholder="For example, https://example.com/policy" className={inputClass} />
            </div>
          )}

          <div>
            <Label className="mb-2">Description</Label>
            <textarea value={form.description} onChange={(e) => set('description', e.target.value)} rows={2} className={`${inputClass} resize-none`} />
          </div>
        </DialogBody>

        <DialogFooter>
          <Button variant="secondary" onClick={guarded.requestClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving} loading={saving} loadingLabel="Saving">
            {editing ? 'Save item' : 'Add item'}
          </Button>
        </DialogFooter>
    </DialogShell>
    </>
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
    <DialogShell title="Assign employees" onClose={onClose} size="md">
        <DialogBody>
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-primary" /></div>
          ) : loadFailed ? (
            <p className="text-label text-text-secondary text-center py-8">Employees could not be loaded. Close this and try again.</p>
          ) : employees.length === 0 ? (
            <p className="text-label text-text-secondary text-center py-8">No employees found</p>
          ) : (
            employees.map((emp) => {
              const checked = selected.includes(emp.id)
              const name = emp.user?.name ?? 'Unknown'
              return (
                <button
                  key={emp.id}
                  type="button"
                  onClick={() => toggle(emp.id)}
                  className="outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-primary-ring w-full flex items-center gap-3 px-3 py-2.5 rounded-control hover:bg-surface-sunken transition-colors text-left"
                >
                  <Checkbox checked={checked} onCheckedChange={() => toggle(emp.id)} tabIndex={-1} />
                  <div className="flex-1 min-w-0">
                    <p className="text-label font-medium text-text-primary truncate">{name}</p>
                    <p className="text-meta text-text-secondary truncate">{emp.role?.title ?? ''}</p>
                  </div>
                </button>
              )
            })
          )}
          {error && (
            <div className="mt-3 text-label text-danger bg-danger-bg border border-danger-border rounded-control px-3 py-2">{error}</div>
          )}
        </DialogBody>
        <DialogFooter className="justify-between">
          <p className="text-label text-text-secondary">{selected.length} selected</p>
          <Button onClick={handleAssign} disabled={!selected.length || assigning} loading={assigning}>
            Assign
          </Button>
        </DialogFooter>
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

  if (status === 'loading') return <div className="flex justify-center py-12"><div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
  if (status === 'failed' || !policy) {
    return (
      <div>
        <PageHeader title="Policy" trail={[{ label: 'Company policy', href: POLICY_BASE }]} />
        <div className="bg-surface border border-border-light rounded-card shadow-card p-8 flex flex-col items-center text-center gap-2">
          <p className="text-label font-medium text-text-primary">This policy could not be loaded</p>
          <p className="text-label text-text-secondary">It may have been deleted, or the connection dropped.</p>
          <div className="flex gap-3 mt-2">
            <Button type="button" variant="secondary" onClick={load}>Retry</Button>
            <Button variant="secondary" render={<Link href={POLICY_BASE} />}>All policies</Button>
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

  return (
    <div className="w-full max-w-[1280px]">
      <PageHeader
        title={policy.title}
        trail={[{ label: 'Company policy', href: POLICY_BASE }]}
        meta={<StatusBadge status={policy.status} />}
        actions={
          <>
            {canEdit === true ? (
              <Button variant="secondary" render={<Link href={`${policyHref(policyId)}/edit`} />}>
                <Pencil size={14} /> Edit
              </Button>
            ) : (
              <PermissionTooltip allowed={canEdit} reason={POLICY_REASONS.edit}>
                <Button type="button" variant="secondary" disabled>
                  <Pencil size={14} /> Edit
                </Button>
              </PermissionTooltip>
            )}
            {policy.status === 'draft' && (
              <PermissionTooltip
                allowed={canWrite === true && itemCount === 0 ? false : canWrite}
                reason={canWrite === true ? 'Add at least one item before publishing.' : POLICY_REASONS.create}
              >
                <Button
                  onClick={handlePublish}
                  disabled={publishing || canWrite !== true || itemCount === 0}
                  loading={publishing}
                  loadingLabel="Publishing"
                >
                  Publish
                </Button>
              </PermissionTooltip>
            )}
            {policy.status === 'published' && (
              <PermissionTooltip allowed={canWrite} reason={POLICY_REASONS.create}>
                <Button
                  variant="secondary"
                  onClick={handleArchive}
                  disabled={archiving || canWrite !== true}
                  loading={archiving}
                  loadingLabel="Archiving"
                >
                  Archive
                </Button>
              </PermissionTooltip>
            )}
            <PermissionTooltip allowed={canDeletePolicy} reason={POLICY_REASONS.deletePolicy}>
              <Tooltip label="Delete policy">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => { setDeleteError(null); setPendingDelete({ kind: 'policy' }) }}
                  disabled={canDeletePolicy !== true}
                  aria-label="Delete policy"
                  className="text-danger"
                >
                  <Trash2 size={15} />
                </Button>
              </Tooltip>
            </PermissionTooltip>
          </>
        }
      />
      {policy.description && <p className="text-body text-text-secondary -mt-3 mb-4 leading-relaxed wrap-break-word">{policy.description}</p>}

      {/* Tabs — with the tab's own action on the right of the bar */}
      <div className="flex items-end justify-between gap-3 border-b border-border-light mb-6 flex-wrap">
        <div className="flex gap-0">
          {(showAssignmentsTab ? (['items', 'assignments'] as const) : (['items'] as const)).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={['outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-primary-ring -mb-px px-4 py-2.5 min-h-[44px] text-label font-medium capitalize border-b-2 transition-colors', activeTab === t ? 'border-primary text-primary-text' : 'border-transparent text-text-secondary hover:text-text-primary'].join(' ')}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="pb-2">
          {activeTab === 'items' ? (
            <PermissionTooltip allowed={canWrite} reason={POLICY_REASONS.create}>
              <Button
                variant="secondary"
                onClick={() => { setEditingItem(null); setShowItemModal(true) }}
                disabled={canWrite !== true}
              >
                <Plus size={15} /> Add item
              </Button>
            </PermissionTooltip>
          ) : (
            <PermissionTooltip
              allowed={canWrite === true && policy.status !== 'published' ? false : canWrite}
              reason={canWrite === true ? 'Publish this policy before assigning it.' : POLICY_REASONS.create}
            >
              <Button
                variant="secondary"
                onClick={() => setShowAssignModal(true)}
                disabled={canWrite !== true || policy.status !== 'published'}
              >
                <Users size={15} /> Assign employees
              </Button>
            </PermissionTooltip>
          )}
        </div>
      </div>

      {/* Items tab */}
      {activeTab === 'items' && (
        <div>
          {!policy.items?.length ? (
            <div className="text-center py-12 bg-surface border border-border-light rounded-card shadow-card px-4">
              <FileText size={28} className="text-text-secondary mx-auto mb-3" />
              <p className="text-label font-medium text-text-primary">No items yet</p>
              <p className="text-meta text-text-secondary mt-1">
                {canWrite === true ? 'Add articles, videos, documents or links to this policy.' : 'This policy has no content yet.'}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {policy.items.map((item, idx) => {
                const Icon = TYPE_ICONS[item.content_type]
                return (
                  <div key={item.id} className="bg-surface border border-border-light rounded-card px-4 py-3.5 flex items-center gap-3 sm:gap-4 hover:border-border transition-colors">
                    <span className="hidden sm:block text-meta font-medium text-text-secondary w-5 text-right shrink-0">{idx + 1}</span>
                    <div className={['w-8 h-8 rounded-control flex items-center justify-center shrink-0', TYPE_COLORS[item.content_type].split(' ')[0]].join(' ')}>
                      <Icon size={15} className={TYPE_COLORS[item.content_type].split(' ')[1]} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-body font-medium text-text-primary truncate">{item.title}</p>
                      {item.description && <p className="text-meta text-text-secondary truncate">{item.description}</p>}
                    </div>
                    <span className="hidden sm:inline-flex"><TypeBadge type={item.content_type} /></span>
                    <div className="flex items-center gap-1 shrink-0">
                      <PermissionTooltip allowed={canEdit} reason={POLICY_REASONS.edit}>
                        <Tooltip label="Edit item">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => { setEditingItem(item); setShowItemModal(true) }}
                            disabled={canEdit !== true}
                            aria-label={`Edit ${item.title}`}
                          >
                            <Pencil size={14} />
                          </Button>
                        </Tooltip>
                      </PermissionTooltip>
                      <PermissionTooltip allowed={canDeleteItem} reason={POLICY_REASONS.deleteItem}>
                        <Tooltip label="Remove item">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => { setDeleteError(null); setPendingDelete({ kind: 'item', item }) }}
                            disabled={canDeleteItem !== true}
                            aria-label={`Remove ${item.title}`}
                          >
                            <Trash2 size={14} />
                          </Button>
                        </Tooltip>
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
            <div className="text-center py-12 bg-surface border border-border-light rounded-card shadow-card px-4">
              <p className="text-label font-medium text-text-primary">Assignments could not be loaded</p>
              <p className="text-meta text-text-secondary mt-1 mb-3">Check your connection and try again.</p>
              <Button type="button" variant="secondary" onClick={() => setAssignmentsLoaded(false)}>Retry</Button>
            </div>
          ) : !assignmentsLoaded ? (
            <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
          ) : assignments.length === 0 ? (
            <div className="text-center py-12 bg-surface border border-border-light rounded-card shadow-card px-4">
              <Users size={28} className="text-text-secondary mx-auto mb-3" />
              <p className="text-label font-medium text-text-primary">No assignments yet</p>
              <p className="text-meta text-text-secondary mt-1">
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
