'use client'

import React from 'react'
import { Monitor } from 'lucide-react'
import { useToast } from '@/components/ui/Toast'
import { PhoneButton, PhoneLinkButton } from './primitives'

/*
 * The phone's empty states - the kit's empty-state.tsx (FRONTEND_RULES.md
 * section 13) drawn with phone tokens: an icon in a soft circle, a heading,
 * one line, and the way forward. Every state offers one (no dead ends).
 */

export function PhoneEmptyState({
  icon,
  heading,
  line,
  headingLevel = 2,
  children,
}: {
  icon: React.ReactNode
  heading: string
  line: string
  headingLevel?: 1 | 2
  children?: React.ReactNode
}) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2'
  return (
    <div className="flex flex-col items-center px-[8px] py-[48px] text-center">
      <span
        aria-hidden
        className="mb-[16px] flex size-[56px] items-center justify-center rounded-full bg-primary-subtle text-primary-text [&_svg]:size-[26px]"
      >
        {icon}
      </span>
      <Heading className="text-phone-section font-semibold text-text-primary">{heading}</Heading>
      <p className="mt-[8px] max-w-[420px] text-phone-body text-text-secondary">{line}</p>
      {children ? <div className="mt-[24px] flex w-full max-w-[420px] flex-col gap-[8px]">{children}</div> : null}
    </div>
  )
}

/*
 * Whether the browser has a share sheet. It never changes while the page is
 * open; the server cannot know and guesses yes (phone browsers have one).
 */
const shareSheet = {
  subscribe: () => () => {},
  read: () => typeof navigator !== 'undefined' && typeof navigator.share === 'function',
  server: () => true,
}

/**
 * 41.11 rule 1: "Share link" opens the phone's share sheet with this page's
 * address, so the person can send it to themselves and open it on a
 * computer. Without a share sheet it reads "Copy link" and copies the address.
 * Closing the share sheet without sharing is not an error.
 */
export function ShareLinkButton({ variant = 'primary' }: { variant?: 'primary' | 'secondary' }) {
  const { addToast } = useToast()
  const canShare = React.useSyncExternalStore(shareSheet.subscribe, shareSheet.read, shareSheet.server)

  const share = async () => {
    const url = window.location.href
    if (canShare) {
      try {
        await navigator.share({ title: document.title, url })
        return
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
      }
    }
    try {
      await navigator.clipboard.writeText(url)
      addToast('Link copied', 'success')
    } catch {
      addToast('The link could not be copied. Copy it from the address bar instead.', 'error')
    }
  }

  return (
    <PhoneButton variant={variant} fullWidth onClick={() => void share()}>
      {canShare ? 'Share link' : 'Copy link'}
    </PhoneButton>
  )
}

/**
 * 41.11 rule 1: a computer-only screen opened on a phone. Monitor icon, the
 * kit's words, "Share link" (primary) and "Go to home" (secondary). `home`
 * is omitted for someone with no phone home (a super admin), so "Go to home"
 * never loops back to this page.
 */
export function DesktopOnlyState({ home }: { home?: string }) {
  return (
    <PhoneEmptyState
      icon={<Monitor />}
      heading="This screen works on a computer"
      line="Open it on a computer to use it. This link opens the same screen there."
    >
      <ShareLinkButton />
      {home ? (
        <PhoneLinkButton href={home} fullWidth>
          Go to home
        </PhoneLinkButton>
      ) : null}
    </PhoneEmptyState>
  )
}
