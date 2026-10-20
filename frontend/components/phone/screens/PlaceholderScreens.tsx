'use client'

import React from 'react'
import { usePathname } from 'next/navigation'
import { CalendarDays, CheckSquare, Lock, LogOut, UserCheck } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { computerOnlyTitle, PHONE_HOME, type PhoneRoute } from '@/lib/phone-routes'
import PhoneScreen from '../PhoneScreen'
import { DesktopOnlyState, PhoneEmptyState, ShareLinkButton } from '../PhoneEmptyState'
import { PhoneButton, PhoneLinkButton } from '../primitives'

/*
 * Slice 1's holding screens. My work, Given and Meetings are real tabs with
 * real addresses; their lists are built in the next slices. Until then each
 * says so plainly and offers the way forward: "Share link", to open the same
 * address on a computer, where the full screen works today. No dead ends.
 */

const COMING_NEXT: Record<'my-work' | 'given' | 'meetings', { icon: React.ReactNode; line: string }> = {
  'my-work': {
    icon: <CheckSquare />,
    line: 'Tasks waiting on you will be listed here in the next update. Until then, open My tasks on a computer.',
  },
  given: {
    icon: <UserCheck />,
    line: 'Tasks you have given to others will be listed here in the next update. Until then, open Assigned by me on a computer.',
  },
  meetings: {
    icon: <CalendarDays />,
    line: 'Your meetings will be listed here in the next update. Until then, open Meetings on a computer.',
  },
}

/** A top-level tab whose list is built in a later slice. */
export function ComingNextScreen({ route }: { route: PhoneRoute & { key: 'my-work' | 'given' | 'meetings' } }) {
  const words = COMING_NEXT[route.key]
  return (
    <PhoneScreen title={route.title}>
      <PhoneEmptyState icon={words.icon} heading="Coming to the phone next" line={words.line}>
        <ShareLinkButton variant="secondary" />
      </PhoneEmptyState>
    </PhoneScreen>
  )
}

/**
 * A task or meeting opened from a notification or a shared link, before its
 * phone record screen exists. Below the top level: the back arrow returns to
 * the previous screen, or to the record's list (41.4 rule 7).
 */
export function RecordComingNextScreen({ route }: { route: PhoneRoute }) {
  const noun = route.key === 'meeting-record' ? 'meeting' : 'task'
  return (
    <PhoneScreen title={route.title} parent={route.parent}>
      <PhoneEmptyState
        icon={route.key === 'meeting-record' ? <CalendarDays /> : <CheckSquare />}
        heading={`This ${noun} opens on a computer for now`}
        line={`${noun === 'task' ? 'Tasks' : 'Meetings'} open on the phone in the next update. Share the link to open this ${noun} on a computer.`}
      >
        <ShareLinkButton />
        {route.parent ? (
          <PhoneLinkButton href={route.parent} fullWidth>
            {noun === 'task' ? 'Go to my work' : 'Go to meetings'}
          </PhoneLinkButton>
        ) : null}
      </PhoneEmptyState>
    </PhoneScreen>
  )
}

/**
 * 41.11: a computer-only screen opened on a phone, inside the phone shell,
 * never a squeezed desktop page. Titled by the area the address belongs to.
 * Below the top level: the back arrow returns to the previous screen, or to
 * My work. A super admin has no phone screens at all, so for them there is no
 * back arrow and no "Go to home" (it would only lead back here); Sign out is
 * the way forward instead.
 */
export function ComputerOnlyScreen() {
  const pathname = usePathname()
  const { user, logout } = useAuth()
  const hasPhoneHome = !user?.isSuperAdmin
  return (
    <PhoneScreen title={computerOnlyTitle(pathname)} parent={hasPhoneHome ? PHONE_HOME : undefined}>
      <DesktopOnlyState home={hasPhoneHome ? PHONE_HOME : undefined} />
      {!hasPhoneHome ? (
        <div className="mx-auto flex w-full max-w-[420px] flex-col">
          <PhoneButton fullWidth onClick={() => void logout()}>
            <LogOut aria-hidden />
            Sign out
          </PhoneButton>
        </div>
      ) : null}
    </PhoneScreen>
  )
}

/**
 * A phone screen whose module the organisation has switched off - the phone
 * form of MainLayout's "isn't enabled" state. Notifications is always there,
 * so it is the way forward.
 */
export function ModuleOffScreen({ route }: { route: PhoneRoute }) {
  return (
    <PhoneScreen title={route.title} parent={route.parent}>
      <PhoneEmptyState
        icon={<Lock />}
        heading={`${route.title} isn't enabled`}
        line="This is not part of your organisation's plan. Contact your administrator if you think this is a mistake."
      >
        <PhoneLinkButton href="/dashboard/notifications" fullWidth>
          Go to notifications
        </PhoneLinkButton>
      </PhoneEmptyState>
    </PhoneScreen>
  )
}
