'use client'

import { useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useLayout } from '@/lib/layout'

/*
 * /dashboard/tasks/recurring/:id/edit
 *
 * On a phone, MainLayout renders PhoneShell instead of this page
 * (lib/phone-routes.ts 'recurring-edit' -> RecurringEditScreen), so nothing
 * here runs.
 *
 * On desktop a recurring task is edited in a dialog on its own page (the
 * template's instances), so this address forwards there. The forward waits
 * one tick and is cancelled on unmount, so a first-render "desktop" guess
 * that turns out to be a phone keeps the phone's edit screen in place.
 */
export default function EditRecurringRoute() {
  const router = useRouter()
  const { layout } = useLayout()
  const params = useParams<{ id: string }>()
  const id = params?.id

  useEffect(() => {
    if (layout !== 'desktop' || !id) return
    const t = window.setTimeout(() => router.replace(`/dashboard/tasks/recurring/${id}`), 0)
    return () => window.clearTimeout(t)
  }, [layout, id, router])

  return null
}
