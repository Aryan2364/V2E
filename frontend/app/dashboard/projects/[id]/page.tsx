'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/lib/auth/context'
import { projectsApi } from '@/lib/api/projects'
import { tasksApi } from '@/lib/api/tasks'
import type {
  Project, ProjectMilestone, ProjectTask, ProjectComment,
  ProjectDocument, ProjectActivityLog,
} from '@/lib/types/projects'
import type { TaskCategory, TaskPriority, TaskStatus } from '@/lib/types/tasks'
import ProjectProgressBar from '@/components/projects/ProjectProgressBar'
import BudgetCard from '@/components/projects/BudgetCard'
import MilestoneCard from '@/components/projects/MilestoneCard'
import GanttChart from '@/components/projects/GanttChart'
import ProjectCommentThread from '@/components/projects/ProjectCommentThread'
import DocumentCard from '@/components/projects/DocumentCard'
import ProjectActivityFeed from '@/components/projects/ProjectActivityFeed'
import CreateTaskModal from '@/components/tasks/CreateTaskModal'
import {
  ChevronLeft, Settings, Plus, Loader2, FileText, Link2,
} from 'lucide-react'

type Tab = 'overview' | 'milestones' | 'tasks' | 'gantt' | 'comments' | 'documents' | 'activity'

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'milestones', label: 'Milestones' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'gantt', label: 'Gantt' },
  { id: 'comments', label: 'Comments' },
  { id: 'documents', label: 'Documents' },
  { id: 'activity', label: 'Activity' },
]

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  active:    { bg: 'var(--success-bg)', text: 'var(--success)' },
  on_hold:   { bg: 'var(--warning-bg)', text: 'var(--warning)' },
  completed: { bg: 'var(--primary-subtle)', text: 'var(--primary-text)' },
  cancelled: { bg: 'var(--danger-bg)', text: 'var(--danger)' },
}

