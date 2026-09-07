'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowUpRight, FolderKanban, Link2Off, Loader2, Lock, Plus } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import StyledSelect from '@/components/ui/StyledSelect'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import { goalsApi } from '@/lib/api/goals'
import type { Goal, GoalCandidateProject, LinkedProject } from '@/lib/types/goals'
import { CountBadge, formatDate } from './shared'

const PROJECT_STATUS_META: Record<string, { label: string; bg: string; text: string; border: string }> = {
  active: { label: 'Active', bg: '#DCFCE7', text: '#16A34A', border: '#BBF7D0' },
  on_hold: { label: 'On hold', bg: '#FEF9C3', text: '#CA8A04', border: '#FDE68A' },
  completed: { label: 'Completed', bg: '#E0F2FE', text: '#0369A1', border: '#BAE6FD' },
  cancelled: { label: 'Cancelled', bg: '#FEE2E2', text: '#DC2626', border: '#FECACA' },
}

/**
 * A goal's linked projects (the Work module's Projects).
 *
 * Rendered only when the org actually has the Projects module — the caller
 * gates on the entitlement, so a firm without Projects never sees an empty
 * section for something it can't use.
 *
 * The list the server returns is already filtered to the projects this viewer
 * can open (projects carry row scope + membership, unlike goals), and any
 * withheld ones are reported as a count rather than silently dropped.
 */
