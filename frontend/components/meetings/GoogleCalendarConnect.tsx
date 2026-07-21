'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Calendar, Check, Loader2, RefreshCw, X } from 'lucide-react'
import { meetingsApi, type GoogleSyncStatus } from '@/lib/api/meetings'

// Per-user Google Calendar connection control for the meetings header.
// Controlled by the page (status + onChanged) so the calendar's reverse view and
// this button stay in sync. Renders nothing when the server has no Google app
// configured — per design rules, never show a control that can only error.
export default function GoogleCalendarConnect({
  status,
  onChanged,
}: {
  status: GoogleSyncStatus | null
  onChanged: () => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<'connected' | 'error' | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  function flash(kind: 'connected' | 'error') {
    setToast(kind)
    setTimeout(() => setToast(null), 4000)
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
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 px-3 py-2.5 text-sm font-medium text-[#475569] border border-[#E2E8F0] rounded-[8px] hover:bg-[#F8FAFC]"
        title={connected ? 'Google Calendar — connected' : 'Connect Google Calendar'}
      >
        <span
          className="w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: connected ? '#22C55E' : '#CBD5E1' }}
        />
        <Calendar size={16} />
        <span className="hidden sm:inline">Google Calendar</span>
      </button>

      {mounted &&
        open &&
        createPortal(
          <div
            className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4"
            onClick={() => !busy && setOpen(false)}
          >
            <div
              className="bg-white rounded-[14px] shadow-xl w-full max-w-[420px] p-5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 rounded-[10px] bg-[#EFF6FF] flex items-center justify-center text-[#2563EB]">
                    <Calendar size={18} />
                  </div>
                  <div>
                    <h3 className="text-[16px] font-semibold text-[#0F172A] leading-tight">Google Calendar</h3>
                    <p className="text-xs text-[#64748B] mt-0.5">
                      {connected ? 'Connected — syncing both ways' : 'Not connected'}
                    </p>
                  </div>
                </div>
                <button onClick={() => !busy && setOpen(false)} className="text-[#94A3B8] hover:text-[#475569]">
                  <X size={18} />
                </button>
              </div>

              <p className="text-sm text-[#475569] leading-relaxed mb-4">
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
                  <span className="inline-flex items-center gap-1.5 text-sm font-medium text-[#16A34A]">
                    <Check size={16} /> Connected
                  </span>
                  <div className="flex-1" />
                  <button
                    onClick={disconnect}
                    disabled={busy}
                    className="px-3 py-2 text-sm font-medium text-[#B91C1C] border border-[#FECACA] rounded-[8px] hover:bg-[#FEF2F2] disabled:opacity-50"
                  >
                    {busy ? <Loader2 size={15} className="animate-spin" /> : 'Disconnect'}
                  </button>
                </div>
              ) : (
                <button
                  onClick={connect}
                  disabled={busy}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-[8px] disabled:opacity-50"
                >
                  {busy ? (
                    <>
                      <Loader2 size={16} className="animate-spin" /> Waiting for Google…
                    </>
                  ) : (
                    <>
                      <RefreshCw size={16} /> Connect Google Calendar
                    </>
                  )}
                </button>
              )}
            </div>
          </div>,
          document.body,
        )}

      {mounted &&
        toast &&
        createPortal(
          <div
            className="fixed bottom-5 right-5 z-[1001] flex items-center gap-2 px-4 py-3 rounded-[10px] shadow-lg border text-sm"
            style={{
              backgroundColor: toast === 'connected' ? '#FFFFFF' : '#FEF2F2',
              borderColor: toast === 'connected' ? '#BBF7D0' : '#FECACA',
              color: toast === 'connected' ? '#166534' : '#B91C1C',
            }}
          >
            {toast === 'connected' ? <Check size={16} /> : <X size={16} />}
            {toast === 'connected' ? 'Google Calendar connected!' : 'Connection failed. Please try again.'}
          </div>,
          document.body,
        )}
    </>
  )
}
