'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Ticket as TicketIcon } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { ticketsApi } from '@/lib/api/tickets'
import type { Ticket } from '@/lib/types/tickets'
import TicketCard from '@/components/tickets/TicketCard'

export default function AssignedTicketsPage() {
  const { user } = useAuth()
  const router = useRouter()
  const orgId = user?.organizationId ?? ''

  const [tickets, setTickets] = useState<Ticket[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    try {
      setTickets(await ticketsApi.listAssigned(orgId))
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => { load() }, [load])

  const needsAcceptance = tickets.filter((t) => t.status?.type === 'assigned')
  const overdueSla = tickets.filter((t) => t.sla_breached)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[22px] font-bold text-text-primary">Assigned to Me</h1>
        <p className="text-sm text-text-secondary mt-0.5">
          {tickets.length} ticket{tickets.length !== 1 ? 's' : ''} assigned
          {needsAcceptance.length > 0 && ` · ${needsAcceptance.length} pending acceptance`}
          {overdueSla.length > 0 && ` · ${overdueSla.length} SLA breached`}
        </p>
      </div>

      {loading ? (
        <div className="flex flex-col gap-2">
          {[1, 2, 3].map((i) => <div key={i} className="h-16 bg-surface-control rounded-[12px] animate-pulse" />)}
        </div>
      ) : tickets.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 border border-dashed border-border-light rounded-[12px]">
          <TicketIcon size={28} className="text-[#CBD5E1] mb-3" />
          <p className="text-sm font-medium text-text-primary">No tickets assigned to you</p>
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
