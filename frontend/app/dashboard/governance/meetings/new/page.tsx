import { redirectOnDesktop } from '@/lib/layout.server'
import PhoneOnly from '@/components/phone/PhoneOnly'

/**
 * /dashboard/governance/meetings/new - Create meeting, phone-only
 * (plan-phone-2026-10-14.md §5.9). Desktop creates a meeting through
 * CreateMeetingModal on the list page and has no address of its own for
 * it, so a computer visiting this URL is sent back to the Meetings list:
 * by the server from its layout guess, or by PhoneOnly if that guess was
 * wrong. On a phone the shell draws it (components/phone/screens/
 * MeetingCreateScreen.tsx); this page renders nothing there.
 */
export default async function CreateMeetingPage() {
  await redirectOnDesktop('/dashboard/governance/meetings')
  return <PhoneOnly desktopHref="/dashboard/governance/meetings" />
}
