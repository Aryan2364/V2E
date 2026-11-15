'use client'

import dynamic from 'next/dynamic'
import { Skeleton } from '@/components/ui/skeleton'

// reactflow is heavy and browser-only: load it only when this page is opened.
const OrgChartPage = dynamic(() => import('@/components/org-chart/OrgChartPage'), {
  ssr: false,
  loading: () => <Skeleton className="h-full min-h-[480px] w-full rounded-xl" />,
})

export default function Page() {
  return <OrgChartPage />
}
