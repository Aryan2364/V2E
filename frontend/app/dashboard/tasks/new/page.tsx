'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useLayout } from '@/lib/layout'

/*
 * /dashboard/tasks/new
 *
 * On a phone, MainLayout renders PhoneShell instead of this page
 * (lib/phone-routes.ts 'give-task' -> GiveTaskScreen), so nothing here runs.
 *
 * On desktop there is no "new task" page - tasks are given from the list's
 * own create dialog - so this address forwards to the tasks list rather than
 * showing a blank page. The forward waits one tick and is cancelled on
 * unmount: if the first render's layout guess was "desktop" and the measured
 * answer is "phone", MainLayout swaps to PhoneShell, this page unmounts, and
 * the phone's Give task screen stays put.
 */
export default function NewTaskRoute() {
  const router = useRouter()
  const { layout } = useLayout()

  useEffect(() => {
    if (layout !== 'desktop') return
    const t = window.setTimeout(() => router.replace('/dashboard/tasks'), 0)
    return () => window.clearTimeout(t)
  }, [layout, router])

  return null
}
