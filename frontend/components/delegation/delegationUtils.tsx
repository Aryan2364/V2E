import type { DelegationStatus } from '@/lib/api/delegations'

const STATUS_META: Record<DelegationStatus, { label: string; cls: string }> = {
  active: { label: 'Active', cls: 'bg-[#E0F2FE] text-[#0369A1] border-[#BAE6FD]' },
  completed: { label: 'Completed', cls: 'bg-[#DCFCE7] text-[#16A34A] border-[#BBF7D0]' },
  cancelled: { label: 'Cancelled', cls: 'bg-[#FEE2E2] text-[#DC2626] border-[#FECACA]' },
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
