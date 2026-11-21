'use client'

import React, { useEffect, useState, useCallback, useRef } from 'react'
import type {
  TaskMasterConfig,
  TaskCategory,
  TaskPriority,
  TaskStatus,
  ChecklistTemplate,
  ChecklistAccessMode,
} from '@/lib/types/tasks'
import type { Department, Role, EmployeeProfile } from '@/lib/types'
import type {
  TicketMasterConfig,
  TicketType,
  TicketCategory,
  TicketPriority,
  TicketStatus,
  TicketTemplate,
  TicketReassignmentMode,
  TicketStatusType,
  TicketTemplateType,
  TicketResolverGroup,
  TicketAssignmentStrategy,
  TicketTemplateAccessMode,
} from '@/lib/types/tickets'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Plus, Pencil, Trash2, Save, X, Settings2, Tag, Tags, BarChart, Activity, List, Users, Ticket as TicketIcon, CheckSquare, Bell, GripVertical, ChevronUp, ChevronDown, Upload } from 'lucide-react'
import { notificationsApi, type NotificationMaster } from '@/lib/api/notifications'
import { Spinner } from './shared'

const NOTIF_EVENT_LABELS: Record<string, string> = {
  task_assigned: 'Task assigned (incl. CC)',
  task_completed: 'Task completed',
  task_reopened: 'Task reopened',
  task_comment: 'New comment on a task',
  task_reminder: 'Task reminder',
  task_overdue: 'Task overdue',
  task_overdue_followup: 'Task still overdue (follow-up)',
  task_escalated: 'Task escalated',
  recurring_spawned: 'Recurring task created',
  project_created: 'Project created',
  project_member_added: 'Added to a project',
  milestone_completed: 'Milestone achieved',
  workflow_triggered: 'Workflow started (new instance)',
  workflow_step_assigned: 'Workflow step assigned',
  workflow_step_upcoming: 'Your workflow step is starting soon',
  workflow_step_overdue: 'Workflow step overdue',
  workflow_upstream_delay: 'Upstream step delayed',
  workflow_completed: 'Workflow instance completed',
  workflow_stuck: 'Workflow instance stuck — needs attention',
  workflow_task_withdrawn: 'Workflow task withdrawn',
  workflow_sent_back: 'Workflow step sent back to you',
  workflow_step_late: 'Workflow step late',
  workflow_note_added: 'Message left for your workflow step',
  workflow_discussion: 'New message in a workflow instance discussion',
  workflow_mention: 'Mentioned in a workflow instance discussion',
  workflow_creator_changed: 'Made creator of a workflow',
  ticket_raised: 'Ticket raised / assigned',
  ticket_status_changed: 'Ticket status changed',
  ticket_sla_breached: 'Ticket SLA breached',
  ticket_escalated: 'Ticket escalated',
  ticket_comment: 'New comment on a ticket',
}

const NOTIF_MODULE_LABELS: Record<string, string> = {
  tasks: 'Tasks',
  projects: 'Projects',
  workflows: 'Workflows',
  tickets: 'Tickets',
}

export default function NotificationsMasterTab({ orgId }: { orgId: string }) {
  const [master, setMaster] = useState<NotificationMaster | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    notificationsApi.getMaster(orgId).then(setMaster).catch(() => null).finally(() => setLoading(false))
  }, [orgId])

  if (loading) return <Spinner />
  if (!master) return <p className="text-body text-text-secondary">Could not load notification settings.</p>

  const toggles = master.event_toggles ?? {}
  const isOn = (event: string) => toggles[event] !== false // absent ⇒ on

  function flip(event: string) {
    setMaster((prev) => prev && ({
      ...prev,
      event_toggles: { ...(prev.event_toggles ?? {}), [event]: !isOn(event) },
    }))
  }

  async function handleSave() {
    if (!master) return
    setSaving(true)
    try {
      const updated = await notificationsApi.updateMaster(orgId, {
        event_toggles: master.event_toggles,
        overdue_followup_days: master.overdue_followup_days,
      })
      setMaster({ ...updated, catalog: master.catalog })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch { /* ignore */ } finally { setSaving(false) }
  }

  const catalog = master.catalog ?? {}
  const modules = Object.keys(NOTIF_MODULE_LABELS).filter((m) => (catalog[m] ?? []).length > 0)

  return (
    <div className="space-y-6 max-w-2xl">
      <p className="text-label text-text-secondary">
        Switch individual notifications on or off for everyone in this organization.
      </p>

      {modules.map((mod) => (
        <div key={mod} className="border border-border-light rounded-control overflow-hidden">
          <div className="px-4 py-2.5 bg-surface-sunken border-b border-border-light">
            <p className="text-meta font-medium text-text-secondary uppercase tracking-wider">{NOTIF_MODULE_LABELS[mod]}</p>
          </div>
          <div className="divide-y divide-surface-control">
            {(catalog[mod] ?? []).map((event) => (
              <div key={event} className="flex items-center justify-between px-4 py-2.5 gap-4">
                <span className="text-body text-text-primary">{NOTIF_EVENT_LABELS[event] ?? event}</span>
                <Switch checked={isOn(event)} onCheckedChange={() => flip(event)} />
              </div>
            ))}
            {mod === 'tasks' && (
              <div className="flex items-center justify-between px-4 py-2.5 gap-4 bg-warning-bg/50">
                <span className="text-body text-text-primary">Overdue follow-up after (days)</span>
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={master.overdue_followup_days}
                  onChange={(e) => setMaster({ ...master, overdue_followup_days: parseInt(e.target.value) || 1 })}
                  className="w-20 border border-border rounded-control px-2 py-1.5 text-body text-text-primary focus:border-primary focus:outline-hidden bg-surface text-center"
                />
              </div>
            )}
          </div>
        </div>
      ))}

      <Button onClick={handleSave} loading={saving} loadingLabel="Saving">
        <Save size={15} />
        {saved ? 'Saved!' : 'Save Notification Settings'}
      </Button>
    </div>
  )
}
