'use client'

import React from 'react'
import Link from 'next/link'
import { useAuth } from '@/lib/auth/context'
import { useToast } from '@/components/ui/Toast'
import { detectPlatform, isInstalledApp, type InstallPlatform } from '@/lib/install'
import { disablePush, enablePush, getPushStatus, PUSH_ERROR_MESSAGES, type PushStatus } from '@/lib/push'
import { MORE_HREF, type PhoneRoute } from '@/lib/phone-routes'
import PhoneScreen from '../PhoneScreen'
import { PhoneSheet } from '../PhoneSheet'
import { PhoneButton } from '../primitives'

/*
 * Notification choices - FRONTEND_RULES_PHONE.md 41.18 rules 1 and 3, 41.12
 * rules 4 and 5. A row in More, below the top level (back to More).
 *
 * Slice 1 holds the phone-notifications block the kit puts at the foot of
 * this screen (notification-permission-sheet.tsx's PhoneNotificationsSetting):
 * where phone notifications stand on THIS phone, and the next step. V2E has
 * no per-person switches for kinds of notification yet (its notification
 * settings are the organisation's, on the computer), so there are none here.
 *
 *   - Not known yet: nothing, so it never shows one answer and then another.
 *   - iPhone, not installed: notifications need the app on the Home Screen
 *     (41.12 rule 5), with a link to More, where Install app lives.
 *   - A browser that cannot show them, or a page not on https: says so.
 *   - The phone said no: the app cannot ask again, so the steps to allow them
 *     in the phone's settings, for this phone (41.12 rule 4, 41.16 rule 3).
 *   - Off: "Turn on notifications" opens a short sheet saying why, then the
 *     phone asks its own question from that tap (41.12 rule 4). This screen
 *     is the one place the offer comes back after "Skip for now"; there is no
 *     prompt on first open on the phone.
 *   - On: they are on, with "Turn off" for this phone.
 * Whatever the answer, every notification is still in the Notifications tab.
 */

type View =
  | { kind: 'loading' }
  | { kind: 'needs-install' }
  | { kind: 'unsupported' }
  | { kind: 'denied'; platform: InstallPlatform; installed: boolean }
  | { kind: 'off' }
  | { kind: 'on' }

const STILL_IN_APP = 'You still see every notification in the Notifications tab.'

function deniedLine(platform: InstallPlatform, installed: boolean): string {
  const start = 'Notifications are blocked on this phone, and the app cannot ask again. To allow them, '
  if (platform === 'ios') {
    return `${start}open your iPhone's Settings, then Notifications, then V2E, and turn on Allow Notifications. ${STILL_IN_APP}`
  }
  if (platform === 'android' && installed) {
    return `${start}open your phone's Settings, then Apps, then V2E, then Notifications, and turn them on. ${STILL_IN_APP}`
  }
  return `${start}tap the icon at the left of the browser's address bar, open this site's settings, and allow Notifications. ${STILL_IN_APP}`
}

async function readView(): Promise<View> {
  const platform = detectPlatform()
  const installed = isInstalledApp()
  if (platform === 'ios' && !installed) return { kind: 'needs-install' }
  if (!window.isSecureContext) return { kind: 'unsupported' }
  const status: PushStatus = await getPushStatus()
  if (status === 'unsupported') return { kind: 'unsupported' }
  if (status === 'denied') return { kind: 'denied', platform, installed }
  return status === 'enabled' ? { kind: 'on' } : { kind: 'off' }
}

export default function NotificationChoicesScreen({ route }: { route: PhoneRoute }) {
  const { user } = useAuth()
  const { addToast } = useToast()
  const orgId = user?.organizationId ?? ''
  const [view, setView] = React.useState<View>({ kind: 'loading' })
  const [sheetOpen, setSheetOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

  const refresh = React.useCallback(async () => {
    try {
      setView(await readView())
    } catch {
      setView({ kind: 'unsupported' })
    }
  }, [])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  async function turnOn() {
    if (!orgId || busy) return
    setBusy(true)
    try {
      // From the tap itself: iPhone refuses the phone's question from anywhere else.
      const result = await enablePush(orgId)
      if (result.ok) {
        addToast('Notifications turned on', 'success')
        setSheetOpen(false)
      } else if (result.reason === 'denied' || result.reason === 'dismissed') {
        // The phone's own answer is the phone's to keep; this screen explains.
        setSheetOpen(false)
      } else {
        addToast(PUSH_ERROR_MESSAGES[result.reason], 'error')
      }
    } catch {
      addToast('Notifications could not be turned on. Check your connection and try again.', 'error')
    } finally {
      setBusy(false)
      void refresh()
    }
  }

  async function turnOff() {
    if (!orgId || busy) return
    setBusy(true)
    try {
      await disablePush(orgId)
      addToast('Notifications turned off on this phone', 'success')
    } catch {
      addToast('Notifications could not be turned off. Check your connection and try again.', 'error')
    } finally {
      setBusy(false)
      void refresh()
    }
  }

  let line = ''
  let next: React.ReactNode = null
  switch (view.kind) {
    case 'loading':
      break
    case 'needs-install':
      line =
        'On iPhone, phone notifications work only once V2E is on your Home Screen. Install it from More, then turn them on here.'
      next = (
        <Link
          href={MORE_HREF}
          className="text-body font-medium text-primary-text underline underline-offset-2 outline-hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-ring"
        >
          Go to More to install the app
        </Link>
      )
      break
    case 'unsupported':
      line = `This browser cannot show phone notifications. ${STILL_IN_APP}`
      break
    case 'denied':
      line = deniedLine(view.platform, view.installed)
      break
    case 'off':
      line = `Phone notifications are off. ${STILL_IN_APP}`
      next = (
        <PhoneButton fullWidth onClick={() => setSheetOpen(true)}>
          Turn on notifications
        </PhoneButton>
      )
      break
    case 'on':
      line = 'Phone notifications are on. You get one when something needs you, even when V2E is closed.'
      next = (
        <PhoneButton fullWidth loading={busy} onClick={() => void turnOff()}>
          Turn off on this phone
        </PhoneButton>
      )
      break
  }

  return (
    <PhoneScreen title={route.title} parent={route.parent}>
      {view.kind === 'loading' ? null : (
        <section aria-labelledby="phone-notifications-heading" className="flex flex-col gap-[8px]">
          <h2 id="phone-notifications-heading" className="text-card-heading font-medium text-text-primary">
            Phone notifications
          </h2>
          {/* An instruction, so body text, never the muted colour. */}
          <p className="text-body text-text-primary">{line}</p>
          {next ? <div className="pt-[8px]">{next}</div> : null}
        </section>
      )}

      <PhoneSheet
        open={sheetOpen}
        onOpenChange={(open) => {
          if (!busy) setSheetOpen(open)
        }}
        title="Notifications on this phone"
        footer={
          <>
            <PhoneButton disabled={busy} onClick={() => setSheetOpen(false)}>
              Skip for now
            </PhoneButton>
            <PhoneButton variant="primary" loading={busy} onClick={() => void turnOn()}>
              Turn on
            </PhoneButton>
          </>
        }
      >
        <p className="text-body text-text-primary">
          Get a notification when something needs you, such as a task given to you or a meeting about to start.
        </p>
      </PhoneSheet>
    </PhoneScreen>
  )
}
