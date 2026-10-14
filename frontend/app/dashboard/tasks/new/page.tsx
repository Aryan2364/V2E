'use client'

/*
 * /dashboard/tasks/new - route existence only.
 *
 * On a phone, MainLayout renders PhoneShell instead of these children
 * (lib/phone-routes.ts 'give-task' -> GiveTaskScreen). This page has no
 * desktop entry point in this slice (desktop keeps using CreateTaskModal
 * from the list screens), so it stays a harmless placeholder here.
 */
export default function NewTaskRouteStub() {
  return null
}
