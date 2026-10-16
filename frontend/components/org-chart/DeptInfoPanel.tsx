'use client'

import { useRouter } from 'next/navigation'
import { UsersIcon, NetworkIcon, ChevronRightIcon, PencilIcon, CrownIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import Tooltip from '@/components/ui/tooltip'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetBody,
} from '@/components/ui/sheet'
import type { Department, EmployeeProfile } from '@/lib/types'

/** Small pill that tags the department head wherever they appear. */
function HeadBadge() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-meta font-medium uppercase tracking-wide text-primary-foreground">
      <CrownIcon size={10} />
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

  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <SheetContent side="right">
        {department && (
          <>
            <SheetHeader className="pr-20">
              <div className="min-w-0">
                {ancestors.length > 0 && (
                  <nav className="mb-1 flex flex-wrap items-center gap-0.5 text-meta text-text-muted">
                    {ancestors.map((a) => (
                      <span key={a.id} className="flex items-center gap-0.5">
                        <button
                          onClick={() => onSelectDepartment(a)}
                          className="max-w-30 truncate font-medium hover:text-primary-text hover:underline"
                        >
                          {a.name}
                        </button>
                        <ChevronRightIcon size={11} className="text-text-muted" />
                      </span>
                    ))}
                  </nav>
                )}
                <SheetTitle className="flex items-center gap-2 truncate">
                  {accentColor && (
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: accentColor }}
                    />
                  )}
                  {department.name}
                </SheetTitle>
                <p className="mt-1 text-meta text-text-muted">
                  {department._count?.employee_profiles ?? members.length} members ·{' '}
                  {department._count?.roles ?? 0} roles ·{' '}
                  {department._count?.child_departments ?? subDepartments.length} sub-departments
                </p>
              </div>
              {canEdit && (
                <Tooltip label="Edit department">
                  <Button
                    variant="on-brand"
                    size="icon"
                    className="absolute top-3 right-14"
                    onClick={() => onEdit(department)}
                    aria-label="Edit department"
                  >
                    <PencilIcon size={15} />
                  </Button>
                </Tooltip>
              )}
            </SheetHeader>

            <SheetBody className="flex flex-col gap-6">
              {department.description && (
                <p className="text-body text-text-secondary">{department.description}</p>
              )}

              {/* Members — the department head is pinned to the top and tagged. */}
              <section>
                <h4 className="mb-2 flex items-center gap-1 text-label font-medium uppercase tracking-wider text-text-muted">
                  <UsersIcon size={13} /> Members ({members.length})
                </h4>
                {members.length === 0 && !headOnlyName ? (
                  <p className="text-body text-text-muted">No one is in this department yet.</p>
                ) : (
                  <div className="flex flex-col gap-1">
                    {/* Head who isn't on the member roster (e.g. heads from a parent
                        department): show a read-only row so they're never lost. */}
                    {headOnlyName && (
                      <div className="flex items-center gap-2 rounded-lg bg-primary-subtle px-2 py-2 ring-1 ring-inset ring-primary-border">
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface text-label font-medium text-primary-text">
                          {headOnlyName.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-1 truncate text-body font-medium text-text-primary">
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
                          className={`group flex items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors ${
                            isHead
                              ? 'bg-primary-subtle ring-1 ring-inset ring-primary-border hover:bg-primary-subtle'
                              : 'hover:bg-surface-sunken'
                          }`}
                        >
                          <div
                            className={`flex size-8 shrink-0 items-center justify-center rounded-full text-label font-medium ${
                              isHead ? 'bg-surface font-medium text-primary-text' : 'bg-surface-control text-text-secondary'
                            }`}
                          >
                            {(m.user?.name ?? 'U').charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="flex items-center gap-1 truncate text-body font-medium text-text-primary">
                              <span className="truncate">{m.user?.name ?? '—'}</span>
                              {isHead && <HeadBadge />}
                            </p>
                            <p className="truncate text-meta text-text-muted">{m.role?.title ?? ''}</p>
                          </div>
                          <ChevronRightIcon size={14} className="shrink-0 text-text-muted" />
                        </button>
                      )
                    })}
                  </div>
                )}
              </section>

              {/* Sub-departments */}
              <section>
                <h4 className="mb-2 flex items-center gap-1 text-label font-medium uppercase tracking-wider text-text-muted">
                  <NetworkIcon size={13} /> Sub-departments ({subDepartments.length})
                </h4>
                {subDepartments.length === 0 ? (
                  <p className="text-body text-text-muted">No sub-departments.</p>
                ) : (
                  <div className="flex flex-col gap-1">
                    {subDepartments.map((d) => (
                      <button
                        key={d.id}
                        onClick={() => onSelectDepartment(d)}
                        className="group flex items-center justify-between gap-2 rounded-lg bg-surface-sunken px-3 py-2 text-left hover:bg-primary-subtle"
                      >
                        <span className="truncate text-body font-medium text-text-primary">{d.name}</span>
                        <span className="shrink-0 text-meta text-text-muted">
                          {d._count?.employee_profiles ?? 0} ·{' '}
                          <ChevronRightIcon size={12} className="inline" />
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            </SheetBody>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
