'use client'

// Small presentational pieces shared by every bulk-import view (preview, result,
// history, batch detail). They carry no entity knowledge.

import type { ReactNode } from 'react'
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronRight, Download, Loader2, Undo2, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import Tooltip from '@/components/ui/tooltip'
import { formatDateTime } from '@/lib/format'
import type { ImportIssue } from '@/lib/import/types'

type Tone = 'slate' | 'green' | 'red' | 'amber'

/** A clickable filter chip; the active one is solid. */
export function FilterChip({
  color,
  label,
  active,
  onClick,
}: {
  color: Tone
  label: string
  active: boolean
  onClick: () => void
}) {
  const palette = {
    slate: {
      on: 'bg-text-primary text-surface border-text-primary',
      off: 'bg-surface-control text-text-secondary border-border-light hover:bg-surface-control-pressed',
    },
    green: { on: 'bg-success text-primary-foreground border-success', off: 'bg-success-bg text-success border-success-border' },
    red: { on: 'bg-danger text-on-danger border-danger', off: 'bg-danger-bg text-danger border-danger-border' },
    amber: { on: 'bg-warning text-primary-foreground border-warning-border', off: 'bg-warning-bg text-warning border-warning-border' },
  }[color]
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center px-2.5 py-1 rounded-lg border text-meta font-medium transition-colors ${active ? palette.on : palette.off}`}
    >
      {label}
    </button>
  )
}

/** A static (non-clickable) summary chip. */
export function SummaryChip({ color, label }: { color: 'green' | 'red' | 'amber' | 'blue'; label: string }) {
  const styles = {
    green: 'bg-success-bg text-success',
    red: 'bg-danger-bg text-danger',
    amber: 'bg-warning-bg text-warning',
    blue: 'bg-primary-subtle text-primary-text',
  }[color]
  return <span className={`text-meta font-medium rounded-full px-2.5 py-1 ${styles}`}>{label}</span>
}

/** A bordered count tile with an icon: "12 imported", "3 failed", "2 removed". */
export function StatTile({ tone, icon, label }: { tone: 'success' | 'danger' | 'warning' | 'neutral'; icon: ReactNode; label: string }) {
  const box = {
    success: 'bg-success-bg border-success-border text-success',
    danger: 'bg-danger-bg border-danger-border text-danger',
    warning: 'bg-warning-bg border-warning-border text-warning',
    neutral: 'bg-surface-control border-border-light text-text-secondary',
  }[tone]
  return (
    <div className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border ${box}`}>
      {icon}
      <span className="text-body font-medium">{label}</span>
    </div>
  )
}

export const SuccessTile = ({ label }: { label: string }) => (
  <StatTile tone="success" icon={<CheckCircle2 size={16} />} label={label} />
)
export const FailedTile = ({ label }: { label: string }) => (
  <StatTile tone="danger" icon={<AlertCircle size={16} />} label={label} />
)

/** Ready / error status with a coloured dot. */
const STATUS_STYLES = {
  ready: { dot: 'bg-success', text: 'text-success', label: 'Ready' },
  duplicate: { dot: 'bg-danger', text: 'text-danger', label: 'Duplicate' },
  error: { dot: 'bg-danger', text: 'text-danger', label: 'Error' },
} as const

