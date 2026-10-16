'use client'

import type { TicketTemplate } from '@/lib/types/tickets'
import TicketTypeBadge from './TicketTypeBadge'

interface Props {
  template: TicketTemplate
  selected: boolean
  onSelect: () => void
}

export default function TicketTemplateCard({ template, selected, onSelect }: Props) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={[
        'w-full text-left p-4 rounded-[12px] border-2 transition-all',
        selected
          ? 'border-[#2563EB] bg-[#EFF6FF]'
          : 'border-[#E2E8F0] bg-white hover:border-[#93C5FD] hover:shadow-xs',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-sm font-semibold text-[#0F172A]">{template.name}</p>
        <span
          className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full ${
            template.template_type === 'full'
              ? 'bg-[#EFF6FF] text-[#2563EB] border border-[#BFDBFE]'
              : 'bg-[#F8FAFC] text-[#475569] border border-[#E2E8F0]'
          }`}
        >
          {template.template_type === 'full' ? 'Full' : 'Simple'}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {template.ticket_type && <TicketTypeBadge type={template.ticket_type} />}
        {template.priority && (
          <span
            className="inline-flex items-center rounded-[999px] px-2 py-0.5 text-[10px] font-medium"
            style={{ backgroundColor: template.priority.color + '22', color: template.priority.color, border: `1px solid ${template.priority.color}44` }}
          >
            {template.priority.label}
          </span>
        )}
      </div>
      {template.description_template && (
        <p className="text-xs text-[#475569] line-clamp-2">{template.description_template}</p>
      )}
      {template.checklist_items.length > 0 && (
        <p className="text-[10px] text-[#94A3B8] mt-1.5">
          {template.checklist_items.length} checklist item{template.checklist_items.length !== 1 ? 's' : ''}
        </p>
      )}
    </button>
  )
}
