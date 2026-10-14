'use client'

import React from 'react'
import { useRouter } from 'next/navigation'
import { useLayout } from '@/lib/layout'

/**
 * A phone-only address in the browser - FRONTEND_RULES_PHONE.md 41.2 rule 5.
 * Ported from the kit's phone-only.tsx.
 *
 * The server already redirects a desktop guess to the desktop form
 * (redirectOnDesktop, lib/layout.server.ts). On a phone, MainLayout draws the
 * phone shell and never mounts this. It runs only when the server guessed
 * phone and the device turned out to be a computer (the one correction of
 * 41.2 rule 3): it then replaces the address with its desktop form, as the
 * server would have, and draws nothing meanwhile.
 */
export default function PhoneOnly({ desktopHref }: { desktopHref: string }) {
  const { layout } = useLayout()
  const router = useRouter()

  React.useEffect(() => {
    if (layout === 'desktop') router.replace(desktopHref)
  }, [layout, router, desktopHref])

  return null
}
