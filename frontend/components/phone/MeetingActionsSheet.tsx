'use client'

import React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Copy, Pencil, Trash2 } from 'lucide-react'
import { useToast } from '@/components/ui/Toast'
import { PermissionTooltip } from '@/components/ui/permission-tooltip'
import { useMeetingPermissions } from '@/components/meetings/shared'
import { meetingsApi } from '@/lib/api/meetings'
import type { Meeting } from '@/lib/types/meetings'
import { fmtDate, fmtDateTime } from '@/lib/phone-format'
import { apiErrorMessage } from '@/lib/tasks/api-error'
import { MEETINGS_HREF, meetingEditHref } from '@/lib/phone-routes'
import { PhoneSheet } from './PhoneSheet'
import { PhoneButton, ROW, ROW_BLOCK, cx } from './primitives'

/*
 * The meeting's three-dot menu. Mirrors the header actions on desktop's
 * meeting page (meetings/[meetingId]/page.tsx):
 *   - Edit (~149): the viewer can manage the meeting (can_manage) and it is
 *     scheduled or in progress. For a series meeting the Edit screen asks
 *     "this one or the whole series" (~202-213).
 *   - Delete (~154, ~194): the meetings "delete" permission; asks first with
 *     desktop's wording; DELETE meetings/:id.
 *   - Copy summary (~95-118): the same text desktop copies.
 * Not on the phone: Edit log and Insights (small desktop-only views).
 * An action the person may not use is shown disabled and says who may
 * (kit 26) where desktop hides it. Mount it only while open.
 */

const TYPE_LABEL = { online: 'Online', offline: 'In person', hybrid: 'Hybrid' } as const
const EDIT_REASON = 'Only the person who runs this meeting, or someone allowed to manage meetings, can change it while it is scheduled or in progress'
const DELETE_REASON = 'Only someone allowed to delete meetings can do this'

export function MeetingActionsSheet({
  orgId,
  meeting,
  open,
  onOpenChange,
}: {
  orgId: string
  meeting: Meeting
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const { addToast } = useToast()
  const { perms, loading: permsLoading } = useMeetingPermissions(orgId)
  const [confirming, setConfirming] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const canEdit = !!meeting.can_manage && (meeting.status === 'scheduled' || meeting.status === 'in_progress')
  const canDelete = perms.delete

  async function copySummary() {
    const m = meeting
    const lines = [
      `# ${m.title}`,
      `When: ${fmtDateTime(m.scheduled_start)}`,
      `Organizer: ${m.organizer?.name ?? '-'}`,
      `Type: ${TYPE_LABEL[m.type]}${m.location ? ` · ${m.location}` : ''}`,
      '',
      '## Attendees',
      ...(m.attendees ?? []).map((a) => `- ${a.user?.name ?? 'Unknown'} (${a.response})${a.attended ? ' ✓ attended' : ''}`),
      '',
      '## Agenda',
      m.agenda || '-',
      '',
      '## Minutes',
      m.minutes || '-',
      '',
      '## Decisions',
      ...((m.decisions ?? []).length ? (m.decisions ?? []).map((d) => `- ${d.decision}${d.reason ? ` (${d.reason})` : ''}`) : ['-']),
      '',
      '## Action items',
      ...((m.action_items ?? []).length
        ? (m.action_items ?? []).map((it) => `- [${it.is_done ? 'x' : ' '}] ${it.text}${it.due_date ? ` (due ${fmtDate(it.due_date)})` : ''}`)
        : ['-']),
    ]
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      addToast('Summary copied', 'success')
      onOpenChange(false)
    } catch {
      addToast('Could not copy', 'error')
    }
  }

  async function doDelete() {
    setBusy(true)
    setError(null)
    try {
      await meetingsApi.remove(orgId, meeting.id)
      addToast('Meeting deleted', 'success')
      router.replace(MEETINGS_HREF)
    } catch (e) {
      setError(apiErrorMessage(e, 'Could not delete the meeting. Try again.'))
      setBusy(false)
    }
  }

  return (
    <PhoneSheet
      open={open}
      onOpenChange={(o) => {
        if (!busy) onOpenChange(o)
      }}
      title={confirming ? 'Delete meeting?' : 'Meeting'}
      footer={
        confirming ? (
          <>
            <PhoneButton disabled={busy} onClick={() => setConfirming(false)}>
              Cancel
            </PhoneButton>
            <PhoneButton
              variant="primary"
              loading={busy}
              onClick={() => void doDelete()}
              className="border-danger bg-danger active:border-danger active:bg-danger"
            >
              Delete
            </PhoneButton>
          </>
        ) : undefined
      }
    >
      {confirming ? (
        <div className="flex flex-col gap-[12px]">
          <p className="text-body text-text-primary wrap-break-word">
            Delete &ldquo;{meeting.title}&rdquo;? Are you sure? This can&apos;t be undone.
          </p>
          {error ? (
            <p role="alert" className="text-label text-danger">
              {error}
            </p>
          ) : null}
        </div>
      ) : (
        <ul className={ROW_BLOCK}>
          <Gated allowed={canEdit} reason={EDIT_REASON}>
            {canEdit ? (
              <Link href={meetingEditHref(meeting.id)} className={ACTION_ROW}>
                <Pencil aria-hidden className="text-text-secondary" />
                Edit meeting
              </Link>
            ) : (
              <button type="button" disabled className={ACTION_ROW}>
                <Pencil aria-hidden />
                Edit meeting
              </button>
            )}
          </Gated>
          <li>
            <button type="button" onClick={() => void copySummary()} className={ACTION_ROW}>
              <Copy aria-hidden className="text-text-secondary" />
              Copy summary
            </button>
          </li>
          {/* While the permission lookup is still resolving: disabled, no reason yet. */}
          <Gated allowed={permsLoading ? undefined : canDelete} reason={DELETE_REASON}>
            <button type="button" disabled={permsLoading || !canDelete} onClick={() => setConfirming(true)} className={ACTION_ROW}>
              <Trash2 aria-hidden className={canDelete ? 'text-danger' : undefined} />
              <span className={canDelete ? 'text-danger' : undefined}>Delete meeting</span>
            </button>
          </Gated>
        </ul>
      )}
    </PhoneSheet>
  )
}

const ACTION_ROW = cx(ROW, '[&_svg]:size-[20px] [&_svg]:shrink-0 disabled:pointer-events-none disabled:text-text-muted')

function Gated({ allowed, reason, children }: { allowed: boolean | undefined; reason: string; children: React.ReactNode }) {
  return (
    <li className="[&>span]:flex [&>span]:w-full">
      <PermissionTooltip allowed={allowed} reason={reason}>
        {children}
      </PermissionTooltip>
    </li>
  )
}
