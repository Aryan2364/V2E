'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/auth/context'
import { holidaysApi } from '@/lib/api/holidays'
import type { HolidayMasterConfig, HolidayOnTaskAction } from '@/lib/types/holidays'
import { Loader2, Save } from 'lucide-react'
import HolidayConfigCard from '@/components/holidays/HolidayConfigCard'

export default function HolidayConfigurationsPage() {
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''
  const isAdmin = !!user?.is_admin

  const [config, setConfig] = useState<HolidayMasterConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!orgId) return
    holidaysApi.getConfig(orgId).then(setConfig).finally(() => setLoading(false))
  }, [orgId])

  async function save() {
    if (!config) return
    setSaving(true)
    try {
      const updated = await holidaysApi.updateConfig(orgId, {
        holiday_on_task_action: config.holiday_on_task_action,
      })
      setConfig(updated)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={24} className="animate-spin text-text-muted" />
      </div>
    )
  }

  if (!config) return null

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[28px] font-bold text-text-primary">Configurations</h1>
        <p className="text-[15px] text-text-secondary mt-1">Configure how deadlines across tasks, recurring tasks, workflows and tickets behave when they fall on a holiday.</p>
      </div>

      <div className="bg-white border border-border-light rounded-[12px] p-6 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
        <h2 className="text-[18px] font-semibold text-text-primary mb-4">Behavior</h2>

        <HolidayConfigCard
          action={config.holiday_on_task_action}
          onActionChange={(a: HolidayOnTaskAction) => setConfig((c) => c ? { ...c, holiday_on_task_action: a } : c)}
          disabled={!isAdmin}
        />

        {isAdmin && (
          <div className="mt-5">
            <button
              type="button"
              disabled={saving}
              onClick={save}
              className="flex items-center gap-2 h-10 px-5 rounded-[8px] text-sm font-semibold text-white bg-primary hover:bg-primary-hover disabled:bg-surface-control-pressed disabled:text-text-muted transition-colors"
            >
              <Save size={15} />
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        )}
      </div>

    </div>
  )
}
