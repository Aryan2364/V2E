'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Search, Plus, Check } from 'lucide-react'
import Tooltip from '@/components/ui/tooltip'

export interface PersonOption {
  user_id: string
  name: string
  email?: string
}

interface Props {
  options: PersonOption[]
  value: string[]
  onChange: (ids: string[]) => void
  /** When provided, each chip shows a Required/Optional toggle (like the task CC badge). */
  optional?: string[]
  onToggleOptional?: (id: string) => void
  excludeIds?: string[]
  placeholder?: string
  /** The organiser/host. Always in the meeting — shown as a locked chip, never a pickable row. */
  hostId?: string
  /** Overrides the host's displayed name (e.g. "You"). Falls back to the option's name. */
  hostLabel?: string
  /** userId → reason for people who cannot be invited. Rendered greyed-out & unselectable. */
  ineligibleReasons?: Record<string, string>
}

// ── avatar helpers (shared look with the task Assignees & CC picker) ────────────
const AVATAR_COLORS = ['bg-primary', 'bg-text-secondary', 'bg-success', 'bg-warning', 'bg-danger', 'bg-text-secondary']
function avatarColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h += name.charCodeAt(i)
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}
function initials(name: string): string {
  return name.split(' ').map((n) => n[0] ?? '').join('').toUpperCase().slice(0, 2) || '?'
}

// The host is always in the meeting — a locked chip, never removable and never a
// pickable row (backend auto-adds the organiser).
function HostChip({ name }: { name: string }) {
  return (
    <div className="inline-flex items-center gap-1.5 bg-primary-subtle border border-primary-border rounded-[8px] pl-1.5 pr-2 py-1 max-w-[220px]">
      <div className={`w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold shrink-0 ${avatarColor(name)}`}>
        {initials(name)}
      </div>
      <span className="text-xs font-medium text-text-primary truncate">{name.split(' ')[0]}</span>
      <span className="text-[10px] font-semibold rounded-[4px] px-1.5 py-0.5 bg-white text-primary-text border border-primary-border shrink-0">Host</span>
    </div>
  )
}

function AttendeeChip({
  person, isOptional, showToggle, onToggleOptional, onRemove,
}: {
  person: PersonOption
  isOptional: boolean
  showToggle: boolean
  onToggleOptional: () => void
  onRemove: () => void
}) {
  return (
    <div className="inline-flex items-center gap-1.5 bg-surface-sunken border border-border-light rounded-[8px] pl-1.5 pr-1 py-1 max-w-[200px]">
      <div className={`w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold shrink-0 ${avatarColor(person.name)}`}>
        {initials(person.name)}
      </div>
      <span className="text-xs font-medium text-text-primary truncate">{person.name.split(' ')[0]}</span>
      {showToggle && (
        <Tooltip label={isOptional ? 'Click to make Required' : 'Click to make Optional'}>
          <button
            type="button"
            onClick={onToggleOptional}
            className={`text-[10px] font-semibold rounded-[4px] px-1.5 py-0.5 transition-colors shrink-0 border ${
              isOptional ? 'bg-surface-control text-text-muted border-border-light' : 'bg-primary-subtle text-primary-text border-primary-border'
            }`}
          >
            {isOptional ? 'Optional' : 'Required'}
          </button>
        </Tooltip>
      )}
      <button type="button" onClick={onRemove} className="w-4 h-4 flex items-center justify-center text-text-muted hover:text-danger transition-colors shrink-0" aria-label={`Remove ${person.name}`}>
        <X size={11} />
      </button>
    </div>
  )
}

