'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Pencil, Building2, Target, ListChecks, FileText } from 'lucide-react'
import { levelColors } from '@/lib/role-levels'
import type { Role } from '@/lib/types'

interface Props {
  role: Role | null
  departmentName?: string
  canEdit: boolean
  onEdit: (role: Role) => void
  onClose: () => void
}

/**
 * Read-only detail drawer for a role — the counterpart to DeptInfoPanel.
 * Clicking a role opens THIS (a clean read view), not the edit form; the pencil
 * is the explicit, deliberate path into editing. KRAs render as a numbered
 * title+description list and KPIs as cards with a prominent target chip, so the
 * content reads like a spec sheet rather than a form.
 */
export default function RoleInfoPanel({ role, departmentName, canEdit, onEdit, onClose }: Props) {
  const open = !!role
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  if (!mounted) return null

  const kra = role?.kra ?? []
  const kpi = role?.kpi ?? []

  return createPortal(
    <>
      {open && <div className="fixed inset-0 bg-black/20 z-60" onClick={onClose} />}

      <div
        className={`fixed inset-y-0 right-0 z-70 w-full max-w-lg bg-white border-l border-[#E2E8F0] shadow-[-8px_0_32px_rgba(0,0,0,0.08)] flex flex-col transition-transform duration-300 ease-in-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[#E2E8F0]">
          <div className="min-w-0">
            {departmentName && (
              <span className="inline-flex items-center gap-1 text-xs text-[#64748B] mb-1">
                <Building2 size={12} /> {departmentName}
              </span>
            )}
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-bold text-[#0F172A] text-[17px] truncate">{role?.title}</h3>
              {role && (
                <span
                  className={[
                    'inline-flex items-center rounded-[999px] px-2.5 py-0.5 text-[11px] font-semibold capitalize',
                    levelColors[role.level],
                  ].join(' ')}
                >
                  {role.level}
                </span>
              )}
            </div>
            <p className="text-xs text-[#64748B] mt-1">
              {kra.length} KRA{kra.length !== 1 ? 's' : ''} · {kpi.length} KPI
              {kpi.length !== 1 ? 's' : ''}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {canEdit && role && (
              <button
                onClick={() => onEdit(role)}
                className="w-7 h-7 rounded-[6px] flex items-center justify-center text-[#94A3B8] hover:text-[#2563EB] hover:bg-[#EFF6FF] transition-colors"
                aria-label="Edit job role"
              >
                <Pencil size={15} />
              </button>
            )}
            <button
              onClick={onClose}
              className="w-7 h-7 rounded-[6px] flex items-center justify-center text-[#94A3B8] hover:text-[#0F172A] hover:bg-[#F1F5F9] transition-colors"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
          {/* Job description */}
          <section>
            <h4 className="flex items-center gap-1.5 text-xs font-semibold text-[#475569] uppercase tracking-wider mb-2">
              <FileText size={13} /> Job Description
            </h4>
            {role?.job_description ? (
              <p className="text-sm text-[#334155] whitespace-pre-wrap leading-relaxed">
                {role.job_description}
              </p>
            ) : (
              <p className="text-sm text-[#94A3B8] italic">No description provided.</p>
            )}
          </section>

          {/* KRAs */}
          <section>
            <h4 className="flex items-center gap-1.5 text-xs font-semibold text-[#475569] uppercase tracking-wider mb-3">
              <ListChecks size={13} /> Key Result Areas
              <span className="text-[#94A3B8] font-medium normal-case tracking-normal">
                ({kra.length})
              </span>
            </h4>
            {kra.length === 0 ? (
              <p className="text-sm text-[#94A3B8] italic">No KRAs defined.</p>
            ) : (
              <ol className="space-y-2.5">
                {kra.map((item, i) => (
                  <li
                    key={i}
                    className="flex gap-3 rounded-[10px] border border-[#E2E8F0] bg-white p-3"
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#EFF6FF] text-xs font-bold text-[#2563EB]">
                      {i + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#0F172A]">
                        {item.title || <span className="text-[#94A3B8] italic">Untitled</span>}
                      </p>
                      {item.description && (
                        <p className="text-[13px] text-[#475569] mt-0.5 leading-relaxed">
                          {item.description}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {/* KPIs */}
          <section>
            <h4 className="flex items-center gap-1.5 text-xs font-semibold text-[#475569] uppercase tracking-wider mb-3">
              <Target size={13} /> Key Performance Indicators
              <span className="text-[#94A3B8] font-medium normal-case tracking-normal">
                ({kpi.length})
              </span>
            </h4>
            {kpi.length === 0 ? (
              <p className="text-sm text-[#94A3B8] italic">No KPIs defined.</p>
            ) : (
              <div className="space-y-2.5">
                {kpi.map((item, i) => {
                  const target = [item.target, item.unit].filter(Boolean).join(' ')
                  return (
                    <div
                      key={i}
                      className="rounded-[10px] border border-[#E2E8F0] bg-white p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-semibold text-[#0F172A] min-w-0">
                          {item.title || <span className="text-[#94A3B8] italic">Untitled</span>}
                        </p>
                        {target && (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-[6px] bg-[#ECFDF5] px-2 py-0.5 text-xs font-semibold text-[#059669]">
                            <Target size={11} /> {target}
                          </span>
                        )}
                      </div>
                      {item.metric && (
                        <p className="text-[13px] text-[#475569] mt-1">
                          <span className="text-[#94A3B8]">Measured by</span> {item.metric}
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        </div>

        {/* Footer */}
        {canEdit && role && (
          <div className="px-5 py-4 border-t border-[#E2E8F0]">
            <button
              onClick={() => onEdit(role)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-[8px] text-sm font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] transition-colors"
            >
              <Pencil size={15} /> Edit job role
            </button>
          </div>
        )}
      </div>
    </>,
    document.body,
  )
}
