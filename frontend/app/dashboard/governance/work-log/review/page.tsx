'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { Users, FileText, ChevronRight, MessageSquare } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { workLogApi } from '@/lib/api/workLogs'
import WorkLogRemarkThread from '@/components/work-logs/WorkLogRemarkThread'
import Tooltip from '@/components/ui/tooltip'
import type { DailyUpdate, ReadableWriter, WorkLogRemark, WorkLogSubmission } from '@/lib/types/workLogs'
import { format as formatDateFns } from 'date-fns'

const cardCls = 'bg-surface border border-border-light rounded-xl shadow-card'

type SelectedLog =
  | { kind: 'daily'; daily: DailyUpdate }
  | { kind: 'submission'; submission: WorkLogSubmission }

function prettyDate(d: string) {
  return formatDateFns(new Date(d), 'EEE, d MMM yyyy')
}

export default function WorkLogReviewPage() {
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''
  const myId = user?.id ?? ''

  const [writers, setWriters] = useState<ReadableWriter[]>([])
  const [writerId, setWriterId] = useState<string | null>(null)
  const [dailies, setDailies] = useState<DailyUpdate[]>([])
  const [submissions, setSubmissions] = useState<WorkLogSubmission[]>([])
  const [selected, setSelected] = useState<SelectedLog | null>(null)
  const [remarks, setRemarks] = useState<WorkLogRemark[]>([])
  const [loadingWriters, setLoadingWriters] = useState(true)

  useEffect(() => {
    if (!orgId) return
    workLogApi.getReadableWriters(orgId).then((w) => {
      setWriters(w)
      setLoadingWriters(false)
    })
  }, [orgId])

  const loadWriter = useCallback(
    async (wid: string) => {
      setWriterId(wid)
      setSelected(null)
      setRemarks([])
      const res = await workLogApi.getWriterLogs(orgId, wid)
      setDailies((res.daily_updates ?? []).filter(Boolean) as DailyUpdate[])
      setSubmissions(res.standalone_submissions ?? [])
    },
    [orgId],
  )

  const target = selected
    ? selected.kind === 'daily'
      ? { type: 'daily_update', id: selected.daily.id }
      : { type: 'submission', id: selected.submission.id }
    : null

  const loadRemarks = useCallback(async () => {
    if (!target) return
    const r = await workLogApi.getRemarks(orgId, target.type, target.id)
    setRemarks(r)
  }, [orgId, target])

  useEffect(() => {
    if (target) loadRemarks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected])

  async function addRemark(body: string, replyTo?: string) {
    if (!target) return
    await workLogApi.addRemark(orgId, { target_type: target.type, target_id: target.id, body, reply_to_remark_id: replyTo })
    await loadRemarks()
  }
  async function deleteRemark(id: string) {
    await workLogApi.deleteRemark(orgId, id)
    await loadRemarks()
  }

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      {/* Writers */}
      <aside className="lg:w-64 shrink-0">
        <div className={`${cardCls} p-3`}>
          <h3 className="text-body font-medium text-text-primary flex items-center gap-2 px-1 mb-2">
            <Users size={15} className="text-primary-text" /> People below me
          </h3>
          {loadingWriters ? (
            <p className="text-meta text-text-muted px-1 py-2">Loading…</p>
          ) : writers.length === 0 ? (
            <p className="text-meta text-text-secondary px-1 py-2">No one&apos;s logs are shared with you yet.</p>
          ) : (
            <ul className="space-y-0.5">
              {writers.map((w) => (
                <li key={w.user_id}>
                  <button
                    type="button"
                    onClick={() => loadWriter(w.user_id)}
                    className={`w-full text-left px-2.5 py-2 rounded-lg transition-colors ${
                      writerId === w.user_id ? 'bg-primary-subtle' : 'hover:bg-surface-sunken'
                    }`}
                  >
                    <span className="block text-body font-medium text-text-primary">{w.name}</span>
                    {w.role_title && <span className="block text-meta text-text-muted">{w.role_title}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      {/* Logs list */}
      <div className="lg:w-72 shrink-0">
        {!writerId ? (
          <div className={`${cardCls} p-8 text-center`}>
            <FileText size={28} className="text-muted mx-auto mb-2" />
            <p className="text-body text-text-secondary">Pick a person to review their logs.</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className={`${cardCls} p-3`}>
              <h4 className="text-meta font-medium text-text-muted uppercase tracking-wide px-1 mb-2">Daily updates</h4>
              {dailies.length === 0 ? (
                <p className="text-meta text-text-muted px-1 py-1">No daily updates.</p>
              ) : (
                <ul className="space-y-0.5">
                  {dailies.map((d) => (
                    <li key={d.id}>
                      <button
                        type="button"
                        onClick={() => setSelected({ kind: 'daily', daily: d })}
                        className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-left transition-colors ${
                          selected?.kind === 'daily' && selected.daily.id === d.id ? 'bg-primary-subtle' : 'hover:bg-surface-sunken'
                        }`}
                      >
                        <span className="text-body text-text-primary">{prettyDate(d.log_date)}</span>
                        {d.submitted_at && <Tooltip label="Submitted"><span className="w-2 h-2 rounded-full bg-success shrink-0" aria-label="Submitted" /></Tooltip>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {submissions.length > 0 && (
              <div className={`${cardCls} p-3`}>
                <h4 className="text-meta font-medium text-text-muted uppercase tracking-wide px-1 mb-2">Demanded logs</h4>
                <ul className="space-y-0.5">
                  {submissions.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => setSelected({ kind: 'submission', submission: s })}
                        className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-left transition-colors ${
                          selected?.kind === 'submission' && selected.submission.id === s.id ? 'bg-primary-subtle' : 'hover:bg-surface-sunken'
                        }`}
                      >
                        <span className="text-body text-text-primary truncate">{s.demand?.title ?? s.period_label}</span>
                        <span
                          className={`text-meta font-medium px-1.5 py-0.5 rounded-full shrink-0 ${
                            s.status === 'submitted'
                              ? 'bg-success-bg text-success border border-success-border'
                              : 'bg-warning-bg text-warning border border-warning-border'
                          }`}
                        >
                          {s.status}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Detail + remarks */}
      <div className="flex-1 min-w-0">
        {!selected ? (
          <div className={`${cardCls} p-8 text-center`}>
            <ChevronRight size={28} className="text-muted mx-auto mb-2" />
            <p className="text-body text-text-secondary">Select a log to read it and leave remarks.</p>
          </div>
        ) : selected.kind === 'daily' ? (
          <div className="space-y-4">
            <div className={`${cardCls} p-6`}>
              <h2 className="text-[18px] font-medium text-text-primary mb-4">{prettyDate(selected.daily.log_date)}</h2>
              {(selected.daily.notes ?? []).length > 0 && (
                <div className="space-y-3 mb-4">
                  {(selected.daily.notes ?? []).map((n) => (
                    <div key={n.id} className="border border-border-light rounded-[10px] p-3 bg-surface-sunken">
                      <p className="text-body font-medium text-text-primary">{n.title}</p>
                      {n.description && <p className="text-body text-text-primary whitespace-pre-wrap mt-0.5">{n.description}</p>}
                    </div>
                  ))}
                </div>
              )}
              <Field label="Where I was stuck" value={selected.daily.stuck} />
              <Field label="Decisions I took" value={selected.daily.decisions} />
              <Field label="How the day was" value={selected.daily.day_summary} />
              <Field label="Planning for tomorrow" value={selected.daily.planning_tomorrow} />
            </div>

            <div className={`${cardCls} p-6`}>
              <h3 className="text-body font-medium text-text-primary flex items-center gap-2 mb-2">
                <MessageSquare size={15} className="text-primary-text" /> Remarks
              </h3>
              <WorkLogRemarkThread remarks={remarks} currentUserId={myId} onAdd={addRemark} onDelete={deleteRemark} />
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className={`${cardCls} p-6`}>
              <h2 className="text-[18px] font-medium text-text-primary">{selected.submission.demand?.title}</h2>
              <p className="text-meta text-text-muted mb-4">{selected.submission.period_label}</p>
              {selected.submission.body ? (
                <p className="text-body text-text-primary whitespace-pre-wrap">{selected.submission.body}</p>
              ) : (
                <p className="text-body text-text-muted">Not yet submitted.</p>
              )}
            </div>

            <div className={`${cardCls} p-6`}>
              <h3 className="text-body font-medium text-text-primary flex items-center gap-2 mb-2">
                <MessageSquare size={15} className="text-primary-text" /> Remarks
              </h3>
              <WorkLogRemarkThread remarks={remarks} currentUserId={myId} onAdd={addRemark} onDelete={deleteRemark} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null
  return (
    <div className="mb-3">
      <p className="text-meta font-medium text-text-muted uppercase tracking-wide">{label}</p>
      <p className="text-body text-text-primary whitespace-pre-wrap mt-0.5">{value}</p>
    </div>
  )
}
