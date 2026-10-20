'use client'

import { useEffect, useState } from 'react'
import { Bell, X } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { useToast } from '@/components/ui/Toast'
import { enablePush, getPushStatus, PUSH_ERROR_MESSAGES } from '@/lib/push'
import { useLayout } from '@/lib/layout'
import { Button } from '@/components/ui/button'

// One-time nudge to enable browser/device push, so users discover they can be
// notified even when V2E is closed. The enable/disable control also lives
// permanently in the notification bell — this is purely for discoverability.
// Shown at most once per user until they act on it or dismiss it.
//
// DESKTOP ONLY. On a phone the app never asks on first open
// (FRONTEND_RULES_PHONE.md 41.12 rule 4): it offers phone notifications from
// More > Notification choices (components/phone/screens/
// NotificationChoicesScreen.tsx) and, in later slices, at the moment of use.

const dismissKey = (userId: string) => `v2e_push_prompt_dismissed:${userId}`

export default function NotificationsOptInPrompt() {
  const { user } = useAuth()
  const { addToast } = useToast()
  const orgId = user?.organizationId ?? ''
  const userId = user?.id ?? ''

  const { layout } = useLayout()
  const onPhone = layout === 'phone'

  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (onPhone) return
    if (!userId || !orgId) return
    if (typeof window === 'undefined') return
    if (localStorage.getItem(dismissKey(userId))) return

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    // Only nudge when push is genuinely available and not already on/denied.
    getPushStatus().then((status) => {
      if (cancelled) return
      if (status === 'disabled') {
        // Small delay so it doesn't slam in during the initial page paint.
        timer = setTimeout(() => !cancelled && setShow(true), 2_500)
      }
    })
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [userId, orgId, onPhone])

  function dismiss() {
    if (userId) localStorage.setItem(dismissKey(userId), '1')
    setShow(false)
  }

  async function turnOn() {
    setBusy(true)
    try {
      const result = await enablePush(orgId)
      if (result.ok) {
        addToast("Notifications are on — you'll get alerts even when V2E is closed", 'success')
      } else {
        addToast(PUSH_ERROR_MESSAGES[result.reason], 'error')
        if (result.detail) console.warn('[push] enable failed:', result.reason, result.detail)
      }
    } catch {
      addToast('Something went wrong enabling notifications.', 'error')
    } finally {
      setBusy(false)
      dismiss()
    }
  }

  if (!show || onPhone) return null

  return (
    <div className="fixed bottom-4 right-4 left-4 sm:left-auto z-60 sm:w-[360px]">
      <div className="relative rounded-xl border border-border-light bg-surface p-4 shadow-dialog">
        <Button variant="ghost" size="icon" onClick={dismiss} aria-label="Dismiss" className="absolute right-2 top-2">
          <X size={16} />
        </Button>

        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-subtle text-primary-text">
            <Bell size={18} />
          </span>
          <div className="min-w-0 pr-4">
            <p className="text-[15px] font-medium text-text-primary">Turn on notifications</p>
            <p className="mt-0.5 text-[13px] leading-snug text-text-secondary">
              Get alerts for tasks, tickets and mentions on this device — even when V2E isn&apos;t open.
            </p>
          </div>
        </div>

        <div className="mt-3.5 flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={dismiss} disabled={busy}>
            Not now
          </Button>
          <Button onClick={turnOn} disabled={busy} loading={busy} loadingLabel="Enabling">
            Turn on
          </Button>
        </div>
      </div>
    </div>
  )
}
