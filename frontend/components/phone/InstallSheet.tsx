'use client'

import React from 'react'
import { Smartphone } from 'lucide-react'
import { useInstall, type InstallPlatform } from '@/lib/install'
import { useLayout } from '@/lib/layout'
import { PhoneSheet } from './PhoneSheet'
import { PhoneButton } from './primitives'

/*
 * Installing the app - FRONTEND_RULES_PHONE.md 41.12 rules 7 and 8. Ported
 * from the kit's install-sheet.tsx and more-screen.tsx's InstallButton.
 *
 *   - "Install app" lives in More only, never as a pop-up, and is hidden once
 *     the app is installed. It is shown only once the browser has said
 *     whether the app is installed (useInstall's ready), so the installed app
 *     never paints the button and then removes it.
 *   - In Chrome-based browsers on Android it asks the browser's own install
 *     question (beforeinstallprompt, kept by InstallPromptCapture in the root
 *     layout). Elsewhere - Safari on iPhone, or once the browser's question
 *     has been used - it opens a bottom sheet with the browser's own steps.
 */

const WORDS = {
  title: 'Install app',
  iPhoneIntro: 'Add V2E to your Home Screen, so it opens like any other app.',
  iPhoneSteps: [
    "Tap Share in the browser's toolbar.",
    'Tap "Add to Home Screen". If you do not see it, scroll down the list.',
    'Tap Add.',
  ],
  otherSteps: 'Open the browser\'s menu and choose "Install app" or "Add to Home screen".',
}

export function InstallSheet({
  open,
  onOpenChange,
  platform,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  platform: InstallPlatform
}) {
  return (
    <PhoneSheet open={open} onOpenChange={onOpenChange} title={WORDS.title}>
      {platform === 'ios' ? (
        <div className="flex flex-col gap-[16px] text-phone-body text-phone-text-primary">
          <p>{WORDS.iPhoneIntro}</p>
          <ol className="flex list-decimal flex-col gap-[8px] pl-[24px]">
            {WORDS.iPhoneSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
      ) : (
        <p className="text-phone-body text-phone-text-primary">{WORDS.otherSteps}</p>
      )}
    </PhoneSheet>
  )
}

export function InstallButton() {
  const { layout } = useLayout()
  const install = useInstall()
  const [sheetOpen, setSheetOpen] = React.useState(false)
  const busy = React.useRef(false)

  if (layout !== 'phone' || !install.ready || install.installed) return null

  async function onInstall() {
    if (busy.current) return
    busy.current = true
    try {
      if (install.canPrompt) {
        const outcome = await install.prompt()
        if (outcome !== 'unavailable') return
      }
      setSheetOpen(true)
    } finally {
      busy.current = false
    }
  }

  return (
    <>
      <PhoneButton fullWidth onClick={() => void onInstall()}>
        <Smartphone aria-hidden />
        Install app
      </PhoneButton>
      <InstallSheet open={sheetOpen} onOpenChange={setSheetOpen} platform={install.platform} />
    </>
  )
}
