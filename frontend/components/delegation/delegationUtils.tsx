import type { DelegationStatus } from '@/lib/api/delegations'

const STATUS_META: Record<DelegationStatus, { label: string; cls: string }> = {
  active: { label: 'Active', cls: 'bg-surface-control text-text-secondary border-border-light' },
  completed: { label: 'Completed', cls: 'bg-success-bg text-success border-success-border' },
  cancelled: { label: 'Cancelled', cls: 'bg-danger-bg text-danger border-danger-border' },
}

export function StatusPill({ status }: { status: DelegationStatus }) {
  const m = STATUS_META[status]
  return (
    <span className={`inline-flex items-center rounded-[999px] border px-2.5 py-0.5 text-[12px] font-medium ${m.cls}`}>
      {m.label}
    </span>
  )
}

export function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}
