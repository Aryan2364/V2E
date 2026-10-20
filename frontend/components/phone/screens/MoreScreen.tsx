'use client'

import React from 'react'
import Link from 'next/link'
import { BellRing, ChevronRight, LogOut, Repeat } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { NOTIFICATION_CHOICES_HREF, RECURRING_TEMPLATES_HREF, type PhoneRoute } from '@/lib/phone-routes'
import PhoneScreen from '../PhoneScreen'
import { InstallButton } from '../InstallSheet'
import { PhoneButton, ROW, ROW_BLOCK, cx } from '../primitives'

/*
 * The More tab - FRONTEND_RULES_PHONE.md 41.4 rule 15, 41.18 rule 1. Ported
 * from the kit's more-screen.tsx.
 *
 *   - Who is signed in, at the top. It wraps rather than truncates: an email
 *     address cut short is not the person's address (41.8 rule 18).
 *   - The product's other phone screens, as rows grouped under labels. In
 *     slice 1 that is Notification choices. Computer-only screens never
 *     appear here (41.11 rule 2).
 *   - Then two full-width buttons, outside the rows: Install app (41.12
 *     rule 8; hidden once installed) and Sign out, which lives here only.
 *     Sign out is not a danger action and asks nothing: nothing is lost, and
 *     signing in again gets it back. It is the app's existing sign-out.
 *
 * More has no desktop form (41.2 rule 5): its address opens the dashboard on
 * a computer (app/dashboard/more/page.tsx).
 */

const ROWS: { group: string; label: string; href: string; icon: React.ReactNode }[] = [
  {
    group: 'Tasks',
    label: 'Recurring tasks',
    href: RECURRING_TEMPLATES_HREF,
    icon: <Repeat aria-hidden />,
  },
  {
    group: 'Settings',
    label: 'Notification choices',
    href: NOTIFICATION_CHOICES_HREF,
    icon: <BellRing aria-hidden />,
  },
]

export default function MoreScreen({ route }: { route: PhoneRoute }) {
  const { user, logout } = useAuth()
  const [signingOut, setSigningOut] = React.useState(false)
  const groups = Array.from(new Set(ROWS.map((r) => r.group)))

  const detail = user?.email || (user?.phone ? `${user.country_code ?? ''} ${user.phone}`.trim() : '')

  return (
    <PhoneScreen title={route.title}>
      <div className="flex flex-col gap-[24px]">
        {user ? (
          <div className="flex min-w-0 flex-col">
            <p className="wrap-break-word text-card-heading font-medium text-text-primary">{user.name}</p>
            {detail ? <p className="wrap-break-word text-label text-text-secondary">{detail}</p> : null}
          </div>
        ) : null}

        {groups.map((group) => {
          const id = `more-group-${group}`
          return (
            <section key={group} aria-labelledby={id} className="flex flex-col gap-[8px]">
              <h2 id={id} className="text-label font-medium text-text-secondary">
                {group}
              </h2>
              <ul className={ROW_BLOCK}>
                {ROWS.filter((r) => r.group === group).map((row) => (
                  <li key={row.href}>
                    <Link href={row.href} className={cx(ROW, '[&_svg]:size-[20px] [&_svg]:shrink-0')}>
                      <span className="text-text-secondary">{row.icon}</span>
                      <span className="min-w-0 flex-1 wrap-break-word">{row.label}</span>
                      <ChevronRight aria-hidden className="text-text-secondary" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}

        <div className="flex flex-col gap-[8px]">
          <InstallButton />
          <PhoneButton
            fullWidth
            disabled={signingOut}
            onClick={() => {
              setSigningOut(true)
              void logout()
            }}
          >
            <LogOut aria-hidden />
            {signingOut ? 'Signing out' : 'Sign out'}
          </PhoneButton>
        </div>
      </div>
    </PhoneScreen>
  )
}
