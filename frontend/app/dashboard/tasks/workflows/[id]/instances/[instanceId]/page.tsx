'use client'

import { useParams } from 'next/navigation'
import RunView from '@/components/workflows/RunView'

export default function RunDetailPage() {
  const { id, instanceId } = useParams<{ id: string; instanceId: string }>()
  return <RunView key={instanceId} templateId={id} instanceId={instanceId} />
}
