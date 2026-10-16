'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft, Pencil, Users, Loader2, BookOpen, Clock, Archive, ArchiveRestore, Trash2,
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
import MaterialPreviewModal from '@/components/learning/MaterialPreviewModal'
import ResponsiveTable, { type ResponsiveColumn } from '@/components/ui/ResponsiveTable'
import Tooltip from '@/components/ui/Tooltip'

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
        <div className="font-medium text-[#0F172A]">{a.employee_profile?.user?.name}</div>
        <div className="text-xs text-[#64748B]">{a.employee_profile?.role?.title}</div>
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
        'inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium',
        a.status === 'completed' ? 'bg-[#DCFCE7] text-[#16A34A]' :
          a.status === 'in_progress' ? 'bg-[#EFF6FF] text-[#2563EB]' :
            'bg-[#F1F5F9] text-[#64748B]',
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
        <div className="w-8 h-8 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (notAvailable || !path) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-56px)] px-4">
        <div className="text-center max-w-sm">
          <BookOpen size={40} className="text-[#CBD5E1] mx-auto mb-3" />
          <h1 className="text-lg font-bold text-[#0F172A] mb-1">Course not found</h1>
          <p className="text-sm text-[#475569] mb-5">
            This course doesn’t exist, or you don’t have access to manage it.
          </p>
          <Link
            href="/learning/paths"
            className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-[8px] transition-colors"
          >
            <ArrowLeft size={15} /> Back to Courses
          </Link>
        </div>
      </div>
    )
  }

  const items = path.items ?? []

  return (
    <div className="px-4 sm:px-8 pb-10 max-w-5xl mx-auto">
      {/* Frozen: back link + course header + tabs. Only the tab content below scrolls. */}
      <div className="sticky top-0 z-30 bg-white pt-6">
      <Link
        href="/learning/paths"
        className="inline-flex items-center gap-1.5 text-sm text-[#475569] hover:text-[#2563EB] mb-4 transition-colors"
      >
        <ArrowLeft size={16} />
        Back to Courses
      </Link>

      {/* Header */}
      <div className="bg-white border border-[#E2E8F0] rounded-[12px] p-6 mb-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <h1 className="text-[24px] font-bold text-[#0F172A] mb-2">{path.title}</h1>
            <div className="flex items-center gap-3 mb-1">
              <PathStatusBadge status={path.status} />
              <span className="text-xs text-[#94A3B8] capitalize">{path.mode.replace('_', ' ')}</span>
            </div>
            {path.description && <p className="text-sm text-[#475569] mt-1">{path.description}</p>}
            {path.estimated_minutes ? (
              <div className="flex items-center gap-4 mt-3 text-xs text-[#64748B]">
                <span className="flex items-center gap-1"><Clock size={12} />{path.estimated_minutes}m est.</span>
              </div>
            ) : null}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Link
              href={`/learning/paths/${pathId}/preview`}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-[#2563EB] bg-[#EFF6FF] border border-[#BFDBFE] rounded-[8px] hover:bg-[#DBEAFE] transition-colors"
            >
              <Eye size={14} />
              Preview
            </Link>
            <Link
              href={`/learning/paths/builder?id=${pathId}`}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-[8px] transition-colors"
            >
              <Pencil size={14} />
              Edit
            </Link>
            {path.status === 'published' && (
              <Tooltip label="Archive">
                <button
                  onClick={handleArchive}
                  aria-label="Archive"
                  className="p-2 text-[#475569] hover:text-[#D97706] hover:bg-[#FEF3C7] rounded-[8px] transition-colors"
                >
                  <Archive size={16} />
                </button>
              </Tooltip>
            )}
            {path.status === 'archived' && (
              <button
                onClick={handleUnarchive}
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-[#16A34A] bg-[#DCFCE7] border border-[#BBF7D0] rounded-[8px] hover:bg-[#BBF7D0] transition-colors"
              >
                <ArchiveRestore size={14} /> Restore
              </button>
            )}
            {canDelete && (
              <Tooltip label="Delete">
                <button
                  onClick={() => { setDeleteError(null); setDeleteOpen(true) }}
                  aria-label="Delete"
                  className="p-2 text-[#475569] hover:text-[#DC2626] hover:bg-[#FEE2E2] rounded-[8px] transition-colors"
                >
                  <Trash2 size={16} />
                </button>
              </Tooltip>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-end justify-between gap-3 mb-4 border-b border-[#E2E8F0]">
        <div className="flex gap-1">
        {(['materials', 'assignments', 'engagement'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={[
              'px-4 py-2.5 text-sm font-medium capitalize transition-colors border-b-2 -mb-px',
              tab === t
                ? 'border-[#2563EB] text-[#2563EB]'
                : 'border-transparent text-[#475569] hover:text-[#0F172A]',
            ].join(' ')}
          >
            {t}
            {(() => {
              const n =
                t === 'materials' ? (path._count?.items ?? items.length) :
                t === 'assignments' ? (assignmentsLoaded ? assignments.length : (path._count?.assignments ?? 0)) :
                (path._count?.assignments ?? 0) // engagement = people being tracked
              return n > 0 ? (
                <span className="ml-1.5 text-xs font-semibold bg-[#EFF6FF] text-[#2563EB] px-1.5 py-0.5 rounded-full">
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
              <Link
                href={`/learning/paths/builder?id=${pathId}`}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-[#2563EB] hover:text-[#1D4ED8] transition-colors"
              >
                <Pencil size={14} /> Edit materials
              </Link>
            ) : (
              <button
                onClick={openAssignModal}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-[#2563EB] hover:text-[#1D4ED8] transition-colors"
              >
                <Users size={14} /> Assign Employees
              </button>
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
                  className="group text-left w-full bg-white border border-[#E2E8F0] rounded-[10px] px-4 py-3.5 flex items-center gap-3 cursor-pointer hover:border-[#2563EB] hover:bg-[#F8FAFF] transition-colors"
                >
                  <span className="text-xs text-[#94A3B8] w-5 text-center shrink-0">{idx + 1}</span>
                  <div className="w-8 h-8 rounded-[8px] bg-[#F8FAFC] group-hover:bg-[#EFF6FF] flex items-center justify-center shrink-0 transition-colors">
                    <TypeIcon size={15} className="text-[#64748B] group-hover:text-[#2563EB] transition-colors" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-[#0F172A] truncate">{item.title}</span>
                      <ItemTypeBadge type={item.content_type} />
                    </div>
                    {item.content_type === 'file' && item.file_name && (
                      <div className="flex items-center gap-2 text-xs text-[#64748B] mt-0.5">
                        <span className="truncate max-w-[240px]">{item.file_name}</span>
                        {item.file_size_bytes ? <span className="text-[#94A3B8]">· {formatBytes(item.file_size_bytes)}</span> : null}
                        <span className={[
                          'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium',
                          item.allow_download ?? true ? 'bg-[#DCFCE7] text-[#16A34A]' : 'bg-[#FEF9C3] text-[#CA8A04]',
                        ].join(' ')}>
                          {item.allow_download ?? true ? <Download size={10} /> : <Ban size={10} />}
                          {item.allow_download ?? true ? 'Download' : 'View-only'}
                        </span>
                      </div>
                    )}
                    {item.content_type !== 'file' && item.description && (
                      <p className="text-xs text-[#64748B] truncate mt-0.5">{item.description}</p>
                    )}
                  </div>
                  {item.estimated_minutes && (
                    <span className="text-xs text-[#94A3B8] shrink-0">{item.estimated_minutes}m</span>
                  )}
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-[#94A3B8] group-hover:text-[#2563EB] shrink-0 transition-colors">
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
            <div className="bg-white border border-dashed border-[#CBD5E1] rounded-[12px] py-12 flex flex-col items-center text-center">
              <Users size={28} className="text-[#94A3B8] mb-3" />
              <p className="text-sm font-medium text-[#0F172A] mb-1">No assignments yet</p>
              <p className="text-xs text-[#64748B]">Assign this course to employees to get started</p>
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
      {showAssignModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center px-4 bg-black/40">
          <div className="bg-white rounded-[16px] w-full max-w-md p-6 shadow-xl">
            <h2 className="text-lg font-bold text-[#0F172A] mb-1">Assign Course</h2>
            <p className="text-sm text-[#475569] mb-4">Search, select all, or pick people to assign this course to</p>

            <div className="mb-5">
              <AssigneeMultiSelect
                employees={employees}
                selected={selectedEmployees}
                onChange={setSelectedEmployees}
              />
            </div>

            <div className="flex items-center justify-end gap-3">
              <button onClick={() => setShowAssignModal(false)} className="px-4 py-2.5 text-sm font-semibold text-[#475569]">
                Cancel
              </button>
              <button
                onClick={handleAssign}
                disabled={assigning || selectedEmployees.length === 0}
                className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-[8px] transition-colors disabled:bg-[#E2E8F0] disabled:text-[#94A3B8] disabled:cursor-not-allowed"
              >
                {assigning && <Loader2 size={15} className="animate-spin" />}
                Assign {selectedEmployees.length > 0 ? `(${selectedEmployees.length})` : ''}
              </button>
            </div>
          </div>
        </div>
      )}

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
