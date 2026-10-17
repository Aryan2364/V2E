'use client'

import React, { Suspense, useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Search, Filter } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { ticketsApi } from '@/lib/api/tickets'
import type { Ticket, TicketType, TicketCategory, TicketPriority, TicketStatus, TicketStats } from '@/lib/types/tickets'
import TicketCard from '@/components/tickets/TicketCard'
import AccessHiddenState from '@/components/ui/AccessHiddenState'
import StyledSelect from '@/components/ui/StyledSelect'
import { usePermissions } from '@/lib/auth/use-permissions'
import { PageHeader } from '@/components/shell/page-header'
import { Button } from '@/components/ui/button'
import { TextLink } from '@/components/ui/text-link'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Pagination,
  PaginationBar,
  PaginationContent,
  PaginationCount,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination'
import { useListAddress, queryOf, type AddressParams } from '@/lib/list-address'

const PAGE_SIZE = 25

type Criteria = {
  q: string
  typeId: string
  categoryId: string
  priorityId: string
  statusId: string
  sla: string
  page: number
}

const DEFAULT_CRITERIA: Criteria = { q: '', typeId: '', categoryId: '', priorityId: '', statusId: '', sla: '', page: 1 }

function readCriteria(params: AddressParams): Criteria {
  return {
    q: params.get('q') ?? '',
    typeId: params.get('typeId') ?? '',
    categoryId: params.get('categoryId') ?? '',
    priorityId: params.get('priorityId') ?? '',
    statusId: params.get('statusId') ?? '',
    sla: params.get('sla') ?? '',
    page: Number(params.get('page')) > 0 ? Number(params.get('page')) : 1,
  }
}

function criteriaQuery(c: Criteria): string {
  return queryOf([
    ['q', c.q.trim()],
    ['typeId', c.typeId],
    ['categoryId', c.categoryId],
    ['priorityId', c.priorityId],
    ['statusId', c.statusId],
    ['sla', c.sla],
    ['page', c.page !== 1 && c.page.toString()],
  ])
}

