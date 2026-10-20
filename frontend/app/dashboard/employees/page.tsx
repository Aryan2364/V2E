'use client'

import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { getEmployees } from '@/lib/api/employees'
import { getDepartments } from '@/lib/api/departments'
import { getRoles } from '@/lib/api/roles'
import type { EmployeeProfile, Department, Role, EmployeeStatus } from '@/lib/types'
import { Search, Users, ChevronRight, UserPlus, Upload, AlertTriangle } from 'lucide-react'
import AddEmployeeModal from '@/components/employees/AddEmployeeModal'
import ImportEmployeesModal from '@/components/employees/ImportEmployeesModal'
import DepartmentMultiSelect from '@/components/employees/DepartmentMultiSelect'
import EmployeeTreeView from '@/components/employees/EmployeeTreeView'
import ViewToggle, { type EmployeeView } from '@/components/employees/ViewToggle'
import ResponsiveTable, { type ResponsiveColumn } from '@/components/ui/ResponsiveTable'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

const avatarColors = [
  'bg-primary',
  'bg-text-secondary',
  'bg-success',
  'bg-warning',
  'bg-danger',
  'bg-text-secondary',
  'bg-text-secondary',
]

function avatarColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash += name.charCodeAt(i)
  return avatarColors[hash % avatarColors.length]
}

// ─── Status badge ─────────────────────────────────────────────────────────────

const statusConfig: Record<EmployeeStatus, { bg: string; text: string; label: string }> = {
  active: { bg: 'bg-success-bg', text: 'text-success', label: 'Active' },
  inactive: { bg: 'bg-danger-bg', text: 'text-danger', label: 'Inactive' },
}

