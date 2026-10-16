'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { Plus, Trash2, ShieldCheck } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { workLogApi } from '@/lib/api/workLogs'
import type { WorkLogAccessConfig } from '@/lib/types/workLogs'

const cardCls = 'bg-white border border-border-light rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.08)]'
const selectCls =
  'border border-border rounded-[8px] px-3 py-2 text-sm text-text-primary bg-white focus:border-2 focus:border-primary focus:outline-hidden'

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

  if (!config) return <p className="text-sm text-text-muted">Loading…</p>

  const writerAllow = new Set(config.settings.writer_user_ids ?? [])

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Read access */}
      <div className={`${cardCls} p-6`}>
        <h2 className="text-[18px] font-semibold text-text-primary flex items-center gap-2 mb-1">
          <ShieldCheck size={17} className="text-primary-text" /> Read access
        </h2>
        <p className="text-sm text-text-secondary mb-4">Control who can read whose Daily Updates and demanded logs.</p>

        <label className="flex items-center justify-between gap-4 py-2">
          <span className="text-sm text-text-primary">
            Managers automatically read their reports
            <span className="block text-xs text-text-muted">Everyone below them in the reporting hierarchy.</span>
          </span>
          <button
            type="button"
            onClick={toggleManagersRead}
            className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${config.settings.managers_read_reports ? 'bg-primary' : 'bg-surface-control-pressed'}`}
            aria-pressed={config.settings.managers_read_reports}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${config.settings.managers_read_reports ? 'translate-x-5' : ''}`} />
          </button>
        </label>

        <div className="border-t border-border-light mt-4 pt-4">
          <h3 className="text-sm font-semibold text-text-primary mb-2">Explicit reader → writer grants</h3>
          <div className="flex flex-wrap items-end gap-2 mb-3">
            <div>
              <label className="text-xs font-medium text-text-secondary block mb-1">Reader</label>
              <select value={newReader} onChange={(e) => setNewReader(e.target.value)} className={selectCls}>
                <option value="">Select…</option>
                {config.members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>{m.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-text-secondary block mb-1">Can read</label>
              <select value={newWriter} onChange={(e) => setNewWriter(e.target.value)} className={selectCls}>
                <option value="">Select…</option>
                {config.members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>{m.name}</option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={addGrant}
              disabled={!newReader || !newWriter || newReader === newWriter}
              className="flex items-center gap-1.5 px-4 py-2 rounded-[8px] text-sm font-semibold text-white bg-primary hover:bg-primary-hover disabled:bg-surface-control-pressed disabled:text-text-muted"
            >
              <Plus size={15} /> Add
            </button>
          </div>

          {config.grants.length === 0 ? (
            <p className="text-xs text-text-muted">No explicit grants.</p>
          ) : (
            <ul className="divide-y divide-surface-control">
              {config.grants.map((g) => (
                <li key={g.id} className="flex items-center justify-between py-2">
                  <span className="text-sm text-text-primary">
                    <span className="font-medium">{g.reader_name}</span> can read{' '}
                    <span className="font-medium">{g.writer_name}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => removeGrant(g.id)}
                    className="w-8 h-8 flex items-center justify-center rounded-[8px] text-text-muted hover:text-danger hover:bg-danger-bg"
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
        <h2 className="text-[18px] font-semibold text-text-primary mb-1">Write access</h2>
        <p className="text-sm text-text-secondary mb-4">By default everyone has a Daily Update. Restrict it to a specific set if needed.</p>

        <label className="flex items-center justify-between gap-4 py-2">
          <span className="text-sm text-text-primary">Restrict who can write Daily Updates</span>
          <button
            type="button"
            onClick={() => setRestrict(!restrictWriters)}
            className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${restrictWriters ? 'bg-primary' : 'bg-surface-control-pressed'}`}
            aria-pressed={restrictWriters}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${restrictWriters ? 'translate-x-5' : ''}`} />
          </button>
        </label>

        {restrictWriters && (
          <div className="border-t border-border-light mt-4 pt-4">
            <p className="text-xs text-text-muted mb-3">Only the selected people will be able to fill a Daily Update.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-72 overflow-y-auto">
              {config.members.map((m) => (
                <label key={m.user_id} className="flex items-center gap-2 px-2.5 py-2 rounded-[8px] hover:bg-surface-sunken cursor-pointer">
                  <input
                    type="checkbox"
                    checked={writerAllow.has(m.user_id)}
                    onChange={() => toggleWriter(m.user_id)}
                    className="w-4 h-4 accent-primary"
                  />
                  <span className="text-sm text-text-primary">{m.name}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
