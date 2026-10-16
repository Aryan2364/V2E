'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  X, Trash2, Plus, Check, ChevronRight, Loader2, FileText, UserCircle2, Shield, ExternalLink,
  Menu, GitBranch, Copy, Share2, Rows3,
} from 'lucide-react'
import {
  processHierarchyApi,
  type NodeDetail,
  type ProcessArtifact,
  type ProcessAccessKind,
  type ProcessAccessLevel,
  type ProcessMapSummary,
  type ProcessNodeKind,
  type ProcessPool,
  type TreeNode,
} from '@/lib/api/process-hierarchy'
import { KIND_META } from './kind-meta'
import { getDepartments } from '@/lib/api/departments'
import { getRoles } from '@/lib/api/roles'
import { tasksApi } from '@/lib/api/tasks'
import type { Department, Role } from '@/lib/types'
import StyledSelect from '@/components/ui/StyledSelect'
import DepartmentSelect from '@/components/employees/DepartmentSelect'
import EmployeePicker, { type EmployeePickerOption } from '@/components/ui/EmployeePicker'
import RolePicker from '@/components/ui/RolePicker'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import Tooltip from '@/components/ui/Tooltip'
import NodeDocuments from './node-materials'
import { useToast } from '@/components/ui/Toast'

const DRILLABLE = new Set(['container', 'subprocess'])
const CONTAINER_KINDS = new Set(['container', 'subprocess'])
const POOL_LABEL: Record<ProcessPool, string> = { customer: 'Customer', company: 'Company', vendor: 'Vendor' }
const NAME_MAX = 50 // node names are capped so they always fit on the canvas without ellipsis
const NOTE_MAX = 500 // a sticky note holds more than a name, but still bounded

const inputCls =
  'w-full px-3 py-2 text-[14px] rounded-[8px] border border-[#CBD5E1] focus:border-[#2563EB] focus:outline-hidden bg-white text-[#0F172A] placeholder:text-[#94A3B8]'