function TicketsPageInner() {
  const { user } = useAuth()
  const router = useRouter()
  const orgId = user?.organizationId ?? ''
  const { can, loading: permsLoading } = usePermissions()

  const { criteria, apply } = useListAddress<Criteria>({ read: readCriteria, query: criteriaQuery })
  const { q: search, typeId: filterType, categoryId: filterCategory, priorityId: filterPriority, statusId: filterStatus, sla: filterSla, page } = criteria

  const [tickets, setTickets] = useState<Ticket[]>([])
  const [total, setTotal] = useState(0)
  const [stats, setStats] = useState<TicketStats | null>(null)
  const [types, setTypes] = useState<TicketType[]>([])
  const [categories, setCategories] = useState<TicketCategory[]>([])
  const [priorities, setPriorities] = useState<TicketPriority[]>([])
  const [statuses, setStatuses] = useState<TicketStatus[]>([])
  const [loading, setLoading] = useState(true)

  // Local, immediate value for the search box; written to the address (replace)
  // 300ms after typing stops (kit §27.1), so each keystroke pause isn't a Back step.
  const [searchInput, setSearchInput] = useState(search)
  useEffect(() => setSearchInput(search), [search])
  useEffect(() => {
    const t = setTimeout(() => {
      if (searchInput !== search) apply({ ...criteria, q: searchInput, page: 1 }, 'replace')
    }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput])

  const setFilter = useCallback(
    (patch: Partial<Criteria>) => apply({ ...criteria, ...patch, page: 1 }, 'push'),
    [apply, criteria],
  )
  const setPage = useCallback((next: number) => apply({ ...criteria, page: next }, 'push'), [apply, criteria])

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    try {
      const [ticketData, statsData, typesData, catsData, priData, stData] = await Promise.all([
        ticketsApi.listPaged(orgId, {
          typeId: filterType || undefined,
          categoryId: filterCategory || undefined,
          priorityId: filterPriority || undefined,
          statusId: filterStatus || undefined,
          slaBreached: filterSla === 'breached' ? true : filterSla === 'ok' ? false : undefined,
          search: search || undefined,
          page,
          pageSize: PAGE_SIZE,
        }),
        ticketsApi.getStats(orgId),
        ticketsApi.listTypes(orgId),
        ticketsApi.listCategories(orgId),
        ticketsApi.listPriorities(orgId),
        ticketsApi.listStatuses(orgId),
      ])
      setTickets(ticketData.items)
      setTotal(ticketData.total)
      setStats(statsData)
      setTypes(typesData)
      setCategories(catsData)
      setPriorities(priData)
      setStatuses(stData)
    } finally {
      setLoading(false)
    }
  }, [orgId, filterType, filterCategory, filterPriority, filterStatus, filterSla, search, page])

  useEffect(() => { load() }, [load])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const rangeEnd = Math.min(page * PAGE_SIZE, total)

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
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search tickets..."
            className="w-full pl-8 pr-3 py-1.5 border border-border rounded-[7px] text-body text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-hidden"
          />
        </div>
        <StyledSelect
          value={filterType}
          onChange={(v) => setFilter({ typeId: v })}
          placeholder="All Types"
          wrapperClassName="w-40"
          options={[
            { value: '', label: 'All Types' },
            ...types.map((t) => ({ value: t.id, label: `${t.icon} ${t.name}`, color: t.color })),
          ]}
        />
        <StyledSelect
          value={filterCategory}
          onChange={(v) => setFilter({ categoryId: v })}
          placeholder="All Categories"
          wrapperClassName="w-40"
          options={[
            { value: '', label: 'All Categories' },
            ...categories.map((c) => ({ value: c.id, label: c.name, color: c.color })),
          ]}
        />
        <StyledSelect
          value={filterPriority}
          onChange={(v) => setFilter({ priorityId: v })}
          placeholder="All Priorities"
          wrapperClassName="w-40"
          options={[
            { value: '', label: 'All Priorities' },
            ...priorities.map((p) => ({ value: p.id, label: p.label, color: p.color })),
          ]}
        />
        <StyledSelect
          value={filterStatus}
          onChange={(v) => setFilter({ statusId: v })}
          placeholder="All Statuses"
          wrapperClassName="w-40"
          options={[
            { value: '', label: 'All Statuses' },
            ...statuses.map((s) => ({ value: s.id, label: s.label, color: s.color })),
          ]}
        />
        <StyledSelect
          value={filterSla}
          onChange={(v) => setFilter({ sla: v })}
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
            onClick={() => apply({ ...DEFAULT_CRITERIA }, 'push')}
          >
            Clear
          </TextLink>
        )}
      </div>

      {/* List */}
      {loading ? (
        <div className="flex flex-col gap-2">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-16" />)}
        </div>
      ) : tickets.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 border border-dashed border-border-light rounded-[12px]">
          <Filter size={28} className="text-muted mb-3" />
          <p className="text-body font-medium text-text-primary">No tickets found</p>
          <p className="text-meta text-text-secondary mt-1">{hasFilters || search ? 'Try adjusting your filters' : 'Raise the first ticket to get started'}</p>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {tickets.map((ticket) => (
              <TicketCard
                key={ticket.id}
                ticket={ticket}
                onClick={() => router.push(`/dashboard/tasks/tickets/${ticket.id}`)}
              />
            ))}
          </div>
          <PaginationBar>
            <PaginationCount>
              {rangeStart}–{rangeEnd} of {total}
            </PaginationCount>
            <Pagination>
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    aria-disabled={page <= 1}
                    onClick={() => page > 1 && setPage(page - 1)}
                  />
                </PaginationItem>
                <PaginationItem>
                  <PaginationLink isActive>{page}</PaginationLink>
                </PaginationItem>
                <PaginationItem>
                  <PaginationNext
                    aria-disabled={page >= totalPages}
                    onClick={() => page < totalPages && setPage(page + 1)}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </PaginationBar>
        </>
      )}
    </div>
  )
}

export default function TicketsPage() {
  return (
    <Suspense fallback={null}>
      <TicketsPageInner />
    </Suspense>
  )
}
