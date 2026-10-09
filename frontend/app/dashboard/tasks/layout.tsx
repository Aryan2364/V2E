'use client'

import React, { useLayoutEffect, useRef } from 'react'
import { useSelectedLayoutSegments } from 'next/navigation'
import TaskModuleSidebar from '@/components/layout/TaskModuleSidebar'

export default function TasksLayout({ children }: { children: React.ReactNode }) {
  const mainRef = useRef<HTMLElement>(null)
  // The rendered route, not the address: a page that rewrites its own address in place
  // (the workflow builder after a first save) keeps its tree, so it keeps its scroll.
  const page = useSelectedLayoutSegments().join('/')

  // This <main> is the page's scroll container, and it outlives every page under
  // /dashboard/tasks. Without this, a new page inherits the last page's scroll offset and
  // Next.js's "scroll the new page into view" lands it part-way down (e.g. a workflow
  // opened from a scrolled builder sat ~56px down, its first heading under the sticky
  // header). A new page starts at its top. Runs after Next's own scroll (child effects run
  // first); query-only changes (filters) keep the route and so keep the position, and a
  // page that scrolls to a #hash does so once its content has loaded, after this.
  useLayoutEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = 0
  }, [page])

  // The TEST CLOCK is now a floating circular button (no reserved height), so the
  // shell can fill the full viewport below the top nav.
  return (
    <div className="flex gap-0 h-[calc(100vh-56px)] -mx-4 sm:-mx-6 lg:-mx-8 -my-6 lg:-my-8">
      <TaskModuleSidebar />
      {/* scrollbar-gutter:stable reserves the vertical scrollbar's space even when no
          scrollbar is showing — so opening a tall popover/menu (which briefly makes the
          short page overflow) no longer nudges the whole layout left as the bar appears. */}
      <main ref={mainRef} className="flex-1 min-w-0 px-4 sm:px-6 lg:px-8 py-6 lg:py-8 overflow-auto [scrollbar-gutter:stable]">
        {children}
      </main>
    </div>
  )
}
