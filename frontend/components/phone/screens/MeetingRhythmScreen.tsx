'use client'

import React from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { CalendarClock, MapPin, MoreHorizontal, Pause, Pencil, Play, Repeat, Square, Video } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { getNow } from '@/lib/clock'
import { useToast } from '@/components/ui/Toast'
import { PermissionTooltip } from '@/components/ui/permission-tooltip'
import { meetingsApi } from '@/lib/api/meetings'
import type { Meeting, MeetingRhythm, RhythmSchedule } from '@/lib/types/meetings'
import { fmtDate, fmtDateTime, fmtTime } from '@/lib/phone-format'
import { apiErrorMessage } from '@/lib/tasks/api-error'
import { MEETINGS_HREF, meetingHref, type PhoneRoute } from '@/lib/phone-routes'
import PhoneScreen from '../PhoneScreen'
import { APP_BAR_BUTTON } from '../PhoneAppBar'
import { PhoneFailedState } from '../PhoneEmptyState'
import { PhoneSheet } from '../PhoneSheet'
import { PhoneButton, PhoneLinkButton, ROW, ROW_BLOCK, cx } from '../primitives'
import { MeetingSeriesEditSheet } from '../MeetingSeriesEditSheet'
import { useInvitees } from '../MeetingFormFields'

/*
 * A recurring meeting (the series) - the phone version of desktop's
 * meetings/rhythms/[rhythmId]/page.tsx. It is where the "You are on a
 * recurring meeting" notification lands. Shows the schedule in plain words,
 * the format, who is on it, and the meetings in the series (each opens that
 * meeting), with the series actions desktop offers (page.tsx ~165-176): Edit,
 * Pause / Resume and Stop, all behind rhythm.can_manage. A person who may not
 * use them sees them disabled with who may (kit 26), where desktop hides them.
 */

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function ordinal(n: number): string {
  const a = Math.abs(n)
  if (a % 100 >= 11 && a % 100 <= 13) return `${a}th`
  return `${a}${['th', 'st', 'nd', 'rd'][a % 10] ?? 'th'}`
}
function join(parts: string[]): string {
  if (parts.length <= 1) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}
function clock(time: string): string {
  const [h, m] = time.split(':').map(Number)
  if (h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m)) return time
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}

/** "Every week on Monday and Wednesday at 10:00 AM, for 10 meetings" - the desktop's cadence / recurrenceSummary, in plain words. */
function scheduleInWords(e: RhythmSchedule | undefined): string {
  if (!e) return 'No schedule set'
  const every = Math.max(1, e.every || 1)
  let core: string
  if (e.schedule_type === 'daily') core = every === 1 ? 'Every day' : `Every ${every} days`
  else if (e.schedule_type === 'weekly') {
    const days = (e.days ?? []).slice().sort((a, b) => a - b).map((d) => WEEKDAYS[d])
    const base = every === 1 ? 'Every week' : `Every ${every} weeks`
    core = days.length ? `${base} on ${join(days)}` : base
  } else if (e.schedule_type === 'monthly') {
    const days = (e.month_days ?? []).slice().sort((a, b) => a - b).map((d) => (d > 0 ? `the ${ordinal(d)}` : d === -1 ? 'the last day' : `the ${ordinal(-d)}-to-last day`))
    const base = every === 1 ? 'Every month' : `Every ${every} months`
    core = days.length ? `${base} on ${join(days)}` : base
  } else {
    const dates = (e.yearly_dates ?? []).map((d) => `${MONTHS[(d.month ?? 1) - 1]} ${ordinal(d.day ?? 1)}`)
    core = dates.length ? `Every year on ${join(dates)}` : 'Every year'
  }
  const time = e.time ? ` at ${clock(e.time)}` : ''
  let end = ''
  if (e.end_condition === 'after_n' && e.end_after) end = `, for ${e.end_after} meeting${e.end_after === 1 ? '' : 's'}`
  else if (e.end_condition === 'on_date' && e.end_date) end = `, until ${fmtDate(e.end_date)}`
  return `${core}${time}${end}`
}