function StatusBadge({ status }: { status: string }) {
  const c = STATUS_COLORS[status] ?? { bg: 'var(--surface-control)', text: 'var(--text-muted)' }
  return (
    <span
      className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold capitalize"
      style={{ backgroundColor: c.bg, color: c.text }}
    >
      {status.replace('_', ' ')}
    </span>
  )
}

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''
  const userId = user?.id ?? ''

  const [project, setProject] = useState<Project | null>(null)
  const [milestones, setMilestones] = useState<ProjectMilestone[]>([])
  const [tasks, setTasks] = useState<ProjectTask[]>([])
  const [comments, setComments] = useState<ProjectComment[]>([])
  const [documents, setDocuments] = useState<ProjectDocument[]>([])
  const [activity, setActivity] = useState<ProjectActivityLog[]>([])
  const [categories, setCategories] = useState<TaskCategory[]>([])
  const [priorities, setPriorities] = useState<TaskPriority[]>([])
  const [statuses, setStatuses] = useState<TaskStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('overview')

  // Add task modal state
  const [showAddTask, setShowAddTask] = useState(false)
  const [pendingMilestoneId, setPendingMilestoneId] = useState<string | undefined>()

  // Document add state
  const [showAddDoc, setShowAddDoc] = useState(false)
  const [docName, setDocName] = useState('')
  const [docUrl, setDocUrl] = useState('')
  const [docSaving, setDocSaving] = useState(false)

  const load = useCallback(() => {
    if (!orgId || !id) return
    setLoading(true)
    Promise.all([
      projectsApi.get(orgId, id).catch(() => null),
      projectsApi.listMilestones(orgId, id).catch(() => []),
      projectsApi.listTasks(orgId, id).catch(() => []),
      projectsApi.listComments(orgId, id).catch(() => []),
      projectsApi.listDocuments(orgId, id).catch(() => []),
      projectsApi.getActivity(orgId, id).catch(() => []),
      tasksApi.getCategories(orgId).catch(() => []),
      tasksApi.getPriorities(orgId).catch(() => []),
      tasksApi.getStatuses(orgId).catch(() => []),
    ]).then(([proj, ms, ts, cm, docs, act, cats, pris, sts]) => {
      setProject(proj)
      setMilestones(ms)
      setTasks(ts)
      setComments(cm)
      setDocuments(docs)
      setActivity(act)
      setCategories(cats)
      setPriorities(pris)
      setStatuses(sts)
    }).finally(() => setLoading(false))
  }, [orgId, id])

  useEffect(() => { load() }, [load])

  async function handleAddDoc() {
    if (!docName.trim() || !docUrl.trim()) return
    setDocSaving(true)
    try {
      await projectsApi.addDocument(orgId, id, { name: docName.trim(), url: docUrl.trim() })
      setDocName(''); setDocUrl(''); setShowAddDoc(false)
      load()
    } finally {
      setDocSaving(false)
    }
  }

  async function handleDeleteDoc(docId: string) {
    await projectsApi.deleteDocument(orgId, id, docId)
    load()
  }

  function openAddTask(milestoneId?: string) {
    setPendingMilestoneId(milestoneId)
    setShowAddTask(true)
  }

  async function handleTaskCreated() {
    setShowAddTask(false)
    load()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <p className="font-semibold text-text-primary">Project not found</p>
        <Link href="/dashboard/projects" className="mt-2 text-sm text-primary-text hover:underline">
          Back to Projects
        </Link>
      </div>
    )
  }

  const directTasks = tasks.filter((pt) => !pt.milestone_id)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link
          href="/dashboard/projects"
          className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors mb-3"
        >
          <ChevronLeft size={15} />
          Projects
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-[26px] font-bold text-text-primary leading-tight">{project.name}</h1>
              <StatusBadge status={project.status} />
            </div>
            {project.description && (
              <p className="mt-1 text-sm text-text-secondary">{project.description}</p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => openAddTask()}
              className="flex items-center gap-1.5 px-4 py-2 bg-primary hover:bg-primary-hover text-white text-sm font-semibold rounded-[8px] transition-colors"
            >
              <Plus size={15} />
              Add Task
            </button>
            <Link
              href={`/dashboard/projects/${id}/settings`}
              className="p-2 rounded-[8px] border border-border-light text-text-secondary hover:bg-surface-sunken transition-colors"
            >
              <Settings size={16} />
            </Link>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-4">
          <ProjectProgressBar percentage={project.completion_percentage} showLabel />
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-0 border-b border-border-light overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={[
              'px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors',
              tab === t.id
                ? 'border-primary text-primary-text'
                : 'border-transparent text-text-secondary hover:text-text-primary hover:border-border',
            ].join(' ')}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            {/* Key info */}
            <div className="bg-white border border-border-light rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.08)] p-5">
              <h2 className="text-sm font-semibold text-text-primary mb-4">Project Info</h2>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <div>
                  <dt className="text-text-muted text-xs font-medium mb-0.5">Start Date</dt>
                  <dd className="text-text-primary">{project.start_date ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-text-muted text-xs font-medium mb-0.5">End Date</dt>
                  <dd className="text-text-primary">{project.end_date ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-text-muted text-xs font-medium mb-0.5">Milestones</dt>
                  <dd className="text-text-primary">{project.achieved_milestones}/{project.total_milestones} achieved</dd>
                </div>
                <div>
                  <dt className="text-text-muted text-xs font-medium mb-0.5">Tasks</dt>
                  <dd className="text-text-primary">{project.completed_tasks}/{project.total_tasks} completed</dd>
                </div>
                {/* The goals this project moves — visible from both ends, so
                    neither side is a dead end. A project may serve several. */}
                {!!project.goals?.length && (
                  <div className="col-span-2">
                    <dt className="text-text-muted text-xs font-medium mb-0.5">
                      {project.goals.length === 1 ? 'Goal' : 'Goals'}
                    </dt>
                    <dd className="flex flex-wrap gap-x-3 gap-y-1">
                      {project.goals.map(({ goal }) => (
                        <Link
                          key={goal.id}
                          href={`/goals/${goal.id}`}
                          className="inline-flex items-center gap-1 text-primary-text hover:text-primary-text hover:underline"
                        >
                          {goal.title}
                        </Link>
                      ))}
                    </dd>
                  </div>
                )}
                <div>
                  <dt className="text-text-muted text-xs font-medium mb-0.5">Progress</dt>
                  <dd className="text-text-primary font-semibold">{Math.round(project.completion_percentage)}%</dd>
                </div>
                <div>
                  <dt className="text-text-muted text-xs font-medium mb-0.5">Members</dt>
                  <dd className="text-text-primary">{project._count?.members ?? project.members?.length ?? 0}</dd>
                </div>
              </dl>
            </div>
          </div>
          <div className="space-y-4">
            {(project.planned_budget !== undefined || project.actual_spent !== undefined) && (
              <BudgetCard
                planned={project.planned_budget}
                actual={project.actual_spent}
                currency={project.currency}
              />
            )}
          </div>
        </div>
      )}

      {tab === 'milestones' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-text-secondary">{milestones.length} milestone{milestones.length !== 1 ? 's' : ''}</p>
          </div>
          {milestones.length === 0 ? (
            <div className="bg-white border border-border-light rounded-[12px] p-12 text-center text-sm text-text-muted">
              No milestones yet. Add them in project settings.
            </div>
          ) : (
            <div className="space-y-3">
              {milestones.map((ms) => {
                const msTasks = tasks.filter((pt) => pt.milestone_id === ms.id)
                return (
                  <MilestoneCard
                    key={ms.id}
                    milestone={ms}
                    tasks={msTasks}
                    warnings={{}}
                    canEdit
                    onAddTask={() => openAddTask(ms.id)}
                    onSetupTask={() => {
                      setPendingMilestoneId(ms.id)
                      setShowAddTask(true)
                    }}
                  />
                )
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'tasks' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-text-secondary">{tasks.length} task{tasks.length !== 1 ? 's' : ''} total · {directTasks.length} direct</p>
            <button
              type="button"
              onClick={() => openAddTask()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-primary-text border border-primary-border bg-primary-subtle rounded-[6px] hover:bg-primary-subtle transition-colors"
            >
              <Plus size={12} />
              Add Task
            </button>
          </div>
          {tasks.length === 0 ? (
            <div className="bg-white border border-border-light rounded-[12px] p-12 text-center text-sm text-text-muted">
              No tasks linked yet. Use &quot;Add Task&quot; to link tasks to this project.
            </div>
          ) : (
            <div className="bg-white border border-border-light rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.08)] divide-y divide-surface-control">
              {tasks.map((pt) => {
                const task = pt.task
                if (!task) {
                  return (
                    <div key={pt.id} className="flex items-center gap-3 px-4 py-3">
                      <div className="w-2 h-2 rounded-full bg-warning" />
                      <span className="text-sm text-warning font-medium">Pending task — setup required</span>
                    </div>
                  )
                }
                return (
                  <div key={pt.id} className="flex items-center gap-3 px-4 py-3">
                    <div
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: task.status?.color ?? 'var(--text-muted)' }}
                    />
                    <span className="text-sm text-text-primary flex-1 truncate">{task.title}</span>
                    {task.status && (
                      <span
                        className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: (task.status.color ?? 'var(--text-muted)') + '20', color: task.status.color ?? 'var(--text-muted)' }}
                      >
                        {task.status.label}
                      </span>
                    )}
                    {task.deadline && (
                      <span className="text-xs text-text-muted shrink-0">
                        {new Date(task.deadline).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                      </span>
                    )}
                    {pt.milestone_id && (
                      <span className="text-[10px] text-text-muted shrink-0">
                        {milestones.find((m) => m.id === pt.milestone_id)?.name ?? ''}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'gantt' && (
        <GanttChart project={project} milestones={milestones} tasks={tasks} />
      )}

      {tab === 'comments' && (
        <ProjectCommentThread
          orgId={orgId}
          projectId={id}
          comments={comments}
          onRefresh={load}
        />
      )}

      {tab === 'documents' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-text-secondary">{documents.length} document{documents.length !== 1 ? 's' : ''}</p>
            <button
              type="button"
              onClick={() => setShowAddDoc((v) => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-primary-text border border-primary-border bg-primary-subtle rounded-[6px] hover:bg-primary-subtle transition-colors"
            >
              <Plus size={12} />
              Add Document
            </button>
          </div>

          {showAddDoc && (
            <div className="bg-white border border-border-light rounded-[12px] p-4 shadow-[0_1px_3px_rgba(0,0,0,0.08)] space-y-3">
              <p className="text-sm font-medium text-text-primary">Add Document Link</p>
              <input
                value={docName}
                onChange={(e) => setDocName(e.target.value)}
                placeholder="Document name"
                className="w-full h-9 px-3 rounded-[8px] border border-border text-sm text-text-primary placeholder:text-text-muted bg-white focus:border-primary focus:outline-hidden"
              />
              <div className="relative">
                <Link2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                <input
                  value={docUrl}
                  onChange={(e) => setDocUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full h-9 pl-8 pr-3 rounded-[8px] border border-border text-sm text-text-primary placeholder:text-text-muted bg-white focus:border-primary focus:outline-hidden"
                />
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => { setShowAddDoc(false); setDocName(''); setDocUrl('') }}
                  className="h-8 px-3 text-xs font-medium text-text-secondary border border-border-light rounded-[6px] hover:bg-surface-sunken transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={docSaving || !docName.trim() || !docUrl.trim()}
                  onClick={handleAddDoc}
                  className="h-8 px-3 text-xs font-semibold bg-primary text-white rounded-[6px] hover:bg-primary-hover disabled:opacity-50 transition-colors flex items-center gap-1.5"
                >
                  {docSaving && <Loader2 size={12} className="animate-spin" />}
                  Save
                </button>
              </div>
            </div>
          )}

          {documents.length === 0 && !showAddDoc ? (
            <div className="bg-white border border-border-light rounded-[12px] p-12 text-center">
              <div className="w-12 h-12 rounded-full bg-surface-control flex items-center justify-center mx-auto mb-3">
                <FileText size={20} className="text-text-muted" />
              </div>
              <p className="text-sm font-medium text-text-primary">No documents yet</p>
              <p className="text-xs text-text-secondary mt-1">Add links to project documents, specs, or resources.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {documents.map((doc) => (
                <DocumentCard
                  key={doc.id}
                  doc={doc}
                  canDelete
                  onDelete={() => handleDeleteDoc(doc.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'activity' && (
        <ProjectActivityFeed logs={activity} />
      )}

      {/* Add Task Modal */}
      <CreateTaskModal
        isOpen={showAddTask}
        onClose={() => setShowAddTask(false)}
        onCreated={handleTaskCreated}
        onTaskCreated={async (newTask) => {
          try {
            await projectsApi.linkTask(orgId, id, {
              task_id: newTask.id,
              milestone_id: pendingMilestoneId,
            })
          } catch {
            // link failure is non-fatal — task was still created
          }
        }}
        categories={categories}
        priorities={priorities}
        statuses={statuses}
      />
    </div>
  )
}
