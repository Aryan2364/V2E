'use client'

import { ExternalLink, Trash2, FileText, Link2, Image } from 'lucide-react'
import type { ProjectDocument } from '@/lib/types/projects'

function typeIcon(type?: string) {
  if (!type) return <Link2 size={18} className="text-text-secondary" />
  if (type === 'pdf') return <FileText size={18} className="text-danger" />
  if (['jpg', 'jpeg', 'png', 'gif', 'svg'].includes(type)) return <Image size={18} className="text-text-secondary" />
  return <FileText size={18} className="text-text-secondary" />
}

interface DocumentCardProps {
  doc: ProjectDocument
  canDelete: boolean
  onDelete: (id: string) => void
}

export default function DocumentCard({ doc, canDelete, onDelete }: DocumentCardProps) {
  return (
    <div className="bg-white border border-border-light rounded-[12px] p-4 shadow-[0_1px_3px_rgba(0,0,0,0.08)] flex items-start gap-3">
      <div className="w-10 h-10 rounded-[8px] bg-surface-sunken border border-border-light flex items-center justify-center shrink-0">
        {typeIcon(doc.type)}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-text-primary truncate">{doc.name}</p>
        {doc.type && (
          <p className="text-xs text-text-muted uppercase">{doc.type}</p>
        )}
        <p className="text-xs text-text-muted mt-0.5">
          {new Date(doc.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <a
          href={doc.url}
          target="_blank"
          rel="noopener noreferrer"
          className="p-1.5 rounded-[6px] hover:bg-surface-control text-text-secondary hover:text-text-primary transition-colors"
        >
          <ExternalLink size={14} />
        </a>
        {canDelete && (
          <button
            type="button"
            onClick={() => onDelete(doc.id)}
            className="p-1.5 rounded-[6px] hover:bg-danger-bg text-danger transition-colors"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
    </div>
  )
}