export default function GoalProjectsSection({
  orgId,
  goal,
  canEdit,
  onChanged,
}: {
  orgId: string
  goal: Goal
  canEdit: boolean
  onChanged: () => void
}) {
  const [linkOpen, setLinkOpen] = useState(false)
  const projects = goal.projects ?? []
  const hidden = goal.hidden_project_count ?? 0

  return (
    <section className="bg-white border border-[#E2E8F0] rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.04)] flex flex-col max-h-[420px]">
      <header className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[#F1F5F9] shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="flex items-center gap-2 text-[16px] font-semibold text-[#0F172A]">
              <FolderKanban size={16} className="text-[#475569]" /> Projects
            </h2>
            <CountBadge count={projects.length} />
          </div>
          <p className="text-[12px] text-[#475569] mt-0.5">
            {projects.length === 0
              ? 'Bigger bodies of work behind this goal.'
              : 'Projects from Work, linked to this goal.'}
          </p>
        </div>
        {canEdit && (
          <button
            onClick={() => setLinkOpen(true)}
            aria-label="Link a project"
            title="Link a project to this goal"
            className="w-7 h-7 shrink-0 rounded-[8px] bg-[#2563EB] hover:bg-[#1D4ED8] text-white flex items-center justify-center transition-colors"
          >
            <Plus size={16} />
          </button>
        )}
      </header>

      <div className="table-scroll flex-1 overflow-y-auto px-5 py-3">
        {projects.length === 0 ? (
          <p className="text-[13px] text-[#475569] py-4">
            No projects linked. Link one when the work behind this goal is big enough to need
            milestones and a plan of its own.
          </p>
        ) : (
          <ul className="divide-y divide-[#F1F5F9]">
            {projects.map((p) => (
              <ProjectRow
                key={p.id}
                orgId={orgId}
                goalId={goal.id}
                project={p}
                canEdit={canEdit}
                onChanged={onChanged}
              />
            ))}
          </ul>
        )}

        {/* Honest about what was withheld rather than quietly showing a short list. */}
        {hidden > 0 && (
          <p className="flex items-start gap-1.5 mt-3 rounded-[6px] bg-[#F8FAFC] border border-[#E2E8F0] px-2.5 py-2 text-[12px] text-[#475569]">
            <Lock size={12} className="shrink-0 mt-0.5" />
            {hidden} more linked {hidden === 1 ? 'project is' : 'projects are'} hidden — you’re not
            on {hidden === 1 ? 'it' : 'them'}. Ask a project manager to add you.
          </p>
        )}
      </div>

      {linkOpen && (
        <LinkProjectModal
          orgId={orgId}
          goal={goal}
          onClose={() => setLinkOpen(false)}
          onLinked={onChanged}
        />
      )}
    </section>
  )
}

function ProjectRow({
  orgId,
  goalId,
  project,
  canEdit,
  onChanged,
}: {
  orgId: string
  goalId: string
  project: LinkedProject
  canEdit: boolean
  onChanged: () => void
}) {
  const { addToast } = useToast()
  const [unlinkOpen, setUnlinkOpen] = useState(false)
  const [unlinking, setUnlinking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const meta = PROJECT_STATUS_META[project.status] ?? {
    label: project.status,
    bg: '#F1F5F9',
    text: '#475569',
    border: '#E2E8F0',
  }

  async function unlink() {
    setUnlinking(true)
    setError(null)
    try {
      await goalsApi.unlinkProject(orgId, goalId, project.id)
      setUnlinkOpen(false)
      onChanged()
      addToast('Project unlinked', 'success')
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Could not unlink the project')
    } finally {
      setUnlinking(false)
    }
  }

  return (
    <li className="flex items-start justify-between gap-3 py-2.5">
      <Link href={`/dashboard/projects/${project.id}`} className="group min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="text-[14px] font-medium text-[#0F172A] group-hover:text-[#2563EB] transition-colors truncate">
            {project.name}
          </span>
          <ArrowUpRight
            size={13}
            className="text-[#94A3B8] group-hover:text-[#2563EB] shrink-0 transition-colors"
          />
        </span>
        <span className="flex items-center gap-2 flex-wrap mt-1">
          <span
            className="inline-flex items-center font-medium text-[11px] rounded-full px-2 py-0.5 border whitespace-nowrap"
            style={{ backgroundColor: meta.bg, color: meta.text, borderColor: meta.border }}
          >
            {meta.label}
          </span>
          <span className="text-[12px] text-[#475569] tabular-nums">
            {project.completed_tasks}/{project.total_tasks} tasks
          </span>
          {project.end_date && (
            <>
              <span className="text-[#CBD5E1]">·</span>
              <span className="text-[12px] text-[#475569]">ends {formatDate(project.end_date)}</span>
            </>
          )}
        </span>
      </Link>

      {canEdit && (
        <button
          onClick={() => setUnlinkOpen(true)}
          title="Unlink from this goal"
          aria-label="Unlink project"
          className="w-6 h-6 shrink-0 rounded-[6px] flex items-center justify-center text-[#475569] hover:text-[#DC2626] hover:bg-[#FEE2E2] transition-colors"
        >
          <Link2Off size={13} />
        </button>
      )}

      <ConfirmDialog
        open={unlinkOpen}
        title="Unlink this project?"
        message={`“${project.name}” stays exactly as it is in Work, and on any other goals it serves — it just stops showing on this one.`}
        confirmLabel="Unlink"
        danger
        loading={unlinking}
        error={error}
        onConfirm={unlink}
        onCancel={() => {
          setUnlinkOpen(false)
          setError(null)
        }}
      />
    </li>
  )
}

function LinkProjectModal({
  orgId,
  goal,
  onClose,
  onLinked,
}: {
  orgId: string
  goal: Goal
  onClose: () => void
  onLinked: () => void
}) {
  const { addToast } = useToast()
  const router = useRouter()
  const [options, setOptions] = useState<GoalCandidateProject[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    // Server-filtered: live, in this org, openable by this person, and not
    // already on THIS goal. Projects on OTHER goals still appear — a project
    // can serve several goals at once.
    goalsApi
      .projectCandidates(orgId, goal.id)
      .then(setOptions)
      .catch(() => setOptions([]))
      .finally(() => setLoading(false))
  }, [orgId, goal.id])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!selected) return addToast('Pick a project to link', 'error')

    setSaving(true)
    try {
      await goalsApi.linkProject(orgId, goal.id, selected)
      addToast('Project linked', 'success')
      onLinked()
      onClose()
    } catch (err: any) {
      addToast(err?.response?.data?.message ?? 'Could not link the project', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen onClose={() => !saving && onClose()} title="Link a project" size="md">
      <form onSubmit={submit} className="space-y-4">
        <div className="rounded-[10px] bg-[#F8FAFC] border border-[#E2E8F0] px-3 py-2.5">
          <p className="text-[13px] text-[#475569]">Linking to</p>
          <p className="text-[15px] font-semibold text-[#0F172A] leading-snug">{goal.title}</p>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-[#475569] py-2">
            <Loader2 size={15} className="animate-spin" /> Loading projects…
          </div>
        ) : options.length === 0 ? (
          <p className="text-sm text-[#475569]">
            There are no more projects you can link. Create one in Work first, then come back — or
            set the goal on it while creating it.
          </p>
        ) : (
          <div>
            <label className="block text-sm font-medium text-[#374151] mb-1">Project *</label>
            <StyledSelect
              value={selected}
              onChange={setSelected}
              placeholder="Choose a project…"
              options={options.map((p) => ({ value: p.id, label: p.name }))}
              disabled={saving}
            />
            <p className="text-[11px] text-[#475569] mt-1">
              A project can serve several goals — linking it here doesn’t remove it from any
              others. Only projects you’re on are listed.
            </p>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 pt-4 border-t border-[#E2E8F0]">
          <button
            type="button"
            onClick={() => router.push('/dashboard/projects/new')}
            className="text-sm font-medium text-[#2563EB] hover:text-[#1D4ED8] transition-colors"
          >
            Create a project in Work
          </button>
          <Button type="submit" disabled={saving || !selected}>
            {saving && <Loader2 size={15} className="animate-spin mr-1.5" />}
            {saving ? 'Linking…' : 'Link project'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
