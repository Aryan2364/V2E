import type { TicketStatus } from '@/lib/types/tickets'

interface Props {
  status: TicketStatus
}

export default function TicketStatusBadge({ status }: Props) {
  return (
    <span
      className="inline-flex items-center rounded-[999px] px-2.5 py-0.5 text-meta font-medium"
      style={{
        backgroundColor: status.color + '22',
        color: status.color,
        border: `1px solid ${status.color}44`,
      }}
    >
      {status.label}
    </span>
  )
}
