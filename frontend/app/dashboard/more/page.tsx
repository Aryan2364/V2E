import { redirectOnDesktop } from '@/lib/layout.server'
import PhoneOnly from '@/components/phone/PhoneOnly'

/**
 * /dashboard/more - the phone's More tab (FRONTEND_RULES_PHONE.md 41.4 rule
 * 15). On a phone the phone shell draws it (components/phone/screens/
 * MoreScreen.tsx); this page renders nothing there. More has no desktop form
 * (41.2 rule 5), so a computer is sent to the dashboard: by the server from
 * its layout guess, or by PhoneOnly if that guess was wrong.
 */
export default async function MorePage() {
  await redirectOnDesktop('/dashboard')
  return <PhoneOnly desktopHref="/dashboard" />
}
