'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Clock, ChevronLeft, ChevronRight, Play, RotateCcw, FlaskConical, X } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { clockApi } from '@/lib/api/clock'
import { syncClock, useNow } from '@/lib/clock'
import Tooltip from '@/components/ui/Tooltip'

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * Floating "time travel" control for test organizations. Collapsed to a circular
 * button (so it never blocks page content) that expands into a popover panel.
 * Picker / typing / arrows only edit a LOCAL pending value (no API calls). Apply
 * commits once → backend replays the gap → full reload so every view reflects the
 * new simulated time.
 */
export default function TimeTravelBar() {
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''
  const isTestOrg = !!user?.isTestOrg

  const now = useNow() // live ticking display
  const [pending, setPending] = useState<string>('') // datetime-local string (local pending only)
  const [synced, setSynced] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Initial fetch + periodic re-sync (keeps drift corrected). No writes here.
  const refresh = useCallback(async () => {
    if (!orgId) return
    try {
      const state = await clockApi.getClock(orgId)
      syncClock(state)
      setSynced(true)
      // Seed the pending field only once (don't fight the user while they type)
      setPending((prev) => prev || toLocalInput(new Date(state.simulated_now)))
    } catch {
      /* ignore — bar stays on real time */
    }
  }, [orgId])

  useEffect(() => {
    if (!isTestOrg) return
    refresh()
    const id = setInterval(refresh, 60_000)
    return () => clearInterval(id)
  }, [isTestOrg, refresh])

  // Collapse on Escape or click outside while expanded.
  useEffect(() => {
    if (!expanded) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setExpanded(false) }
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setExpanded(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClick)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onClick)
    }
  }, [expanded])

  if (!isTestOrg || !orgId) return null

  const nudgeDays = (delta: number) => {
    const base = pending ? new Date(pending) : new Date(now)
    base.setDate(base.getDate() + delta)
    setPending(toLocalInput(base))
  }
  const nudgeHours = (delta: number) => {
    const base = pending ? new Date(pending) : new Date(now)
    base.setHours(base.getHours() + delta)
    setPending(toLocalInput(base))
  }

  async function apply() {
    if (!pending) return
    setBusy(true)
    setError('')
    try {
      const iso = new Date(pending).toISOString()
      const state = await clockApi.setClock(orgId, iso)
      syncClock(state)
      // Full reload so all client-fetched views reflect the new simulated time.
      window.location.reload()
    } catch (e: any) {
      const msg = e?.response?.data?.message ?? e?.response?.data?.error ?? 'Failed to set clock'
      setError(Array.isArray(msg) ? msg.join(', ') : String(msg))
      setBusy(false)
    }
  }

  async function reset() {
    setBusy(true)
    setError('')
    try {
      const state = await clockApi.resetClock(orgId)
      syncClock(state)
      window.location.reload()
    } catch {
      setError('Failed to reset clock')
      setBusy(false)
    }
  }

  const liveLabel = now.toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const compactLabel = now.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })

  const inputCls = 'w-full px-2.5 py-2 rounded-[8px] border border-[#CBD5E1] text-base sm:text-sm text-[#0F172A] bg-white focus:border-2 focus:border-[#2563EB] focus:outline-hidden'
  const arrowCls = 'shrink-0 w-9 h-9 flex items-center justify-center rounded-[8px] bg-white border border-[#FBBF24] text-[#92400E] hover:bg-[#FFFBEB] transition-colors'

  return (
    <div ref={containerRef} className="fixed bottom-5 right-5 z-40 flex flex-col items-end gap-3">
      {/* Expanded control panel */}
      {expanded && (
        <div className="w-[calc(100vw-2.5rem)] sm:w-[380px] bg-white rounded-[12px] border border-[#E2E8F0] shadow-[0_8px_32px_rgba(0,0,0,0.16)] overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between gap-2 px-4 py-3 bg-[#FEF3C7] border-b-2 border-[#D97706]">
            <span className="inline-flex items-center gap-1.5 rounded-[999px] bg-[#D97706] px-2.5 py-1 text-[12px] font-semibold text-white">
              <FlaskConical size={13} /> TEST CLOCK
            </span>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              aria-label="Collapse"
              className="w-8 h-8 rounded-[6px] flex items-center justify-center text-[#92400E] hover:bg-[#FDE68A] transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          <div className="px-4 py-4 space-y-4">
            {/* Live clock */}
            <div className="inline-flex items-center gap-1.5 text-sm font-medium text-[#92400E]">
              <Clock size={14} /> {liveLabel}
            </div>

            {/* Pending value editor (local only) */}
            <div>
              <label className="block text-sm font-medium text-[#374151] mb-1.5">Simulated time</label>
              <div className="flex items-center gap-1.5">
                <Tooltip label="−1 day">
                <button type="button" onClick={() => nudgeDays(-1)} aria-label="−1 day" className={arrowCls}>
                  <ChevronLeft size={16} />
                </button>
                </Tooltip>
                <input
                  type="datetime-local"
                  value={pending}
                  onChange={(e) => setPending(e.target.value)}
                  className={inputCls}
                />
                <Tooltip label="+1 day">
                <button type="button" onClick={() => nudgeDays(1)} aria-label="+1 day" className={arrowCls}>
                  <ChevronRight size={16} />
                </button>
                </Tooltip>
              </div>
              <div className="flex items-center gap-1.5 mt-2">
                <button type="button" onClick={() => nudgeHours(-1)} className="px-2.5 h-8 rounded-[8px] bg-white border border-[#FBBF24] text-[#92400E] text-xs font-semibold hover:bg-[#FFFBEB] transition-colors">−1 hour</button>
                <button type="button" onClick={() => nudgeHours(1)} className="px-2.5 h-8 rounded-[8px] bg-white border border-[#FBBF24] text-[#92400E] text-xs font-semibold hover:bg-[#FFFBEB] transition-colors">+1 hour</button>
              </div>
            </div>

            {error && <p className="text-sm font-medium text-[#DC2626]">{error}</p>}

            {/* Actions */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={apply}
                disabled={busy || !pending}
                className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-[8px] text-sm font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] disabled:bg-[#E2E8F0] disabled:text-[#94A3B8] disabled:cursor-not-allowed transition-colors"
              >
                <Play size={14} /> {busy ? 'Applying…' : 'Apply'}
              </button>
              <button
                type="button"
                onClick={reset}
                disabled={busy}
                className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-[8px] text-sm font-semibold text-[#92400E] bg-white border border-[#D97706] hover:bg-[#FFFBEB] disabled:text-[#94A3B8] disabled:border-[#E2E8F0] disabled:cursor-not-allowed transition-colors"
              >
                <RotateCcw size={14} /> Reset
              </button>
            </div>

            {!synced && (
              <p className="text-[11px] text-[#92400E]">Connecting to simulated clock…</p>
            )}
          </div>
        </div>
      )}

      {/* Floating clock toggle — displays live-ticking date and time capsule */}
      <Tooltip label="Test clock">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-label={expanded ? 'Collapse test clock' : 'Open test clock'}
        aria-expanded={expanded}
        className="flex items-center gap-2 px-4 h-10 rounded-full bg-[#D97706] text-white font-medium text-xs shadow-[0_4px_16px_rgba(0,0,0,0.20)] ring-2 ring-white hover:bg-[#B45309] transition-all duration-200 cursor-pointer"
      >
        <FlaskConical size={14} className="animate-pulse shrink-0" />
        <span className="font-semibold">{compactLabel}</span>
        {synced && (
          <span className="w-1.5 h-1.5 rounded-full bg-[#16A34A] shrink-0" />
        )}
      </button>
      </Tooltip>
    </div>
  )
}
