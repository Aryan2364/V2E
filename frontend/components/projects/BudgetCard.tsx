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
    <div className="bg-surface border border-border-light rounded-card p-6 shadow-card">
      <h3 className="text-body font-medium text-text-primary mb-3">Budget</h3>
      <div className="flex justify-between text-body mb-2">
        <span className="text-text-secondary">Planned</span>
        <span className="font-medium text-text-primary">{planned ? fmt(planned, currency) : '—'}</span>
      </div>
      <div className="flex justify-between text-body mb-3">
        <span className="text-text-secondary">Actual spent</span>
        <span className={`font-medium ${over ? 'text-danger' : 'text-text-primary'}`}>
          {actual ? fmt(actual, currency) : '—'}
        </span>
      </div>
      {planned && actual ? (
        <div className="w-full h-2 rounded-full bg-surface-control overflow-hidden">
          <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: barColor }} />
        </div>
      ) : null}
      {over && (
        <p className="text-meta text-danger mt-1">Over budget by {fmt(actual! - planned!, currency)}</p>
      )}
    </div>
  )
}