type Bucket = 'upcoming' | 'in_progress' | 'held' | 'missed' | 'cancelled'
function bucketOf(m: Meeting, now: number): Bucket {
  if (m.status === 'cancelled') return 'cancelled'
  if (m.status === 'in_progress') return 'in_progress'
  if (m.status === 'closed') return 'held'
  const start = m.scheduled_start ? new Date(m.scheduled_start).getTime() : 0
  return start && start < now ? 'missed' : 'upcoming'
}
const BUCKET_META: Record<Bucket, { label: string; bg: string; fg: string }> = {
  upcoming: { label: 'Upcoming', bg: 'var(--primary-subtle)', fg: 'var(--primary-text)' },
  in_progress: { label: 'In progress', bg: 'var(--warning-bg)', fg: 'var(--warning)' },
  held: { label: 'Held', bg: 'var(--success-bg)', fg: 'var(--success)' },
  missed: { label: 'Missed', bg: 'var(--danger-bg)', fg: 'var(--danger)' },
  cancelled: { label: 'Cancelled', bg: 'var(--surface-control)', fg: 'var(--text-secondary)' },
}
const FILTERS: { key: 'all' | Bucket; label: string }[] = [
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'held', label: 'Held' },
  { key: 'missed', label: 'Missed' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'all', label: 'All' },
]

const MANAGE_REASON = 'Only the person who set this meeting up, or someone allowed to manage meetings, can do this'
const ACTION_ROW = cx(ROW, '[&_svg]:size-[20px] [&_svg]:shrink-0 disabled:pointer-events-none disabled:text-text-muted')

