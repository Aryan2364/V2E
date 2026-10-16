'use client'

import type React from 'react'
import { PhoneAppBar as V2EPhoneAppBar } from '@/components/phone/PhoneAppBar'

/**
 * Shim (v2e kit-alignment P3): the kit's components/ui/sheet.tsx (the
 * full-screen dialog layer, section 24 rule on phone, 41.8 rule 10) imports
 * its phone app bar from "@/components/shell/app-bar" — a module the kit's
 * own shell phase would build. v2e already has a phone app bar, built on
 * feat/phone-app at components/phone/PhoneAppBar.tsx; this file re-exports
 * it under the kit's expected module path and name so sheet.tsx (and
 * anything else the kit ports later from components/shell) compiles
 * against v2e's real app bar instead of a stub.
 *
 * `titleAs` is accepted and ignored: v2e's PhoneAppBar always renders an h1
 * (it is always the screen's one top-level heading, per 41.4), so there is
 * no h2 variant to switch to yet. If a future full-screen-layer-inside-a-
 * full-screen-layer case needs h2, add it to PhoneAppBar itself rather than
 * here.
 */
export function PhoneAppBar({
  title,
  leading,
  actions,
  belowTop,
}: {
  title: string
  leading?: React.ReactNode
  actions?: React.ReactNode
  titleAs?: 'h1' | 'h2'
  belowTop?: boolean
}) {
  return <V2EPhoneAppBar title={title} leading={leading} actions={actions} belowTop={belowTop} />
}
