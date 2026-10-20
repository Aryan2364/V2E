'use client'

import { useState } from 'react'
import MainLayout from '@/components/layout/MainLayout'
import LearningAdminSidebar from '@/components/learning/LearningAdminSidebar'

export default function LearningLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <MainLayout>
      <LearningAdminSidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
      <div
        className="min-w-0 transition-[margin-left] duration-200 ease-in-out"
        style={{ marginLeft: collapsed ? 64 : 240 }}
      >
        {/* Section 12.3: pages get a 1600px frame, centred in the room beside the sidebar. */}
        <div className="mx-auto min-w-0 max-w-[1600px]">{children}</div>
      </div>
    </MainLayout>
  )
}