export default function MeetingAttendeeSelector({
  options, value, onChange, optional = [], onToggleOptional, excludeIds = [], placeholder = 'Add attendees',
  hostId, hostLabel, ineligibleReasons = {},
}: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  const byId = useMemo(() => new Map(options.map((o) => [o.user_id, o])), [options])
  // The host is never a value chip nor a pickable row (backend always adds them).
  const selectedSet = useMemo(() => new Set(value), [value])
  const showToggle = !!onToggleOptional
  const hostName = hostId ? hostLabel ?? byId.get(hostId)?.name ?? 'You' : null
  // Chips exclude the host defensively (never render them as a removable attendee).
  const chipValue = useMemo(() => value.filter((id) => id !== hostId), [value, hostId])

  const list = useMemo(
    () =>
      options.filter(
        (o) =>
          o.user_id !== hostId &&
          !excludeIds.includes(o.user_id) &&
          (o.name.toLowerCase().includes(query.toLowerCase()) || (o.email ?? '').toLowerCase().includes(query.toLowerCase())),
      ),
    [options, excludeIds, hostId, query],
  )

  useEffect(() => {
    if (!open) { setQuery(''); return }
    const t = setTimeout(() => searchRef.current?.focus(), 50)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    window.addEventListener('keydown', onKey)
    return () => { clearTimeout(t); window.removeEventListener('keydown', onKey) }
  }, [open])

  function toggle(id: string) {
    // Can't add someone who isn't eligible to be invited (but always allow removing).
    if (!selectedSet.has(id) && ineligibleReasons[id]) return
    onChange(selectedSet.has(id) ? value.filter((v) => v !== id) : [...value, id])
  }

  return (
    <div className="relative">
      {/* Trigger: host (locked) + selected chips + Add */}
      <div className="flex flex-wrap gap-1.5 items-center min-h-[42px] p-1.5 border border-border rounded-[8px] bg-white">
        {hostName && <HostChip name={hostName} />}
        {chipValue.map((id) => {
          const p = byId.get(id)
          if (!p) return null
          return (
            <AttendeeChip
              key={id}
              person={p}
              isOptional={optional.includes(id)}
              showToggle={showToggle}
              onToggleOptional={() => onToggleOptional?.(id)}
              onRemove={() => toggle(id)}
            />
          )
        })}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-1 px-2 py-1 rounded-[6px] text-xs font-medium text-primary-text hover:bg-primary-subtle transition-colors"
        >
          <Plus size={12} /> {chipValue.length === 0 ? placeholder : 'Add'}
        </button>
      </div>

      {/* Picker — centered dialog over the page (own backdrop), matching Assignees & CC */}
      {open && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-100 flex items-center justify-center p-4 bg-black/40"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false) }}
        >
          <div className="w-[440px] max-w-full max-h-[80vh] rounded-[12px] bg-white border border-border-light shadow-[0_12px_40px_rgba(0,0,0,0.20)] flex flex-col overflow-hidden">
            {/* Title */}
            <div className="flex items-center justify-between px-4 pt-3.5 pb-2.5 border-b border-border-light shrink-0">
              <h3 className="text-sm font-semibold text-text-primary">Attendees</h3>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="w-7 h-7 flex items-center justify-center rounded-[6px] text-text-muted hover:text-text-primary hover:bg-surface-control transition-colors">
                <X size={15} />
              </button>
            </div>

            {/* Search */}
            <div className="px-4 pt-3 pb-2 shrink-0">
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
                <input
                  ref={searchRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by name or email…"
                  className="w-full pl-8 pr-3 py-[7px] text-sm text-text-primary placeholder:text-text-muted border border-border-light rounded-[8px] focus:border-primary focus:outline-hidden bg-white"
                />
              </div>
            </div>

            {/* Selected chips inside the dialog (host is always shown first, locked) */}
            {(hostName || chipValue.length > 0) && (
              <div className="px-4 py-2.5 border-b border-border-light shrink-0 flex flex-wrap gap-1.5 max-h-[104px] overflow-y-auto">
                {hostName && <HostChip name={hostName} />}
                {chipValue.map((id) => {
                  const p = byId.get(id)
                  if (!p) return null
                  return (
                    <AttendeeChip
                      key={id}
                      person={p}
                      isOptional={optional.includes(id)}
                      showToggle={showToggle}
                      onToggleOptional={() => onToggleOptional?.(id)}
                      onRemove={() => toggle(id)}
                    />
                  )
                })}
              </div>
            )}

            {/* People list */}
            <div className="overflow-y-auto flex-1">
              {list.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center px-4">
                  <div className="w-10 h-10 rounded-full bg-surface-control flex items-center justify-center mb-3"><Search size={16} className="text-text-muted" /></div>
                  <p className="text-sm font-medium text-text-primary">{query ? 'No people found' : 'No one to add'}</p>
                  {query && <p className="text-xs text-text-secondary mt-1">Try a different search term.</p>}
                </div>
              ) : (
                list.map((p) => {
                  const selected = selectedSet.has(p.user_id)
                  const reason = ineligibleReasons[p.user_id]
                  const blocked = !!reason && !selected
                  return (
                    <Tooltip key={p.user_id} label={blocked ? reason : undefined}>
                    <button
                      type="button"
                      onClick={() => toggle(p.user_id)}
                      disabled={blocked}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                        blocked ? 'opacity-55 cursor-not-allowed' : selected ? 'bg-primary-subtle' : 'hover:bg-surface-sunken'
                      }`}
                    >
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0 ${blocked ? 'bg-[#94A3B8]' : avatarColor(p.name)}`}>
                        {initials(p.name)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-text-primary truncate">{p.name}</p>
                        {blocked ? (
                          <p className="text-xs text-danger truncate">{reason}</p>
                        ) : (
                          p.email && <p className="text-xs text-text-muted truncate">{p.email}</p>
                        )}
                      </div>
                      {blocked ? (
                        <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wide shrink-0">Can't invite</span>
                      ) : selected && (
                        <span className="w-4 h-4 flex items-center justify-center bg-primary rounded-full shrink-0">
                          <Check size={10} className="text-white" strokeWidth={3} />
                        </span>
                      )}
                    </button>
                    </Tooltip>
                  )
                })
              )}
            </div>

            {/* Footer: count + Done */}
            <div className="px-4 py-2.5 border-t border-border-light bg-surface-sunken shrink-0 flex items-center justify-between gap-3">
              <p className="text-xs text-text-secondary min-w-0 truncate">
                {value.length > 0 ? (
                  <>
                    <span className="font-semibold text-text-primary">{value.length}</span> attendee{value.length !== 1 ? 's' : ''}
                    {showToggle && <span className="text-text-muted"> · click a badge to toggle Optional</span>}
                  </>
                ) : (
                  <span className="text-text-muted">Search and select people, then confirm</span>
                )}
              </p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-[8px] text-sm font-semibold text-white bg-primary hover:bg-primary-hover transition-colors shrink-0"
              >
                <Check size={15} strokeWidth={3} /> Done
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
