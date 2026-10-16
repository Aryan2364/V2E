'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Search, Filter } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { ticketsApi } from '@/lib/api/tickets'
import type { Ticket, TicketType, TicketCategory, TicketPriority, TicketStatus, TicketStats } from '@/lib/types/tickets'
import TicketCard from '@/components/tickets/TicketCard'
import AccessHiddenState from '@/components/ui/AccessHiddenState'
import StyledSelect from '@/components/ui/StyledSelect'
import { usePermissions } from '@/lib/auth/use-permissions'
import PageHeader from '@/components/shell/page-header'
import { Button } from '@/components/ui/button'
import { TextLink } from '@/components/ui/text-link'

export default function TicketsPage() {
  const { user } = useAuth()
  const router = useRouter()
  const orgId = user?.organizationId ?? ''
  const { can, loading: permsLoading } = usePermissions()

  const [tickets, setTickets] = useState<Ticket[]>([])
  const [stats, setStats] = useState<TicketStats | null>(null)
  const [types, setTypes] = useState<TicketType[]>([])
  const [categories, setCategories] = useState<TicketCategory[]>([])
  const [priorities, setPriorities] = useState<TicketPriority[]>([])
  const [statuses, setStatuses] = useState<TicketStatus[]>([])
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [filterPriority, setFilterPriority] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterSla, setFilterSla] = useState('')

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    try {
      const [ticketData, statsData, typesData, catsData, priData, stData] = await Promise.all([
        ticketsApi.list(orgId, {
          typeId: filterType || undefined,
          categoryId: filterCategory || undefined,
          priorityId: filterPriority || undefined,
          statusId: filterStatus || undefined,
          slaBreached: filterSla === 'breached' ? true : filterSla === 'ok' ? false : undefined,
          search: search || undefined,
        }),
        ticketsApi.getStats(orgId),
        ticketsApi.listTypes(orgId),
        ticketsApi.listCategories(orgId),
        ticketsApi.listPriorities(orgId),
        ticketsApi.listStatuses(orgId),
      ])
      setTickets(ticketData)
      setStats(statsData)
      setTypes(typesData)
      setCategories(catsData)
      setPriorities(priData)
      setStatuses(stData)
    } finally {
      setLoading(false)
    }
  }, [orgId, filterType, filterCategory, filterPriority, filterStatus, filterSla, search])

  useEffect(() => { load() }, [load])

  const statCard = (label: string, value: number, color: string) => (
    <div className="bg-surface border border-border-light rounded-card shadow-card p-4 flex-1">
      <p className="text-meta font-medium text-text-secondary mb-1">{label}</p>
      <p className="text-page-title font-medium" style={{ color }}>{value}</p>
    </div>
  )

  const hasFilters = filterType || filterCategory || filterPriority || filterStatus || filterSla

  if (!permsLoading && !can('tickets.ticket.manage', 'read')) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Tickets" />
        <AccessHiddenState orgId={orgId} leaf="tickets.ticket.manage" moduleLabel="Tickets" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Tickets"
        meta="Track and manage support requests"
        actions={
          <Button onClick={() => router.push('/dashboard/tasks/tickets/new')}>
            <Plus size={15} /> Raise ticket
          </Button>
        }
      />

      {/* Stats */}
      {stats && (
        <div className="flex gap-3 flex-wrap">
          {statCard('Open', stats.open, 'var(--primary-text)')}
          {statCard('Assigned to Me', stats.assignedToMe, 'var(--text-secondary)')}
          {statCard('SLA Breached', stats.slaBreached, 'var(--danger)')}
          {statCard('Resolved This Month', stats.resolvedThisMonth, 'var(--success)')}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tickets..."
            className="w-full pl-8 pr-3 py-1.5 border border-border rounded-[7px] text-body text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-hidden"
          />
        </div>
        <StyledSelect
          value={filterType}
          onChange={(v) => setFilterType(v)}
          placeholder="All Types"
          wrapperClassName="w-40"
          options={[
            { value: '', label: 'All Types' },
            ...types.map((t) => ({ value: t.id, label: `${t.icon} ${t.name}`, color: t.color })),
          ]}
        />
        <StyledSelect
          value={filterCategory}
          onChange={(v) => setFilterCategory(v)}
          placeholder="All Categories"
          wrapperClassName="w-40"
          options={[
            { value: '', label: 'All Categories' },
            ...categories.map((c) => ({ value: c.id, label: c.name, color: c.color })),
          ]}
        />
        <StyledSelect
          value={filterPriority}
          onChange={(v) => setFilterPriority(v)}
          placeholder="All Priorities"
          wrapperClassName="w-40"
          options={[
            { value: '', label: 'All Priorities' },
            ...priorities.map((p) => ({ value: p.id, label: p.label, color: p.color })),
          ]}
        />
        <StyledSelect
          value={filterStatus}
          onChange={(v) => setFilterStatus(v)}
          placeholder="All Statuses"
          wrapperClassName="w-40"
          options={[
            { value: '', label: 'All Statuses' },
            ...statuses.map((s) => ({ value: s.id, label: s.label, color: s.color })),
          ]}
        />
        <StyledSelect
          value={filterSla}
          onChange={(v) => setFilterSla(v)}
          placeholder="SLA Status"
          wrapperClassName="w-40"
          options={[
            { value: '', label: 'SLA Status' },
            { value: 'breached', label: 'Breached' },
            { value: 'ok', label: 'Within SLA' },
          ]}
        />
        {hasFilters && (
          <TextLink
            render={<button type="button" />}
            onClick={() => { setFilterType(''); setFilterCategory(''); setFilterPriority(''); setFilterStatus(''); setFilterSla('') }}
          >
            Clear
          </TextLink>
        )}
      </div>

      {/* List */}
      {loading ? (
        <div className="flex flex-col gap-2">
          {[1, 2, 3, 4].map((i) => <div key={i} className="h-16 bg-surface-control rounded-[12px] animate-pulse" />)}
        </div>
      ) : tickets.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 border border-dashed border-border-light rounded-[12px]">
          <Filter size={28} className="text-muted mb-3" />
          <p className="text-body font-medium text-text-primary">No tickets found</p>
          <p className="text-meta text-text-secondary mt-1">{hasFilters || search ? 'Try adjusting your filters' : 'Raise the first ticket to get started'}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {tickets.map((ticket) => (
            <TicketCard
              key={ticket.id}
              ticket={ticket}
              onClick={() => router.push(`/dashboard/tasks/tickets/${ticket.id}`)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