function StatusBadge({ status }: { status: EmployeeStatus }) {
  const cfg = statusConfig[status] ?? statusConfig.inactive
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-meta font-medium ${cfg.bg} ${cfg.text}`}
    >
      {cfg.label}
    </span>
  )
}

// ─── Avatar ───────────────────────────────────────────────────────────────────

function Avatar({ name }: { name: string }) {
  return (
    <div
      className={`w-9 h-9 rounded-full ${avatarColor(name)} flex items-center justify-center text-white text-meta font-medium shrink-0`}
    >
      {getInitials(name)}
    </div>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="bg-surface border border-border-light rounded-card shadow-card flex flex-col items-center justify-center py-12 text-center">
      <div className="w-14 h-14 rounded-full bg-surface-control flex items-center justify-center mb-4">
        <Users size={24} className="text-text-muted" />
      </div>
      <p className="font-medium text-text-primary">
        {filtered ? 'No employees match your filter' : 'No employees yet'}
      </p>
      <p className="text-text-secondary text-body mt-1">
        {filtered
          ? 'Try adjusting your search or department filter.'
          : 'Employees will appear here once added.'}
      </p>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function EmployeesPage() {
  const router = useRouter()
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''
  const canManage = !!user?.is_admin

  const [employees, setEmployees] = useState<EmployeeProfile[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [loading, setLoading] = useState(true)
  // Lazily hydrate the view + filters from sessionStorage on the very first
  // render, so returning here (browser back from a profile) lands on the exact
  // screen the user left — same view, search and department filter — with no
  // flash of the default table. Reading in the initializer (rather than a mount
  // effect) avoids racing the persistence effects below. Guarded for SSR: the
  // view-dependent UI only renders after `loading` flips client-side, so this
  // never affects the hydrated markup.
  const [search, setSearch] = useState(() =>
    typeof window === 'undefined' ? '' : sessionStorage.getItem('employees-search') ?? '',
  )
  const [selectedDeptIds, setSelectedDeptIds] = useState<string[]>(() => {
    if (typeof window === 'undefined') return []
    try {
      const raw = sessionStorage.getItem('employees-depts')
      const arr = raw ? JSON.parse(raw) : []
      return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : []
    } catch {
      return []
    }
  })
  const [showAdd, setShowAdd] = useState(false)
  const [prefillSelf, setPrefillSelf] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [view, setView] = useState<EmployeeView>(() => {
    if (typeof window === 'undefined') return 'table'
    const v = sessionStorage.getItem('employees-view')
    return v === 'tree' || v === 'table' ? v : 'table'
  })
  const tableScrollRef = useRef<HTMLDivElement>(null)
  // Set true the instant we navigate to a profile, so the scroll listener below
  // ignores the scroll-to-top that Next fires for the new route — otherwise it
  // would clobber the saved position with 0 and we'd land back at the top.
  const navigatingRef = useRef(false)

  // Persist the current page scroll and flag that we're leaving. Capturing here
  // (before navigation) is what makes "back" return to the same spot — matters
  // most in tree view, where the chart sits below the fold.
  const markNavigating = useCallback(() => {
    navigatingRef.current = true
    sessionStorage.setItem(
      'employees-page-scroll',
      String(window.scrollY || document.documentElement.scrollTop || 0),
    )
  }, [])

  const openEmployee = useCallback(
    (id: string) => {
      markNavigating()
      router.push(`/settings/organization/employees/${id}`)
    },
    [markNavigating, router],
  )

  useEffect(() => {
    sessionStorage.setItem('employees-view', view)
  }, [view])
  useEffect(() => {
    sessionStorage.setItem('employees-search', search)
  }, [search])
  useEffect(() => {
    sessionStorage.setItem('employees-depts', JSON.stringify(selectedDeptIds))
  }, [selectedDeptIds])

  // ── Card (inner) scroll: save + restore ──────────────────────────────────────
  // Persist the table's own scroll position so returning from a profile keeps the
  // card where the user left it. rAF-throttled; re-attaches when the table mounts.
  useEffect(() => {
    if (loading || view !== 'table') return
    const el = tableScrollRef.current
    if (!el) return
    let raf = 0
    const onScroll = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        sessionStorage.setItem('employees-scroll', String(el.scrollTop))
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [loading, view])

  useEffect(() => {
    if (loading || view !== 'table') return
    const y = Number(sessionStorage.getItem('employees-scroll'))
    if (!Number.isFinite(y) || y <= 0) return
    let frame = 0
    let tries = 0
    const apply = () => {
      const el = tableScrollRef.current
      if (!el) return
      el.scrollTop = y
      tries += 1
      if (Math.abs(el.scrollTop - y) > 2 && tries < 40) {
        frame = requestAnimationFrame(apply)
      }
    }
    frame = requestAnimationFrame(apply)
    return () => {
      if (frame) cancelAnimationFrame(frame)
    }
  }, [loading, view])

  // ── Page (window) scroll: save + restore ─────────────────────────────────────
  // The page can still scroll because the header + filters + capped card exceed
  // the viewport. Kept fully independent of the card restore above so the two
  // never interfere — they target different scrollers and different storage keys.
  useEffect(() => {
    let raf = 0
    const onScroll = () => {
      if (raf || navigatingRef.current) return
      raf = requestAnimationFrame(() => {
        raf = 0
        if (navigatingRef.current) return
        sessionStorage.setItem(
          'employees-page-scroll',
          String(window.scrollY || document.documentElement.scrollTop || 0),
        )
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  useEffect(() => {
    if (loading) return
    const y = Number(sessionStorage.getItem('employees-page-scroll'))
    if (!Number.isFinite(y) || y <= 0) return
    let frame = 0
    let tries = 0
    const apply = () => {
      window.scrollTo(0, y)
      tries += 1
      const cur = window.scrollY || document.documentElement.scrollTop || 0
      const maxY = document.documentElement.scrollHeight - window.innerHeight
      if (Math.abs(cur - Math.min(y, maxY)) > 2 && tries < 40) {
        frame = requestAnimationFrame(apply)
      }
    }
    frame = requestAnimationFrame(apply)
    return () => {
      if (frame) cancelAnimationFrame(frame)
    }
  }, [loading])

  const reloadEmployees = useCallback(() => {
    if (!orgId) return
    getEmployees(orgId)
      .then(setEmployees)
      .catch(() => null)
  }, [orgId])

  // After an employee is created we refresh employees AND the catalog lists
  // (departments/roles), because the Add-Employee flow lets the user create a
  // department or job role inline — those need to persist into this page's state
  // so the next open of the modal (and the filters) show them.
  const reloadAfterCreate = useCallback(() => {
    if (!orgId) return
    Promise.all([
      getEmployees(orgId).catch(() => null),
      getDepartments(orgId).catch(() => null),
      getRoles(orgId).catch(() => null),
    ]).then(([emps, depts, rls]) => {
      if (emps) setEmployees(emps)
      if (depts) setDepartments(depts)
      if (rls) setRoles(rls)
    })
  }, [orgId])

  // A role/department created inline from the modal must land in the parent list
  // immediately — even if the user then cancels the employee — so it's available
  // on the next entry. De-dupe by id in case a refetch also brought it in.
  const handleRoleCreated = useCallback((role: Role) => {
    setRoles((rs) => (rs.some((r) => r.id === role.id) ? rs : [...rs, role]))
  }, [])
  const handleDeptCreated = useCallback((dept: Department) => {
    setDepartments((ds) => (ds.some((d) => d.id === dept.id) ? ds : [...ds, dept]))
  }, [])

  useEffect(() => {
    if (!orgId) {
      setLoading(false)
      return
    }
    Promise.all([
      getEmployees(orgId).catch(() => []),
      getDepartments(orgId).catch(() => []),
      getRoles(orgId).catch(() => []),
    ]).then(([emps, depts, rls]) => {
      setEmployees(emps)
      setDepartments(depts)
      setRoles(rls)
    }).finally(() => setLoading(false))
  }, [orgId])

  const selectedDeptSet = useMemo(() => new Set(selectedDeptIds), [selectedDeptIds])

  const filtered = useMemo(() => {
    return employees.filter((emp) => {
      const name = emp.user?.name ?? ''
      const email = emp.user?.email ?? ''
      const matchesDept = selectedDeptSet.size === 0 || selectedDeptSet.has(emp.department_id)
      const matchesSearch =
        !search ||
        name.toLowerCase().includes(search.toLowerCase()) ||
        email.toLowerCase().includes(search.toLowerCase())
      return matchesDept && matchesSearch
    })
  }, [employees, selectedDeptSet, search])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const isFiltered = search !== '' || selectedDeptIds.length > 0

  const columns: ResponsiveColumn<EmployeeProfile>[] = [
    {
      key: 'name',
      header: 'Name',
      primary: true,
      cellClassName: 'px-6 py-4',
      headerClassName: 'px-6 py-3.5',
      render: (emp) => {
        const name = emp.user?.name ?? 'Unknown'
        const email = emp.user?.email ?? ''
        return (
          <div className="flex items-center gap-3">
            <Avatar name={name} />
            <div className="min-w-0">
              <p className="font-medium text-text-primary truncate">{name}</p>
              <p className="text-meta text-text-secondary truncate">{email}</p>
            </div>
          </div>
        )
      },
    },
    {
      key: 'role',
      header: 'Role',
      desktopHiddenBelow: 'md',
      cellClassName: 'px-6 py-4 text-text-secondary',
      headerClassName: 'px-6 py-3.5',
      render: (emp) => emp.role?.title ?? '—',
    },
    {
      key: 'department',
      header: 'Department',
      desktopHiddenBelow: 'lg',
      cellClassName: 'px-6 py-4 text-text-secondary',
      headerClassName: 'px-6 py-3.5',
      render: (emp) => emp.department?.name ?? '—',
    },
    {
      key: 'status',
      header: 'Status',
      cellClassName: 'px-6 py-4',
      headerClassName: 'px-6 py-3.5',
      render: (emp) => <StatusBadge status={emp.status} />,
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      cellClassName: 'px-6 py-4',
      headerClassName: 'px-6 py-3.5',
      render: (emp) => (
        <Link
          href={`/settings/organization/employees/${emp.id}`}
          onClick={(e) => {
            e.stopPropagation()
            markNavigating()
          }}
          className="inline-flex items-center gap-1 min-h-[40px] sm:min-h-0 text-primary-text text-meta font-medium hover:text-primary-text transition-colors rounded-md focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
        >
          View
          <ChevronRight size={13} />
        </Link>
      ),
    },
  ]

  const hasProfile = employees.some((e) => e.user_id === user?.id)

  return (
    <div className="flex h-full min-h-0 flex-col gap-6">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-page-title font-medium text-text-primary leading-tight">Employees</h1>
          <p className="mt-1 text-body text-text-secondary">
            Browse and manage all employee profiles.
          </p>
        </div>
        {canManage && (
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowImport(true)}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-body font-medium text-primary-text bg-surface border-2 border-primary hover:bg-primary-subtle transition-colors"
            >
              <Upload size={16} />
              Import
            </button>
            <button
              onClick={() => setShowAdd(true)}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-body font-medium text-primary-foreground bg-primary hover:bg-primary-hover transition-colors"
            >
              <UserPlus size={16} />
              Add Employee
            </button>
          </div>
        )}
      </div>

      {/* Profile setup warning banner */}
      {user && !user.isSuperAdmin && !hasProfile && !loading && (
        <div className="bg-warning-bg border border-warning-border rounded-card p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-card">
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} className="text-warning shrink-0 mt-0.5" />
            <div>
              <p className="text-body font-medium text-warning">Profile Setup Required</p>
              <p className="text-meta text-warning mt-0.5">
                You do not have an employee profile in the directory yet. Set up your profile to assign yourself to a department, role, and enable full task assignments.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setPrefillSelf(true)
              setShowAdd(true)
            }}
            className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-meta font-medium text-primary-foreground bg-warning hover:bg-warning transition-colors whitespace-nowrap self-start sm:self-center"
          >
            Setup Profile
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search
            size={15}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
          />
          <input
            type="text"
            placeholder="Search by name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-[10px] text-body rounded-lg border border-border focus:border-primary focus:outline-hidden bg-surface text-text-primary placeholder:text-text-muted"
          />
        </div>
        <div className="w-full sm:w-60">
          <DepartmentMultiSelect
            selected={selectedDeptIds}
            onChange={setSelectedDeptIds}
            departments={departments}
            allLabel="All departments"
          />
        </div>
      </div>

      {/* Count + view toggle */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-body text-text-secondary">
          {filtered.length} employee{filtered.length !== 1 ? 's' : ''}
        </p>
        <ViewToggle value={view} onChange={setView} />
      </div>

      {/* Table / Tree */}
      {view === 'table' ? (
        <ResponsiveTable
          columns={columns}
          rows={filtered}
          rowKey={(emp) => emp.id}
          onRowClick={(emp) => openEmployee(emp.id)}
          emptyState={<EmptyState filtered={isFiltered} />}
          fill
          scrollContainerRef={tableScrollRef}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <EmployeeTreeView
            employees={filtered}
            allEmployees={employees}
            departments={departments}
            onOpenEmployee={openEmployee}
          />
        </div>
      )}

      {/* Add / Import modals */}
      {showAdd && (
        <AddEmployeeModal
          orgId={orgId}
          departments={departments}
          roles={roles}
          employees={employees}
          prefillSelf={prefillSelf}
          onRoleCreated={handleRoleCreated}
          onDeptCreated={handleDeptCreated}
          onClose={() => {
            setShowAdd(false)
            setPrefillSelf(false)
          }}
          onCreated={() => {
            setShowAdd(false)
            setPrefillSelf(false)
            reloadAfterCreate()
          }}
        />
      )}
      {showImport && (
        <ImportEmployeesModal
          orgId={orgId}
          departments={departments}
          roles={roles}
          employees={employees}
          onClose={() => setShowImport(false)}
          onImported={reloadEmployees}
        />
      )}
    </div>
  )
}