export default function MeetingRhythmScreen({ route }: { route: PhoneRoute }) {
  const params = useParams<{ rhythmId: string }>()
  const rhythmId = params?.rhythmId ?? ''
  const { user } = useAuth()
  const { addToast } = useToast()
  const orgId = user?.organizationId ?? ''
  const parent = route.parent ?? MEETINGS_HREF

  const [rhythm, setRhythm] = React.useState<MeetingRhythm | null>(null)
  const [meetings, setMeetings] = React.useState<Meeting[]>([])
  const [failed, setFailed] = React.useState(false)
  const [filter, setFilter] = React.useState<'all' | Bucket>('upcoming')
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [editOpen, setEditOpen] = React.useState(false)
  const [stopping, setStopping] = React.useState<'stop' | 'delete-future' | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [stopError, setStopError] = React.useState<string | null>(null)

  const people = useInvitees(orgId)
  const nameOf = React.useMemo(() => new Map(people.map((p) => [p.user_id, p.name])), [people])

  const load = React.useCallback(() => {
    if (!orgId || !rhythmId) return
    Promise.all([meetingsApi.getRhythm(orgId, rhythmId), meetingsApi.list(orgId, { rhythm_id: rhythmId }).catch(() => [] as Meeting[])])
      .then(([r, ms]) => {
        setRhythm(r)
        setMeetings(ms)
        setFailed(false)
      })
      .catch(() => setFailed(true))
  }, [orgId, rhythmId])

  React.useEffect(() => {
    load()
  }, [load])

  const rows = React.useMemo(() => {
    const t = getNow().getTime()
    const withBucket = meetings.map((m) => ({ m, b: bucketOf(m, t) }))
    const shown = filter === 'all' ? withBucket : withBucket.filter((x) => x.b === filter)
    // Upcoming soonest first, then past most recent first - as desktop.
    return shown.sort((a, b) => {
      const ta = a.m.scheduled_start ? new Date(a.m.scheduled_start).getTime() : 0
      const tb = b.m.scheduled_start ? new Date(b.m.scheduled_start).getTime() : 0
      const aFuture = ta >= t
      const bFuture = tb >= t
      if (aFuture !== bFuture) return aFuture ? -1 : 1
      return aFuture ? ta - tb : tb - ta
    })
  }, [meetings, filter])

  if (failed) {
    return (
      <PhoneScreen title="Recurring meeting" parent={parent}>
        <PhoneFailedState what="This recurring meeting" onRetry={() => { setFailed(false); load() }} />
        <PhoneLinkButton href={MEETINGS_HREF} fullWidth>
          Go to meetings
        </PhoneLinkButton>
      </PhoneScreen>
    )
  }
  if (!rhythm) {
    return (
      <PhoneScreen title="Recurring meeting" parent={parent}>
        <div className="flex flex-col gap-[12px]" aria-hidden>
          <span className="h-[24px] w-2/3 rounded-full bg-surface-control" />
          <span className="h-[16px] w-1/3 rounded-full bg-surface-control" />
        </div>
      </PhoneScreen>
    )
  }

  const r = rhythm
  const e = r.schedule_entries?.[0]
  const canManage = !!r.can_manage
  const attendeeIds = r.attendee_user_ids ?? []
  const hostName = r.created_by_user_id === user?.id ? 'You' : (r.created_by_name ?? 'Host')

  async function toggleActive() {
    setBusy(true)
    try {
      const updated = r.is_active ? await meetingsApi.pauseRhythm(orgId, r.id) : await meetingsApi.resumeRhythm(orgId, r.id)
      setRhythm(updated)
      addToast(r.is_active ? 'Series paused' : 'Series resumed', 'success')
      setMenuOpen(false)
      load()
    } catch (err) {
      addToast(apiErrorMessage(err, 'Could not change the series. Try again.'), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function confirmStop() {
    if (!stopping) return
    setBusy(true)
    setStopError(null)
    try {
      await meetingsApi.removeRhythm(orgId, r.id, stopping)
      addToast('Series stopped', 'success')
      setStopping(null)
      setMenuOpen(false)
      load()
    } catch (err) {
      setStopError(apiErrorMessage(err, 'Could not stop the series. Try again.'))
    } finally {
      setBusy(false)
    }
  }

  const stopCopy = {
    stop: { label: 'Stop, keep upcoming meetings', danger: false },
    'delete-future': { label: 'Stop and remove upcoming meetings', danger: true },
  } as const

  return (
    <PhoneScreen
      title="Recurring meeting"
      parent={parent}
      actions={
        <button type="button" aria-label="More options" className={APP_BAR_BUTTON} onClick={() => setMenuOpen(true)}>
          <MoreHorizontal aria-hidden />
        </button>
      }
    >
      <div className="flex flex-col gap-[20px] pb-[16px]">
        <div className="flex flex-col gap-[8px]">
          <h2 className="text-card-heading font-medium text-text-primary wrap-break-word">{r.title}</h2>
          <span
            className="inline-flex w-fit items-center rounded-full px-[10px] py-[2px] text-label font-medium"
            style={r.is_active ? { backgroundColor: 'var(--success-bg)', color: 'var(--success)' } : { backgroundColor: 'var(--surface-control)', color: 'var(--text-secondary)' }}
          >
            {r.is_active ? 'Active' : 'Paused'}
          </span>
          <p className="flex items-start gap-[8px] text-body text-text-primary">
            <Repeat aria-hidden className="mt-[3px] size-[16px] shrink-0 text-text-secondary" />
            <span>{scheduleInWords(e)}</span>
          </p>
        </div>

        <dl className="grid grid-cols-2 gap-x-[12px] gap-y-[14px]">
          <div className="flex flex-col gap-[2px]">
            <dt className="text-meta text-text-secondary">Next meeting</dt>
            <dd className="text-body text-text-primary">{r.is_active ? (r.next_run ? fmtDate(r.next_run) : '-') : 'Paused'}</dd>
          </div>
          <div className="flex flex-col gap-[2px]">
            <dt className="text-meta text-text-secondary">Format</dt>
            <dd className="text-body text-text-primary">
              {r.type === 'offline' ? 'In person' : r.type === 'hybrid' ? 'Hybrid' : 'Online'} · {r.duration_min} min
            </dd>
          </div>
          {e?.start_date ? (
            <div className="flex flex-col gap-[2px]">
              <dt className="text-meta text-text-secondary">Since</dt>
              <dd className="text-body text-text-primary">{fmtDate(e.start_date)}</dd>
            </div>
          ) : null}
          {r.type !== 'online' && r.location ? (
            <div className="flex flex-col gap-[2px]">
              <dt className="text-meta text-text-secondary">Where</dt>
              <dd className="flex items-center gap-[4px] text-body text-text-primary">
                <MapPin aria-hidden className="size-[14px] shrink-0 text-text-secondary" />
                <span className="min-w-0 wrap-break-word">{r.location}</span>
              </dd>
            </div>
          ) : null}
        </dl>

        {r.type !== 'offline' && r.online_link ? (
          <PhoneButton variant="secondary" fullWidth onClick={() => window.open(r.online_link!, '_blank', 'noopener,noreferrer')}>
            <Video aria-hidden /> Open the meeting link
          </PhoneButton>
        ) : null}

        <section className="flex flex-col gap-[8px]">
          <h3 className="text-label font-medium text-text-secondary">People · {attendeeIds.length + 1}</h3>
          <ul className="flex flex-col divide-y divide-border-light rounded-[8px] border border-border-light bg-surface">
            <li className="flex min-h-[48px] items-center justify-between gap-[12px] px-[12px]">
              <span className="min-w-0 truncate text-body text-text-primary">{hostName}</span>
              <span className="shrink-0 text-meta text-text-secondary">Host</span>
            </li>
            {attendeeIds.map((id) => (
              <li key={id} className="flex min-h-[48px] items-center justify-between gap-[12px] px-[12px]">
                <span className="min-w-0 truncate text-body text-text-primary">{nameOf.get(id) ?? 'Unknown'}</span>
                {(r.optional_user_ids ?? []).includes(id) ? <span className="shrink-0 text-meta text-text-secondary">Optional</span> : null}
              </li>
            ))}
          </ul>
        </section>

        {r.agenda ? (
          <section className="flex flex-col gap-[4px]">
            <h3 className="text-label font-medium text-text-secondary">Standing agenda</h3>
            <p className="whitespace-pre-wrap text-body text-text-primary">{r.agenda}</p>
          </section>
        ) : null}

        <section className="flex flex-col gap-[12px]">
          <h3 className="text-label font-medium text-text-secondary">Meetings in this series · {meetings.length}</h3>
          <div role="group" aria-label="Show" className="flex flex-wrap gap-[8px]">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                aria-pressed={filter === f.key}
                onClick={() => setFilter(f.key)}
                className={cx(
                  'min-h-[44px] rounded-full border px-[14px] text-body font-medium',
                  filter === f.key ? 'border-primary bg-primary text-primary-foreground' : 'border-border-strong bg-surface text-text-primary',
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          {rows.length === 0 ? (
            <p className="text-body text-text-secondary">
              {meetings.length === 0 ? 'No meetings yet. They are created automatically, up to 60 days ahead.' : 'No meetings to show here.'}
            </p>
          ) : (
            <ul className={ROW_BLOCK}>
              {rows.map(({ m, b }) => {
                const meta = BUCKET_META[b]
                return (
                  <li key={m.id}>
                    <Link href={meetingHref(m.id)} className={cx(ROW, 'justify-between')}>
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-body text-text-primary">{m.scheduled_start ? fmtDateTime(m.scheduled_start) : 'No time set'}</span>
                        <span className="truncate text-label text-text-secondary">
                          {m.scheduled_end ? `Until ${fmtTime(m.scheduled_end)} · ` : ''}
                          {m._count?.attendees ?? m.attendees?.length ?? 0} invited
                        </span>
                      </span>
                      <span className="inline-flex shrink-0 items-center rounded-full px-[8px] py-[2px] text-meta font-medium" style={{ backgroundColor: meta.bg, color: meta.fg }}>
                        {meta.label}
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>

      <PhoneSheet
        open={menuOpen}
        onOpenChange={(o) => {
          if (busy) return
          setMenuOpen(o)
          if (!o) {
            setStopping(null)
            setStopError(null)
          }
        }}
        title={stopping ? 'Stop this series?' : r.title}
        footer={
          stopping ? (
            <>
              <PhoneButton disabled={busy} onClick={() => setStopping(null)}>
                Cancel
              </PhoneButton>
              <PhoneButton
                variant="primary"
                loading={busy}
                onClick={() => void confirmStop()}
                className={cx(stopCopy[stopping].danger && 'border-danger bg-danger active:border-danger active:bg-danger')}
              >
                {stopCopy[stopping].label}
              </PhoneButton>
            </>
          ) : undefined
        }
      >
        {stopping ? (
          <div className="flex flex-col gap-[12px]">
            <p className="text-body text-text-primary wrap-break-word">
              Stop &ldquo;{r.title}&rdquo;? No new meetings will be created. Past meetings are kept.
              {stopping === 'delete-future' ? ' Meetings that are still scheduled are removed too.' : ' Meetings that are already scheduled stay.'}
            </p>
            {stopError ? <p role="alert" className="text-label text-danger">{stopError}</p> : null}
          </div>
        ) : (
          <div className="flex flex-col gap-[16px]">
            <ul className={ROW_BLOCK}>
              <GatedRow allowed={canManage}>
                <button type="button" disabled={!canManage || busy} onClick={() => { setMenuOpen(false); setEditOpen(true) }} className={ACTION_ROW}>
                  <Pencil aria-hidden className="text-text-secondary" />
                  Edit whole series
                </button>
              </GatedRow>
              <GatedRow allowed={canManage}>
                <button type="button" disabled={!canManage || busy} onClick={() => void toggleActive()} className={ACTION_ROW}>
                  {r.is_active ? <Pause aria-hidden className="text-text-secondary" /> : <Play aria-hidden className="text-text-secondary" />}
                  {r.is_active ? 'Pause' : 'Resume'}
                </button>
              </GatedRow>
            </ul>
            <ul className={ROW_BLOCK}>
              {(['stop', 'delete-future'] as const).map((mode) => (
                <GatedRow key={mode} allowed={canManage}>
                  <button type="button" disabled={!canManage || busy} onClick={() => setStopping(mode)} className={ACTION_ROW}>
                    {mode === 'stop' ? <Square aria-hidden className="text-text-secondary" /> : <Square aria-hidden className={canManage ? 'text-danger' : undefined} />}
                    <span className={mode === 'delete-future' && canManage ? 'text-danger' : undefined}>{stopCopy[mode].label}</span>
                  </button>
                </GatedRow>
              ))}
            </ul>
            <p className="flex items-center gap-[8px] text-label text-text-secondary">
              <CalendarClock aria-hidden className="size-[14px]" /> Next meeting: {r.is_active ? (r.next_run ? fmtDate(r.next_run) : '-') : 'paused'}
            </p>
          </div>
        )}
      </PhoneSheet>

      {editOpen ? (
        <MeetingSeriesEditSheet
          rhythm={r}
          open={editOpen}
          onOpenChange={setEditOpen}
          onSaved={(updated) => {
            setRhythm(updated)
            load()
          }}
        />
      ) : null}
    </PhoneScreen>
  )
}

/* A series action the person may not use stays visible, disabled, and says who may (kit 26). */
function GatedRow({ allowed, children }: { allowed: boolean; children: React.ReactNode }) {
  return (
    <li className="[&>span]:flex [&>span]:w-full">
      <PermissionTooltip allowed={allowed} reason={MANAGE_REASON}>
        {children}
      </PermissionTooltip>
    </li>
  )
}
