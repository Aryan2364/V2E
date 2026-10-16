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
          ? 'border-primary bg-primary-subtle'
          : 'border-border-light bg-surface hover:border-primary-border hover:shadow-xs',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-body font-medium text-text-primary">{template.name}</p>
        <span
          className={`shrink-0 text-meta font-medium px-2 py-0.5 rounded-full ${
            template.template_type === 'full'
              ? 'bg-primary-subtle text-primary-text border border-primary-border'
              : 'bg-surface-sunken text-text-secondary border border-border-light'
          }`}
        >
          {template.template_type === 'full' ? 'Full' : 'Simple'}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {template.ticket_type && <TicketTypeBadge type={template.ticket_type} />}
        {template.priority && (
          <span
            className="inline-flex items-center rounded-[999px] px-2 py-0.5 text-meta font-medium"
            style={{ backgroundColor: template.priority.color + '22', color: template.priority.color, border: `1px solid ${template.priority.color}44` }}
          >
            {template.priority.label}
          </span>
        )}
      </div>
      {template.description_template && (
        <p className="text-meta text-text-secondary line-clamp-2">{template.description_template}</p>
      )}
      {template.checklist_items.length > 0 && (
        <p className="text-meta text-text-muted mt-1.5">
          {template.checklist_items.length} checklist item{template.checklist_items.length !== 1 ? 's' : ''}
        </p>
      )}
    </button>
  )
}
