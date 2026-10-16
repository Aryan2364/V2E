'use client'

interface BudgetCardProps {
  planned?: number
  actual?: number
  currency: string
}

function fmt(n: number, currency: string) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n)
}

export default function BudgetCard({ planned, actual, currency }: BudgetCardProps) {
  if (!planned && !actual) return null

  const pct = planned && actual ? Math.min(100, (actual / planned) * 100) : 0
  const over = actual && planned && actual > planned
  const barColor = over ? 'var(--danger)' : 'var(--primary-text)'

  return (
    <div className="bg-white border border-border-light rounded-[12px] p-5 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
      <h3 className="text-[15px] font-semibold text-text-primary mb-3">Budget</h3>
      <div className="flex justify-between text-sm mb-2">
        <span className="text-text-secondary">Planned</span>
        <span className="font-semibold text-text-primary">{planned ? fmt(planned, currency) : '—'}</span>
      </div>
      <div className="flex justify-between text-sm mb-3">
        <span className="text-text-secondary">Actual Spent</span>
        <span className={`font-semibold ${over ? 'text-danger' : 'text-text-primary'}`}>
          {actual ? fmt(actual, currency) : '—'}
        </span>
      </div>
      {planned && actual ? (
        <div className="w-full h-2 rounded-full bg-surface-control overflow-hidden">
          <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: barColor }} />
        </div>
      ) : null}
      {over && (
        <p className="text-xs text-danger mt-1">Over budget by {fmt(actual! - planned!, currency)}</p>
      )}
    </div>
  )
}
