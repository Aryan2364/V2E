import { redirectOnDesktop } from '@/lib/layout.server'
import PhoneOnly from '@/components/phone/PhoneOnly'

/**
 * /dashboard/more/notifications - Notification choices on the phone
 * (FRONTEND_RULES_PHONE.md 41.18 rule 3), drawn by the phone shell
 * (components/phone/screens/NotificationChoicesScreen.tsx). On a computer it
 * opens the Notifications page, where the desktop's notification controls
 * live (41.2 rule 5).
 */
export default async function NotificationChoicesPage() {
  await redirectOnDesktop('/dashboard/notifications')
  return <PhoneOnly desktopHref="/dashboard/notifications" />
}
