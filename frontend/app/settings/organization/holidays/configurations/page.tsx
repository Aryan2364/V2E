'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/auth/context'
import { holidaysApi } from '@/lib/api/holidays'
import type { HolidayMasterConfig, HolidayOnTaskAction } from '@/lib/types/holidays'
import { Save } from 'lucide-react'
import HolidayConfigCard from '@/components/holidays/HolidayConfigCard'
import { PageHeader } from '@/components/shell/page-header'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Configurations"
        meta="Configure how deadlines across tasks, recurring tasks, workflows and tickets behave when they fall on a holiday."
      />

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : !config ? null : (
        <div className="bg-surface border border-border-light rounded-card p-6 shadow-card">
          <h2 className="text-section font-medium text-text-primary mb-4">Behavior</h2>

          <HolidayConfigCard
            action={config.holiday_on_task_action}
            onActionChange={(a: HolidayOnTaskAction) => setConfig((c) => c ? { ...c, holiday_on_task_action: a } : c)}
            disabled={!isAdmin}
          />

          {isAdmin && (
            <div className="mt-4">
              <Button type="button" loading={saving} onClick={save}>
                <Save size={15} />
                Save settings
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
