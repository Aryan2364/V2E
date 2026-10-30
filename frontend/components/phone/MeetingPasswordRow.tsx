'use client'

import React from 'react'
import { Copy, Eye, EyeOff } from 'lucide-react'
import { useToast } from '@/components/ui/Toast'

/*
 * The online meeting's password, hidden until asked for, with Copy. Mirrors
 * desktop's AccessCard (meetings/[meetingId]/page.tsx ~352-368): bullets with
 * a show / hide eye. Copy is the phone's addition - nobody retypes a password
 * from a small screen into the call app.
 */
export function MeetingPasswordRow({ password }: { password: string }) {
  const { addToast } = useToast()
  const [shown, setShown] = React.useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(password)
      addToast('Password copied', 'success')
    } catch {
      addToast('Could not copy. Show the password and copy it by hand.', 'error')
    }
  }

  const iconButton =
    'flex size-[44px] shrink-0 items-center justify-center rounded-full text-text-secondary active:bg-surface-control outline-hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-ring'

  return (
    <div className="flex min-h-[48px] items-center justify-between gap-[8px] rounded-[8px] border border-border-strong bg-surface pl-[12px]">
      <div className="flex min-w-0 flex-col">
        <span className="text-meta text-text-secondary">Password</span>
        <code className="truncate text-body text-text-primary">{shown ? password : '••••••••'}</code>
      </div>
      <div className="flex shrink-0 items-center">
        <button type="button" aria-label={shown ? 'Hide password' : 'Show password'} aria-pressed={shown} onClick={() => setShown((v) => !v)} className={iconButton}>
          {shown ? <EyeOff aria-hidden className="size-[20px]" /> : <Eye aria-hidden className="size-[20px]" />}
        </button>
        <button type="button" aria-label="Copy password" onClick={() => void copy()} className={iconButton}>
          <Copy aria-hidden className="size-[20px]" />
        </button>
      </div>
    </div>
  )
}
