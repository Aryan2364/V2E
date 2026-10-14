'use client'

import React from 'react'
import { useToast } from '@/components/ui/Toast'
import { enablePush, PUSH_ERROR_MESSAGES } from '@/lib/push'
import { PhoneSheet } from './PhoneSheet'
import { PhoneButton } from './primitives'

/*
 * The app's own sheet before the phone's own question - plan §9, kit §41.12
 * rule 4. Shown once, at the first useful moment (giving a task, sending a
 * comment - see useOfferPushAfter in the same folder's callers), never on
 * open. "Turn on" asks the phone's own question from the tap itself (iPhone
 * refuses it otherwise) via the existing enablePush(orgId) - no backend
 * contract change. "Skip for now", a swipe down, the backdrop, Android back
 * or Escape are all the person's "no" on this sheet: onDeclined runs and the
 * sheet is offered again only from More -> Notification choices, after the
 * plan's 3-day cooldown.
 */
export function NotificationOfferSheet({
  orgId,
  open,
  onOpenChange,
  onDeclined,
}: {
  orgId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The person's "no" on this sheet - starts the offer's cooldown. */
  onDeclined: () => void
}) {
  const { addToast } = useToast()
  const [busy, setBusy] = React.useState(false)
  const pressedRef = React.useRef(false)

  const close = (next: boolean) => {
    if (!next && !pressedRef.current) onDeclined()
    onOpenChange(next)
  }

  async function turnOn() {
    if (busy) return
    pressedRef.current = true
    setBusy(true)
    try {
      const result = await enablePush(orgId)
      if (result.ok) {
        addToast('Notifications turned on', 'success')
      } else if (result.reason !== 'denied' && result.reason !== 'dismissed') {
        addToast(PUSH_ERROR_MESSAGES[result.reason], 'error')
      }
      // A "denied"/"dismissed" answer is the phone's own to keep - Notification
      // choices explains it next; nothing more to say from this sheet.
    } catch {
      addToast('Notifications could not be turned on. Check your connection and try again.', 'error')
    } finally {
      setBusy(false)
      onOpenChange(false)
    }
  }

  return (
    <PhoneSheet
      open={open}
      onOpenChange={close}
      title="Notifications on this phone"
      footer={
        <>
          <PhoneButton disabled={busy} onClick={() => close(false)}>
            Skip for now
          </PhoneButton>
          <PhoneButton variant="primary" disabled={busy} onClick={() => void turnOn()}>
            {busy ? 'Turning on' : 'Turn on'}
          </PhoneButton>
        </>
      }
    >
      <p className="text-phone-body text-phone-text-primary">
        Get a notification when something needs you, such as a task given to you or a reply on your comment.
      </p>
    </PhoneSheet>
  )
}
