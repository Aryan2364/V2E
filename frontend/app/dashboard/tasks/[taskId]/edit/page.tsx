'use client'

import { useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useLayout } from '@/lib/layout'

/*
 * /dashboard/tasks/:taskId/edit
 *
 * On a phone, MainLayout renders PhoneShell instead of this page
 * (lib/phone-routes.ts 'task-edit' -> EditTaskScreen), so nothing here runs.
 *
 * On desktop the task is edited in a dialog on the record itself, so this
 * address forwards to the record rather than showing a blank page. The
 * forward waits one tick and is cancelled on unmount: if the first render's
 * layout guess was "desktop" and the measured answer is "phone", MainLayout
 * swaps to PhoneShell, this page unmounts, and the phone's Edit task screen
 * stays put.
 */
export default function EditTaskRoute() {
  const router = useRouter()
  const { layout } = useLayout()
  const params = useParams<{ taskId: string }>()
  const taskId = params?.taskId

  useEffect(() => {
    if (layout !== 'desktop' || !taskId) return
    const t = window.setTimeout(() => router.replace(`/dashboard/tasks/${taskId}`), 0)
    return () => window.clearTimeout(t)
  }, [layout, router, taskId])

  return null
}
