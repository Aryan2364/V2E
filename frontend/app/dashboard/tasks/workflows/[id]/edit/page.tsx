'use client'

import { useParams } from 'next/navigation'
import WorkflowBuilder from '@/components/workflows/WorkflowBuilder'

export default function EditWorkflowPage() {
  const { id } = useParams<{ id: string }>()
  // key: a different workflow is a fresh builder, never stale state from the last one.
  return <WorkflowBuilder key={id} id={id} />
}
