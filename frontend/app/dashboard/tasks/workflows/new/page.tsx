'use client'

import WorkflowBuilder from '@/components/workflows/WorkflowBuilder'

/**
 * A new workflow: the same one-page builder as editing. It is saved, switched off, as
 * soon as it has a name, and the address becomes its edit page without a reload.
 */
export default function NewWorkflowPage() {
  return <WorkflowBuilder id={null} />
}
