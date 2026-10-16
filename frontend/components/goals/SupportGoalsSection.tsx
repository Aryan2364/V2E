'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  ArrowUpRight,
  CornerDownRight,
  Link2Off,
  Pencil,
  Plus,
  Loader2,
  X,
  Check,
} from 'lucide-react'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import { goalsApi } from '@/lib/api/goals'
import { formatValue, type Goal, type GoalLink } from '@/lib/types/goals'
import LinkGoalModal, { type LinkDirection } from './LinkGoalModal'
import { CountBadge, GoalStatusBadge, formatDate } from './shared'
import { inputClass, type EmployeeOption } from './GoalFormFields'

/**
 * The web, on one goal's page — both directions, both editable from here.
 *
 * Every goal's page looks exactly the same whether it sits at the top of a
 * chain or the bottom: there is no "parent", no level, and no indentation.
 */
export default function SupportGoalsSection({
  orgId,
  goal,
  employees,
  canEdit,
  onChanged,
}: {
  orgId: string
  goal: Goal
  employees: EmployeeOption[]
  canEdit: boolean
  onChanged: () => void
}) {
  const [linkOpen, setLinkOpen] = useState<LinkDirection | null>(null)

  const supportedBy = goal.supported_by ?? []
  const supports = goal.supports ?? []

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <LinkList
          orgId={orgId}
          heading="What this goal needs"
          hint="Goals that have to land for this one to happen."
          emptyText="Nothing linked yet. If this goal depends on someone else succeeding at a number, link it here."
          links={supportedBy}
          direction="supported_by"
          canEdit={canEdit}
          onAdd={() => setLinkOpen('supported_by')}
          onChanged={onChanged}
        />
        <LinkList
          orgId={orgId}
          heading="What this goal powers"
          hint="The bigger goals this one feeds."
          emptyText="Nothing linked yet. If this goal exists to serve a bigger one, link it here."
          links={supports}
          direction="supports"
          canEdit={canEdit}
          onAdd={() => setLinkOpen('supports')}
          onChanged={onChanged}
        />
      </div>

      {linkOpen && (
        <LinkGoalModal
          isOpen
          onClose={() => setLinkOpen(null)}
          orgId={orgId}
          goal={goal}
          direction={linkOpen}
          employees={employees}
          onLinked={onChanged}
        />
      )}
    </>
  )
}

