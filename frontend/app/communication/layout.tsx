'use client'

import { useState } from 'react'
import MainLayout from '@/components/layout/MainLayout'
import CommunicationSidebar from '@/components/communication/CommunicationSidebar'

export default function CommunicationLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)
  return (
    <MainLayout>
      <CommunicationSidebar collapsed={collapsed} onToggle={() => setCollapsed(c => !c)} />
      {/* Mirrors the sidebar's width: a 64px icon rail below md, 240px (or the
          collapsed rail) from md up. */}
      <div
        className={[
          'min-w-0 transition-[margin-left] duration-200 ease-in-out',
          collapsed ? 'ml-16' : 'ml-16 md:ml-[240px]',
        ].join(' ')}
      >
        {children}
      </div>
    </MainLayout>
  )
}