// Turn plain text into React nodes with any URLs (http(s):// or www.…) rendered as clickable
// links that open in a new tab. Used to show a description so pasted links are clickable.
function linkify(text: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(https?:\/\/[^\s<]+|www\.[^\s<]+)/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    // Don't swallow trailing punctuation that's clearly not part of the URL.
    let raw = m[0]
    const trail = raw.match(/[.,;:!?)\]]+$/)
    let suffix = ''
    if (trail) { suffix = trail[0]; raw = raw.slice(0, -suffix.length) }
    const href = raw.startsWith('http') ? raw : `https://${raw}`
    out.push(
      <a
        key={i++}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="text-[#2563EB] underline underline-offset-2 hover:text-[#1D4ED8] break-all"
      >
        {raw}
      </a>,
    )
    if (suffix) out.push(suffix)
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export default function NodeDrawer({
  orgId, mapId, nodeId, tree = [], onClose, onChanged, onDrill, onCopy,
}: {
  orgId: string
  mapId: string
  nodeId: string
  tree?: TreeNode[]
  onClose: () => void
  onChanged: () => void
  onDrill: (nodeId: string) => void
  onCopy?: () => void
}) {
  const { addToast } = useToast()
  const [node, setNode] = useState<NodeDetail | null>(null)
  const [artifacts, setArtifacts] = useState<ProcessArtifact[]>([])
  const [maps, setMaps] = useState<ProcessMapSummary[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  // Rich people list (name + role + department, grouped) — the same source as the
  // Create Task assignee picker, so the Responsible person field matches it exactly.
  const [employees, setEmployees] = useState<EmployeePickerOption[]>([])
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showMenu, setShowMenu] = useState(false) // header ⋯ (Move to another area)
  const [detaching, setDetaching] = useState(false)
  const [makingReusable, setMakingReusable] = useState(false)
  const [deptError, setDeptError] = useState(false) // only shown after a save attempt

  // editable local copy
  const [name, setName] = useState('')
  const [kind, setKind] = useState<ProcessNodeKind>('task') // staged like every other field — only committed on Save
  const [description, setDescription] = useState('')
  const [descEditing, setDescEditing] = useState(false) // description shows linkified text until you click to edit
  const [respUser, setRespUser] = useState<string>('')
  const [respRole, setRespRole] = useState<string>('')
  const [pool, setPool] = useState<ProcessPool | ''>('')
  const [deptId, setDeptId] = useState<string>('')
  const [checklist, setChecklist] = useState<{ id?: string; text: string }[]>([])

  const reloadNode = async () => {
    const d = await processHierarchyApi.getNode(orgId, mapId, nodeId)
    setNode(d)
    setName(d.name); setKind(d.kind); setDescription(d.description ?? ''); setDescEditing(false)
    setRespUser(d.responsible_user_id ?? ''); setRespRole(d.responsible_role_id ?? '')
    setPool(d.pool ?? ''); setDeptId(d.department_id ?? '')
    setChecklist(d.checklist.map((c) => ({ id: c.id, text: c.text })))
    setDirty(false)
  }

  useEffect(() => {
    setNode(null)
    reloadNode().catch(() => addToast('Could not load this step.', 'error'))
    processHierarchyApi.listArtifacts(orgId, mapId).then(setArtifacts).catch(() => {})
    processHierarchyApi.listMaps(orgId).then(setMaps).catch(() => {})
    getDepartments(orgId).then(setDepartments).catch(() => {})
    getRoles(orgId).then(setRoles).catch(() => {})
    tasksApi.getEligibleAssignees(orgId).then((res) => {
      const opts: EmployeePickerOption[] = []
      res.departments.forEach((d) => d.users.forEach((u) =>
        opts.push({ user_id: u.user_id, name: u.name, role_title: u.role_title, role_id: u.role_id, department_id: u.department_id, department_name: u.department_name })))
      setEmployees(opts)
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, orgId, mapId])

  // Closing with unsaved edits asks first, so typed changes are never lost silently.
  const requestClose = useCallback(() => {
    if (dirty) setConfirmDiscard(true)
    else onClose()
  }, [dirty, onClose])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || confirmDiscard || confirmDel) return
      requestClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [requestClose, confirmDiscard, confirmDel])

  const canEdit = !!node?.can_edit
  const isNote = node?.kind === 'note' // a sticky annotation — only its text is editable
  // Customer / Vendor steps are performed by an external party — internal Person/Role
  // don't apply, so we hide those fields for them.
  const isExternalPool = pool === 'customer' || pool === 'vendor'
  const drillable = node ? DRILLABLE.has(node.kind) : false

  // Descendants of this node (from the map tree) — used for the delete blast radius
  // and to keep the node out of its own "move to" targets.
  const descendantIds = useMemo(() => {
    if (!tree.length) return new Set<string>()
    const childrenBy = new Map<string | null, string[]>()
    tree.forEach((n) => {
      const list = childrenBy.get(n.parent_node_id) ?? []
      list.push(n.id); childrenBy.set(n.parent_node_id, list)
    })
    const out = new Set<string>()
    const stack = [...(childrenBy.get(nodeId) ?? [])]
    while (stack.length) { const id = stack.pop()!; if (out.has(id)) continue; out.add(id); for (const c of childrenBy.get(id) ?? []) stack.push(c) }
    return out
  }, [tree, nodeId])

  // Ancestor names (excluding this node) for the header breadcrumb.
  const ancestorPath = useMemo(() => {
    if (!tree.length) return [] as string[]
    const byId = new Map(tree.map((n) => [n.id, n]))
    const chain: string[] = []
    let cur = byId.get(nodeId)?.parent_node_id ?? null
    let guard = 0
    while (cur && guard < 50) {
      const p = byId.get(cur)
      if (!p) break
      chain.unshift(p.name); cur = p.parent_node_id; guard++
    }
    return chain
  }, [tree, nodeId])

  async function saveCore() {
    if (!node || saving) return
    // A Company step must name its department (that's its lane) — catch it here so the
    // whole save doesn't fail with a backend 400.
    if (pool === 'company' && !deptId) {
      setDeptError(true)
      addToast('Pick a department for the Company lane.', 'error')
      return
    }
    setSaving(true)
    try {
      await processHierarchyApi.updateNode(orgId, mapId, nodeId, {
        name: name.trim() || node.name,
        description,
        // External (Customer/Vendor) steps never carry an internal owner.
        responsible_user_id: isExternalPool ? null : (respUser || null),
        responsible_role_id: isExternalPool ? null : (respRole || null),
        pool: pool || null,
        department_id: pool === 'company' ? deptId : null,
        checklist,
        ...(kind !== node.kind ? { kind } : {}),
      })
      await reloadNode()
      onChanged()
      addToast('Changes saved.', 'success')
    } catch {
      addToast('Could not save your changes. Please try again.', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function removeNode() {
    if (!node) return
    setDeleting(true)
    try {
      await processHierarchyApi.deleteNode(orgId, mapId, nodeId)
      setConfirmDel(false)
      onChanged()
      onClose()
    } catch {
      addToast('Could not delete this step. Please try again.', 'error')
      setDeleting(false)
    }
  }

  async function setLinkedMap(id: string) {
    try { await processHierarchyApi.updateNode(orgId, mapId, nodeId, { linked_map_id: id || null }); await reloadNode(); onChanged() }
    catch { addToast('Could not update the cross-link.', 'error') }
  }

  async function detach() {
    if (detaching) return
    setDetaching(true)
    try { await processHierarchyApi.detachNode(orgId, mapId, nodeId); await reloadNode(); onChanged(); addToast('Made an independent copy — edits here no longer affect the original.', 'success') }
    catch (e: any) { addToast(e?.response?.data?.message ?? 'Could not make a copy.', 'error') }
    finally { setDetaching(false) }
  }

  async function makeReusable() {
    if (makingReusable) return
    setMakingReusable(true)
    try {
      await processHierarchyApi.makeNodeReusable(orgId, mapId, nodeId); await reloadNode(); onChanged()
      addToast('This is now its own map — reference it as a line item in any map via Add → Reference a map.', 'success')
    } catch (e: any) { addToast(e?.response?.data?.message ?? 'Could not make this reusable.', 'error') }
    finally { setMakingReusable(false) }
  }

  async function moveTo(parentId: string) {
    if (!node) return
    try {
      await processHierarchyApi.updateNode(orgId, mapId, nodeId, { parent_node_id: parentId === '__root__' ? null : parentId })
      onChanged()
      addToast('Step moved.', 'success')
      onClose()
    } catch {
      addToast('Could not move this step there.', 'error')
    }
  }

  // ── Person ⇄ Role ⇄ Lane cross-derivation ──────────────────────────────────
  // No scope yet → full lists. A chosen role scopes people to that role; a chosen
  // lane (department) scopes both. Picking a person fills its role + lane; picking a
  // role fills its lane. Re-scoping the pool/lane blanks the owner (can't conflict).
  const filteredRoles = useMemo(
    () => (pool === 'company' && deptId ? roles.filter((r) => r.department_id === deptId || r.id === respRole) : roles),
    [roles, pool, deptId, respRole],
  )
  const filteredEmployees = useMemo(() => {
    // Always keep the currently-selected person visible even if the scope would hide them.
    if (respRole) return employees.filter((e) => e.role_id === respRole || e.user_id === respUser)
    if (pool === 'company' && deptId) return employees.filter((e) => e.department_id === deptId || e.user_id === respUser)
    return employees
  }, [employees, respRole, respUser, pool, deptId])

  function pickPerson(userId: string) {
    setRespUser(userId)
    const p = userId ? employees.find((e) => e.user_id === userId) : null
    if (p) {
      if (p.role_id) setRespRole(p.role_id)
      if (p.department_id) { setPool('company'); setDeptId(p.department_id) }
    }
    touch()
  }
  function pickRole(roleId: string) {
    setRespRole(roleId)
    const r = roleId ? roles.find((x) => x.id === roleId) : null
    if (r?.department_id) { setPool('company'); setDeptId(r.department_id) }
    if (roleId && respUser) {
      const p = employees.find((e) => e.user_id === respUser)
      if (p && p.role_id !== roleId) setRespUser('') // person no longer matches the role
    }
    touch()
  }
  // User re-scopes the swimlane → any current owner may now conflict, so blank it.
  function pickPool(p: ProcessPool | '') {
    setPool(p)
    if (p !== 'company') { setDeptId(''); setDeptError(false) }
    setRespUser(''); setRespRole('')
    touch()
  }
  function pickDept(d: string) {
    setDeptId(d)
    if (d) setDeptError(false)
    setRespUser(''); setRespRole('')
    touch()
  }

  const touch = () => setDirty(true)
  const isEvent = (k: string) => k === 'start_event' || k === 'end_event'

  const moveOptions = useMemo(() => {
    const opts = [{ value: '__root__', label: 'Top level (map root)' }]
    tree
      .filter((n) => CONTAINER_KINDS.has(n.kind) && n.id !== nodeId && !descendantIds.has(n.id) && n.id !== node?.parent_node_id)
      .forEach((n) => opts.push({ value: n.id, label: n.name }))
    return opts
  }, [tree, nodeId, descendantIds, node?.parent_node_id])

  const mapOptions = useMemo(
    () => [{ value: '', label: '— None —' }, ...maps.filter((m) => m.id !== mapId).map((m) => ({ value: m.id, label: m.name }))],
    [maps, mapId],
  )

  const body = (
    // Non-modal: no dimming backdrop, so the canvas stays visible and the selected
    // node keeps its context while you edit it (Part B7). The panel slides in.
    <div className="fixed inset-0 z-60 pointer-events-none">
      <div className="absolute right-0 top-0 h-full w-full max-w-[440px] bg-white shadow-2xl border-l border-[#E2E8F0] flex flex-col pointer-events-auto animate-[slideInRight_.22s_ease-out]">
        {/* Header — breadcrumb path to this node; the last crumb is its live name. */}
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-[#E2E8F0]">
          <span className="text-[#2563EB] shrink-0">{node ? KIND_META[node.kind].icon : <FileText size={14} />}</span>
          <div className="min-w-0 flex-1 truncate text-[12px] text-[#64748B]">
            {ancestorPath.map((a, i) => (
              <span key={i}>{a} <span className="text-[#CBD5E1]">/</span> </span>
            ))}
            <span className="text-[#0F172A] font-semibold">{node ? (name || KIND_META[node.kind].label) : 'Loading'}</span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {drillable && (
              <button
                onClick={() => onDrill(nodeId)}
                className="inline-flex items-center gap-1 text-[13px] font-semibold text-[#2563EB] hover:text-[#1D4ED8] px-2 py-1 rounded-[6px] hover:bg-[#EFF6FF] transition-colors"
              >
                Open <ChevronRight size={14} />
              </button>
            )}
            {/* Hamburger: structural actions (Move, Delete) — kept out of the scroll body
                so they're always reachable without a footer button. */}
            {node && canEdit && (
              <div className="relative">
                <Tooltip label="Actions">
                  <button onClick={() => setShowMenu((v) => !v)} aria-label="Actions" aria-haspopup="menu" aria-expanded={showMenu}
                    className="text-[#94A3B8] hover:text-[#0F172A] hover:bg-[#F1F5F9] rounded-[6px] p-1 transition-colors">
                    <Menu size={18} />
                  </button>
                </Tooltip>
                {showMenu && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
                    <div className="absolute right-0 top-[calc(100%+6px)] z-50 w-64 bg-white border border-[#E2E8F0] rounded-[10px] shadow-lg p-1.5 animate-[popIn_.12s_ease-out]">
                      {!isEvent(node.kind) && moveOptions.length > 1 && (
                        <>
                          <p className="px-2 py-1 text-[11px] font-semibold text-[#64748B] uppercase tracking-wide">Move to another area</p>
                          <div className="max-h-48 overflow-y-auto">
                            {moveOptions.map((o) => (
                              <button key={o.value} onClick={() => { setShowMenu(false); moveTo(o.value) }}
                                className="w-full text-left px-2.5 py-1.5 rounded-[6px] hover:bg-[#F1F5F9] text-[13px] text-[#0F172A] truncate">
                                {o.label}
                              </button>
                            ))}
                          </div>
                          <p className="px-2 py-1 text-[11px] text-[#64748B]">Moves this step (and anything inside it) into another container.</p>
                          <div className="my-1 border-t border-[#F1F5F9]" />
                        </>
                      )}
                      {onCopy && (
                        <button onClick={() => { setShowMenu(false); onCopy() }}
                          className="w-full text-left px-2.5 py-1.5 rounded-[6px] hover:bg-[#F1F5F9] text-[13px] font-medium text-[#0F172A] inline-flex items-center gap-2">
                          <Copy size={14} /> Copy
                        </button>
                      )}
                      <button onClick={() => { setShowMenu(false); setConfirmDel(true) }}
                        className="w-full text-left px-2.5 py-1.5 rounded-[6px] hover:bg-[#FEF2F2] text-[13px] font-medium text-[#DC2626] inline-flex items-center gap-2">
                        <Trash2 size={14} /> Delete node
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
            <button onClick={requestClose} aria-label="Close panel" className="text-[#94A3B8] hover:text-[#0F172A] transition-colors p-1"><X size={18} /></button>
          </div>
        </div>

        {!node ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 size={22} className="animate-spin text-[#2563EB]" />
          </div>
        ) : (
          <>
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
            {/* Name — capped so it always fits on the canvas (no ellipsis). A note has no
                name, just body text, so it shows a roomy textarea instead. */}
            {isNote ? (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-[#374151]">Note</label>
                  {canEdit && <span className="text-[10px] text-[#94A3B8] tabular-nums">{name.length}/{NOTE_MAX}</span>}
                </div>
                <textarea className={`${inputCls} resize-none`} rows={6} value={name} disabled={!canEdit} maxLength={NOTE_MAX}
                  placeholder={canEdit ? 'Write your note…' : '—'}
                  onChange={(e) => { setName(e.target.value); touch() }} />
              </div>
            ) : (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-[#374151]">Name</label>
                  {canEdit && <span className="text-[10px] text-[#94A3B8] tabular-nums">{name.length}/{NAME_MAX}</span>}
                </div>
                <input className={inputCls} value={name} disabled={!canEdit} maxLength={NAME_MAX}
                  onChange={(e) => { setName(e.target.value); touch() }} />
              </div>
            )}

            {/* Change type — safe conversions only (backend blocks the unsafe ones). */}
            {canEdit && !isEvent(node.kind) && !isNote && (
              <div>
                <label className="block text-xs font-medium text-[#374151] mb-1">Type</label>
                <StyledSelect value={kind} onChange={(k) => { setKind(k as ProcessNodeKind); touch() }}
                  options={(CONTAINER_KINDS.has(node.kind)
                    ? (['container', 'subprocess'] as ProcessNodeKind[])
                    : (['task', 'decision', 'container', 'subprocess'] as ProcessNodeKind[])
                  ).map((k) => ({ value: k, label: KIND_META[k].label }))} />
                <p className="text-[11px] text-[#64748B] mt-1">
                  {CONTAINER_KINDS.has(node.kind)
                    ? 'Switch between Container and Sub-process (both hold steps).'
                    : 'A step can also become an area (Container / Sub-process).'}
                </p>
              </div>
            )}

            {/* Description — available for every step, Start / End markers included. Shows as
                linkified text (pasted links are clickable, open in a new tab); click it to edit. */}
            {!isNote && (
              <div>
                <label className="block text-xs font-medium text-[#374151] mb-1">Description</label>
                {canEdit && descEditing ? (
                  <textarea autoFocus className={`${inputCls} resize-none`} rows={3} value={description}
                    placeholder="What happens in this step?"
                    onChange={(e) => { setDescription(e.target.value); touch() }}
                    onBlur={() => setDescEditing(false)} />
                ) : description.trim() ? (
                  <div
                    onClick={() => { if (canEdit) setDescEditing(true) }}
                    className={`${inputCls} whitespace-pre-wrap wrap-break-word min-h-[76px] ${canEdit ? 'cursor-text' : ''}`}
                  >{linkify(description)}</div>
                ) : (
                  <div
                    onClick={() => { if (canEdit) setDescEditing(true) }}
                    className={`${inputCls} min-h-[76px] text-[#94A3B8] ${canEdit ? 'cursor-text' : ''}`}
                  >{canEdit ? 'What happens in this step?' : '—'}</div>
                )}
                {canEdit && <p className="text-[11px] text-[#64748B] mt-1">Paste a link and it becomes clickable.</p>}
              </div>
            )}

            {/* Decision: its Yes / No routes are set on the arrows, not here. */}
            {node.kind === 'decision' && (
              <div className="flex items-start gap-2 rounded-[8px] bg-[#F8FAFC] border border-[#E2E8F0] px-3 py-2.5 text-[12px] text-[#475569]">
                <GitBranch size={14} className="text-[#94A3B8] shrink-0 mt-0.5" />
                <span>Set the <span className="font-semibold text-[#0F172A]">Yes / No</span> routes by clicking the arrows leaving this diamond on the canvas.</span>
              </div>
            )}

            {/* Pool / Lane — which swimlane band this step sits in. Company steps pick a
                department (their lane); Customer/Vendor sit in a single band. */}
            {!isNote && (
              <div>
                <label className="block text-xs font-medium text-[#374151] mb-1"><Rows3 size={12} className="inline mr-1" />Pool / Lane</label>
                {canEdit ? (
                  <>
                    <StyledSelect
                      value={pool}
                      onChange={(v) => pickPool(v as ProcessPool | '')}
                      options={[
                        { value: '', label: '— None (free-form) —' },
                        { value: 'customer', label: 'Customer' },
                        { value: 'company', label: 'Company' },
                        { value: 'vendor', label: 'Vendor' },
                      ]}
                    />
                    {pool === 'company' && (
                      <div className="mt-2">
                        <DepartmentSelect inline value={deptId} onChange={pickDept}
                          departments={departments} placeholder="Pick a department (lane)" />
                        {deptError && !deptId && <p className="text-[11px] text-[#DC2626] mt-1">A Company step needs a department.</p>}
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-[#0F172A]">
                    {pool ? POOL_LABEL[pool] : 'Free-form (no swimlane)'}
                    {pool === 'company' && deptId ? ` · ${departments.find((d) => d.id === deptId)?.name ?? 'Department'}` : ''}
                  </p>
                )}
                <p className="text-[11px] text-[#64748B] mt-1">Company steps pick a department (their lane); Customer/Vendor sit in one band.</p>
              </div>
            )}

            {/* Responsible — internal Person/Role only for Company / free-form steps. A
                Customer or Vendor step is done by that external party, so we hide them. */}
            {!isEvent(node.kind) && !isNote && !isExternalPool && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#374151] mb-1"><UserCircle2 size={12} className="inline mr-1" />Person</label>
                  <EmployeePicker
                    value={respUser}
                    onChange={pickPerson}
                    employees={filteredEmployees}
                    title="Responsible person"
                    placeholder="— None —"
                    allowClear
                    disabled={!canEdit}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#374151] mb-1">Role</label>
                  <RolePicker value={respRole} onChange={pickRole}
                    roles={filteredRoles} title="Responsible role" placeholder="— None —" allowClear disabled={!canEdit} />
                </div>
              </div>
            )}

            {/* Checklist — only a Task decomposes into sub-steps (areas use child nodes). */}
            {node.kind === 'task' && (
              <ChecklistEditor items={checklist} canEdit={canEdit} onChange={(next) => { setChecklist(next); touch() }} />
            )}

            {/* Artifacts (inputs/outputs) */}
            {!isEvent(node.kind) && !isNote && (
              <ArtifactsSection
                orgId={orgId} mapId={mapId} nodeId={nodeId} node={node} artifacts={artifacts}
                canEdit={canEdit}
                onArtifactsChanged={() => processHierarchyApi.listArtifacts(orgId, mapId).then(setArtifacts)}
                onLinksChanged={reloadNode}
              />
            )}

            {/* Opens another map (cross-link) — only areas open a deeper map. */}
            {CONTAINER_KINDS.has(node.kind) && (
              <div>
                <label className="block text-xs font-medium text-[#374151] mb-1">Opens another map (cross-link)</label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <StyledSelect value={node.linked_map_id ?? ''} onChange={(v) => setLinkedMap(v)}
                      options={mapOptions} disabled={!canEdit} placeholder="— None —" />
                  </div>
                  {node.linked_map && (
                    <Tooltip label="Open linked map">
                      <button onClick={() => onDrill(nodeId)}
                        className="shrink-0 inline-flex items-center gap-1 px-2.5 py-2 text-[12px] font-semibold rounded-[8px] border border-[#2563EB] text-[#2563EB] hover:bg-[#EFF6FF]">
                        <ExternalLink size={13} /> Open
                      </button>
                    </Tooltip>
                  )}
                </div>
                {node.linked_map && (
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <p className="text-[11px] text-[#64748B]">Opening this node jumps to “{node.linked_map.name}”.</p>
                    {canEdit && !node.linked_map.owned && (
                      <button onClick={detach} disabled={detaching}
                        className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold text-[#2563EB] hover:underline disabled:text-[#94A3B8]">
                        {detaching ? <Loader2 size={11} className="animate-spin" /> : <Copy size={11} />} Make my own copy
                      </button>
                    )}
                  </div>
                )}

                {/* Make reusable — promote this area into a standalone map that can be
                    dropped as a line item in any map. Hidden when it's already a shared map. */}
                {canEdit && !(node.linked_map && !node.linked_map.owned) && (
                  <div className="mt-2 flex items-start justify-between gap-2 rounded-[8px] border border-[#E2E8F0] bg-[#F8FAFC] p-2.5">
                    <div className="min-w-0">
                      <p className="text-[12px] font-semibold text-[#0F172A]">Reusable map</p>
                      <p className="text-[11px] text-[#64748B] leading-snug">
                        {node.linked_map?.owned
                          ? 'Publish this as a shared map you can reference in any other map.'
                          : 'Turn this into its own map you can drop as a line item in any other map.'}
                      </p>
                    </div>
                    <Tooltip label="Make reusable">
                      <button onClick={makeReusable} disabled={makingReusable}
                        className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 text-[12px] font-semibold rounded-[8px] border border-[#2563EB] text-[#2563EB] hover:bg-[#EFF6FF] disabled:opacity-50">
                        {makingReusable ? <Loader2 size={12} className="animate-spin" /> : <Share2 size={12} />} Make reusable
                      </button>
                    </Tooltip>
                  </div>
                )}
              </div>
            )}

            {/* Sharing — access cascades into an area's contents, so areas only. */}
            {canEdit && CONTAINER_KINDS.has(node.kind) && (
              <SharingSection
                orgId={orgId} mapId={mapId} nodeId={nodeId} node={node}
                departments={departments} roles={roles} employees={employees}
                onChanged={reloadNode}
              />
            )}

          </div>

          {/* Save — pinned footer, always visible so it's obvious your typed edits are
              held locally and only written when you click Save (never per keystroke). */}
          {canEdit && (
            <div className="shrink-0 border-t border-[#E2E8F0] px-5 py-3">
              <button onClick={saveCore} disabled={saving || !dirty}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-[8px] text-sm font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] disabled:bg-[#E2E8F0] disabled:text-[#94A3B8] disabled:cursor-not-allowed transition-colors">
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
              </button>
            </div>
          )}
          </>
        )}
      </div>

      <ConfirmDialog
        open={confirmDel}
        danger
        title="Delete this step?"
        message={
          descendantIds.size > 0
            ? `This also permanently deletes the ${descendantIds.size} item${descendantIds.size !== 1 ? 's' : ''} nested inside it. This cannot be undone.`
            : 'This permanently deletes the step. This cannot be undone.'
        }
        confirmLabel="Delete"
        loading={deleting}
        onConfirm={removeNode}
        onCancel={() => { if (!deleting) setConfirmDel(false) }}
      />

      <ConfirmDialog
        open={confirmDiscard}
        danger
        title="Discard unsaved changes?"
        message="You've made edits that aren't saved yet. Closing now will lose them."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        onConfirm={() => { setConfirmDiscard(false); onClose() }}
        onCancel={() => setConfirmDiscard(false)}
      />
    </div>
  )

  return typeof document !== 'undefined' ? createPortal(body, document.body) : null
}

// ─── Checklist ─────────────────────────────────────────────────────────────
function ChecklistEditor({ items, canEdit, onChange }: {
  items: { id?: string; text: string }[]
  canEdit: boolean
  onChange: (next: { id?: string; text: string }[]) => void
}) {
  const [draft, setDraft] = useState('')
  if (!canEdit && items.length === 0) return null
  return (
    <div>
      <label className="block text-xs font-medium text-[#374151] mb-1.5">Checklist</label>
      <div className="space-y-1.5">
        {items.map((it, i) => (
          <div key={it.id ?? i} className="flex items-center gap-2">
            <span className="w-4 h-4 rounded-xs border border-[#CBD5E1] shrink-0" />
            <input className={`${inputCls} py-1.5 text-[13px]`} value={it.text} disabled={!canEdit}
              onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
            {canEdit && (
              <button onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label="Remove item"
                className="text-[#94A3B8] hover:text-[#DC2626] shrink-0"><X size={14} /></button>
            )}
          </div>
        ))}
      </div>
      {canEdit && (
        <div className="flex items-center gap-2 mt-2">
          <input className={`${inputCls} py-1.5 text-[13px]`} value={draft} placeholder="Add checklist item…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && draft.trim()) { onChange([...items, { text: draft.trim() }]); setDraft('') } }} />
          <button onClick={() => { if (draft.trim()) { onChange([...items, { text: draft.trim() }]); setDraft('') } }} aria-label="Add checklist item"
            className="shrink-0 w-8 h-8 rounded-[8px] bg-[#2563EB] text-white flex items-center justify-center hover:bg-[#1D4ED8]"><Plus size={15} /></button>
        </div>
      )}
    </div>
  )
}

// ─── Collapsible section (chevron + title + count pill) ─────────────────────
function CollapsibleSection({ title, count = 0, defaultOpen = false, children }: {
  title: string; count?: number; defaultOpen?: boolean; children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-t border-[#E2E8F0] pt-4">
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#2563EB] rounded-xs">
        <ChevronRight size={14} className={`text-[#94A3B8] shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
        <span className="flex-1 text-xs font-semibold text-[#0F172A]">{title}</span>
        {count > 0 && (
          <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-[#2563EB] text-white text-[11px] font-semibold shrink-0">{count}</span>
        )}
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  )
}

// ─── Artifacts / Documents (file | link | article) ──────────────────────────
function ArtifactsSection({ orgId, mapId, nodeId, node, canEdit, onArtifactsChanged, onLinksChanged }: {
  orgId: string; mapId: string; nodeId: string; node: NodeDetail; artifacts: ProcessArtifact[]
  canEdit: boolean; onArtifactsChanged: () => void; onLinksChanged: () => void
}) {
  const docCount = node.inputs.length + node.outputs.length
  return (
    <CollapsibleSection title="Documents" count={docCount} defaultOpen={docCount > 0}>
      <NodeDocuments
        orgId={orgId} mapId={mapId} nodeId={nodeId}
        inputs={node.inputs} outputs={node.outputs} canEdit={canEdit}
        onChanged={onLinksChanged} onArtifactsChanged={onArtifactsChanged}
      />
    </CollapsibleSection>
  )
}

// ─── Sharing ──────────────────────────────────────────────────────────────
function SharingSection({ orgId, mapId, nodeId, node, departments, roles, employees, onChanged }: {
  orgId: string; mapId: string; nodeId: string; node: NodeDetail
  departments: Department[]; roles: Role[]; employees: EmployeePickerOption[]; onChanged: () => void
}) {
  const { addToast } = useToast()
  const [kind, setKind] = useState<ProcessAccessKind>('department')
  const [level, setLevel] = useState<ProcessAccessLevel>('view')
  const [entityId, setEntityId] = useState('')
  const [busy, setBusy] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false) // add-rule form stays hidden behind a link

  const deptOptions = useMemo(() => departments.map((d) => ({ value: d.id, label: d.name })), [departments])

  async function add() {
    if (!entityId || busy) return
    setBusy(true)
    try {
      await processHierarchyApi.addAccess(orgId, mapId, nodeId, {
        kind,
        level: kind === 'exclude_user' ? undefined : level,
        department_id: kind === 'department' ? entityId : undefined,
        role_id: kind === 'role' ? entityId : undefined,
        user_id: kind === 'user' || kind === 'exclude_user' ? entityId : undefined,
      })
      setEntityId('')
      onChanged()
    } catch { addToast('Could not update sharing.', 'error') }
    finally { setBusy(false) }
  }

  async function remove(id: string) {
    try { await processHierarchyApi.removeAccess(orgId, mapId, nodeId, id); onChanged() }
    catch { addToast('Could not remove that rule.', 'error') }
  }

  return (
    <CollapsibleSection title="Who can see this" count={node.access_rules.length} defaultOpen={node.access_rules.length > 0}>
      <div className="space-y-3">
      <p className="text-[11px] text-[#64748B] flex items-center gap-1.5"><Shield size={12} /> Applies to every node inside this one.</p>
      {node.access_rules.length === 0 ? (
        <p className="text-[13px] text-[#64748B]">No one attached here yet — this node inherits access from above.</p>
      ) : (
        <div className="space-y-1">
          {node.access_rules.map((r) => (
            <div key={r.id} className="flex items-center gap-2 text-[13px] bg-[#F8FAFC] border border-[#E2E8F0] rounded-[6px] px-2 py-1.5">
              <span className={`text-[10px] font-semibold rounded-xs px-1.5 py-0.5 shrink-0 ${
                r.kind === 'exclude_user' ? 'bg-[#FEE2E2] text-[#DC2626]' : r.level === 'edit' ? 'bg-[#DCFCE7] text-[#16A34A]' : 'bg-[#E0F2FE] text-[#0369A1]'}`}>
                {r.kind === 'exclude_user' ? 'hidden' : r.level}
              </span>
              <span className="flex-1 truncate text-[#0F172A]">{r.label}</span>
              <span className="text-[11px] text-[#64748B] capitalize shrink-0">{r.kind === 'exclude_user' ? 'person' : r.kind}</span>
              <button onClick={() => remove(r.id)} aria-label="Remove rule" className="text-[#94A3B8] hover:text-[#DC2626] shrink-0"><X size={13} /></button>
            </div>
          ))}
        </div>
      )}
      {/* Add-rule form stays behind a single link until you want it. */}
      {!showAddForm ? (
        <button onClick={() => setShowAddForm(true)}
          className="inline-flex items-center gap-1 text-[13px] font-semibold text-[#2563EB] hover:underline">
          <Plus size={14} /> Add person, role or department
        </button>
      ) : (
      /* One control per line so nothing crams; searchable pickers for role/person. */
      <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-[8px] p-3 space-y-2.5">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wide">Give access to</p>
          <button onClick={() => setShowAddForm(false)} aria-label="Close" className="text-[#94A3B8] hover:text-[#0F172A]"><X size={14} /></button>
        </div>

        <StyledSelect value={kind} onChange={(v) => { setKind(v as ProcessAccessKind); setEntityId('') }}
          options={[
            { value: 'department', label: 'A department' },
            { value: 'role', label: 'A role' },
            { value: 'user', label: 'A person' },
            { value: 'exclude_user', label: 'Hide from a person' },
          ]} />

        {kind === 'department' && (
          <StyledSelect value={entityId} onChange={setEntityId} options={deptOptions} placeholder="Choose a department…" />
        )}
        {kind === 'role' && (
          <RolePicker value={entityId} onChange={setEntityId} roles={roles} title="Choose a role" placeholder="Choose a role…" allowClear />
        )}
        {(kind === 'user' || kind === 'exclude_user') && (
          <EmployeePicker value={entityId} onChange={setEntityId} employees={employees} title="Choose a person" placeholder="Choose a person…" allowClear />
        )}

        <div className="flex items-center gap-2 pt-0.5">
          {kind !== 'exclude_user' && (
            <div className="inline-flex rounded-[8px] border border-[#E2E8F0] overflow-hidden bg-white">
              {(['view', 'edit'] as ProcessAccessLevel[]).map((lv) => (
                <button key={lv} type="button" onClick={() => setLevel(lv)}
                  className={`px-3 py-1.5 text-[12px] font-medium transition-colors ${level === lv ? 'bg-[#2563EB] text-white' : 'bg-white text-[#475569] hover:bg-[#F1F5F9]'}`}>
                  {lv === 'view' ? 'Can view' : 'Can edit'}
                </button>
              ))}
            </div>
          )}
          <button onClick={add} disabled={!entityId || busy}
            className="ml-auto inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[13px] font-semibold rounded-[8px] bg-[#2563EB] text-white hover:bg-[#1D4ED8] disabled:bg-[#E2E8F0] disabled:text-[#94A3B8] transition-colors">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={15} />} Add
          </button>
        </div>
      </div>
      )}
      <p className="text-[11px] text-[#64748B]">Attaching a department automatically covers its roles and people. Use “Hide from a person” to remove someone who’s otherwise included.</p>
      </div>
    </CollapsibleSection>
  )
}
