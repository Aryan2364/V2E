'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { X, Users, Network, ChevronRight, Pencil, Crown } from 'lucide-react'
import type { Department, EmployeeProfile } from '@/lib/types'

/** Small pill that tags the department head wherever they appear. */
function HeadBadge() {
  return (
    <span className="inline-flex items-center gap-1 shrink-0 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
      <Crown size={10} />
      Head
    </span>
  )
}

interface DeptInfoPanelProps {
  department: Department | null
  /** Branch/override hue for this department (small accent dot). */
  accentColor?: string
  /** Ancestor chain, root → immediate parent, for breadcrumb back-navigation. */
  ancestors: Department[]
  members: EmployeeProfile[]
  subDepartments: Department[]
  canEdit: boolean
  onEdit: (dept: Department) => void
  onSelectDepartment: (dept: Department) => void
  onClose: () => void
}

/**
 * Read-only detail drawer for a department: head, members (name + role) and
 * sub-departments. Slides in from the right; click a member to open their
 * profile, click a sub-department to drill into it.
 */
export default function DeptInfoPanel({
  department,
  accentColor,
  ancestors,
  members,
  subDepartments,
  canEdit,
  onEdit,
  onSelectDepartment,
  onClose,
}: DeptInfoPanelProps) {
  const router = useRouter()
  const open = !!department

  // Portal to <body> so the drawer is never clipped by the fixed top nav.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // Pin the department head to the top of the member roster and tag them. The
  // head is matched by user id; if they aren't on the roster (e.g. they head this
  // department from above), we surface a read-only row so they're never dropped.
  const headUserId = department?.head_user_id
  const sortedMembers = [...members].sort((a, b) => {
    const aHead = !!headUserId && a.user_id === headUserId
    const bHead = !!headUserId && b.user_id === headUserId
    return aHead === bHead ? 0 : aHead ? -1 : 1
  })
  const headIsMember = !!headUserId && members.some((m) => m.user_id === headUserId)
  const headOnlyName = !headIsMember ? department?.head_user?.name ?? null : null

  if (!mounted) return null

  return createPortal(
    <>
      {/* Overlay */}
      {open && <div className="fixed inset-0 bg-black/20 z-60" onClick={onClose} />}

      <div
        className={`fixed inset-y-0 right-0 z-70 w-full max-w-sm bg-white border-l border-border-light shadow-[-8px_0_32px_rgba(0,0,0,0.08)] flex flex-col transition-transform duration-300 ease-in-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {department && (
          <>
            {/* Header */}
            <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-border-light">
              <div className="min-w-0">
                {ancestors.length > 0 && (
                  <nav className="flex items-center flex-wrap gap-0.5 mb-1 text-xs text-text-muted">
                    {ancestors.map((a) => (
                      <span key={a.id} className="flex items-center gap-0.5">
                        <button
                          onClick={() => onSelectDepartment(a)}
                          className="hover:text-primary-text hover:underline font-medium truncate max-w-[120px]"
                        >
                          {a.name}
                        </button>
                        <ChevronRight size={11} className="text-[#CBD5E1]" />
                      </span>
                    ))}
                  </nav>
                )}
                <h3 className="font-bold text-text-primary text-[17px] truncate flex items-center gap-2">
                  {accentColor && (
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: accentColor }}
                    />
                  )}
                  {department.name}
                </h3>
                <p className="text-xs text-text-muted mt-0.5">
                  {department._count?.employee_profiles ?? members.length} members ·{' '}
                  {department._count?.roles ?? 0} roles ·{' '}
                  {department._count?.child_departments ?? subDepartments.length} sub-departments
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {canEdit && (
                  <button
                    onClick={() => onEdit(department)}
                    className="w-7 h-7 rounded-[6px] flex items-center justify-center text-text-muted hover:text-primary-text hover:bg-primary-subtle transition-colors"
                    aria-label="Edit department"
                  >
                    <Pencil size={15} />
                  </button>
                )}
                <button
                  onClick={onClose}
                  className="w-7 h-7 rounded-[6px] flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-control transition-colors"
                  aria-label="Close"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-5 flex flex-col gap-6">
              {department.description && (
                <p className="text-sm text-text-secondary leading-relaxed">{department.description}</p>
              )}

              {/* Members — the department head is pinned to the top and tagged. */}
              <section>
                <h4 className="text-xs font-bold uppercase tracking-wider text-text-muted mb-2 flex items-center gap-1.5">
                  <Users size={13} /> Members ({members.length})
                </h4>
                {members.length === 0 && !headOnlyName ? (
                  <p className="text-sm text-text-muted">No one is in this department yet.</p>
                ) : (
                  <div className="flex flex-col gap-1">
                    {/* Head who isn't on the member roster (e.g. heads from a parent
                        department): show a read-only row so they're never lost. */}
                    {headOnlyName && (
                      <div className="flex items-center gap-2.5 rounded-[8px] px-2 py-2 bg-primary-subtle ring-1 ring-inset ring-primary-border">
                        <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center text-primary-text text-xs font-bold shrink-0">
                          {headOnlyName.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-text-primary truncate flex items-center gap-1.5">
                            <span className="truncate">{headOnlyName}</span>
                            <HeadBadge />
                          </p>
                        </div>
                      </div>
                    )}
                    {sortedMembers.map((m) => {
                      const isHead = !!headUserId && m.user_id === headUserId
                      return (
                        <button
                          key={m.id}
                          onClick={() => router.push(`/settings/organization/employees/${m.id}`)}
                          className={`group flex items-center gap-2.5 rounded-[8px] px-2 py-2 text-left transition-colors ${
                            isHead
                              ? 'bg-primary-subtle ring-1 ring-inset ring-primary-border hover:bg-primary-subtle'
                              : 'hover:bg-surface-sunken'
                          }`}
                        >
                          <div
                            className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${
                              isHead ? 'bg-white text-primary-text font-bold' : 'bg-surface-control text-text-secondary'
                            }`}
                          >
                            {(m.user?.name ?? 'U').charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-text-primary truncate flex items-center gap-1.5">
                              <span className="truncate">{m.user?.name ?? '—'}</span>
                              {isHead && <HeadBadge />}
                            </p>
                            <p className="text-xs text-text-muted truncate">{m.role?.title ?? ''}</p>
                          </div>
                          <ChevronRight
                            size={14}
                            className="text-[#CBD5E1] group-hover:text-text-muted shrink-0"
                          />
                        </button>
                      )
                    })}
                  </div>
                )}
              </section>

              {/* Sub-departments */}
              <section>
                <h4 className="text-xs font-bold uppercase tracking-wider text-text-muted mb-2 flex items-center gap-1.5">
                  <Network size={13} /> Sub-departments ({subDepartments.length})
                </h4>
                {subDepartments.length === 0 ? (
                  <p className="text-sm text-text-muted">No sub-departments.</p>
                ) : (
                  <div className="flex flex-col gap-1">
                    {subDepartments.map((d) => (
                      <button
                        key={d.id}
                        onClick={() => onSelectDepartment(d)}
                        className="group flex items-center justify-between gap-2 rounded-[8px] px-3 py-2 text-left bg-surface-sunken hover:bg-primary-subtle transition-colors"
                      >
                        <span className="text-sm font-medium text-text-primary truncate">{d.name}</span>
                        <span className="text-xs text-text-muted shrink-0">
                          {d._count?.employee_profiles ?? 0} ·{' '}
                          <ChevronRight size={12} className="inline" />
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </>
        )}
      </div>
    </>,
    document.body,
  )
}
