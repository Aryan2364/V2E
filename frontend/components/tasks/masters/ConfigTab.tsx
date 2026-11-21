'use client'

import React, { useEffect, useState, useCallback, useRef } from 'react'
import { tasksApi } from '@/lib/api/tasks'
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
import { Plus, Pencil, Trash2, Save, X, Settings2, Tag, Tags, BarChart, Activity, List, Users, Ticket as TicketIcon, CheckSquare, Bell, GripVertical, ChevronUp, ChevronDown, Upload } from 'lucide-react'
import { FormField, inputCls, Spinner } from './shared'

export default function ConfigTab({ orgId }: { orgId: string }) {
  const [config, setConfig] = useState<TaskMasterConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    tasksApi.getConfig(orgId).then(setConfig).catch(() => null).finally(() => setLoading(false))
  }, [orgId])

  async function handleSave() {
    if (!config) return
    setSaving(true)
    try {
      const updated = await tasksApi.updateConfig(orgId, config)
      setConfig(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch { /* ignore */ } finally { setSaving(false) }
  }

  if (loading) return <Spinner />
  if (!config) return <p className="text-body text-text-secondary">Could not load configuration.</p>

  return (
    <div className="space-y-6 max-w-xl">
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Default reminder days before">
          <input type="number" min={0} value={config.default_reminder_days_before}
            onChange={(e) => setConfig({ ...config, default_reminder_days_before: parseInt(e.target.value) || 0 })}
            className={inputCls} />
        </FormField>
        <FormField label="Undo window (minutes)">
          <input type="number" min={0} value={config.reopen_window_minutes}
            onChange={(e) => setConfig({ ...config, reopen_window_minutes: parseInt(e.target.value) || 0 })}
            className={inputCls} />
        </FormField>
        <FormField label="Escalation levels">
          <input type="number" min={0} value={config.escalation_levels}
            onChange={(e) => setConfig({ ...config, escalation_levels: parseInt(e.target.value) || 0 })}
            className={inputCls} />
        </FormField>
      </div>
      <Button onClick={handleSave} loading={saving} loadingLabel="Saving">
        <Save size={15} />
        {saved ? 'Saved!' : 'Save Configuration'}
      </Button>
    </div>
  )
}
