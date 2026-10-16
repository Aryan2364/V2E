'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { Shield, UserPlus, Info } from 'lucide-react'
import { tasksApi } from '@/lib/api/tasks'
import EmployeePicker, { type EmployeePickerOption } from '@/components/ui/EmployeePicker'
import StyledSelect from '@/components/ui/StyledSelect'
import type { RecurringAccessPanel, RecurringAccessLevel } from '@/lib/types/tasks'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

const AVATAR_COLORS = ['bg-primary', 'bg-text-secondary', 'bg-success', 'bg-warning', 'bg-danger', 'bg-text-secondary']
function avatarColor(name: string): string {
  let h = 0; for (let i = 0; i < name.length; i++) h += name.charCodeAt(i)
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}
function initials(name: string): string {
  return name.split(' ').map((n) => n[0] ?? '').join('').toUpperCase().slice(0, 2) || '?'
}

function Avatar({ name }: { name: string }) {
  return (
    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-meta font-medium shrink-0 ${avatarColor(name)}`}>
      {initials(name)}
    </div>
  )
}

const SOURCE_LABEL: Record<string, string> = { creator: 'Owner', assignee: 'Assignee', cc: 'CC' }

/**
 * Google-Drive-style access manager for a recurring template. Shows who can see it by
 * the rules (owner / assignees / CC), the people it's been explicitly shared with
 * (view or edit), and the people explicitly hidden from it. The owner or an admin can
 * add someone outside the rules, change a share's level, remove a viewer, or restore a
 * hidden one — the affected person is notified. Removing only affects VISIBILITY;
 * assignment is managed separately in the template's assignees.
 */
export default function ManageAccessModal({
  orgId,
  templateId,
  employees,
  onClose,
}: {
  orgId: string
  templateId: string
  employees: EmployeePickerOption[]
  onClose: () => void
}) {
  const [panel, setPanel] = useState<RecurringAccessPanel | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyUser, setBusyUser] = useState<string | null>(null)

  // Add row
  const [addUser, setAddUser] = useState('')
  const [addLevel, setAddLevel] = useState<'view' | 'edit' | 'revoke'>('view')

  useEffect(() => {
    let cancelled = false
    tasksApi.getRecurringAccess(orgId, templateId)
      .then((p) => { if (!cancelled) setPanel(p) })
      .catch((e) => { if (!cancelled) setError(e?.response?.data?.message ?? 'Could not load access settings.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [orgId, templateId])

  const nameOf = useMemo(() => new Map(employees.map((e) => [e.user_id, e.name])), [employees])

  // People already accounted for (so the picker doesn't offer them again).
  const takenIds = useMemo(() => {
    if (!panel) return new Set<string>()
    return new Set<string>([
      ...panel.rule_viewers.map((p) => p.user_id),
      ...panel.shares.map((p) => p.user_id),
      ...panel.revokes.map((p) => p.user_id),
    ])
  }, [panel])

  const pickerOptions = useMemo(() => employees.filter((e) => !takenIds.has(e.user_id)), [employees, takenIds])

  async function mutate(fn: () => Promise<RecurringAccessPanel>, userId: string) {
    setBusyUser(userId)
    setError(null)
    try {
      setPanel(await fn())
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Could not update access. Please try again.')
    } finally {
      setBusyUser(null)
    }
  }

  const share = (userId: string, level: RecurringAccessLevel) =>
    mutate(() => tasksApi.setRecurringAccess(orgId, templateId, { user_id: userId, kind: 'grant', level }), userId)
  const revoke = (userId: string) =>
    mutate(() => tasksApi.setRecurringAccess(orgId, templateId, { user_id: userId, kind: 'revoke' }), userId)
  const clear = (userId: string) =>
    mutate(() => tasksApi.clearRecurringAccess(orgId, templateId, userId), userId)

  async function handleAdd() {
    if (!addUser) return
    if (addLevel === 'revoke') await revoke(addUser)
    else await share(addUser, addLevel)
    setAddUser('')
    setAddLevel('view')
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent size="md">
        <DialogHeader>
          <div className="flex items-center gap-2 min-w-0">
            <Shield size={17} className="shrink-0" />
            <div className="min-w-0">
              <DialogTitle>Manage access</DialogTitle>
              {panel && <p className="text-[13px] text-on-brand-muted truncate">“{panel.title}”</p>}
            </div>
          </div>
        </DialogHeader>

        {/* Body */}
        <DialogBody className="space-y-4">
          {error && (
            <div className="bg-danger-bg border border-danger-border rounded-lg px-3 py-2 text-sm text-danger">{error}</div>
          )}

          {loading ? (
            <div className="space-y-2 py-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : panel ? (
            <>
              {/* Add people */}
              <div className="bg-surface-sunken border border-border-light rounded-lg p-3">
                <div className="flex items-center gap-1.5 mb-2 text-[13px] font-medium text-text-primary">
                  <UserPlus size={14} className="text-primary-text" /> Add or remove a person
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex-1 min-w-[180px]">
                    <EmployeePicker
                      value={addUser}
                      onChange={setAddUser}
                      employees={pickerOptions}
                      title="Select a person"
                      placeholder="Choose a person…"
                      allowClear
                    />
                  </div>
                  <StyledSelect
                    value={addLevel}
                    onChange={(v) => setAddLevel(v as typeof addLevel)}
                    wrapperClassName="w-[140px]"
                    options={[
                      { value: 'view', label: 'Can view' },
                      { value: 'edit', label: 'Can edit' },
                      { value: 'revoke', label: 'No access' },
                    ]}
                  />
                  <button
                    onClick={handleAdd}
                    disabled={!addUser || busyUser === addUser}
                    className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-hover disabled:bg-surface-control-pressed disabled:text-text-muted transition-colors"
                  >
                    Apply
                  </button>
                </div>
                <p className="mt-2 flex items-start gap-1 text-[12px] text-text-muted">
                  <Info size={12} className="mt-0.5 shrink-0" />
                  “No access” hides the template from someone the rules would otherwise let see it. It does not change who does the work — edit the assignees for that.
                </p>
              </div>

              {/* Has access */}
              <div>
                <p className="text-[12px] font-medium uppercase tracking-wide text-text-muted mb-2">Has access</p>
                <div className="space-y-1.5">
                  {panel.rule_viewers.map((p) => (
                    <div key={`rv-${p.user_id}`} className="flex items-center gap-3 px-2.5 py-2 rounded-lg hover:bg-surface-sunken">
                      <Avatar name={p.name} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-text-primary truncate">{p.name}</p>
                        <p className="text-[12px] text-text-muted">{SOURCE_LABEL[p.source ?? ''] ?? 'Viewer'} · by rule</p>
                      </div>
                      {p.source === 'creator' ? (
                        <span className="text-[12px] font-medium text-text-muted px-2">Full access</span>
                      ) : p.source === 'assignee' ? (
                        <span className="text-[12px] text-text-muted px-2">Does the work</span>
                      ) : (
                        <button
                          onClick={() => revoke(p.user_id)}
                          disabled={busyUser === p.user_id}
                          className="text-[13px] font-medium text-danger hover:underline disabled:opacity-50"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  ))}

                  {panel.shares.map((p) => (
                    <div key={`sh-${p.user_id}`} className="flex items-center gap-3 px-2.5 py-2 rounded-lg hover:bg-surface-sunken">
                      <Avatar name={p.name} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-text-primary truncate">{p.name}</p>
                        <p className="text-[12px] text-primary-text">Shared</p>
                      </div>
                      <StyledSelect
                        value={p.level ?? 'view'}
                        onChange={(v) => share(p.user_id, v as RecurringAccessLevel)}
                        wrapperClassName="w-[120px]"
                        options={[{ value: 'view', label: 'Can view' }, { value: 'edit', label: 'Can edit' }]}
                      />
                      <button
                        onClick={() => clear(p.user_id)}
                        disabled={busyUser === p.user_id}
                        className="text-[13px] font-medium text-danger hover:underline disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Removed */}
              {panel.revokes.length > 0 && (
                <div>
                  <p className="text-[12px] font-medium uppercase tracking-wide text-text-muted mb-2">Hidden from</p>
                  <div className="space-y-1.5">
                    {panel.revokes.map((p) => (
                      <div key={`rk-${p.user_id}`} className="flex items-center gap-3 px-2.5 py-2 rounded-lg hover:bg-surface-sunken">
                        <Avatar name={p.name} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-text-primary truncate">{p.name}</p>
                          <p className="text-[12px] text-text-muted">No access</p>
                        </div>
                        <button
                          onClick={() => clear(p.user_id)}
                          disabled={busyUser === p.user_id}
                          className="text-[13px] font-medium text-primary-text hover:underline disabled:opacity-50"
                        >
                          Restore
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : null}
        </DialogBody>

        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
