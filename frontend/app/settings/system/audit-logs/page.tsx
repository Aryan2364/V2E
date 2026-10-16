'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ScrollText, ChevronDown, ChevronRight, Search } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { auditApi, type AuditFilters } from '@/lib/api/audit'
import type { AuditEntry, AuditModuleFacet } from '@/lib/types/audit'
import ResponsiveTable, { type ResponsiveColumn } from '@/components/ui/ResponsiveTable'
import SelectField from '@/components/ui/SelectField'
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
  'rounded-[8px] border border-border bg-white px-3.5 py-2.5 text-[15px] text-text-primary placeholder:text-text-muted focus:outline-hidden focus:border-primary focus:ring-1 focus:ring-primary transition-colors'

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
        cellClassName: 'w-8 px-2 text-[#CBD5E1] align-top',
        hideOnMobile: true,
        render: (e) => (hasChanges(e) ? expanded === e.id ? <ChevronDown size={15} /> : <ChevronRight size={15} /> : null),
      },
      {
        key: 'when',
        header: 'When',
        primary: true,
        cellClassName: 'align-top',
        render: (e) => <span className="text-sm text-text-secondary whitespace-nowrap">{fmtDateTime(e.occurred_at)}</span>,
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
              <span className="text-sm text-text-primary">{lbl?.module ?? e.resource.replace(/_/g, ' ')}</span>
              {lbl && lbl.type !== lbl.module && (
                <span className="block text-xs text-text-muted">{lbl.type}</span>
              )}
            </div>
          )
        },
      },
      {
        key: 'entity',
        header: 'Entity',
        cellClassName: 'align-top',
        render: (e) => <span className="text-sm text-text-primary">{e.entity_label ?? e.entity_id}</span>,
      },
    ],
    [expanded, resourceLabels],
  )

  const toggleRow = useCallback((e: AuditEntry) => {
    if (hasChanges(e)) setExpanded((cur) => (cur === e.id ? null : e.id))
  }, [])

  if (denied)
    return (
      <div className="py-16 text-center">
        <h2 className="text-[18px] font-semibold text-text-primary">No access</h2>
        <p className="text-sm text-text-secondary mt-1">You don&apos;t have permission to view audit logs.</p>
      </div>
    )

  return (
    <div>
      <div className="mb-5">
        <h1 className="flex items-center gap-2 text-[26px] font-bold text-text-primary leading-tight">
          <ScrollText size={24} className="text-primary-text" /> Audit Logs
        </h1>
        <p className="text-sm text-text-secondary mt-1">
          Software-wide record of who — or what — changed what, and when, across modules.
        </p>
      </div>

      {/* Filters — search spans the full width; controls sit in an even row below */}
      <div className="mb-4 space-y-2">
        <div className="relative w-full">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            className={`${inputClass} w-full pl-9`}
            placeholder="Search by entity or action…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* 1 — Module: the primary, navigation-level filter */}
          <SelectField
            wrapperClassName="flex-1 min-w-[150px]"
            value={module}
            onChange={(e) => {
              setModule(e.target.value)
              setResource('') // reset the dependent Type when the module changes
            }}
          >
            <option value="">All modules</option>
            {modules.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </SelectField>

          {/* 2 — Type: stays in place, inactive when the module has no sub-types */}
          <SelectField
            wrapperClassName="flex-1 min-w-[150px]"
            value={resource}
            disabled={typeDisabled}
            onChange={(e) => setResource(e.target.value)}
          >
            {typeDisabled ? (
              <option value="">Category</option>
            ) : (
              <>
                <option value="">All {selectedModule!.label.toLowerCase()}</option>
                {typeOptions.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.label}
                  </option>
                ))}
              </>
            )}
          </SelectField>

          {/* 3 — Action */}
          <SelectField wrapperClassName="flex-1 min-w-[140px]" value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">All actions</option>
            <option value="create">Create</option>
            <option value="update">Update</option>
            <option value="delete">Delete</option>
          </SelectField>

          {/* 4 — Actor */}
          <SelectField wrapperClassName="flex-1 min-w-[140px]" value={actorType} onChange={(e) => setActorType(e.target.value)}>
            <option value="">User &amp; System</option>
            <option value="user">User</option>
            <option value="system">System</option>
          </SelectField>

          {/* 5 — Trigger (only when system entries with a known trigger exist) */}
          <SelectField
            wrapperClassName="flex-1 min-w-[140px]"
            value={triggerSource}
            disabled={triggerSources.length === 0}
            onChange={(e) => setTriggerSource(e.target.value)}
          >
            <option value="">All triggers</option>
            {triggerSources.map((t) => (
              <option key={t} value={t}>
                {triggerLabel(t)}
              </option>
            ))}
          </SelectField>

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
          <div className="bg-white border border-border-light rounded-[12px] overflow-hidden">
            <div className="p-10 text-center text-sm text-text-secondary">No audit entries.</div>
          </div>
        }
      />
    </div>
  )
}
