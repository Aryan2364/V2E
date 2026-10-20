'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Pencil, Users, Loader2, BookOpen, Clock, Archive, ArchiveRestore, Trash2,
  Play, FileText, Link2, File as FileIcon, Download, Ban, Eye,
} from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { usePermissions } from '@/lib/auth/use-permissions'
import {
  getPath, archivePath, unarchivePath, deletePath, getAssignments, assignPath,
} from '@/lib/api/learning'
import { getEmployees } from '@/lib/api/employees'
import { formatBytes } from '@/lib/attachments'
import type { LearningPath, ContentType, LearningItem, LearningPathAssignment } from '@/lib/types/learning'
import type { EmployeeProfile } from '@/lib/types'
import PathStatusBadge from '@/components/learning/PathStatusBadge'
import ItemTypeBadge from '@/components/learning/ItemTypeBadge'
import ProgressBar from '@/components/learning/ProgressBar'
import EngagementPanel from '@/components/learning/EngagementPanel'
import AssigneeMultiSelect from '@/components/learning/AssigneeMultiSelect'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import MaterialPreviewModal from '@/components/learning/MaterialPreviewModal'
import ResponsiveTable, { type ResponsiveColumn } from '@/components/ui/ResponsiveTable'
import Tooltip from '@/components/ui/tooltip'
import { PageHeader } from '@/components/shell/page-header'
import { EmptyState } from '@/components/ui/empty-state'

type Tab = 'materials' | 'assignments' | 'engagement'

const TYPE_ICONS: Record<ContentType, any> = {
  video: Play,
  file: FileIcon,
  document: FileText,
  url: Link2,
  article: BookOpen,
}

const assignmentColumns: ResponsiveColumn<any>[] = [
  {
    key: 'employee',
    header: 'Employee',
    primary: true,
    render: (a) => (
      <>
        <div className="font-medium text-text-primary">{a.employee_profile?.user?.name}</div>
        <div className="text-meta text-text-muted">{a.employee_profile?.role?.title}</div>
      </>
    ),
  },
  {
    key: 'progress',
    header: 'Progress',
    render: (a) => (
      <ProgressBar percent={a.path_progress?.progress_percent ?? 0} showLabel size="sm" className="max-w-[160px]" />
    ),
  },
  {
    key: 'status',
    header: 'Status',
    render: (a) => (
      <span className={[
        'inline-flex px-2.5 py-0.5 rounded-full text-meta font-medium',
        a.status === 'completed' ? 'bg-success-bg text-success' :
          a.status === 'in_progress' ? 'bg-primary-subtle text-primary-text' :
            'bg-surface-control text-text-muted',
      ].join(' ')}>
        {a.status.replace('_', ' ')}
      </span>
    ),
  },
]

