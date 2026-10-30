'use client'

import { useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useLayout } from '@/lib/layout'

/*
 * /dashboard/governance/meetings/:meetingId/edit
 *
 * On a phone, MainLayout renders PhoneShell instead of this page
 * (lib/phone-routes.ts 'meeting-edit' -> MeetingEditScreen), so nothing here runs.
 *
 * On desktop a meeting is edited in a dialog on its own page, so this address
 * forwards to the meeting rather than showing a blank page. The forward waits
 * one tick and is cancelled on unmount: if the first render's layout guess was
 * "desktop" and the measured answer is "phone", MainLayout swaps to PhoneShell,
 * this page unmounts, and the phone's Edit meeting screen stays put.
 */
export default function EditMeetingRoute() {
  const router = useRouter()
  const params = useParams<{ meetingId: string }>()
  const { layout } = useLayout()
  const meetingId = params?.meetingId

  useEffect(() => {
    if (layout !== 'desktop' || !meetingId) return
    const t = window.setTimeout(() => router.replace(`/dashboard/governance/meetings/${meetingId}`), 0)
    return () => window.clearTimeout(t)
  }, [layout, meetingId, router])

  return null
}
