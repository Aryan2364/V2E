'use client'

import React, { useEffect, useState, useCallback, useRef } from 'react'
import { ticketsApi } from '@/lib/api/tickets'
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

export default function TktConfigTab({ orgId }: { orgId: string }) {
  const [config, setConfig] = useState<TicketMasterConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    ticketsApi.getConfig(orgId).then(setConfig).catch(() => null).finally(() => setLoading(false))
  }, [orgId])

  async function handleSave() {
    if (!config) return
    setSaving(true)
    try {
      const updated = await ticketsApi.updateConfig(orgId, config)
      setConfig(updated); setSaved(true); setTimeout(() => setSaved(false), 2000)
    } catch { /* ignore */ } finally { setSaving(false) }
  }

  if (loading) return <Spinner />
  if (!config) return <p className="text-label text-text-secondary">Could not load configuration.</p>

  const modeOptions: { value: TicketReassignmentMode; label: string; desc: string }[] = [
    { value: 'both', label: 'Both', desc: 'Assignee and administrators can reassign' },
    { value: 'assignee_only', label: 'Assignee Only', desc: 'Only the current assignee can reassign' },
    { value: 'admin_manager_only', label: 'Administrators Only', desc: 'Only administrators can reassign' },
  ]

  return (
    <div className="space-y-6 max-w-xl">
      <FormField label="Reassignment mode">
        <div className="space-y-2">
          {modeOptions.map((opt) => (
            <button key={opt.value} type="button" onClick={() => setConfig({ ...config, reassignment_mode: opt.value })}
              className={`w-full flex items-start gap-3 p-3 rounded-control border-2 text-left outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-primary-ring transition-all ${config.reassignment_mode === opt.value ? 'border-primary bg-primary-subtle' : 'border-border-light hover:border-border'}`}>
              <div className={`w-4 h-4 rounded-full border-2 mt-0.5 shrink-0 ${config.reassignment_mode === opt.value ? 'border-primary bg-primary' : 'border-border'}`} />
              <div>
                <p className={`text-body font-medium ${config.reassignment_mode === opt.value ? 'text-primary-text' : 'text-text-primary'}`}>{opt.label}</p>
                <p className="text-meta text-text-secondary">{opt.desc}</p>
              </div>
            </button>
          ))}
        </div>
      </FormField>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Default escalation levels">
          <input type="number" min={0} max={5} value={config.default_escalation_levels}
            onChange={(e) => setConfig({ ...config, default_escalation_levels: parseInt(e.target.value) || 0 })}
            className={inputCls} />
        </FormField>
        <FormField label="Escalation interval (hours)">
          <input type="number" min={1} value={config.escalation_interval_hours}
            onChange={(e) => setConfig({ ...config, escalation_interval_hours: parseInt(e.target.value) || 1 })}
            className={inputCls} />
        </FormField>
        <FormField label="Default Response SLA (hours, optional)">
          <input type="number" min={1} value={config.default_response_sla_hours ?? ''}
            onChange={(e) => setConfig({ ...config, default_response_sla_hours: e.target.value ? parseInt(e.target.value) : null })}
            placeholder="No response SLA" className={inputCls} />
        </FormField>
      </div>

      <div className="space-y-3">
        {[
          { key: 'require_raiser_confirmation' as const, label: 'Require raiser confirmation before closing', desc: 'Ticket stays in "Resolved" until the raiser confirms their issue is fixed' },
          { key: 'enable_rating' as const, label: 'Enable ticket rating', desc: 'Raiser can rate the resolution quality (1–5 stars) after ticket is closed' },
          { key: 'allow_requester_reopen' as const, label: 'Allow requester to reopen', desc: 'The person who raised the ticket can reopen it after it is resolved or closed' },
          { key: 'allow_assignee_reopen' as const, label: 'Allow assignee to reopen', desc: 'The assigned resolver can reopen a ticket after it is resolved or closed' },
        ].map(({ key, label, desc }) => (
          <div key={key} className={`flex items-start gap-3 p-3 rounded-control border-2 cursor-pointer transition-all ${config[key] ? 'border-primary bg-primary-subtle' : 'border-border-light'}`} onClick={() => setConfig({ ...config, [key]: !config[key] })}>
            <div className={`relative w-9 h-5 rounded-full mt-0.5 shrink-0 transition-colors duration-200 ${config[key] ? 'bg-primary' : 'bg-surface-control-pressed'}`}>
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-surface rounded-full shadow-xs transition-transform duration-200 ${config[key] ? 'translate-x-4' : 'translate-x-0'}`} />
            </div>
            <div>
              <p className={`text-body font-medium ${config[key] ? 'text-primary-text' : 'text-text-primary'}`}>{label}</p>
              <p className="text-meta text-text-secondary mt-0.5">{desc}</p>
            </div>
          </div>
        ))}
      </div>

      <Button onClick={handleSave} loading={saving} loadingLabel="Saving">
        <Save size={15} /> {saved ? 'Saved!' : 'Save Configuration'}
      </Button>
    </div>
  )
}
