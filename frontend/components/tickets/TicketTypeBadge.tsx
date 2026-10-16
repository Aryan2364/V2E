import type { TicketType } from '@/lib/types/tickets'

interface Props {
  type: TicketType
}

export default function TicketTypeBadge({ type }: Props) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-[999px] px-2 py-0.5 text-meta font-medium"
      style={{
        backgroundColor: type.color + '22',
        color: type.color,
        border: `1px solid ${type.color}44`,
      }}
    >
      <span>{type.icon}</span>
      {type.name}
    </span>
  )
}
