import { Video, FileText, Link2, BookOpen, File as FileIcon } from 'lucide-react'
import type { ContentType } from '@/lib/types/learning'

const CONFIG: Record<ContentType, { label: string; Icon: any; classes: string }> = {
  video: {
    label: 'Video',
    Icon: Video,
    classes: 'bg-primary-subtle text-primary-text',
  },
  file: {
    label: 'File',
    Icon: FileIcon,
    classes: 'bg-primary-subtle text-primary-text',
  },
  document: {
    label: 'Document',
    Icon: FileText,
    classes: 'bg-success-bg text-success',
  },
  url: {
    label: 'URL',
    Icon: Link2,
    classes: 'bg-warning-bg text-warning',
  },
  article: {
    label: 'Article',
    Icon: BookOpen,
    classes: 'bg-surface-control text-text-secondary',
  },
}

export default function ItemTypeBadge({ type }: { type: ContentType }) {
  const { label, Icon, classes } = CONFIG[type] ?? CONFIG.article
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-meta font-medium ${classes}`}>
      <Icon size={11} />
      {label}
    </span>
  )
}
