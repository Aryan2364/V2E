'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ScrollText, ChevronDown, ChevronRight, Search } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { auditApi, type AuditFilters } from '@/lib/api/audit'
import type { AuditEntry, AuditModuleFacet } from '@/lib/types/audit'
import ResponsiveTable, { type ResponsiveColumn } from '@/components/ui/ResponsiveTable'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import DateRangePicker from '@/components/ui/DateRangePicker'
import {
  ActorCell,
  ActionBadge,
  AuditExpandedDetail,
  hasChanges,
  fmtDateTime,
  triggerLabel,
} from '@/components/audit/AuditDetail'

// Text inputs (search + dates) stay white to contrast the soft-filled dropdowns,
// but share the dropdowns' height and radius so the filter row stays aligned.
const inputClass =
  'rounded-lg border border-border bg-surface px-3.5 py-2.5 text-body text-text-primary placeholder:text-text-muted focus:outline-hidden focus:border-primary focus:ring-1 focus:ring-primary transition-colors'

// Sentinel for "no filter" in the five Select controls below. The filter
// state itself stays '' (what AuditFilters expects); only the Select's
// own value ever sees this sentinel, so an "All ..." row can be the
// Select's real selected item instead of a placeholder.
const ALL_VALUE = '__all__'

export default function AuditLogsPage() {
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''

  const [items, setItems] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [denied, setDenied] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  const [modules, setModules] = useState<AuditModuleFacet[]>([])
  const [triggerSources, setTriggerSources] = useState<string[]>([])

  const [module, setModule] = useState('')
  const [resource, setResource] = useState('')
  const [action, setAction] = useState('')
  const [actorType, setActorType] = useState('')
  const [triggerSource, setTriggerSource] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [search, setSearch] = useState('')

  // Load the filter option lists once.
  useEffect(() => {
    if (!orgId) return
    auditApi
      .resources(orgId)
      .then((res) => {
        setModules(res.modules)
        setTriggerSources(res.trigger_sources)
      })
      .catch(() => {})
  }, [orgId])

  // Entity types within the selected module — drives the dependent Type dropdown.
  // Hidden aliases (legacy/derived keys) are kept for labels but excluded here.
  const selectedModule = useMemo(() => modules.find((m) => m.key === module), [modules, module])
  const typeOptions = useMemo(
    () => selectedModule?.resources.filter((r) => !r.hidden) ?? [],
    [selectedModule],
  )
  // The Type dropdown stays in place but goes inactive when there's nothing to
  // narrow (no module chosen, or a single-entity module) — avoids layout shift.
  const typeDisabled = typeOptions.length <= 1

  // Cap the date range at today (audit entries are never in the future).
  const todayIso = useMemo(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }, [])

  // resource key → { module label, type label } for the table's Module column.
  const resourceLabels = useMemo(() => {
    const map = new Map<string, { module: string; type: string }>()
    for (const m of modules) {
      for (const r of m.resources) map.set(r.key, { module: m.label, type: r.label })
    }
    return map
  }, [modules])

  const load = useCallback(() => {
    if (!orgId) {
      setLoading(false)
      return
    }
    setLoading(true)
    const filters: AuditFilters = {}
    // A specific Type wins; otherwise filter by the whole module.
    if (resource) filters.resource = resource
    else if (module) filters.module = module
    if (action) filters.action = action
    if (actorType) filters.actor_type = actorType
    if (triggerSource) filters.trigger_source = triggerSource
    if (fromDate) filters.from_date = new Date(fromDate).toISOString()
    if (toDate) {
      const end = new Date(toDate)
      end.setHours(23, 59, 59, 999)
      filters.to_date = end.toISOString()
    }
    if (search) filters.search = search
    auditApi
      .list(orgId, filters)
      .then((res) => setItems(res.items))
      .catch((err) => {
        if (err?.response?.status === 403) setDenied(true)
      })
      .finally(() => setLoading(false))
  }, [orgId, module, resource, action, actorType, triggerSource, fromDate, toDate, search])

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0)
    return () => clearTimeout(t)
  }, [load, search])

  const columns = useMemo<ResponsiveColumn<AuditEntry>[]>(
    () => [
      {
        key: 'expand',
        header: '',
        headerClassName: 'w-8 px-2',
        cellClassName: 'w-8 px-2 text-text-muted align-top',
        hideOnMobile: true,
        render: (e) => (hasChanges(e) ? expanded === e.id ? <ChevronDown size={15} /> : <ChevronRight size={15} /> : null),
      },
      {
        key: 'when',
        header: 'When',
        primary: true,
        cellClassName: 'align-top',
        render: (e) => <span className="text-body text-text-secondary whitespace-nowrap">{fmtDateTime(e.occurred_at)}</span>,
      },
      {
        key: 'actor',
        header: 'Actor',
        cellClassName: 'align-top',
        render: (e) => <ActorCell entry={e} />,
      },
      {
        key: 'action',
        header: 'Action',
        cellClassName: 'align-top',
        render: (e) => <ActionBadge action={e.action} />,
      },
      {
        key: 'module',
        header: 'Module',
        cellClassName: 'align-top',
        render: (e) => {
          const lbl = resourceLabels.get(e.resource)
          return (
            <div className="leading-tight">
              <span className="text-body text-text-primary">{lbl?.module ?? e.resource.replace(/_/g, ' ')}</span>
              {lbl && lbl.type !== lbl.module && (
                <span className="block text-meta text-text-muted">{lbl.type}</span>
              )}
            </div>
          )
        },
      },
      {
        key: 'entity',
        header: 'Entity',
        cellClassName: 'align-top',
        render: (e) => <span className="text-body text-text-primary">{e.entity_label ?? e.entity_id}</span>,
      },
    ],
    [expanded, resourceLabels],
  )

  const toggleRow = useCallback((e: AuditEntry) => {
    if (hasChanges(e)) setExpanded((cur) => (cur === e.id ? null : e.id))
  }, [])

  if (denied)
    return (
      <div className="py-12 text-center">
        <h2 className="text-section font-medium text-text-primary">No access</h2>
        <p className="text-body text-text-secondary mt-1">You don&apos;t have permission to view audit logs.</p>
      </div>
    )

  return (
    <div>
      <div className="mb-4">
        <h1 className="flex items-center gap-2 text-page-title font-medium text-text-primary leading-tight">
          <ScrollText size={24} className="text-primary-text" /> Audit Logs
        </h1>
        <p className="text-body text-text-secondary mt-1">
          Software-wide record of who — or what — changed what, and when, across modules.
        </p>
      </div>

      {/* Filters — search spans the full width; controls sit in an even row below */}
      <div className="mb-4 space-y-2">
        <div className="relative w-full">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            className={`${inputClass} w-full pl-8`}
            placeholder="Search by entity or action…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* 1 — Module: the primary, navigation-level filter. ALL_VALUE
              stands in for "" (no filter): Base UI's Select treats an
              item whose value stringifies to "" as having no selection,
              which would make the trigger fall back to its placeholder
              text instead of showing the chosen "All ..." row. */}
          <Select
            value={module || ALL_VALUE}
            onValueChange={(next) => {
              setModule(next === ALL_VALUE ? '' : (next as string))
              setResource('') // reset the dependent Type when the module changes
            }}
          >
            <SelectTrigger className="flex-1 min-w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>All modules</SelectItem>
              {modules.map((m) => (
                <SelectItem key={m.key} value={m.key}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* 2 — Type: stays in place, inactive when the module has no sub-types */}
          <Select
            value={resource || ALL_VALUE}
            disabled={typeDisabled}
            onValueChange={(next) => setResource(next === ALL_VALUE ? '' : (next as string))}
          >
            <SelectTrigger className="flex-1 min-w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {typeDisabled ? (
                <SelectItem value={ALL_VALUE}>Category</SelectItem>
              ) : (
                <>
                  <SelectItem value={ALL_VALUE}>All {selectedModule!.label.toLowerCase()}</SelectItem>
                  {typeOptions.map((r) => (
                    <SelectItem key={r.key} value={r.key}>
                      {r.label}
                    </SelectItem>
                  ))}
                </>
              )}
            </SelectContent>
          </Select>

          {/* 3 — Action */}
          <Select
            value={action || ALL_VALUE}
            onValueChange={(next) => setAction(next === ALL_VALUE ? '' : (next as string))}
          >
            <SelectTrigger className="flex-1 min-w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>All actions</SelectItem>
              <SelectItem value="create">Create</SelectItem>
              <SelectItem value="update">Update</SelectItem>
              <SelectItem value="delete">Delete</SelectItem>
            </SelectContent>
          </Select>

          {/* 4 — Actor */}
          <Select
            value={actorType || ALL_VALUE}
            onValueChange={(next) => setActorType(next === ALL_VALUE ? '' : (next as string))}
          >
            <SelectTrigger className="flex-1 min-w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>User &amp; System</SelectItem>
              <SelectItem value="user">User</SelectItem>
              <SelectItem value="system">System</SelectItem>
            </SelectContent>
          </Select>

          {/* 5 — Trigger (only when system entries with a known trigger exist) */}
          <Select
            value={triggerSource || ALL_VALUE}
            disabled={triggerSources.length === 0}
            onValueChange={(next) => setTriggerSource(next === ALL_VALUE ? '' : (next as string))}
          >
            <SelectTrigger className="flex-1 min-w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>All triggers</SelectItem>
              {triggerSources.map((t) => (
                <SelectItem key={t} value={t}>
                  {triggerLabel(t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Date range — single tab, opens a calendar with quick presets */}
          <DateRangePicker
            wrapperClassName="flex-1 min-w-[190px]"
            from={fromDate}
            to={toDate}
            max={todayIso}
            onChange={(f, t) => {
              setFromDate(f)
              setToDate(t)
            }}
          />
        </div>
      </div>

      {/* Table */}
      <ResponsiveTable
        columns={columns}
        rows={items}
        rowKey={(e) => e.id}
        loading={loading}
        onRowClick={toggleRow}
        isExpanded={(e) => expanded === e.id && hasChanges(e)}
        renderExpanded={(e) => <AuditExpandedDetail entry={e} />}
        emptyState={
          <div className="bg-surface border border-border-light rounded-card overflow-hidden">
            <div className="p-8 text-center text-body text-text-secondary">No audit entries.</div>
          </div>
        }
      />
    </div>
  )
}
