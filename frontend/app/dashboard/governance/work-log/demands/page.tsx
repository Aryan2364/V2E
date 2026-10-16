'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { Plus, Repeat, Clock, Inbox, Send, Pause, Play, Trash2 } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { workLogApi } from '@/lib/api/workLogs'
import DemandModal from '@/components/work-logs/DemandModal'
import type { WorkLogDemand, WorkLogSubmission } from '@/lib/types/workLogs'
import { format as formatDateFns } from 'date-fns'

const cardCls = 'bg-surface border border-border-light rounded-xl shadow-card'
const inputCls =
  'w-full border border-border rounded-lg px-3 py-2 text-sm text-text-primary bg-surface placeholder:text-text-muted focus:border-2 focus:border-primary focus:outline-hidden'

function freqLabel(d: WorkLogDemand): string {
  if (d.kind === 'one_time') return d.deadline ? `One-time · due ${formatDateFns(new Date(d.deadline), 'd MMM')}` : 'One-time'
  const t = d.schedule_entries?.[0]?.schedule_type
  return `Recurring · ${t ?? 'custom'}`
}

export default function WorkLogDemandsPage() {
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''

  const [demands, setDemands] = useState<WorkLogDemand[]>([])
  const [mine, setMine] = useState<WorkLogSubmission[]>([])
  const [selected, setSelected] = useState<WorkLogDemand | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    if (!orgId) return
    const [d, m] = await Promise.all([
      workLogApi.listDemands(orgId),
      workLogApi.getMySubmissions(orgId, 'pending'),
    ])
    setDemands(d)
    setMine(m)
  }, [orgId])

  useEffect(() => {
    load()
  }, [load])

  async function openSeries(id: string) {
    const series = await workLogApi.getDemandSeries(orgId, id)
    setSelected(series)
  }

  async function submitMine(id: string) {
    await workLogApi.submitSubmission(orgId, id, drafts[id] ?? '')
    await load()
  }

  async function toggle(d: WorkLogDemand) {
    if (d.is_active) await workLogApi.pauseDemand(orgId, d.id)
    else await workLogApi.resumeDemand(orgId, d.id)
    await load()
    if (selected?.id === d.id) openSeries(d.id)
  }

  async function remove(id: string) {
    await workLogApi.deleteDemand(orgId, id)
    if (selected?.id === id) setSelected(null)
    await load()
  }

  return (
    <div className="space-y-6">
      {/* Logs demanded from me */}
      {mine.length > 0 && (
        <div className={`${cardCls} p-6`}>
          <h2 className="text-[18px] font-medium text-text-primary flex items-center gap-2 mb-4">
            <Inbox size={17} className="text-primary-text" /> Logs demanded from me
          </h2>
          <div className="space-y-4">
            {mine.map((s) => (
              <div key={s.id} className="border border-border-light rounded-[10px] p-4 bg-surface-sunken">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-text-primary">{s.demand?.title}</span>
                  <span className="text-xs text-text-muted">due {s.period_label}</span>
                </div>
                {s.assigner_name && <p className="text-xs text-text-muted mb-2">Asked by {s.assigner_name}</p>}
                <textarea
                  value={drafts[s.id] ?? ''}
                  onChange={(e) => setDrafts((m) => ({ ...m, [s.id]: e.target.value }))}
                  placeholder="Your update…"
                  rows={2}
                  className={inputCls}
                />
                <div className="flex justify-end mt-2">
                  <button
                    type="button"
                    onClick={() => submitMine(s.id)}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white bg-primary hover:bg-primary-hover"
                  >
                    <Send size={14} /> Submit
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* My demands + series */}
      <div className="flex flex-col lg:flex-row gap-6">
        <div className="lg:w-80 shrink-0 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-[18px] font-medium text-text-primary">Logs I demanded</h2>
            <button
              type="button"
              onClick={() => setShowModal(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-white bg-primary hover:bg-primary-hover"
            >
              <Plus size={15} /> Demand
            </button>
          </div>

          {demands.length === 0 ? (
            <div className={`${cardCls} p-6 text-center`}>
              <p className="text-sm text-text-secondary">You haven&apos;t demanded any logs yet.</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {demands.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => openSeries(d.id)}
                    className={`w-full text-left ${cardCls} p-4 transition-colors ${selected?.id === d.id ? 'ring-2 ring-primary' : 'hover:bg-surface-sunken'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-text-primary truncate">{d.title}</span>
                      {!d.is_active && (
                        <span className="text-meta font-medium px-1.5 py-0.5 rounded-full bg-danger-bg text-danger border border-danger-border shrink-0">Paused</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-xs text-text-muted">
                      {d.kind === 'recurring' ? <Repeat size={12} /> : <Clock size={12} />}
                      <span>{freqLabel(d)}</span>
                    </div>
                    <p className="text-xs text-text-secondary mt-1">
                      For {d.assignee_name ?? 'someone'} · {d._count?.submissions ?? 0} submission{(d._count?.submissions ?? 0) !== 1 ? 's' : ''}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Series detail */}
        <div className="flex-1 min-w-0">
          {!selected ? (
            <div className={`${cardCls} p-8 text-center`}>
              <p className="text-sm text-text-secondary">Select a demand to view its submission series.</p>
            </div>
          ) : (
            <div className={`${cardCls} p-6`}>
              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-[18px] font-medium text-text-primary">{selected.title}</h2>
                  <p className="text-sm text-text-muted mt-0.5">
                    {freqLabel(selected)} · for {selected.assignee_name ?? 'someone'}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {selected.kind === 'recurring' && (
                    <button
                      type="button"
                      onClick={() => toggle(selected)}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium text-text-secondary border border-border-light hover:bg-surface-control"
                    >
                      {selected.is_active ? <><Pause size={13} /> Pause</> : <><Play size={13} /> Resume</>}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => remove(selected.id)}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium text-danger border border-danger-border hover:bg-danger-bg"
                  >
                    <Trash2 size={13} /> Delete
                  </button>
                </div>
              </div>
              {selected.description && <p className="text-sm text-text-primary mb-4">{selected.description}</p>}

              <h3 className="text-xs font-medium text-text-muted uppercase tracking-wide mb-2">Submission series</h3>
              {(selected.submissions ?? []).length === 0 ? (
                <p className="text-sm text-text-muted">No submissions yet.</p>
              ) : (
                <ul className="divide-y divide-surface-control">
                  {(selected.submissions ?? []).map((s) => (
                    <li key={s.id} className="py-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-text-primary">{s.period_label}</span>
                        <span
                          className={`text-meta font-medium px-1.5 py-0.5 rounded-full ${
                            s.status === 'submitted'
                              ? 'bg-success-bg text-success border border-success-border'
                              : 'bg-warning-bg text-warning border border-warning-border'
                          }`}
                        >
                          {s.status}
                        </span>
                      </div>
                      {s.body && <p className="text-sm text-text-primary whitespace-pre-wrap mt-1">{s.body}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>

      {showModal && <DemandModal orgId={orgId} onClose={() => setShowModal(false)} onCreated={load} />}
    </div>
  )
}
