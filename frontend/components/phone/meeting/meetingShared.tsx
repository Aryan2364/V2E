'use client'

import React from 'react'
import { ChevronRight } from 'lucide-react'
import { getEmployees } from '@/lib/api/employees'
import type { Meeting } from '@/lib/types/meetings'
import { PeoplePickerSheet, type PickedPerson, type PickerSection } from '../PeoplePickerSheet'
import { PhoneSheet } from '../PhoneSheet'
import { PhoneButton, PhoneField, cx } from '../primitives'

/*
 * Pieces the phone meeting sections share: the people list, a single-person
 * field, a confirm sheet and the edit gates. The gates mirror the computer's
 * meeting page and the server (meetings.service.ts requireAttendee/assertOpen).
 */

type LooseEmployee = {
  user_id: string
  name?: string
  email?: string
  user?: { name?: string }
  department?: { name?: string } | null
  role?: { name?: string } | null
}

export type MeetingPerson = { user_id: string; name: string; department: string | null; role: string | null }

/** Loads the org's people once, when first needed. */
export function useMeetingPeople(orgId: string, needed: boolean) {
  const [people, setPeople] = React.useState<MeetingPerson[]>([])
  const [failed, setFailed] = React.useState(false)
  const [loaded, setLoaded] = React.useState(false)
  const load = React.useCallback(() => {
    if (!orgId) return
    getEmployees(orgId)
      .then((emps) => {
        setFailed(false)
        setPeople(
          (emps as unknown as LooseEmployee[]).map((e) => ({
            user_id: e.user_id,
            name: e.user?.name ?? e.name ?? e.email ?? 'Unknown',
            department: e.department?.name ?? null,
            role: e.role?.name ?? null,
          })),
        )
        setLoaded(true)
      })
      .catch(() => setFailed(true))
  }, [orgId])
  React.useEffect(() => {
    if (needed && !loaded && !failed) load()
  }, [needed, loaded, failed, load])
  const retry = React.useCallback(() => {
    setFailed(false)
    load()
  }, [load])
  return { people, failed, loading: needed && !loaded && !failed, retry }
}

function groupByDepartment(people: MeetingPerson[]): PickerSection[] {
  const groups = new Map<string, MeetingPerson[]>()
  for (const p of people) groups.set(p.department?.trim() || '', [...(groups.get(p.department?.trim() || '') ?? []), p])
  const toSection = (name: string): PickerSection => ({
    id: name || 'none',
    name: name || 'No department',
    people: [...groups.get(name)!].sort((a, b) => a.name.localeCompare(b.name)).map((p) => ({ user_id: p.user_id, name: p.name, role: p.role, department: p.department })),
  })
  const named = [...groups.keys()].filter(Boolean).sort((a, b) => a.localeCompare(b)).map(toSection)
  return groups.has('') ? [...named, toSection('')] : named
}

/** One person (or nobody): a row that opens the people picker. */
export function PersonField({
  label,
  htmlFor,
  required,
  value,
  onChange,
  people,
  loading,
  failed,
  onRetry,
  placeholder = 'Choose a person',
  clearable = true,
}: {
  label: string
  htmlFor: string
  required?: boolean
  value: string
  onChange: (userId: string) => void
  people: MeetingPerson[]
  loading: boolean
  failed: boolean
  onRetry: () => void
  placeholder?: string
  clearable?: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const name = people.find((p) => p.user_id === value)?.name
  const selected: PickedPerson[] = value && name ? [{ user_id: value, name }] : []
  return (
    <PhoneField label={label} htmlFor={htmlFor} required={required}>
      <div className="flex gap-[8px]">
        <button
          id={htmlFor}
          type="button"
          onClick={() => setOpen(true)}
          className="flex min-h-(--h-control) min-w-0 flex-1 items-center justify-between gap-[8px] rounded-[8px] border border-border-strong bg-surface px-[12px] text-left active:bg-surface-control"
        >
          <span className={cx('min-w-0 truncate text-body', name ? 'text-text-primary' : 'text-text-muted')}>{name ?? (value ? 'Selected' : placeholder)}</span>
          <ChevronRight aria-hidden className="size-[18px] shrink-0 text-text-secondary" />
        </button>
        {clearable && value ? (
          <PhoneButton variant="secondary" onClick={() => onChange('')}>
            Clear
          </PhoneButton>
        ) : null}
      </div>
      <PeoplePickerSheet
        open={open}
        onOpenChange={setOpen}
        title={label}
        sections={groupByDepartment(people)}
        loading={loading}
        failed={failed}
        onRetry={onRetry}
        selected={selected}
        // The picker is multi-select; one person is wanted, so the newest tap wins.
        onDone={(picked) => {
          const next = picked.filter((p) => p.user_id !== value)
          onChange((next[next.length - 1] ?? picked[picked.length - 1])?.user_id ?? '')
        }}
      />
    </PhoneField>
  )
}

/** Confirm sheet for the steps that are hard to take back. */
export function ConfirmSheet({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  busy,
  destructive,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  body: string
  confirmLabel: string
  busy: boolean
  destructive?: boolean
  onConfirm: () => void
}) {
  return (
    <PhoneSheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      footer={
        <>
          <PhoneButton variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </PhoneButton>
          <PhoneButton
            variant="primary"
            loading={busy}
            className={cx(destructive && 'border-danger bg-danger active:border-danger active:bg-danger')}
            onClick={onConfirm}
          >
            {confirmLabel}
          </PhoneButton>
        </>
      }
    >
      <p className="text-body text-text-primary">{body}</p>
    </PhoneSheet>
  )
}

export const LOCKED_STATUSES = ['closed', 'cancelled']

/** Desktop: locked = closed or cancelled. Server: a participant or someone who can manage may edit the record. */
export function meetingEditGates(meeting: Meeting, userId: string | undefined) {
  const locked = LOCKED_STATUSES.includes(meeting.status)
  const participant = !!userId && (meeting.created_by_user_id === userId || !!meeting.attendees?.some((a) => a.user_id === userId))
  const canEdit = participant || !!meeting.can_manage
  return { locked, canEdit }
}

export const EDIT_REASON = 'Only people on this meeting, or the organiser, can do this'
export const MANAGE_REASON = 'Only the organiser, or someone allowed to edit meetings, can do this'
