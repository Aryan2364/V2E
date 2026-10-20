'use client'

import { Pencil, Building2, Target, ListChecks, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import Tooltip from '@/components/ui/tooltip'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetBody, SheetFooter } from '@/components/ui/sheet'
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
  const kra = role?.kra ?? []
  const kpi = role?.kpi ?? []

  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <SheetContent side="right" className="data-[side=right]:sm:max-w-lg">
        {role && (
          <>
            <SheetHeader>
              <div className="min-w-0">
                {departmentName && (
                  <span className="mb-1 inline-flex items-center gap-1 text-meta opacity-90">
                    <Building2 size={12} /> {departmentName}
                  </span>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <SheetTitle className="truncate">{role.title}</SheetTitle>
                  <span
                    className={[
                      'inline-flex items-center rounded-full px-2.5 py-0.5 text-meta font-medium capitalize',
                      levelColors[role.level],
                    ].join(' ')}
                  >
                    {role.level}
                  </span>
                </div>
                <p className="mt-1 text-meta opacity-90">
                  {kra.length} KRA{kra.length !== 1 ? 's' : ''} · {kpi.length} KPI
                  {kpi.length !== 1 ? 's' : ''}
                </p>
              </div>
              {canEdit && (
                <Tooltip label="Edit job role">
                  <Button
                    variant="on-brand"
                    size="icon"
                    className="absolute top-3 right-14"
                    onClick={() => onEdit(role)}
                    aria-label="Edit job role"
                  >
                    <Pencil size={15} />
                  </Button>
                </Tooltip>
              )}
            </SheetHeader>

            <SheetBody className="flex flex-col gap-6">
        {/* Job description */}
          <section>
            <h4 className="flex items-center gap-1.5 text-meta font-medium text-text-secondary mb-2">
              <FileText size={13} /> Job description
            </h4>
            {role?.job_description ? (
              <p className="text-body text-text-secondary whitespace-pre-wrap leading-relaxed">
                {role.job_description}
              </p>
            ) : (
              <p className="text-body text-text-muted italic">No description provided.</p>
            )}
          </section>

          {/* KRAs */}
          <section>
            <h4 className="flex items-center gap-1.5 text-meta font-medium text-text-secondary mb-3">
              <ListChecks size={13} /> Key result areas
              <span className="text-text-muted font-medium normal-case tracking-normal">
                ({kra.length})
              </span>
            </h4>
            {kra.length === 0 ? (
              <p className="text-body text-text-muted italic">No KRAs defined.</p>
            ) : (
              <ol className="space-y-2.5">
                {kra.map((item, i) => (
                  <li
                    key={i}
                    className="flex gap-3 rounded-xl border border-border-light bg-surface p-3"
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-subtle text-meta font-medium text-primary-text">
                      {i + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-body font-medium text-text-primary">
                        {item.title || <span className="text-text-muted italic">Untitled</span>}
                      </p>
                      {item.description && (
                        <p className="text-label text-text-secondary mt-0.5 leading-relaxed">
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
            <h4 className="flex items-center gap-1.5 text-meta font-medium text-text-secondary mb-3">
              <Target size={13} /> Key performance indicators
              <span className="text-text-muted font-medium normal-case tracking-normal">
                ({kpi.length})
              </span>
            </h4>
            {kpi.length === 0 ? (
              <p className="text-body text-text-muted italic">No KPIs defined.</p>
            ) : (
              <div className="space-y-2.5">
                {kpi.map((item, i) => {
                  const target = [item.target, item.unit].filter(Boolean).join(' ')
                  return (
                    <div
                      key={i}
                      className="rounded-xl border border-border-light bg-surface p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-body font-medium text-text-primary min-w-0">
                          {item.title || <span className="text-text-muted italic">Untitled</span>}
                        </p>
                        {target && (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-success-bg px-2 py-0.5 text-meta font-medium text-success">
                            <Target size={11} /> {target}
                          </span>
                        )}
                      </div>
                      {item.metric && (
                        <p className="text-label text-text-secondary mt-1">
                          <span className="text-text-muted">Measured by</span> {item.metric}
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </section>
            </SheetBody>

            {canEdit && (
              <SheetFooter>
                <Button variant="primary" onClick={() => onEdit(role)}>
                  <Pencil size={15} /> Edit job role
                </Button>
              </SheetFooter>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