function LinkList({
  orgId,
  heading,
  hint,
  emptyText,
  links,
  direction,
  canEdit,
  onAdd,
  onChanged,
}: {
  orgId: string
  heading: string
  hint: string
  emptyText: string
  links: GoalLink[]
  direction: LinkDirection
  canEdit: boolean
  onAdd: () => void
  onChanged: () => void
}) {
  return (
    // Fixed height with an internally scrolling body — DESIGN_RULES Part 2, so
    // the two columns stay aligned however many links each side has.
    <section className="bg-surface border border-border-light rounded-card shadow-card flex flex-col h-[340px]">
      <header className="flex items-start justify-between gap-3 px-4 py-4 border-b border-border-light shrink-0">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-card-heading font-medium text-text-primary">{heading}</h3>
            <CountBadge count={links.length} />
          </div>
          <p className="text-meta text-text-secondary mt-0.5">{hint}</p>
        </div>
        {canEdit && (
          <button
            onClick={onAdd}
            aria-label={heading}
            title={`Add to “${heading}”`}
            className="w-7 h-7 shrink-0 rounded-control bg-primary hover:bg-primary-hover text-primary-foreground flex items-center justify-center transition-colors"
          >
            <Plus size={16} />
          </button>
        )}
      </header>

      <div className="table-scroll flex-1 overflow-y-auto px-4 py-3">
        {links.length === 0 ? (
          <p className="text-label text-text-secondary py-6">{emptyText}</p>
        ) : (
          <ul className="space-y-2.5">
            {links.map((l) => (
              <LinkRow
                key={l.link_id}
                orgId={orgId}
                link={l}
                direction={direction}
                canEdit={canEdit}
                onChanged={onChanged}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

function LinkRow({
  orgId,
  link,
  direction,
  canEdit,
  onChanged,
}: {
  orgId: string
  link: GoalLink
  direction: LinkDirection
  canEdit: boolean
  onChanged: () => void
}) {
  const router = useRouter()
  const { addToast } = useToast()
  const [editingNote, setEditingNote] = useState(false)
  const [note, setNote] = useState(link.note ?? '')
  const [savingNote, setSavingNote] = useState(false)
  const [unlinkOpen, setUnlinkOpen] = useState(false)
  const [unlinking, setUnlinking] = useState(false)
  const [unlinkError, setUnlinkError] = useState<string | null>(null)

  const g = link.goal
  // How much further the chain runs past this neighbour, in the same direction.
  const beyond = direction === 'supported_by' ? g._count?.supported_by ?? 0 : g._count?.supports ?? 0

  async function saveNote() {
    setSavingNote(true)
    try {
      await goalsApi.updateLinkNote(orgId, link.link_id, note.trim() || null)
      setEditingNote(false)
      onChanged()
    } catch (err: any) {
      addToast(err?.response?.data?.message ?? 'Could not save the note', 'error')
    } finally {
      setSavingNote(false)
    }
  }

  async function unlink() {
    setUnlinking(true)
    setUnlinkError(null)
    try {
      await goalsApi.removeLink(orgId, link.link_id)
      setUnlinkOpen(false)
      onChanged()
    } catch (err: any) {
      setUnlinkError(err?.response?.data?.message ?? 'Could not unlink the goals')
    } finally {
      setUnlinking(false)
    }
  }

  return (
    <li className="rounded-card border border-border-light bg-surface hover:border-border transition-colors">
      <div className="px-3 py-2.5">
        <div className="flex items-start justify-between gap-2">
          <button
            onClick={() => router.push(`/goals/${g.id}`)}
            className="group text-left min-w-0 flex-1"
          >
            <span className="flex items-center gap-1.5">
              <span className="text-body font-medium text-text-primary group-hover:text-primary-text transition-colors truncate">
                {g.title}
              </span>
              <ArrowUpRight
                size={13}
                className="text-text-muted group-hover:text-primary-text shrink-0 transition-colors"
              />
            </span>
          </button>
          {canEdit && (
            <div className="flex items-center gap-0.5 shrink-0">
              <button
                onClick={() => setEditingNote((v) => !v)}
                title={link.note ? 'Edit why' : 'Say why this link exists'}
                aria-label="Edit link note"
                className="w-6 h-6 rounded-control flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-surface-control transition-colors"
              >
                <Pencil size={13} />
              </button>
              <button
                onClick={() => setUnlinkOpen(true)}
                title="Unlink"
                aria-label="Unlink goal"
                className="w-6 h-6 rounded-control flex items-center justify-center text-text-secondary hover:text-danger hover:bg-danger-bg transition-colors"
              >
                <Link2Off size={13} />
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center flex-wrap gap-x-2.5 gap-y-1 mt-1.5">
          <GoalStatusBadge status={g.status} />
          <span className="text-meta text-text-secondary">{g.owner?.name ?? '—'}</span>
          <span className="text-muted">·</span>
          <span className="text-meta text-text-secondary">due {formatDate(g.due_date)}</span>
          {g.target_value !== null && g.target_value !== undefined && (
            <>
              <span className="text-muted">·</span>
              <span className="text-meta text-text-secondary tabular-nums">
                {g.current_value === null || g.current_value === undefined ? '—' : g.current_value}
                {' of '}
                {formatValue(g.target_value, g.unit)}
              </span>
            </>
          )}
        </div>

        {/* The chain continues — say so rather than implying the web stops here. */}
        {beyond > 0 && (
          <button
            onClick={() => router.push(`/goals/${g.id}`)}
            className="inline-flex items-center gap-1 mt-1.5 text-meta text-primary-text hover:text-primary-text transition-colors"
          >
            <CornerDownRight size={11} />
            {beyond} more {beyond === 1 ? 'goal' : 'goals'} behind this
          </button>
        )}

        {/* A deadline that doesn't add up is a permanent condition, not a toast. */}
        {link.deadline_warning && (
          <p className="flex items-start gap-1.5 mt-2 rounded-control bg-warning-bg border border-warning-border px-2 py-1.5 text-meta text-warning">
            <AlertTriangle size={12} className="shrink-0 mt-0.5" />
            {direction === 'supported_by'
              ? `This is due ${formatDate(g.due_date)} — after the goal it supports.`
              : `This goal is due after ${formatDate(g.due_date)}, the goal it supports.`}
          </p>
        )}

        {editingNote ? (
          <div className="mt-2">
            <textarea
              className={`${inputClass} resize-none text-label`}
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Why does this link exist?"
              disabled={savingNote}
              maxLength={1000}
              autoFocus
            />
            <div className="flex items-center gap-2 mt-1.5">
              <button
                onClick={saveNote}
                disabled={savingNote}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-control bg-primary hover:bg-primary-hover disabled:bg-surface-control-pressed disabled:text-text-muted text-primary-foreground text-meta font-medium transition-colors"
              >
                {savingNote ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                Save
              </button>
              <button
                onClick={() => {
                  setNote(link.note ?? '')
                  setEditingNote(false)
                }}
                disabled={savingNote}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-control text-text-secondary hover:bg-surface-control text-meta font-medium transition-colors"
              >
                <X size={12} /> Cancel
              </button>
            </div>
          </div>
        ) : (
          link.note && (
            <p className="mt-2 rounded-control bg-surface-sunken border-l-2 border-border px-2.5 py-1.5 text-meta text-text-primary italic">
              “{link.note}”
            </p>
          )
        )}
      </div>

      <ConfirmDialog
        open={unlinkOpen}
        title="Unlink these goals?"
        message={`This only removes the connection to “${g.title}”. Neither goal is deleted, and you can link them again at any time.`}
        confirmLabel="Unlink"
        danger
        loading={unlinking}
        error={unlinkError}
        onConfirm={unlink}
        onCancel={() => {
          setUnlinkOpen(false)
          setUnlinkError(null)
        }}
      />
    </li>
  )
}
