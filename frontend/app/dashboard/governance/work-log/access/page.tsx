'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { Plus, Trash2, ShieldCheck } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { workLogApi } from '@/lib/api/workLogs'
import type { WorkLogAccessConfig } from '@/lib/types/workLogs'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'

const cardCls = 'bg-surface border border-border-light rounded-xl shadow-card'

export default function WorkLogAccessPage() {
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''

  const [config, setConfig] = useState<WorkLogAccessConfig | null>(null)
  const [newReader, setNewReader] = useState('')
  const [newWriter, setNewWriter] = useState('')
  const [restrictWriters, setRestrictWriters] = useState(false)

  const load = useCallback(async () => {
    if (!orgId) return
    const c = await workLogApi.getAccess(orgId)
    setConfig(c)
    setRestrictWriters((c.settings.writer_user_ids ?? []).length > 0)
  }, [orgId])

  useEffect(() => {
    load()
  }, [load])

  async function toggleManagersRead() {
    if (!config) return
    const next = !config.settings.managers_read_reports
    await workLogApi.updateAccessSettings(orgId, { managers_read_reports: next })
    await load()
  }

  async function toggleWriter(userId: string) {
    if (!config) return
    const current = new Set(config.settings.writer_user_ids ?? [])
    if (current.has(userId)) current.delete(userId)
    else current.add(userId)
    await workLogApi.updateAccessSettings(orgId, { writer_user_ids: Array.from(current) })
    await load()
  }

  async function setRestrict(on: boolean) {
    setRestrictWriters(on)
    // Switching off the allowlist = everyone writes (empty array).
    if (!on) {
      await workLogApi.updateAccessSettings(orgId, { writer_user_ids: [] })
      await load()
    }
  }

  async function addGrant() {
    if (!newReader || !newWriter || newReader === newWriter) return
    await workLogApi.addReaderGrant(orgId, newReader, newWriter)
    setNewReader('')
    setNewWriter('')
    await load()
  }

  async function removeGrant(id: string) {
    await workLogApi.removeReaderGrant(orgId, id)
    await load()
  }

  if (!config) return <p className="text-body text-text-muted">Loading…</p>

  const writerAllow = new Set(config.settings.writer_user_ids ?? [])

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Read access */}
      <div className={`${cardCls} p-6`}>
        <h2 className="text-[18px] font-medium text-text-primary flex items-center gap-2 mb-1">
          <ShieldCheck size={17} className="text-primary-text" /> Read access
        </h2>
        <p className="text-body text-text-secondary mb-4">Control who can read whose Daily Updates and demanded logs.</p>

        <label className="flex items-center justify-between gap-4 py-2">
          <span className="text-body text-text-primary">
            Managers automatically read their reports
            <span className="block text-meta text-text-muted">Everyone below them in the reporting hierarchy.</span>
          </span>
          <Switch
            checked={config.settings.managers_read_reports}
            onCheckedChange={toggleManagersRead}
          />
        </label>

        <div className="border-t border-border-light mt-4 pt-4">
          <h3 className="text-body font-medium text-text-primary mb-2">Explicit reader → writer grants</h3>
          <div className="flex flex-wrap items-end gap-2 mb-3">
            <div className="w-[200px]">
              <label className="text-meta font-medium text-text-secondary block mb-1">Reader</label>
              <SearchableSelect
                value={newReader}
                onValueChange={setNewReader}
                placeholder="Select…"
                options={config.members.map((m) => ({ value: m.user_id, label: m.name }))}
              />
            </div>
            <div className="w-[200px]">
              <label className="text-meta font-medium text-text-secondary block mb-1">Can read</label>
              <SearchableSelect
                value={newWriter}
                onValueChange={setNewWriter}
                placeholder="Select…"
                options={config.members.map((m) => ({ value: m.user_id, label: m.name }))}
              />
            </div>
            <Button
              onClick={addGrant}
              disabled={!newReader || !newWriter || newReader === newWriter}
            >
              <Plus size={15} /> Add
            </Button>
          </div>

          {config.grants.length === 0 ? (
            <p className="text-meta text-text-muted">No explicit grants.</p>
          ) : (
            <ul className="divide-y divide-surface-control">
              {config.grants.map((g) => (
                <li key={g.id} className="flex items-center justify-between py-2">
                  <span className="text-body text-text-primary">
                    <span className="font-medium">{g.reader_name}</span> can read{' '}
                    <span className="font-medium">{g.writer_name}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => removeGrant(g.id)}
                    className="w-8 h-8 flex items-center justify-center rounded-lg text-text-muted hover:text-danger hover:bg-danger-bg"
                    aria-label="Remove grant"
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Write access */}
      <div className={`${cardCls} p-6`}>
        <h2 className="text-[18px] font-medium text-text-primary mb-1">Write access</h2>
        <p className="text-body text-text-secondary mb-4">By default everyone has a Daily Update. Restrict it to a specific set if needed.</p>

        <label className="flex items-center justify-between gap-4 py-2">
          <span className="text-body text-text-primary">Restrict who can write Daily Updates</span>
          <Switch
            checked={restrictWriters}
            onCheckedChange={(checked) => setRestrict(checked)}
          />
        </label>

        {restrictWriters && (
          <div className="border-t border-border-light mt-4 pt-4">
            <p className="text-meta text-text-muted mb-3">Only the selected people will be able to fill a Daily Update.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-72 overflow-y-auto">
              {config.members.map((m) => (
                <label key={m.user_id} className="flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-surface-sunken cursor-pointer">
                  <Checkbox
                    checked={writerAllow.has(m.user_id)}
                    onCheckedChange={() => toggleWriter(m.user_id)}
                  />
                  <span className="text-body text-text-primary">{m.name}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
