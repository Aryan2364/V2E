'use client'

import MainLayout from '@/components/layout/MainLayout'
import GoalsSidebar from '@/components/layout/GoalsSidebar'

export default function GoalsLayout({ children }: { children: React.ReactNode }) {
  return (
    <MainLayout>
      <div className="flex gap-0 h-[calc(100vh-56px)]">
        <GoalsSidebar />
        {/* scrollbar-gutter:stable reserves the scrollbar's space so opening a tall
            popover (which briefly makes a short page overflow) doesn't nudge the
            layout sideways. */}
        <main className="flex-1 min-w-0 overflow-auto scrollbar-gutter-stable">
          <div className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8 mx-auto max-w-[1600px]">
            {children}
          </div>
        </main>
      </div>
    </MainLayout>
  )
}
