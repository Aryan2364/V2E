'use client'

import { useMemo, useRef, useState } from 'react'
import { Search, Check, CheckCheck, X } from 'lucide-react'
import type { EmployeeProfile } from '@/lib/types'

/**
 * Reusable people multi-select for assigning a course. Search filters by person,
 * role, or department; "Select all" toggles everything currently matching; and when
 * the search box is empty the already-selected people float to the top so you can see
 * your picks at a glance. Shared by the Assign modal and the builder's people section.
 */
export default function AssigneeMultiSelect({
  employees,
  selected,
  onChange,
  heightClass = 'max-h-72',
}: {
  employees: EmployeeProfile[]
  selected: string[]
  onChange: (ids: string[]) => void
  heightClass?: string
}) {
  const [q, setQ] = useState('')
  const selectedSet = useMemo(() => new Set(selected), [selected])

  // Keep the latest selection available WITHOUT making the list order depend on it —
  // so toggling a checkbox never re-sorts the list (which would jump the scroll).
  const selectedRef = useRef(selected)
  selectedRef.current = selected

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase()
    const list = employees.filter((e: any) => {
      if (!query) return true
      const hay = [e.user?.name, e.role?.title, e.department?.name]
        .filter(Boolean).join(' ').toLowerCase()
      return hay.includes(query)
    })
    // Float already-selected people to the top, but ONLY recompute when the search
    // (or the roster) changes — not on every selection — so the list stays put while
    // you tick people off. Clearing the search re-sorts and brings your picks up top.
    if (!query) {
      const snapshot = new Set(selectedRef.current)
      return [...list].sort((a: any, b: any) => {
        const sa = snapshot.has(a.id) ? 0 : 1
        const sb = snapshot.has(b.id) ? 0 : 1
        if (sa !== sb) return sa - sb
        return (a.user?.name ?? '').localeCompare(b.user?.name ?? '')
      })
    }
    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employees, q])

  const filteredIds = useMemo(() => filtered.map((e) => e.id), [filtered])
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedSet.has(id))

  function toggle(id: string) {
    onChange(selectedSet.has(id) ? selected.filter((x) => x !== id) : [...selected, id])
  }
  function toggleAllFiltered() {
    if (allFilteredSelected) {
      onChange(selected.filter((id) => !filteredIds.includes(id)))
    } else {
      onChange(Array.from(new Set([...selected, ...filteredIds])))
    }
  }

  return (
    <div className="border border-border rounded-card overflow-hidden">
      {/* Search */}
      <div className="px-3 py-2 border-b border-border-light bg-surface-sunken flex items-center gap-2">
        <Search size={15} className="text-text-muted shrink-0" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name, role or department…"
          className="flex-1 bg-transparent text-label text-text-primary placeholder:text-text-muted focus:outline-hidden"
        />
        {q && (
          <button type="button" onClick={() => setQ('')} className="text-text-muted hover:text-text-secondary shrink-0">
            <X size={14} />
          </button>
        )}
      </div>

      {/* Select-all + counts */}
      <div className="px-3 py-2 border-b border-border-light flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={toggleAllFiltered}
          disabled={filteredIds.length === 0}
          className="inline-flex items-center gap-1.5 text-meta font-medium text-primary-text hover:text-primary-text disabled:text-text-muted disabled:cursor-not-allowed"
        >
          <CheckCheck size={14} />
          {allFilteredSelected ? 'Deselect' : 'Select'} {q ? 'matching' : 'all'} ({filteredIds.length})
        </button>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-meta text-text-muted">{selected.length} selected</span>
          {selected.length > 0 && (
            <button type="button" onClick={() => onChange([])} className="text-meta font-medium text-text-secondary hover:text-danger">
              Clear
            </button>
          )}
        </div>
      </div>

      {/* List */}
      <div className={`${heightClass} overflow-y-auto`}>
        {filtered.length === 0 ? (
          <p className="text-label text-text-muted px-3 py-4 text-center">No people found.</p>
        ) : (
          filtered.map((emp: any) => {
            const checked = selectedSet.has(emp.id)
            return (
              <label
                key={emp.id}
                className={[
                  'flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors border-b border-border-light last:border-0',
                  checked ? 'bg-primary-subtle' : 'hover:bg-surface-sunken',
                ].join(' ')}
              >
                <span className={[
                  'w-4 h-4 rounded-sm flex items-center justify-center border shrink-0',
                  checked ? 'bg-primary border-primary' : 'border-border bg-surface',
                ].join(' ')}>
                  {checked && <Check size={12} className="text-primary-foreground" />}
                </span>
                <input type="checkbox" className="hidden" checked={checked} onChange={() => toggle(emp.id)} />
                <div className="min-w-0">
                  <div className="text-label font-medium text-text-primary truncate">{emp.user?.name}</div>
                  <div className="text-meta text-text-muted truncate">
                    {[emp.role?.title, emp.department?.name].filter(Boolean).join(' · ') || '—'}
                  </div>
                </div>
              </label>
            )
          })
        )}
      </div>
    </div>
  )
}
