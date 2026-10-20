'use client'

/**
 * One-screen course builder. Replaces the old create → save → add-material → save →
 * add-people multi-page flow: path details, materials (file OR link per row, with a
 * per-material "allow download" switch), and people are all here, ending in a single
 * "Publish & Assign". The draft path is created lazily on first real input and every
 * change autosaves, so nothing is lost between steps.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  CheckCircle, Users, BookOpen,
} from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import {
  createPath, updatePath, getPath, addItem, updateItem, publishPath, assignPath, uploadItemFile, reorderItems,
} from '@/lib/api/learning'
import { getEmployees } from '@/lib/api/employees'
import { getRoles } from '@/lib/api/roles'
import { getDepartments } from '@/lib/api/departments'
import type { LearningPath, LearningItem, ContentType, SequentialMode, LearningPathStatus } from '@/lib/types/learning'
import type { EmployeeProfile } from '@/lib/types'
import StyledSelect from '@/components/ui/StyledSelect'
import DatePicker from '@/components/ui/DatePicker'
import MaterialRow from '@/components/learning/MaterialRow'
import AddMaterialBar from '@/components/learning/AddMaterialBar'
import AssigneeMultiSelect from '@/components/learning/AssigneeMultiSelect'
import { PageHeader } from '@/components/shell/page-header'
import { Button } from '@/components/ui/button'
import { Banner, BannerDescription } from '@/components/ui/banner'
import { Label } from '@/components/ui/label'

export default function CourseBuilderPage() {
  const router = useRouter()
  const params = useSearchParams()
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''

  // The draft path id — created lazily. Seeded from ?id= when editing an existing draft.
  const [pathId, setPathId] = useState<string | null>(params.get('id'))
  const [items, setItems] = useState<LearningItem[]>([])
  const [loading, setLoading] = useState(!!params.get('id'))

  // Path detail fields
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [mode, setMode] = useState<SequentialMode>('free_form')
  const [status, setStatus] = useState<LearningPathStatus>('draft')

  // People / assignment
  const [roleId, setRoleId] = useState('')
  const [roles, setRoles] = useState<{ id: string; title: string }[]>([])
  const [departmentId, setDepartmentId] = useState('')
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([])
  const [employees, setEmployees] = useState<EmployeeProfile[]>([])
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([])
  const [dueDate, setDueDate] = useState('')

  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reveal a newly-added material by scrolling the materials LIST's own scroll area
  // to the bottom — never the whole page (that caused a jump-down-then-back).
  const listRef = useRef<HTMLDivElement>(null)
  const [addedSignal, setAddedSignal] = useState(0)
  useEffect(() => {
    if (addedSignal === 0) return
    const el = listRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [addedSignal])

  // ── Load existing draft (edit mode) + reference data ──
  useEffect(() => {
    if (!orgId) return
    getEmployees(orgId).then(setEmployees).catch(() => undefined)
    getRoles(orgId).then((r: any[]) => setRoles(r.map((x) => ({ id: x.id, title: x.title })))).catch(() => undefined)
    getDepartments(orgId).then((d: any[]) => setDepartments(d.map((x) => ({ id: x.id, name: x.name })))).catch(() => undefined)
  }, [orgId])

  useEffect(() => {
    const id = params.get('id')
    if (!orgId || !id) return
    getPath(orgId, id)
      .then((p) => {
        setTitle(p.title)
        setDescription(p.description ?? '')
        setMode(p.mode)
        setRoleId(p.role_id ?? '')
        setDepartmentId(p.department_id ?? '')
        setItems(p.items ?? [])
        setStatus(p.status)
      })
      .finally(() => setLoading(false))
  }, [orgId, params])

  /** Create the draft path on first need (adding a material), or return the existing id. */
  const ensurePath = useCallback(async (): Promise<string> => {
    if (pathId) return pathId
    const created = await createPath(orgId, {
      title: title.trim() || 'Untitled course',
      description: description || undefined,
      mode,
    })
    setPathId(created.id)
    // Reflect the id in the URL so a refresh keeps editing the same draft.
    // scroll:false — App Router otherwise jumps to the top the moment the draft
    // is created (i.e. as you add your first material), which reads as "the form
    // scrolled away while I was working".
    router.replace(`/learning/paths/builder?id=${created.id}`, { scroll: false })
    return created.id
  }, [pathId, orgId, title, description, mode, router])

  // ── Autosave path fields (debounced) once a draft exists ──
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!pathId) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    setSaveState('saving')
    saveTimer.current = setTimeout(async () => {
      try {
        await updatePath(orgId, pathId, {
          title: title.trim() || 'Untitled course',
          description: description || undefined,
          mode,
          role_id: roleId || undefined,
          department_id: departmentId || undefined,
        })
        setSaveState('saved')
      } catch {
        setSaveState('idle')
      }
    }, 700)
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current) }
  }, [title, description, mode, roleId, departmentId, pathId, orgId])

  // ── Materials ──
  const isBlankPlaceholder = (i: LearningItem) =>
    (i.content_type === 'url' && !i.content_url?.trim()) ||
    (i.content_type === 'video' && !i.content_url?.trim()) ||
    (i.content_type === 'article' && !i.content_body?.trim())

  async function handleAddMaterial(type: ContentType, files?: File[]) {
    const pid = await ensurePath()

    // Files: one material per picked file. A leftover blank placeholder is reused for
    // the FIRST file (converted in place — no flicker); the rest are fresh rows.
    if (type === 'file') {
      const list = files ?? []
      if (list.length === 0) return
      let blank = items.find(isBlankPlaceholder)
      for (const file of list) {
        if (blank) {
          const converted: LearningItem = await updateItem(orgId, pid, blank.id, {
            title: file.name,
            content_type: 'file',
          })
          patchItem(converted)
          const uploaded = await uploadItemFile(orgId, pid, blank.id, file, true)
          patchItem(uploaded)
          blank = undefined // only the first file reuses it
        } else {
          const created: LearningItem = await addItem(orgId, pid, {
            title: file.name,
            content_type: 'file',
            allow_download: true,
          })
          setItems((prev) => [...prev, created])
          const uploaded = await uploadItemFile(orgId, pid, created.id, file, true)
          patchItem(uploaded)
        }
      }
      setAddedSignal((s) => s + 1)
      return
    }

    // Link / article: create a single empty row (or reuse an existing blank of that kind).
    const defaultTitle = type === 'url' ? 'New link' : type === 'video' ? 'New video' : 'New article'
    const blank = items.find(isBlankPlaceholder)
    if (blank) {
      // Same-kind blank already there → nothing to change (repeat clicks are a no-op).
      if (blank.content_type === type) {
        setAddedSignal((s) => s + 1)
        return
      }
      const converted: LearningItem = await updateItem(orgId, pid, blank.id, {
        title: defaultTitle,
        content_type: type,
      })
      patchItem(converted)
      setAddedSignal((s) => s + 1)
      return
    }

    const created: LearningItem = await addItem(orgId, pid, {
      title: defaultTitle,
      content_type: type,
      allow_download: true,
    })
    setItems((prev) => [...prev, created])
    setAddedSignal((s) => s + 1)
  }

  function patchItem(updated: LearningItem) {
    setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)))
  }

  // ── Drag-to-reorder materials ──
  // Live-reorders the list as you drag over a new slot (updates in place, no flicker),
  // then persists the final order to the server on drop.
  const itemsRef = useRef(items)
  useEffect(() => { itemsRef.current = items }, [items])
  const [dragId, setDragId] = useState<string | null>(null)
  const dragIndexRef = useRef<number | null>(null)

  function handleDragStart(e: React.DragEvent, idx: number) {
    dragIndexRef.current = idx
    e.dataTransfer.effectAllowed = 'move'
  }
  function handleDragOver(e: React.DragEvent, overIdx: number) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const from = dragIndexRef.current
    if (from === null || from === overIdx) return
    setItems((prev) => {
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(overIdx, 0, moved)
      return next
    })
    dragIndexRef.current = overIdx
  }
  async function handleDragEnd() {
    setDragId(null)
    dragIndexRef.current = null
    const pid = pathId
    if (!pid) return
    const ordered = itemsRef.current.map((it, i) => ({ id: it.id, order_index: i }))
    try {
      await reorderItems(orgId, pid, ordered)
    } catch {
      /* order already reflects locally; a failed persist self-heals on next reorder/reload */
    }
  }
  function removeItemLocal(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id))
  }

  const isPublished = status === 'published' || status === 'archived'

  async function handleFinish() {
    setError(null)
    if (!title.trim()) { setError('Give the course a title first.'); return }
    if (items.length === 0) { setError('Add at least one material first.'); return }
    setPublishing(true)
    try {
      const pid = await ensurePath()
      await updatePath(orgId, pid, {
        title: title.trim(),
        description: description || undefined,
        mode,
        role_id: roleId || undefined,
        department_id: departmentId || undefined,
      })
      // Only publish a draft — an already-published course is edited in place.
      if (!isPublished) await publishPath(orgId, pid) // auto-assigns to role_id / department_id if set
      if (selectedEmployees.length > 0) {
        await assignPath(orgId, pid, selectedEmployees, dueDate || undefined)
      }
      router.push(`/learning/paths/${pid}`)
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Could not save the course. Please try again.')
      setPublishing(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-56px)]">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const canPublish = !!title.trim() && items.length > 0 && !publishing

  return (
    <div className="px-4 sm:px-8 pb-8 max-w-4xl mx-auto">
      {/* Sticky top bar — keeps the title + Save action visible as you scroll the form */}
      <div className="sticky top-0 z-30 bg-surface pt-6 pb-4 mb-6 border-b border-border-light">
        <PageHeader
          title={params.get('id') ? 'Edit course' : 'Create course'}
          trail={[{ label: 'Courses', href: '/learning/paths' }]}
          meta={
            <>
              Add materials and pick who learns — it all saves as you go.{' '}
              {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : ''}
            </>
          }
          actions={
            <Button onClick={handleFinish} disabled={!canPublish} loading={publishing}>
              <CheckCircle size={15} />
              {isPublished ? 'Save and close' : 'Publish and assign'}
            </Button>
          }
        />

        {error && (
          <Banner variant="danger" className="mt-3">
            <BannerDescription>{error}</BannerDescription>
          </Banner>
        )}
      </div>

      {/* 1 — Details */}
      <section className="bg-surface border border-border-light rounded-card shadow-card p-6 mb-4 shadow-card">
        <h2 className="text-card-heading font-medium text-text-primary mb-4">Course details</h2>
        <div className="flex flex-col gap-4">
          <div>
            <Label className="mb-2" required>Title</Label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. New Joiner Onboarding"
              className="w-full px-3 py-2.5 border border-border rounded-control text-body text-text-primary bg-surface focus:outline-hidden focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </div>
          <div>
            <Label className="mb-2">Description</Label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="What will people learn?"
              className="w-full px-3 py-2.5 border border-border rounded-control text-body text-text-primary bg-surface focus:outline-hidden focus:border-primary focus:ring-1 focus:ring-primary resize-none"
            />
          </div>
          <div className="max-w-xs">
            <Label className="mb-2">Order</Label>
            <StyledSelect
              value={mode}
              onChange={(v) => setMode(v as SequentialMode)}
              options={[
                { value: 'free_form', label: 'Any order — learners pick freely' },
                { value: 'sequential', label: 'In sequence — unlock one by one' },
              ]}
            />
          </div>
        </div>
      </section>

      {/* 2 — Materials */}
      <section className="bg-surface border border-border-light rounded-card shadow-card p-6 mb-4 shadow-card">
        <div className="flex items-center gap-2 mb-4">
          <h2 className="text-card-heading font-medium text-text-primary">Materials</h2>
          {items.length > 0 && (
            <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-meta font-medium">
              {items.length}
            </span>
          )}
          {items.length > 1 && (
            <span className="ml-auto text-meta text-text-muted">Drag the handle to set the order learners see</span>
          )}
        </div>

        {items.length === 0 ? (
          <div className="rounded-card border border-dashed border-border bg-surface-sunken py-8 flex flex-col items-center text-center mb-4">
            <BookOpen size={26} className="text-text-muted mb-2" />
            <p className="text-label font-medium text-text-primary">No materials yet</p>
            <p className="text-meta text-text-muted mt-0.5">Upload a document, add a link, embed a video, or write an article.</p>
          </div>
        ) : (
          <div ref={listRef} className="flex flex-col gap-3 mb-4 max-h-[520px] overflow-y-auto pr-1">
            {items.map((item, idx) => (
              <div
                key={item.id}
                draggable={dragId === item.id}
                onDragStart={(e) => handleDragStart(e, idx)}
                onDragOver={(e) => handleDragOver(e, idx)}
                onDragEnd={handleDragEnd}
                onDrop={(e) => e.preventDefault()}
                className={`transition-shadow duration-200 rounded-card ${
                  dragId === item.id ? 'opacity-60 ring-2 ring-primary shadow-md' : ''
                }`}
              >
                <MaterialRow
                  orgId={orgId}
                  pathId={pathId!}
                  index={idx}
                  item={item}
                  onChange={patchItem}
                  onRemove={removeItemLocal}
                  onGripPointerDown={() => setDragId(item.id)}
                />
              </div>
            ))}
          </div>
        )}

        <AddMaterialBar onAdd={handleAddMaterial} />
      </section>

      {/* 3 — People */}
      <section className="bg-surface border border-border-light rounded-card shadow-card p-6 mb-4 shadow-card">
        <div className="flex items-center gap-2 mb-4">
          <Users size={18} className="text-primary-text" />
          <h2 className="text-card-heading font-medium text-text-primary">Who learns this</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
          <div>
            <Label className="mb-2">Auto-assign to a role</Label>
            <StyledSelect
              value={roleId}
              onChange={setRoleId}
              placeholder="No role"
              options={[
                { value: '', label: 'No role' },
                ...roles.map((r) => ({ value: r.id, label: r.title })),
              ]}
            />
            <p className="text-meta text-text-muted mt-1">Everyone in this role gets it automatically — now and future joiners.</p>
          </div>
          <div>
            <Label className="mb-2">Auto-assign to a department</Label>
            <StyledSelect
              value={departmentId}
              onChange={setDepartmentId}
              placeholder="No department"
              options={[
                { value: '', label: 'No department' },
                ...departments.map((d) => ({ value: d.id, label: d.name })),
              ]}
            />
            <p className="text-meta text-text-muted mt-1">Everyone in this department gets it automatically — now and future joiners.</p>
          </div>
          <div>
            <Label className="mb-2">Due date</Label>
            <DatePicker value={dueDate} onChange={setDueDate} placeholder="No deadline" />
          </div>
        </div>

        <Label className="mb-2">Pick people</Label>
        <AssigneeMultiSelect
          employees={employees}
          selected={selectedEmployees}
          onChange={setSelectedEmployees}
          heightClass="max-h-56"
        />
      </section>
    </div>
  )
}
