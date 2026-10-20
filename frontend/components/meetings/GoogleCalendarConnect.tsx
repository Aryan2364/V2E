'use client'

import { useEffect, useRef, useState } from 'react'
import { Calendar, Check, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { meetingsApi, type GoogleSyncStatus } from '@/lib/api/meetings'
import Tooltip from '@/components/ui/tooltip'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

// Per-user Google Calendar connection control for the meetings header.
// Controlled by the page (status + onChanged) so the calendar's reverse view and
// this button stay in sync. Renders nothing when the server has no Google app
// configured — per design rules, never show a control that can only error.
export default function GoogleCalendarConnect({
  status,
  onChanged,
  renderTrigger = true,
  open: openProp,
  onOpenChange,
}: {
  status: GoogleSyncStatus | null
  onChanged: () => void
  renderTrigger?: boolean
  open?: boolean
  onOpenChange?: (v: boolean) => void
}) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = openProp !== undefined ? openProp : internalOpen
  const setOpen = onOpenChange ?? setInternalOpen
  const [busy, setBusy] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  function flash(kind: 'connected' | 'error') {
    if (kind === 'connected') toast.success('Google Calendar connected!')
    else toast.error('Connection failed. Please try again.')
  }

  async function connect() {
    setBusy(true)
    try {
      const { url } = await meetingsApi.googleAuthUrl()
      const popup = window.open(url, 'gcal-connect', 'width=520,height=680')
      // Poll our own status endpoint until the grant lands, then close the popup.
      if (pollRef.current) clearInterval(pollRef.current)
      pollRef.current = setInterval(async () => {
        try {
          const s = await meetingsApi.googleStatus()
          if (s.connected) {
            clearInterval(pollRef.current!)
            pollRef.current = null
            setBusy(false)
            popup?.close()
            flash('connected')
            onChanged()
          }
        } catch {
          /* keep polling */
        }
        if (popup && popup.closed && pollRef.current) {
          clearInterval(pollRef.current)
          pollRef.current = null
          setBusy(false)
          onChanged()
        }
      }, 2000)
    } catch {
      setBusy(false)
      flash('error')
    }
  }

  async function disconnect() {
    setBusy(true)
    try {
      await meetingsApi.googleDisconnect()
      onChanged()
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }

  // Hidden until the server is configured to talk to Google.
  if (!status || !status.configured) return null

  const connected = status.connected

  return (
    <>
      {renderTrigger && (
        <Tooltip label={connected ? 'Google Calendar — connected' : 'Connect Google Calendar'}>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: connected ? 'var(--success)' : 'var(--border)' }}
          />
          <Calendar size={16} />
          <span className="hidden sm:inline">Google Calendar</span>
        </Button>
        </Tooltip>
      )}

      <Dialog open={open} onOpenChange={(next) => { if (!busy) setOpen(next) }}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Google calendar</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <div className="flex items-start gap-2 mb-3">
              <div className="w-9 h-9 rounded-lg bg-primary-subtle flex items-center justify-center text-primary-text shrink-0">
                <Calendar size={18} />
              </div>
              <p className="text-meta text-text-muted mt-2">
                {connected ? 'Connected — syncing both ways' : 'Not connected'}
              </p>
            </div>

            <p className="text-body text-text-secondary leading-relaxed mb-4">
              {connected ? (
                <>
                  Your meetings are mirrored to your Google Calendar, and attendees receive Google invites.
                  Your Google events also appear in the calendar view here.
                </>
              ) : (
                <>
                  Connect your Google account to mirror your meetings onto your Google Calendar (attendees get
                  real Google invites), and to see your existing Google events alongside your meetings.
                </>
              )}
            </p>

            {connected ? (
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 text-body font-medium text-success">
                  <Check size={16} /> Connected
                </span>
                <div className="flex-1" />
                <Button variant="danger" onClick={disconnect} loading={busy} loadingLabel="Disconnecting">
                  Disconnect
                </Button>
              </div>
            ) : (
              <Button onClick={connect} loading={busy} loadingLabel="Waiting for Google" className="w-full">
                <RefreshCw size={16} /> Connect Google Calendar
              </Button>
            )}
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
  )
}