export default function ManagePathPage() {
  const { pathId } = useParams<{ pathId: string }>()
  const { user } = useAuth()
  const router = useRouter()
  const orgId = user?.organizationId ?? ''
  // Deletion is gated by the access-rights system (learning.path.manage:delete), not a
  // hardcoded admin check — so whoever is authorised in Settings → Access Rights can delete.
  const { can, isAdmin } = usePermissions()
  const canDelete = isAdmin || can('learning.path.manage', 'delete')

  const [path, setPath] = useState<LearningPath | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('materials')
  const [assignments, setAssignments] = useState<LearningPathAssignment[]>([])
  const [assignmentsLoaded, setAssignmentsLoaded] = useState(false)
  const [previewItem, setPreviewItem] = useState<LearningItem | null>(null)

  const [showAssignModal, setShowAssignModal] = useState(false)
  const [employees, setEmployees] = useState<EmployeeProfile[]>([])
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([])
  const [assigning, setAssigning] = useState(false)

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [notAvailable, setNotAvailable] = useState(false)

  useEffect(() => {
    if (!orgId || !pathId) return
    getPath(orgId, pathId).then((p) => {
      // Drafts are edited in the builder — keep create and edit identical.
      if (p.status === 'draft') {
        router.replace(`/learning/paths/builder?id=${pathId}`)
        return
      }
      setPath(p)
    }).catch(() => setNotAvailable(true)).finally(() => setLoading(false))
  }, [orgId, pathId, router])

  useEffect(() => {
    if (tab === 'assignments' && !assignmentsLoaded && orgId && pathId) {
      getAssignments(orgId, pathId).then((a) => {
        setAssignments(a)
        setAssignmentsLoaded(true)
      })
    }
  }, [tab, assignmentsLoaded, orgId, pathId])

  async function handleArchive() {
    if (!path) return
    const updated = await archivePath(orgId, pathId)
    setPath(updated)
  }

  async function handleUnarchive() {
    if (!path) return
    const updated = await unarchivePath(orgId, pathId)
    setPath(updated)
  }

  async function confirmDelete() {
    setDeleting(true)
    setDeleteError(null)
    try {
      await deletePath(orgId, pathId)
      router.push('/learning/paths')
    } catch (e: any) {
      setDeleting(false)
      setDeleteError(
        e?.response?.status === 403
          ? 'You don’t have permission to delete this course — only an administrator can.'
          : e?.response?.data?.message ?? 'Could not delete the course. Please try again.',
      )
    }
  }

  async function openAssignModal() {
    const emps = await getEmployees(orgId)
    setEmployees(emps)
    setSelectedEmployees([])
    setShowAssignModal(true)
  }

  async function handleAssign() {
    if (selectedEmployees.length === 0) return
    setAssigning(true)
    try {
      await assignPath(orgId, pathId, selectedEmployees)
      setShowAssignModal(false)
      setAssignmentsLoaded(false)
      if (tab === 'assignments') {
        const a = await getAssignments(orgId, pathId)
        setAssignments(a)
        setAssignmentsLoaded(true)
      }
    } finally {
      setAssigning(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-56px)]">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (notAvailable || !path) {
    return (
      <EmptyState variant="not-found" heading="Course not found" dashboardHref="/learning/paths">
        This course doesn't exist, or you don't have access to manage it.
      </EmptyState>
    )
  }

  const items = path.items ?? []

  return (
    <div className="px-4 sm:px-8 pb-8 max-w-5xl mx-auto">
      {/* Frozen: course header + tabs. Only the tab content below scrolls. */}
      <div className="sticky top-0 z-30 bg-surface pt-6">
      <PageHeader
        title={path.title}
        trail={[{ label: 'Courses', href: '/learning/paths' }]}
        meta={
          <span className="flex items-center gap-3">
            <PathStatusBadge status={path.status} />
            <span className="text-meta text-text-muted capitalize">{path.mode.replace('_', ' ')}</span>
            {path.estimated_minutes ? (
              <span className="flex items-center gap-1 text-meta text-text-muted"><Clock size={12} />{path.estimated_minutes}m est.</span>
            ) : null}
          </span>
        }
        actions={
          <>
            <Button variant="secondary" render={<Link href={`/learning/paths/${pathId}/preview`} />}>
              <Eye size={14} /> Preview
            </Button>
            <Button render={<Link href={`/learning/paths/builder?id=${pathId}`} />}>
              <Pencil size={14} /> Edit
            </Button>
            {path.status === 'published' && (
              <Tooltip label="Archive">
                <Button variant="ghost" size="icon" aria-label="Archive" onClick={handleArchive}>
                  <Archive size={16} />
                </Button>
              </Tooltip>
            )}
            {path.status === 'archived' && (
              <Button variant="secondary" onClick={handleUnarchive}>
                <ArchiveRestore size={14} /> Restore
              </Button>
            )}
            {canDelete && (
              <Tooltip label="Delete">
                <Button variant="ghost" size="icon" aria-label="Delete" onClick={() => { setDeleteError(null); setDeleteOpen(true) }}>
                  <Trash2 size={16} />
                </Button>
              </Tooltip>
            )}
          </>
        }
      />
      {path.description && <p className="text-label text-text-secondary -mt-2 mb-4">{path.description}</p>}

      {/* Tabs */}
      <div className="flex items-end justify-between gap-3 mb-4 border-b border-border-light">
        <div className="flex gap-1">
        {(['materials', 'assignments', 'engagement'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={[
              'outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-primary-ring px-4 py-2.5 text-label font-medium capitalize transition-colors border-b-2 -mb-px',
              tab === t
                ? 'border-primary text-primary-text'
                : 'border-transparent text-text-secondary hover:text-text-primary',
            ].join(' ')}
          >
            {t}
            {(() => {
              const n =
                t === 'materials' ? (path._count?.items ?? items.length) :
                t === 'assignments' ? (assignmentsLoaded ? assignments.length : (path._count?.assignments ?? 0)) :
                (path._count?.assignments ?? 0) // engagement = people being tracked
              return n > 0 ? (
                <span className="ml-1.5 text-meta font-medium bg-primary-subtle text-primary-text px-1.5 py-0.5 rounded-full">
                  {n}
                </span>
              ) : null
            })()}
          </button>
        ))}
        </div>
        {tab !== 'engagement' && (
          <div className="pb-2 shrink-0">
            {tab === 'materials' ? (
              <Button variant="secondary" render={<Link href={`/learning/paths/builder?id=${pathId}`} />}>
                <Pencil size={14} /> Edit materials
              </Button>
            ) : (
              <Button variant="secondary" onClick={openAssignModal}>
                <Users size={14} /> Assign employees
              </Button>
            )}
          </div>
        )}
      </div>
      </div>{/* end frozen header + tabs */}

      <div className="pt-4">
      {/* Materials Tab (read-only — edit in the builder) */}
      {tab === 'materials' && (
        <div>
          <div className="flex flex-col gap-2">
            {items.map((item, idx) => {
              const TypeIcon = TYPE_ICONS[item.content_type] ?? BookOpen
              return (
                <Tooltip key={item.id} label="Click to preview">
                <button
                  type="button"
                  onClick={() => setPreviewItem(item)}
                  className="outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-primary-ring group text-left w-full bg-surface border border-border-light rounded-card px-4 py-3.5 flex items-center gap-3 cursor-pointer hover:border-primary hover:bg-surface-sunken transition-colors"
                >
                  <span className="text-meta text-text-muted w-5 text-center shrink-0">{idx + 1}</span>
                  <div className="w-8 h-8 rounded-control bg-surface-sunken group-hover:bg-primary-subtle flex items-center justify-center shrink-0 transition-colors">
                    <TypeIcon size={15} className="text-text-muted group-hover:text-primary-text transition-colors" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-label font-medium text-text-primary truncate">{item.title}</span>
                      <ItemTypeBadge type={item.content_type} />
                    </div>
                    {item.content_type === 'file' && item.file_name && (
                      <div className="flex items-center gap-2 text-meta text-text-muted mt-0.5">
                        <span className="truncate max-w-[240px]">{item.file_name}</span>
                        {item.file_size_bytes ? <span className="text-text-muted">· {formatBytes(item.file_size_bytes)}</span> : null}
                        <span className={[
                          'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-meta font-medium',
                          item.allow_download ?? true ? 'bg-success-bg text-success' : 'bg-warning-bg text-warning',
                        ].join(' ')}>
                          {item.allow_download ?? true ? <Download size={10} /> : <Ban size={10} />}
                          {item.allow_download ?? true ? 'Download' : 'View-only'}
                        </span>
                      </div>
                    )}
                    {item.content_type !== 'file' && item.description && (
                      <p className="text-meta text-text-muted truncate mt-0.5">{item.description}</p>
                    )}
                  </div>
                  {item.estimated_minutes && (
                    <span className="text-meta text-text-muted shrink-0">{item.estimated_minutes}m</span>
                  )}
                  <span className="inline-flex items-center gap-1 text-meta font-medium text-text-muted group-hover:text-primary-text shrink-0 transition-colors">
                    <Eye size={14} />
                    <span className="hidden sm:inline">Preview</span>
                  </span>
                </button>
                </Tooltip>
              )
            })}
          </div>
        </div>
      )}

      {/* Assignments Tab */}
      {tab === 'assignments' && (
        <div>
          {assignments.length === 0 ? (
            <div className="bg-surface border border-dashed border-border rounded-card py-12 flex flex-col items-center text-center">
              <Users size={28} className="text-text-muted mb-3" />
              <p className="text-label font-medium text-text-primary mb-1">No assignments yet</p>
              <p className="text-meta text-text-muted">Assign this course to employees to get started</p>
            </div>
          ) : (
            <ResponsiveTable columns={assignmentColumns} rows={assignments} rowKey={(a) => a.id} />
          )}
        </div>
      )}

      {/* Engagement Tab */}
      {tab === 'engagement' && <EngagementPanel orgId={orgId} pathId={pathId} />}
      </div>{/* end scrolling tab content */}

      {/* Material preview popup — windowed with maximize + close */}
      {previewItem && (
        <MaterialPreviewModal
          orgId={orgId}
          pathId={pathId}
          item={previewItem}
          onClose={() => setPreviewItem(null)}
        />
      )}

      {/* Assign Modal */}
      <Dialog open={showAssignModal} onOpenChange={(next) => { if (!next) setShowAssignModal(false) }}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Assign course</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <p className="text-body text-text-secondary mb-4">Search, select all, or pick people to assign this course to</p>
            <AssigneeMultiSelect
              employees={employees}
              selected={selectedEmployees}
              onChange={setSelectedEmployees}
            />
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setShowAssignModal(false)}>Cancel</Button>
            <Button
              onClick={handleAssign}
              disabled={assigning || selectedEmployees.length === 0}
              loading={assigning}
            >
              Assign {selectedEmployees.length > 0 ? `(${selectedEmployees.length})` : ''}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteOpen}
        title="Delete this course?"
        message="This permanently removes the course and all its materials and assignments. This can’t be undone."
        danger
        confirmLabel="Delete course"
        loading={deleting}
        error={deleteError}
        onConfirm={confirmDelete}
        onCancel={() => { if (!deleting) { setDeleteOpen(false); setDeleteError(null) } }}
      />
    </div>
  )
}
