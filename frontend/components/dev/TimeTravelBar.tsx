'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Clock, ChevronLeft, ChevronRight, Play, RotateCcw, FlaskConical, X } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { clockApi } from '@/lib/api/clock'
import { syncClock, useNow } from '@/lib/clock'
import Tooltip from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'

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

  const inputCls = 'w-full px-3 py-2 rounded-lg border border-border text-body text-text-primary bg-surface focus:border-2 focus:border-primary focus:outline-hidden'

  return (
    <div ref={containerRef} className="fixed bottom-6 right-6 z-toast flex flex-col items-end gap-3">
      {/* Expanded control panel */}
      {expanded && (
        <div className="w-96 overflow-hidden rounded-card border border-border-light bg-surface shadow-dialog">
          {/* Header */}
          <div className="flex items-center justify-between gap-2 border-b-2 border-warning bg-warning-bg px-4 py-3">
            <span className="inline-flex items-center gap-1 rounded-full bg-warning px-3 py-1 text-meta font-medium text-primary-foreground">
              <FlaskConical size={13} /> Test clock
            </span>
            <Button type="button" variant="ghost" size="icon" onClick={() => setExpanded(false)} aria-label="Collapse" className="text-warning">
              <X size={18} />
            </Button>
          </div>

          <div className="flex flex-col gap-4 px-4 py-4">
            {/* Live clock */}
            <div className="inline-flex items-center gap-1 text-body font-medium text-warning">
              <Clock size={14} /> {liveLabel}
            </div>

            {/* Pending value editor (local only) */}
            <div>
              <label className="mb-2 block text-label text-text-secondary">Simulated time</label>
              <div className="flex items-center gap-2">
                <Tooltip label="−1 day">
                <Button type="button" variant="secondary" size="icon" onClick={() => nudgeDays(-1)} aria-label="−1 day" className="shrink-0">
                  <ChevronLeft size={16} />
                </Button>
                </Tooltip>
                <input
                  type="datetime-local"
                  value={pending}
                  onChange={(e) => setPending(e.target.value)}
                  className={inputCls}
                />
                <Tooltip label="+1 day">
                <Button type="button" variant="secondary" size="icon" onClick={() => nudgeDays(1)} aria-label="+1 day" className="shrink-0">
                  <ChevronRight size={16} />
                </Button>
                </Tooltip>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <Button type="button" variant="secondary" size="sm" onClick={() => nudgeHours(-1)}>−1 hour</Button>
                <Button type="button" variant="secondary" size="sm" onClick={() => nudgeHours(1)}>+1 hour</Button>
              </div>
            </div>

            {error && <p className="text-body font-medium text-danger">{error}</p>}

            {/* Actions */}
            <div className="flex items-center gap-2">
              <Button
                type="button"
                onClick={apply}
                disabled={!pending}
                loading={busy}
                loadingLabel="Applying"
                className="flex-1"
              >
                <Play size={14} /> Apply
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={reset}
                disabled={busy}
              >
                <RotateCcw size={14} /> Reset
              </Button>
            </div>

            {!synced && (
              <p className="text-meta text-warning">Connecting to simulated clock…</p>
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
        className="outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-primary-ring flex h-10 items-center gap-2 rounded-full bg-warning px-4 text-meta font-medium text-primary-foreground shadow-menu transition-colors cursor-pointer"
      >
        <FlaskConical size={14} className="animate-pulse shrink-0" />
        <span className="font-medium">{compactLabel}</span>
        {synced && (
          <span className="size-1.5 shrink-0 rounded-full bg-success" />
        )}
      </button>
      </Tooltip>
    </div>
  )
}