export function StatusDot({ status }: { status: keyof typeof STATUS_STYLES }) {
  const s = STATUS_STYLES[status]
  return (
    <span className={`inline-flex items-center gap-1.5 font-medium ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  )
}

/** Zebra striping; problem rows keep a solid red tint, also on hover. */
export function previewRowClass(isProblem: boolean, index: number): string {
  return `${isProblem ? 'bg-danger-bg hover:bg-danger-bg' : `${index % 2 === 1 ? 'bg-surface-sunken' : 'bg-surface'} hover:bg-surface-control`} transition-colors`
}

/** A row's validation issues, errors in red and warnings in amber. */
export function IssueList({ issues }: { issues: readonly ImportIssue[] }) {
  if (issues.length === 0) return <span className="text-text-muted">—</span>
  return (
    <ul className="space-y-0.5">
      {issues.map((iss, k) => (
        <li key={k} className={`flex items-start gap-1 ${iss.severity === 'error' ? 'text-danger' : 'text-warning'}`}>
          {iss.severity === 'error' ? (
            <AlertCircle size={13} className="mt-0.5 shrink-0" />
          ) : (
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          )}
          <span>{iss.message}</span>
        </li>
      ))}
    </ul>
  )
}

/** Bordered, height-bounded table with a sticky header. */
export function PreviewTable({
  headers,
  maxHeightClass,
  textClass,
  empty,
  children,
}: {
  headers: string[]
  maxHeightClass: string
  textClass: string
  /** Shown instead of rows when there are none. */
  empty?: boolean
  children: ReactNode
}) {
  return (
    <div className="border border-border-light rounded-lg overflow-hidden">
      <div className={`${maxHeightClass} overflow-auto`}>
        <table className={`w-full ${textClass}`}>
          <thead className="bg-surface-sunken sticky top-0 z-10">
            <tr className="text-left text-text-muted">
              {headers.map((h) => (
                <th key={h} className="px-3 py-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-control-pressed">
            {empty ? (
              <tr>
                <td colSpan={headers.length} className={`px-3 py-8 text-center ${textClass} text-text-muted`}>
                  No rows in this category.
                </td>
              </tr>
            ) : (
              children
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** "N of M rows are ready ... download only the failing rows to fix" guidance. */
export function FixLoopBanner({
  ready,
  total,
  notReady,
  detailed,
  onDownload,
}: {
  ready: number
  total: number
  notReady: number
  /** The longer wording that explains the fix-and-reupload loop. */
  detailed: boolean
  onDownload: () => void
}) {
  if (notReady === 0) return null
  const rowWord = notReady === 1 ? 'row' : 'rows'
  return (
    <div className="flex items-start gap-3 p-3.5 rounded-lg bg-primary-subtle border border-primary-border">
      <Wrench size={18} className="text-primary-text mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-body text-primary-text">
          <strong>
            {ready} of {total} rows are ready
          </strong>{' '}
          and will be imported now. The other{' '}
          <strong>
            {notReady} {rowWord}
          </strong>{' '}
          {notReady === 1 ? 'has a problem' : 'have problems'} and will be skipped
          {detailed ? ' — your ready rows aren’t affected.' : '.'}
        </p>
        {detailed && (
          <p className="text-body text-primary-text mt-1">
            Download a file with{' '}
            <strong>
              only those {notReady} {rowWord}
            </strong>{' '}
            (each tagged with the reason it failed), fix them there, and re-upload just that file — no need to touch the rows
            that already passed.
          </p>
        )}
        <Button size="sm" className="mt-2.5" onClick={onDownload}>
          <Download size={14} /> Download {notReady} {rowWord} to fix
        </Button>
      </div>
    </div>
  )
}

/** A titled, bordered, scrolling list section ("Rows that need fixing"). */
export function ListSection({ title, maxHeightClass = 'max-h-56', children }: { title: string; maxHeightClass?: string; children: ReactNode }) {
  return (
    <div className="border border-border-light rounded-lg overflow-hidden">
      <div className="px-4 py-2.5 bg-surface-sunken border-b border-border-light">
        <p className="text-meta font-medium text-text-secondary uppercase tracking-wider">{title}</p>
      </div>
      <div className={`${maxHeightClass} overflow-y-auto divide-y divide-surface-control`}>{children}</div>
    </div>
  )
}

/** One failed row: "Row 4 · name" and the reason beneath it. */
export function FailedRowItem({ row, label, error }: { row: number; label?: string; error?: string }) {
  return (
    <div className="px-4 py-2.5">
      <p className="text-body font-medium text-text-primary">
        Row {row}
        {label ? ` · ${label}` : ''}
      </p>
      <p className="text-body text-danger mt-0.5">{error}</p>
    </div>
  )
}

/** A neutral grey info note with an icon. */
export function InfoNote({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 p-3 rounded-lg bg-surface-sunken border border-border-light">
      {icon}
      <p className="text-label text-text-muted">{children}</p>
    </div>
  )
}

/** "Download N rows to fix & re-upload" secondary action. */
export function DownloadFixesButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button variant="secondary" size="sm" onClick={onClick}>
      <Download size={14} /> {label}
    </Button>
  )
}

export function UndoButton({
  onClick,
  undoing,
  label = 'Undo this import',
  size = 'default',
  className,
  disabled,
}: {
  onClick: () => void
  undoing: boolean
  disabled?: boolean
  label?: string
  size?: 'default' | 'sm'
  className?: string
}) {
  return (
    <Button variant="danger" size={size} className={className} onClick={onClick} disabled={disabled} loading={undoing} loadingLabel="Undoing…">
      <Undo2 size={size === 'sm' ? 13 : 14} /> {label}
    </Button>
  )
}

/** The empty-history message. */
export function NoImportsYet() {
  return <p className="text-body text-text-muted py-8 text-center">No imports yet.</p>
}

/** Skeleton-free loading line for a batch detail. */
export function LoadingDetail() {
  return (
    <div className="flex items-center justify-center py-12 text-text-muted">
      <Loader2 size={20} className="animate-spin mr-2" /> Loading import details…
    </div>
  )
}

/** The kept-on-undo list ("they already had activity"). */
export function KeptList({ intro, kept }: { intro: string; kept: { key: string; name: string; reason: string }[] }) {
  if (kept.length === 0) return null
  return (
    <div className="border border-border-light rounded-lg p-4 space-y-2">
      <p className="text-label text-warning">{intro}</p>
      <ul className="space-y-1 max-h-52 overflow-y-auto pr-1">
        {kept.map((k) => (
          <li key={k.key} className="text-label text-text-secondary">
            <span className="font-medium text-text-primary">{k.name}</span> — {k.reason}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The common batch-history list: file name, status, counts, open and undo. */
export function BatchHistoryList<B extends { id: string; file_name: string | null; status: string; created_at: string; imported_by: string; created_count: number; failed_count: number; remaining: number; can_undo: boolean }>({
  batches,
  onUndo,
  onOpen,
  undoingId,
  noUndoLabel,
  above,
}: {
  batches: B[]
  onUndo: (id: string) => void
  /** When set, a row opens the batch detail. */
  onOpen?: (id: string) => void
  undoingId: string | null
  noUndoLabel: (b: B) => string
  above?: ReactNode
}) {
  if (batches.length === 0) return <NoImportsYet />
  return (
    <div className="space-y-3">
      {above}
      <div className="border border-border-light rounded-lg divide-y divide-surface-control">
        {batches.map((b) => {
          const body = (
            <>
              <div className="flex-1 min-w-0">
                <p className="text-body font-medium text-text-primary truncate group-hover:text-primary-text transition-colors">
                  {b.file_name || 'Untitled import'}
                  {b.status !== 'committed' && (
                    <span className="ml-2 text-meta font-medium text-text-muted uppercase">{b.status.replace('_', ' ')}</span>
                  )}
                </p>
                <p className="text-meta text-text-muted mt-0.5">
                  {formatDateTime(new Date(b.created_at))} · by {b.imported_by} · {b.created_count} created
                  {b.failed_count > 0 ? `, ${b.failed_count} failed` : ''} · {b.remaining} still present
                </p>
              </div>
              {onOpen && (
                <ChevronRight size={16} className="shrink-0 text-text-muted group-hover:text-primary-text transition-colors" />
              )}
            </>
          )
          return (
            <div key={b.id} className="px-4 py-3 flex items-center gap-3">
              {onOpen ? (
                <Tooltip label="Open this import’s details">
                  <button type="button" onClick={() => onOpen(b.id)} className="flex-1 min-w-0 flex items-center gap-2 text-left group">
                    {body}
                  </button>
                </Tooltip>
              ) : (
                <div className="flex-1 min-w-0 flex items-center gap-2 group">{body}</div>
              )}
              {b.can_undo ? (
                <UndoButton size="sm" label="Undo" className="shrink-0" undoing={undoingId === b.id} onClick={() => onUndo(b.id)} />
              ) : (
                <span className="text-meta text-text-muted shrink-0">{noUndoLabel(b)}</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
