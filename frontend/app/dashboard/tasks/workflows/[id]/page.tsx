'use client'

import { useParams } from 'next/navigation'
import WorkflowOverview from '@/components/workflows/WorkflowOverview'

export default function WorkflowPage() {
  const { id } = useParams<{ id: string }>()
  // key: a different workflow is a fresh page, never stale state from the last one.
  return <WorkflowOverview key={id} id={id} />
}
