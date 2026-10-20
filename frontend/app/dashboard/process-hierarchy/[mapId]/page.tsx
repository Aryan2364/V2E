'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { toast } from '@/components/ui/sonner'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import StyledSelect from '@/components/ui/StyledSelect'
import { formatDate, formatDateTime } from '@/lib/format'
import Tooltip from '@/components/ui/tooltip'
import {
  processHierarchyApi,
  type FlowLevel,
  type ProcessMapDetail,
  type ProcessNodeKind,
  type ProcessConditionKind,
  type ProcessPool,
  type SnapshotSummary,
  type MapDiff,
  type TreeNode,
  type ProcessMapSummary,
  type ProcessArtifact,
} from '@/lib/api/process-hierarchy'
import dynamic from 'next/dynamic'
import NodeDrawer from '@/components/process-hierarchy/NodeDrawer'
import { MaterialPreviewModal } from '@/components/process-hierarchy/node-materials'
import ArtifactLibrary from '@/components/process-hierarchy/ArtifactLibrary'
import HierarchyTree from '@/components/process-hierarchy/HierarchyTree'
import { KIND_META } from '@/components/process-hierarchy/kind-meta'
import DepartmentSelect from '@/components/employees/DepartmentSelect'
import { getDepartments } from '@/lib/api/departments'
import type { Department } from '@/lib/types'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/shell/page-header'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

// Client-only: keeps ReactFlow + html-to-image out of this route's server/SSR bundle.
const ProcessCanvas = dynamic(() => import('@/components/process-hierarchy/ProcessCanvas'), {
  ssr: false,
  loading: () => (
    <div className="h-full flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  ),
})
import {
  Eye, Pencil, Filter, History, Plus, Check, X, Loader2, RotateCcw,
  GitCompare, FolderOpen, Save, MoreHorizontal, PanelLeft, Trash2,
  Link2 as LinkIcon, Search, Workflow, ClipboardPaste, Download, Rows3,
  Undo2, Redo2,
} from 'lucide-react'
import { useMapHistory } from '@/components/process-hierarchy/useMapHistory'

/** Keyboard focus ring for the rows and chips here that stay raw (whole-row menu items, list rows). */
const FOCUS = 'outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-primary-ring'

const ADD_KINDS: ProcessNodeKind[] = ['task', 'decision', 'subprocess', 'container', 'start_event', 'end_event']
// Inside a swimlane there are no containers (folders) — a lane holds flow steps and
// sub-processes only. See the process-swimlanes design decisions.
const LANE_ADD_KINDS: ProcessNodeKind[] = ['task', 'decision', 'subprocess', 'start_event', 'end_event']

export default function ProcessMapExplorerPage() {
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''
  const params = useParams()
  const router = useRouter()
  const mapId = String(params.mapId)

  const [map, setMap] = useState<ProcessMapDetail | null>(null)
  const [parentId, setParentId] = useState<string | null>(null)
  const [flow, setFlow] = useState<FlowLevel | null>(null)
  const [tree, setTree] = useState<TreeNode[]>([])
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<'view' | 'edit'>('view')
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [visible, setVisible] = useState<Set<string> | null>(null)
  const [showFilter, setShowFilter] = useState(false)
  const [showVersions, setShowVersions] = useState(false)
  const [showDocs, setShowDocs] = useState(false)
  const [showSaveTpl, setShowSaveTpl] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [showRefPicker, setShowRefPicker] = useState(false)
  const [showMore, setShowMore] = useState(false)
  const [showDeleteMap, setShowDeleteMap] = useState(false)
  const [deletingMap, setDeletingMap] = useState(false)
  const [showTree, setShowTree] = useState(false) // outline is now a slide-over; opened from the ⋯ menu
  // The process explorer is always the swimlane renderer now (no toggle). When other chart
  // families (org, mindmap) arrive, this becomes `flow.chart_type === 'swimlane'`.
  const swimlane = true
  const [departments, setDepartments] = useState<Department[]>([]) // for the New-swimlane picker
  const [addLanePick, setAddLanePick] = useState(false) // Add-step menu is showing its lane picker
  const [laneRename, setLaneRename] = useState<{ laneId: string; deptId: string; name: string } | null>(null) // "change this lane's department" dialog
  const [laneAdd, setLaneAdd] = useState<{ pool: ProcessPool | null; departmentId: string | null; fromNodeId?: string | null; fromX?: number; fromY?: number; side?: string; autoCond?: ProcessConditionKind; ask?: boolean } | null>(null) // lane "+" / node-dot "add next" kind picker
  const [branchPick, setBranchPick] = useState<{ mode: 'create'; source: string; target: string; side?: string; tside?: string } | { mode: 'set'; connId: string } | null>(null) // Yes/No chooser for a decision connection
  const [modeInitialized, setModeInitialized] = useState(false)
  const [diff, setDiff] = useState<MapDiff | null>(null)
  const [comparing, setComparing] = useState<{ base: string; target: string; baseLabel: string; targetLabel: string } | null>(null)
  const [docPreview, setDocPreview] = useState<ProcessArtifact | null>(null)
  const spawnCenterRef = useRef<(() => { x: number; y: number }) | null>(null)
  const autoPositionsRef = useRef<Record<string, { x: number; y: number }> | null>(null)
  const bakedLevels = useRef<Set<string>>(new Set()) // levels whose legacy layout we've already frozen
  const exportPngRef = useRef<(() => void) | null>(null)
  // Cascades repeat pastes at the same spot so they don't stack on top of each other.
  const pasteSeqRef = useRef<{ key: string; n: number }>({ key: '', n: 0 })
  // Clipboard lives in sessionStorage so it survives navigating to another map — that's
  // the whole point of "copy here, open a different map, paste there".
  const [clipboard, setClipboardState] = useState<{ sourceMapId: string; nodeIds: string[] } | null>(null)
  useEffect(() => {
    try { const raw = sessionStorage.getItem('ph-clipboard'); if (raw) setClipboardState(JSON.parse(raw)) } catch {}
  }, [])
  const setClipboard = useCallback((c: { sourceMapId: string; nodeIds: string[] } | null) => {
    setClipboardState(c)
    try { if (c) sessionStorage.setItem('ph-clipboard', JSON.stringify(c)); else sessionStorage.removeItem('ph-clipboard') } catch {}
  }, [])

  const loadTree = useCallback(() => {
    processHierarchyApi.getTree(orgId, mapId).then((t) => setTree(t.nodes)).catch(() => {})
  }, [orgId, mapId])

  useEffect(() => { if (orgId) getDepartments(orgId).then(setDepartments).catch(() => {}) }, [orgId])

  const loadFlow = useCallback(async (pid: string | null) => {
    const f = await processHierarchyApi.getFlow(orgId, mapId, pid)
    setFlow(f)
    setVisible(null) // reset visibility filter on level change
    return f
  }, [orgId, mapId])

  useEffect(() => {
    if (!orgId) return
    setLoading(true)
    Promise.all([processHierarchyApi.getMap(orgId, mapId), processHierarchyApi.getFlow(orgId, mapId, null)])
      .then(([m, f]) => {
        setMap(m)
        setFlow(f)
        loadTree()
        if (!modeInitialized) { setMode(f.can_edit ? 'edit' : 'view'); setModeInitialized(true) }
      })
      .catch(() => router.push('/dashboard/process-hierarchy'))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, mapId])

  // Reload the current level and refresh the outline tree after any structural change, then push
  // a new undo/redo history entry. refresh() is called ONLY by mutations (navigation uses loadFlow
  // directly), so this is the single chokepoint that records every change. The record goes through
  // a ref to break the chicken-and-egg with the history hook (which itself calls refresh on undo —
  // the hook suppresses recording during its own restore).
  const historyRecordRef = useRef<() => void>(() => {})
  const refresh = useCallback(async () => { await loadFlow(parentId); loadTree(); historyRecordRef.current() }, [loadFlow, parentId, loadTree])
  const history = useMapHistory(orgId, mapId, refresh)
  useEffect(() => { historyRecordRef.current = history.record }, [history.record])

  const drill = useCallback(async (nodeId: string) => {
    const node = flow?.nodes.find((n) => n.id === nodeId)
    if (node?.linked_map_id) { router.push(`/dashboard/process-hierarchy/${node.linked_map_id}`); return }
    setSelectedNodeId(null)
    setParentId(nodeId)
    await loadFlow(nodeId)
  }, [flow, loadFlow, router])

  const goTo = useCallback(async (pid: string | null) => {
    setSelectedNodeId(null)
    setParentId(pid)
    await loadFlow(pid)
  }, [loadFlow])

  // From the tree: open a level (container) or jump to a node and select it.
  const openTreeLevel = useCallback((pid: string | null) => { goTo(pid) }, [goTo])
  const openTreeNode = useCallback(async (node: TreeNode) => {
    await goTo(node.parent_node_id)
    setSelectedNodeId(node.id)
  }, [goTo])

  const canEditHere = !comparing && mode === 'edit' && !!flow?.can_edit

  // Undo / redo keyboard shortcuts: Ctrl/⌘+Z undo, Ctrl+Y or Ctrl/⌘+Shift+Z redo. Only in edit
  // mode, and ignored while typing in a field (so it never clobbers text undo).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!canEditHere || !(e.ctrlKey || e.metaKey)) return
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      const k = e.key.toLowerCase()
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); history.undo() }
      else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); history.redo() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [canEditHere, history.undo, history.redo])

  // One-time "bake": the moment an editable level with legacy (unfrozen) nodes loads, write each
  // node's CURRENT on-screen position into storage and mark it frozen. Nothing moves (we save
  // exactly what's shown) — but from then on the auto-layout never re-flows these boxes, so adding
  // or deleting a connection can't shuffle them. Runs once per level; new nodes are born frozen.
  useEffect(() => {
    if (!canEditHere || !flow) return
    const levelKey = `${mapId}:${parentId ?? 'root'}`
    if (bakedLevels.current.has(levelKey)) return
    const unfrozen = flow.nodes.filter((n) => !n.layout_frozen && !n.id.includes('::'))
    if (!unfrozen.length) { bakedLevels.current.add(levelKey); return }

    let tries = 0, raf = 0
    const attempt = () => {
      const auto = autoPositionsRef.current
      if (!auto || !unfrozen.every((n) => auto[n.id])) {
        if (tries++ < 8) { raf = requestAnimationFrame(attempt) } // wait for the canvas to compute positions
        return
      }
      bakedLevels.current.add(levelKey)
      const positions = unfrozen.map((n) => ({ id: n.id, position_x: Math.round(auto[n.id].x), position_y: Math.round(auto[n.id].y) }))
      // bulkPosition freezes each node; reload with loadFlow (not refresh) so the bake isn't an undo step.
      processHierarchyApi.bulkPosition(orgId, mapId, positions)
        .then(() => loadFlow(parentId))
        .catch(() => bakedLevels.current.delete(levelKey))
    }
    raf = requestAnimationFrame(attempt)
    return () => cancelAnimationFrame(raf)
  }, [flow, canEditHere, mapId, parentId, orgId, loadFlow])

  // Core: place a node in the flow (anchor on selected/right-most, auto-connect), with
  // optional composition (build-in-place child map, or reference an existing map).
  const spawnNode = useCallback(async (kind: ProcessNodeKind, opts?: { name?: string; linkedMapId?: string; createLinkedMap?: boolean }) => {
    if (!flow) return
    setShowAdd(false)
    // Anchor ONLY on a node you've selected. With nothing selected we drop the new node
    // where you're currently looking (centre of the visible canvas) instead of appending
    // it to the far end of the flow, off-screen.
    const anchor = selectedNodeId ? flow.nodes.find((nd) => nd.id === selectedNodeId) ?? null : null
    const center = anchor ? null : (spawnCenterRef.current?.() ?? null)
    let tx = anchor ? anchor.position_x + 240 : Math.round(center?.x ?? 80)
    let ty = anchor ? anchor.position_y : Math.round(center?.y ?? 80)
    const occupied = (x: number, y: number) => flow.nodes.some((nd) => Math.abs(nd.position_x - x) < 60 && Math.abs(nd.position_y - y) < 50)
    for (let i = 0; occupied(tx, ty) && i < 20; i++) ty += 140

    try {
      const created = await processHierarchyApi.createNode(orgId, mapId, {
        parent_node_id: parentId, kind,
        name: opts?.name ?? `New ${KIND_META[kind].label}`,
        position_x: tx, position_y: ty,
        ...(opts?.createLinkedMap ? { create_linked_map: true } : {}),
        ...(opts?.linkedMapId ? { linked_map_id: opts.linkedMapId } : {}),
      })
      // Wire it straight into the flow only when continuing from a selected node (skip if
      // that node is an End marker or the new node is a Start marker). A node dropped into
      // empty space stays standalone — drag/connect it yourself.
      if (anchor && anchor.kind !== 'end_event' && kind !== 'start_event' && kind !== 'note') {
        const condition: ProcessConditionKind = anchor.kind === 'decision' ? 'yes' : 'none'
        await processHierarchyApi.createConnection(orgId, mapId, {
          parent_node_id: parentId, source_node_id: anchor.id, target_node_id: created.id,
          condition_kind: condition, label: condition === 'yes' ? 'Yes' : undefined,
        }).catch(() => {})
      }
      await refresh()
      setSelectedNodeId(created.id) // highlight + open the panel, so it's obvious it landed
    } catch { toast.error('Could not add that step. Please try again.') }
  }, [flow, orgId, mapId, parentId, selectedNodeId, refresh])

  // Copy/paste. Copy just remembers what's on the clipboard; paste duplicates it into
  // the level you're viewing, dropped where you're looking (centre of the canvas).
  const copyNodes = useCallback((nodeIds: string[]) => {
    const ids = nodeIds.filter((id) => !id.includes('::')) // only real top-level nodes
    if (!ids.length) return
    setClipboard({ sourceMapId: mapId, nodeIds: ids })
    pasteSeqRef.current = { key: '', n: 0 } // fresh copy restarts the paste cascade
    toast.success(`Copied ${ids.length} item${ids.length !== 1 ? 's' : ''}. Paste from the Add menu.`)
  }, [mapId])

  const pasteClipboard = useCallback(async () => {
    if (!clipboard) return
    setShowAdd(false)
    // Drop where you're looking. If you paste again without moving, cascade each copy down-right
    // by a small step so repeat pastes never stack on the same spot.
    const c = spawnCenterRef.current?.() ?? null
    let pos: { position_x: number; position_y: number } | null = null
    if (c) {
      const bx = Math.round(c.x), by = Math.round(c.y)
      const key = `${bx},${by}`
      const seq = pasteSeqRef.current
      const n = seq.key === key ? seq.n + 1 : 0
      pasteSeqRef.current = { key, n }
      pos = { position_x: bx + n * 28, position_y: by + n * 28 }
    }
    try {
      const { pasted_node_ids } = await processHierarchyApi.pasteNodes(orgId, mapId, {
        source_map_id: clipboard.sourceMapId, node_ids: clipboard.nodeIds,
        parent_node_id: parentId,
        ...(pos ?? {}),
      })
      await refresh()
      // Note: intentionally do NOT select/open the pasted node — pasting shouldn't pop the sidebar.
      toast.success(`Pasted ${pasted_node_ids.length} item${pasted_node_ids.length !== 1 ? 's' : ''}.`)
    } catch (e: any) { toast.error(e?.response?.data?.message ?? 'Could not paste here.') }
  }, [clipboard, orgId, mapId, parentId, refresh])

  // Create a swimlane (a department lane) straight from the Add step menu, and reveal the
  // swimlane view so the result is visible even if you were on the free-form canvas.
  const createLane = useCallback(async (deptId: string) => {
    if (!deptId) return
    try {
      await processHierarchyApi.createLane(orgId, mapId, { department_id: deptId, parent_node_id: parentId })
      setShowAdd(false); setAddLanePick(false)
      await refresh()
    } catch (e: any) { toast.error(e?.response?.data?.message ?? 'Could not add the lane.') }
  }, [orgId, mapId, parentId, refresh])

  // Open the "change a lane's department" dialog (clicking the lane's name).
  const onRenameLane = useCallback((laneId: string, deptId: string, name: string) => {
    setLaneRename({ laneId, deptId, name })
  }, [])
  // Apply it: re-point the lane at a new department; all its steps move with it.
  const applyLaneRename = useCallback(async (newDeptId: string) => {
    const lr = laneRename
    if (!lr || newDeptId === lr.deptId) { setLaneRename(null); return }
    setLaneRename(null)
    try {
      const { updated } = await processHierarchyApi.reassignLane(orgId, mapId, lr.laneId, newDeptId)
      await refresh()
      toast.success(`Lane changed — ${updated} step${updated !== 1 ? 's' : ''} moved.`)
    } catch (e: any) { toast.error(e?.response?.data?.message ?? 'Could not change the lane.') }
  }, [laneRename, orgId, mapId, refresh])
  // Drag a lane's grip → persist the new top→bottom order of the department lanes.
  const onReorderLanes = useCallback(async (laneIds: string[]) => {
    try {
      await processHierarchyApi.reorderLanes(orgId, mapId, laneIds, parentId)
      await refresh()
    } catch (e: any) { toast.error(e?.response?.data?.message ?? 'Could not reorder the lanes.') }
  }, [orgId, mapId, parentId, refresh])
  // Drag a pool's grip → persist the new top→bottom order of the pools.
  const onReorderPools = useCallback(async (pools: ProcessPool[]) => {
    try {
      await processHierarchyApi.setPoolOrder(orgId, mapId, pools, parentId)
      await refresh()
    } catch (e: any) { toast.error(e?.response?.data?.message ?? 'Could not reorder the pools.') }
  }, [orgId, mapId, parentId, refresh])
  // Remove the lane outright (only offered when it's empty).
  const removeLane = useCallback(async () => {
    const lr = laneRename
    if (!lr) return
    setLaneRename(null)
    try {
      await processHierarchyApi.deleteLane(orgId, mapId, lr.laneId)
      await refresh()
      toast.success('Lane removed.')
    } catch (e: any) { toast.error(e?.response?.data?.message ?? 'Could not remove the lane.') }
  }, [laneRename, orgId, mapId, refresh])

  // Output rules: a decision has exactly one Yes + one No. Every other step can fan out from each
  // FREE connector point — a point (a node side) is in use once a line attaches to it (this step's
  // outgoing source_side OR an incoming target_side), so a step may lead to several next steps as
  // long as there's a free dot. Returns whether another output is allowed and — for a decision —
  // which branch this is (auto-picking the remaining one) or whether to ask (first branch).
  const outputRuleFor = useCallback((sourceId: string, sourceSide?: string): { ok: boolean; reason?: string; condition?: ProcessConditionKind; ask?: boolean } => {
    const src = flow?.nodes.find((n) => n.id === sourceId)
    if (!flow || !src) return { ok: false, reason: 'Could not find that step.' }
    const outs = flow.connections.filter((c) => c.source_node_id === sourceId)
    if (src.kind === 'decision') {
      const hasYes = outs.some((c) => c.condition_kind === 'yes')
      const hasNo = outs.some((c) => c.condition_kind === 'no')
      if ((hasYes && hasNo) || outs.length >= 2) return { ok: false, reason: 'A decision can only branch into Yes and No — both are already used.' }
      if (hasYes) return { ok: true, condition: 'no' }
      if (hasNo) return { ok: true, condition: 'yes' }
      return { ok: true, ask: true }
    }
    const usedPoints = new Set<string>()
    for (const c of flow.connections) {
      if (c.source_node_id === sourceId && c.source_side) usedPoints.add(c.source_side)
      if (c.target_node_id === sourceId && c.target_side) usedPoints.add(c.target_side)
    }
    if (sourceSide) {
      if (usedPoints.has(sourceSide)) return { ok: false, reason: 'That connection point is already in use — pick a free dot.' }
      return { ok: true, condition: 'none' }
    }
    if (outs.length >= 4) return { ok: false, reason: 'This step already uses all four connection points.' }
    return { ok: true, condition: 'none' }
  }, [flow])

  // The lane "+" opens a small picker for WHAT to add (Task / Decision / Container / …),
  // then the chosen kind is created straight into that lane (pool + department pre-set).
  const openLaneAdd = useCallback((pool: ProcessPool, departmentId: string | null) => {
    setLaneAdd({ pool, departmentId })
  }, [])
  // Click a node's exit dot: open the kind picker, remembering which node to link the new
  // step from, inheriting its pool + department.
  const appendFromNode = useCallback((nodeId: string, pool: ProcessPool | null, departmentId: string | null, sourceSide?: string) => {
    const rule = outputRuleFor(nodeId, sourceSide)
    if (!rule.ok) { toast.error(rule.reason!); return }
    const src = flow?.nodes.find((n) => n.id === nodeId)
    setLaneAdd({ pool, departmentId, fromNodeId: nodeId, fromX: src?.position_x, fromY: src?.position_y, side: sourceSide, autoCond: rule.condition, ask: rule.ask })
  }, [outputRuleFor, flow])
  const addLaneKind = useCallback(async (kind: ProcessNodeKind) => {
    if (!laneAdd) return
    const { pool, departmentId, fromNodeId, fromX, fromY, side, autoCond, ask } = laneAdd
    setLaneAdd(null)
    const isArea = kind === 'subprocess' // no containers in a swimlane; only sub-process is an area
    // Place the new step right beside the node you're continuing from, in the direction of the
    // exit dot you clicked — so inserting a step between two nodes lands it next to the source,
    // not off at the far end of the flow. Nudge past anything already sitting on that spot.
    let pos: { position_x: number; position_y: number } | null = null
    if (fromNodeId != null && fromX != null && fromY != null) {
      let px = fromX, py = fromY
      if (side === 'bottom') py = fromY + 140
      else if (side === 'top') py = fromY - 140
      else if (side === 'left') px = fromX - 240
      else px = fromX + 240 // right (default): continue to the right
      const horizontal = side !== 'top' && side !== 'bottom'
      const occupied = (x: number, y: number) => (flow?.nodes ?? []).some((nd) => Math.abs(nd.position_x - x) < 60 && Math.abs(nd.position_y - y) < 50)
      for (let i = 0; occupied(px, py) && i < 20; i++) { if (horizontal) px += 60; else py += 140 }
      pos = { position_x: Math.round(px), position_y: Math.round(py) }
    }
    try {
      const created = await processHierarchyApi.createNode(orgId, mapId, {
        parent_node_id: parentId, kind, name: `New ${KIND_META[kind].label}`,
        ...(pool ? { pool } : {}), ...(departmentId ? { department_id: departmentId } : {}),
        ...(pos ?? {}),
        ...(isArea ? { create_linked_map: true } : {}),
      })
      // Dot "add next" also draws the connection into the new node — with the branch the output
      // rule resolved (auto-picked for a decision's second branch), or unlabeled if we'll ask.
      let newConnId: string | null = null
      if (fromNodeId) {
        const cond: ProcessConditionKind = autoCond ?? 'none'
        const conn = await processHierarchyApi.createConnection(orgId, mapId, {
          parent_node_id: parentId, source_node_id: fromNodeId, target_node_id: created.id,
          condition_kind: cond, label: cond === 'yes' ? 'Yes' : cond === 'no' ? 'No' : undefined,
          ...(side ? { source_side: side } : {}),
        }).catch(() => null)
        newConnId = conn?.id ?? null
      }
      await refresh()
      setSelectedNodeId(created.id)
      // Only ask for the branch when the rule said to (a decision's very first branch).
      if (fromNodeId && newConnId && ask) setBranchPick({ mode: 'set', connId: newConnId })
    } catch (e: any) { toast.error(e?.response?.data?.message ?? 'Could not add a step to this lane.') }
  }, [laneAdd, orgId, mapId, parentId, refresh, flow])

  // Drawing a line FROM a decision to an existing node → ask Yes/No before creating it.
  // Drag a node onto another lane → set its department (Customer/Vendor have none) and keep
  // the horizontal spot it was dropped at.
  const reassignLane = useCallback(async (nodeId: string, pool: ProcessPool | null, departmentId: string | null, positionX: number) => {
    try {
      await processHierarchyApi.updateNode(orgId, mapId, nodeId, { pool, department_id: departmentId, position_x: positionX })
      await refresh()
    } catch (e: any) { toast.error(e?.response?.data?.message ?? 'Could not move it out of the lane.') }
  }, [orgId, mapId, refresh])

  // A box-selected group dragged across lanes — reassign each node's pool/department (+ x/y) to
  // the lane it landed in. Sequential so the per-node auto-lane create/cleanup can't race, then
  // one refresh.
  const onNodesReassign = useCallback(async (items: { id: string; pool: ProcessPool | null; department_id: string | null; position_x: number; position_y: number }[]) => {
    if (!items.length) return
    try {
      for (const it of items) {
        await processHierarchyApi.updateNode(orgId, mapId, it.id, { pool: it.pool, department_id: it.department_id, position_x: it.position_x, position_y: it.position_y })
      }
      await refresh()
    } catch (e: any) { toast.error(e?.response?.data?.message ?? 'Could not move those to that lane.') }
  }, [orgId, mapId, refresh])

  const onDecisionConnect = useCallback((source: string, target: string, sourceSide?: string, targetSide?: string) => {
    const rule = outputRuleFor(source, sourceSide)
    if (!rule.ok) { toast.error(rule.reason!); return }
    if (rule.ask) { setBranchPick({ mode: 'create', source, target, side: sourceSide, tside: targetSide }); return }
    // One branch already used → this is automatically the other one; no pop-up.
    const cond = rule.condition!
    processHierarchyApi.createConnection(orgId, mapId, {
      parent_node_id: parentId, source_node_id: source, target_node_id: target,
      condition_kind: cond, label: cond === 'yes' ? 'Yes' : 'No',
      ...(sourceSide ? { source_side: sourceSide } : {}),
      ...(targetSide ? { target_side: targetSide } : {}),
    }).then(() => refresh()).catch(() => toast.error('Could not connect those steps.'))
  }, [outputRuleFor, orgId, mapId, parentId, refresh])
  const chooseBranch = useCallback(async (cond: 'yes' | 'no') => {
    const bp = branchPick
    setBranchPick(null)
    if (!bp) return
    const label = cond === 'yes' ? 'Yes' : 'No'
    try {
      if (bp.mode === 'create') {
        await processHierarchyApi.createConnection(orgId, mapId, {
          parent_node_id: parentId, source_node_id: bp.source, target_node_id: bp.target, condition_kind: cond, label,
          ...(bp.side ? { source_side: bp.side } : {}),
          ...(bp.tside ? { target_side: bp.tside } : {}),
        })
      } else {
        await processHierarchyApi.updateConnection(orgId, mapId, bp.connId, { condition_kind: cond, label })
      }
      await refresh()
    } catch { toast.error('Could not set the branch.') }
  }, [branchPick, orgId, mapId, parentId, refresh])
  const cancelBranch = useCallback(async () => {
    const bp = branchPick
    setBranchPick(null)
    if (!bp) return
    // "Nothing chosen → break the connection." (In create mode nothing was created yet.)
    if (bp.mode === 'set') {
      try { await processHierarchyApi.deleteConnection(orgId, mapId, bp.connId); await refresh() } catch { /* ignore */ }
    }
  }, [branchPick, orgId, mapId, parentId, refresh])

  // Build-in-place: containers / sub-processes instantly become their own child map.
  const addNode = useCallback((kind: ProcessNodeKind) => {
    const isArea = kind === 'container' || kind === 'subprocess'
    return spawnNode(kind, { createLinkedMap: isArea })
  }, [spawnNode])

  // Insert a reference (instance) to an existing map.
  const addReference = useCallback((map: { id: string; name: string }) => {
    setShowRefPicker(false)
    return spawnNode('subprocess', { name: map.name, linkedMapId: map.id })
  }, [spawnNode])

  const onConnect = useCallback(async (source: string, target: string, _condition: ProcessConditionKind, sourceSide?: string, targetSide?: string) => {
    const rule = outputRuleFor(source, sourceSide)
    if (!rule.ok) { toast.error(rule.reason!); return }
    const cond = rule.condition ?? 'none'
    try {
      await processHierarchyApi.createConnection(orgId, mapId, {
        parent_node_id: parentId, source_node_id: source, target_node_id: target,
        condition_kind: cond, label: cond === 'yes' ? 'Yes' : cond === 'no' ? 'No' : undefined,
        ...(sourceSide ? { source_side: sourceSide } : {}),
        ...(targetSide ? { target_side: targetSide } : {}),
      })
      await refresh()
    } catch { toast.error('Could not connect those steps.') }
  }, [orgId, mapId, parentId, refresh, outputRuleFor])

  const onNodeDragStop = useCallback(async (nodeId: string, x: number, y: number) => {
    // Update local state too, so a later expand/collapse rebuilds at the new spot
    // (not the stale stored position) — otherwise the node appears to jump.
    setFlow((f) => f ? { ...f, nodes: f.nodes.map((n) => (n.id === nodeId ? { ...n, position_x: x, position_y: y } : n)) } : f)
    try { await processHierarchyApi.bulkPosition(orgId, mapId, [{ id: nodeId, position_x: x, position_y: y }]); historyRecordRef.current() }
    catch { toast.error('Could not save the new position.') }
  }, [orgId, mapId])

  // Open a document clicked straight on the canvas: links jump out, files/articles preview.
  const openDoc = useCallback(async (artifactId: string) => {
    try {
      const a = await processHierarchyApi.getArtifact(orgId, mapId, artifactId)
      if (a.content_type === 'link' && a.url) { window.open(a.url, '_blank', 'noopener'); return }
      setDocPreview(a)
    } catch { toast.error('Could not open this document.') }
  }, [orgId, mapId])
  const downloadDoc = useCallback(async (a: ProcessArtifact) => {
    try { const { url } = await processHierarchyApi.downloadArtifact(orgId, mapId, a.id); window.open(url, '_blank', 'noopener') }
    catch { toast.error('Could not download this file.') }
  }, [orgId, mapId])

  // Box-selected group dragged to a new spot — persist every moved node's position.
  const onNodesMove = useCallback(async (positions: { id: string; position_x: number; position_y: number }[]) => {
    if (!positions.length) return
    setFlow((f) => f ? { ...f, nodes: f.nodes.map((n) => {
      const p = positions.find((x) => x.id === n.id)
      return p ? { ...n, position_x: p.position_x, position_y: p.position_y } : n
    }) } : f)
    try { await processHierarchyApi.bulkPosition(orgId, mapId, positions); historyRecordRef.current() }
    catch { toast.error('Could not save the new positions.') }
  }, [orgId, mapId])

  // Delete a box-selected group (cascades handled server-side; ignore per-node races).
  const deleteNodes = useCallback(async (ids: string[]) => {
    if (!ids.length) return
    setSelectedNodeId(null)
    await Promise.allSettled(ids.map((id) => processHierarchyApi.deleteNode(orgId, mapId, id)))
    await refresh()
  }, [orgId, mapId, refresh])

  // Delete the entire map (owner only) — returns to the maps list on success.
  const deleteMap = useCallback(async () => {
    setDeletingMap(true)
    try {
      await processHierarchyApi.deleteMap(orgId, mapId)
      router.push('/dashboard/process-hierarchy')
    } catch { toast.error('Could not delete this map. Please try again.'); setDeletingMap(false) }
  }, [orgId, mapId, router])


  const updateConn = useCallback(async (id: string, dto: { label?: string; condition_kind?: ProcessConditionKind }) => {
    try { await processHierarchyApi.updateConnection(orgId, mapId, id, dto); await refresh() }
    catch { toast.error('Could not update the connection.') }
  }, [orgId, mapId, parentId, refresh])

  const deleteConn = useCallback(async (id: string) => {
    try { await processHierarchyApi.deleteConnection(orgId, mapId, id); await refresh() }
    catch { toast.error('Could not delete the connection.') }
  }, [orgId, mapId, parentId, refresh])

  const runCompare = useCallback(async (base: string, target: string, baseLabel: string, targetLabel: string) => {
    try {
      const d = await processHierarchyApi.diff(orgId, mapId, base, target)
      setDiff(d); setComparing({ base, target, baseLabel, targetLabel })
      setShowVersions(false); setMode('view'); setSelectedNodeId(null)
    } catch { toast.error('Could not compare those versions.') }
  }, [orgId, mapId])

  const exitCompare = useCallback(() => { setDiff(null); setComparing(null) }, [])

  const jumpTo = useCallback(async (parentNodeId: string | null, nodeId: string | null, removed: boolean) => {
    await goTo(parentNodeId)
    if (nodeId && !removed) setSelectedNodeId(nodeId)
  }, [goTo])

  if (loading || !map || !flow) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // Floating "Add step" primary — rendered over the canvas (top-right cluster). In swimlane
  // work a lane is often the FIRST thing you add, so "New swimlane" lives right in this menu.
  const addStepControl = canEditHere ? (
    <div className="flex items-center gap-1.5">
      {/* Undo / redo — greyed when there's nothing to step to, or while a restore is in flight. */}
      <div className="inline-flex items-center rounded-lg border border-border-light bg-surface shadow-xs">
        <Tooltip label="Undo (Ctrl+Z)">
          <Button variant="ghost" size="icon" onClick={history.undo} disabled={!history.canUndo || history.busy} aria-label="Undo (Ctrl+Z)">
            <Undo2 size={16} />
          </Button>
        </Tooltip>
        <Tooltip label="Redo (Ctrl+Y)">
          <Button variant="ghost" size="icon" onClick={history.redo} disabled={!history.canRedo || history.busy} aria-label="Redo (Ctrl+Y)">
            <Redo2 size={16} />
          </Button>
        </Tooltip>
      </div>
      <div className="relative">
      <Button aria-haspopup="menu" aria-expanded={showAdd} onClick={() => { setShowAdd((v) => !v); setAddLanePick(false) }}>
        <Plus size={16} /> Add step
      </Button>
      {showAdd && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => { setShowAdd(false); setAddLanePick(false) }} />
          <div className="absolute right-0 top-[calc(100%+6px)] z-50 w-64 max-h-[320px] overflow-y-auto bg-surface border border-border-light rounded-lg shadow-lg p-1.5 animate-[popIn_.12s_ease-out]">
            {addLanePick ? (
              <div className="p-1">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-meta font-medium text-text-primary">New swimlane</span>
                  <Button variant="secondary" size="sm" onClick={() => setAddLanePick(false)}>Back</Button>
                </div>
                <DepartmentSelect
                  inline value="" departments={departments} onChange={createLane}
                  placeholder="Pick a department"
                  lockedReason={(id) => (flow.lanes.some((l) => l.department_id === id) ? 'Already a lane' : null)}
                />
                <p className="text-meta text-text-muted mt-2">A lane is a department band in the Company pool.</p>
              </div>
            ) : (
              <>
                {ADD_KINDS.map((k) => (
                  <button key={k} onClick={() => addNode(k)}
                    className={`w-full flex items-start gap-2.5 px-2.5 py-2 rounded-lg hover:bg-surface-control text-left transition-colors ${FOCUS}`}>
                    <span className="text-primary-text mt-0.5">{KIND_META[k].icon}</span>
                    <span className="min-w-0">
                      <span className="block text-meta font-medium text-text-primary">{KIND_META[k].label}</span>
                      <span className="block text-meta text-text-muted">{KIND_META[k].hint}</span>
                    </span>
                  </button>
                ))}
                {/* Swimlanes only make sense at the top level of a map — a container (drill-down)
                    holds flow steps, not department lanes. So hide "New swimlane" inside a container. */}
                {!parentId && (
                  <>
                    <div className="my-1 border-t border-border-light" />
                    <button onClick={() => setAddLanePick(true)}
                      className={`w-full flex items-start gap-2.5 px-2.5 py-2 rounded-lg hover:bg-surface-control text-left transition-colors ${FOCUS}`}>
                      <span className="text-primary-text mt-0.5"><Rows3 size={14} /></span>
                      <span className="min-w-0">
                        <span className="block text-meta font-medium text-text-primary">New swimlane</span>
                        <span className="block text-meta text-text-muted">Add a department lane (a horizontal band)</span>
                      </span>
                    </button>
                  </>
                )}
                <div className="my-1 border-t border-border-light" />
                <button onClick={() => { setShowAdd(false); setShowRefPicker(true) }}
                  className={`w-full flex items-start gap-2.5 px-2.5 py-2 rounded-lg hover:bg-surface-control text-left transition-colors ${FOCUS}`}>
                  <span className="text-primary-text mt-0.5"><LinkIcon size={14} /></span>
                  <span className="min-w-0">
                    <span className="block text-meta font-medium text-text-primary">Reference a map</span>
                    <span className="block text-meta text-text-muted">Drop an instance of an existing map</span>
                  </span>
                </button>
                <button onClick={() => addNode('note')}
                  className={`w-full flex items-start gap-2.5 px-2.5 py-2 rounded-lg hover:bg-surface-control text-left transition-colors ${FOCUS}`}>
                  <span className="text-warning mt-0.5">{KIND_META.note.icon}</span>
                  <span className="min-w-0">
                    <span className="block text-meta font-medium text-text-primary">Note</span>
                    <span className="block text-meta text-text-muted">A free-form sticky annotation</span>
                  </span>
                </button>
                {clipboard && (
                  <button onClick={pasteClipboard}
                    className={`w-full flex items-start gap-2.5 px-2.5 py-2 rounded-lg hover:bg-surface-control text-left transition-colors ${FOCUS}`}>
                    <span className="text-primary-text mt-0.5"><ClipboardPaste size={14} /></span>
                    <span className="min-w-0">
                      <span className="block text-meta font-medium text-text-primary">Paste {clipboard.nodeIds.length} item{clipboard.nodeIds.length !== 1 ? 's' : ''}</span>
                      <span className="block text-meta text-text-muted">Drop a copy of what you copied here</span>
                    </span>
                  </button>
                )}
              </>
            )}
          </div>
        </>
      )}
      </div>
    </div>
  ) : null

  return (
    // Full-height flex column that sits flush under the fixed global nav. The negative
    // margins cancel the shared dashboard page padding (px/py) for THIS route only —
    // see app/dashboard/layout.tsx — then we re-add tight gutters. Canvas pans; the
    // page itself never scrolls.
    <div className="flex flex-col overflow-hidden h-[calc(100dvh-56px)] -mt-6 lg:-mt-8 -mb-6 lg:-mb-8 -mx-4 sm:-mx-6 lg:-mx-8 px-3 lg:px-4 pt-2 pb-2">
      {/* Page header — map / level title, the way back (trail), and the working controls. */}
      <div className="shrink-0 [&>nav]:mb-2 [&>div]:mb-2">
        <PageHeader
          title={flow.breadcrumb.length > 0 ? flow.breadcrumb[flow.breadcrumb.length - 1].name : map.name}
          trail={[{ label: 'All maps', href: '/dashboard/process-hierarchy' }]}
          meta={
            flow.breadcrumb.length > 0 ? (
              <span className="inline-flex flex-wrap items-center gap-1.5">
                <button onClick={() => goTo(null)} className={`max-w-[180px] truncate rounded-xs text-primary-text underline ${FOCUS}`}>{map.name}</button>
                {flow.breadcrumb.slice(0, -1).map((c) => (
                  <span key={c.id} className="inline-flex items-center gap-1.5">
                    <span aria-hidden>›</span>
                    <button onClick={() => goTo(c.id)} className={`max-w-[160px] truncate rounded-xs text-primary-text underline ${FOCUS}`}>{c.name}</button>
                  </span>
                ))}
              </span>
            ) : undefined
          }
          actions={
            <>
              {map.can_edit && (
                <div className="inline-flex items-center gap-1" role="group" aria-label="Mode">
                  <Button variant="secondary" aria-pressed={mode === 'view'} onClick={() => setMode('view')} className={mode === 'view' ? 'bg-primary-subtle' : undefined}>
                    <Eye size={16} /> <span className="hidden md:inline">View</span>
                  </Button>
                  <Button variant="secondary" aria-pressed={mode === 'edit'} onClick={() => setMode('edit')} className={mode === 'edit' ? 'bg-primary-subtle' : undefined}>
                    <Pencil size={16} /> <span className="hidden md:inline">Edit</span>
                  </Button>
                </div>
              )}

              {/* Visibility filter */}
              <div className="relative">
                <Button variant="secondary" aria-expanded={showFilter} onClick={() => setShowFilter((v) => !v)} className={visible ? 'bg-primary-subtle' : undefined}>
                  <Filter size={16} /> <span className="hidden md:inline">{visible ? `Showing ${visible.size}` : 'Filter'}</span>
                </Button>
                {showFilter && (
                  <VisibilityPanel flow={flow} visible={visible} onChange={setVisible} onClose={() => setShowFilter(false)} />
                )}
              </div>

              {/* More (secondary tools) + Versions popover anchor */}
              <div className="relative">
                <Button variant="secondary" aria-haspopup="menu" aria-expanded={showMore} onClick={() => setShowMore((v) => !v)}>
                  <MoreHorizontal size={16} /> <span className="hidden md:inline">More</span>
                </Button>
                {showMore && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowMore(false)} />
                    <div className="absolute right-0 top-[calc(100%+6px)] z-50 w-52 bg-surface border border-border-light rounded-lg shadow-lg p-1.5 animate-[popIn_.12s_ease-out]">
                      <MenuItem icon={<PanelLeft size={15} />} label="Outline" onClick={() => { setShowMore(false); setShowTree(true) }} />
                      {flow.nodes.length > 0 && (
                        <MenuItem icon={<Download size={15} />} label="Export as PNG" onClick={() => { setShowMore(false); exportPngRef.current?.() }} />
                      )}
                      <MenuItem icon={<History size={15} />} label="Versions & compare" onClick={() => { setShowMore(false); setShowVersions(true) }} />
                      {map.can_edit && <MenuItem icon={<FolderOpen size={15} />} label="Document library" onClick={() => { setShowMore(false); setShowDocs(true) }} />}
                      <MenuItem icon={<Save size={15} />} label="Save as template" onClick={() => { setShowMore(false); setShowSaveTpl(true) }} />
                      {map.is_owner && (
                        <>
                          <div className="my-1 h-px bg-surface-control" />
                          <MenuItem icon={<Trash2 size={15} />} label="Delete this map" danger onClick={() => { setShowMore(false); setShowDeleteMap(true) }} />
                        </>
                      )}
                    </div>
                  </>
                )}
                {showVersions && (
                  <VersionsPanel orgId={orgId} mapId={mapId} canEdit={map.can_edit}
                    onClose={() => setShowVersions(false)} onRestored={() => refresh()} onCompare={runCompare} />
                )}
              </div>
            </>
          }
        />
      </div>

      {/* Compare banner */}
      {comparing && diff && (
        <div className="flex items-center gap-3 flex-wrap rounded-lg bg-text-primary text-primary-foreground px-4 py-2.5 mt-2 shrink-0">
          <GitCompare size={16} className="shrink-0" />
          <span className="text-meta font-medium">
            Comparing <span className="font-medium">{comparing.baseLabel}</span> → <span className="font-medium">{comparing.targetLabel}</span>
          </span>
          <span className="text-meta text-primary-foreground/70">{diff.summary.total_changes} change{diff.summary.total_changes !== 1 ? 's' : ''}</span>
          <span className="flex items-center gap-2 text-meta">
            <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-success" /> added</span>
            <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-warning" /> changed</span>
            <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-danger" /> removed</span>
          </span>
          <Button variant="secondary" size="sm" onClick={exitCompare} className="ml-auto">
            <X size={16} /> Exit compare
          </Button>
        </div>
      )}

      {/* Canvas — takes the full remaining area, inset with a light border + rounded corners.
          Everything else (outline, add, hint) floats over it. */}
      <div className="relative flex-1 min-h-0 mt-2 rounded-card border border-border-light bg-surface shadow-card overflow-hidden">
        {/* Show the empty state only when there's genuinely nothing to draw. In swimlane view a
            lane with no steps IS something to show, so render the canvas once any lane exists. */}
        {flow.nodes.length === 0 && !(swimlane && flow.lanes.length > 0) ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-6">
            {/* The canvas (which normally hosts Add step) isn't mounted when empty, so float
                the same control here — otherwise the empty state is a dead end. */}
            {addStepControl && <div className="absolute top-3 right-3 z-10">{addStepControl}</div>}
            <div className="w-14 h-14 rounded-full bg-surface-control flex items-center justify-center mb-3">
              {KIND_META.start_event.icon}
            </div>
            <p className="text-text-primary font-medium">This level is empty</p>
            <p className="text-text-secondary text-body mt-1 max-w-sm">
              {canEditHere
                ? 'Add your first step with the Add step button, top right — pick a Container, Task, Decision or a Start/End marker.'
                : 'Nothing has been mapped here yet.'}
            </p>
          </div>
        ) : (
          <ProcessCanvas
            flow={flow}
            canEdit={canEditHere}
            swimlane={swimlane}
            onAddInLane={openLaneAdd}
            onRenameLane={onRenameLane}
            onReorderLanes={onReorderLanes}
            onReorderPools={onReorderPools}
            onAppendFromNode={appendFromNode}
            onDecisionConnect={onDecisionConnect}
            onReassignLane={reassignLane}
            selectedNodeId={selectedNodeId}
            visibleNodeIds={visible}
            diffStatus={comparing ? diff?.node_status ?? null : null}
            onSelectNode={setSelectedNodeId}
            onDrill={drill}
            onConnect={onConnect}
            onNodeDragStop={onNodeDragStop}
            onNodesMove={onNodesMove}
            onNodesReassign={onNodesReassign}
            onDeleteNodes={deleteNodes}
            onUpdateConnection={updateConn}
            onDeleteConnection={deleteConn}
            topRightExtra={addStepControl}
            loadFlowAt={(mid, pid) => processHierarchyApi.getFlow(orgId, mid, pid)}
            onOpenMap={(mid) => router.push(`/dashboard/process-hierarchy/${mid}`)}
            onOpenDoc={openDoc}
            spawnCenterRef={spawnCenterRef}
            autoPositionsRef={autoPositionsRef}
            exportPngRef={exportPngRef}
            onCopyNodes={copyNodes}
            onPaste={pasteClipboard}
          />
        )}

        {docPreview && (
          <MaterialPreviewModal orgId={orgId} mapId={mapId} artifact={docPreview}
            onClose={() => setDocPreview(null)} onDownload={downloadDoc} />
        )}

        {/* Outline slide-over — floats over the canvas; click the canvas or pick an item to close. */}
        {showTree && (
          <>
            <div className="absolute inset-0 z-20" onClick={() => setShowTree(false)} aria-hidden="true" />
            <aside
              className="absolute z-30 top-3 left-3 bottom-3 right-3 sm:right-auto sm:w-[244px] flex flex-col bg-surface/95 backdrop-blur border border-border-light rounded-card shadow-dialog overflow-hidden animate-[slideInLeft_.2s_ease-out]"
              onClick={(e) => e.stopPropagation()}
              aria-label="Outline"
            >
              <HierarchyTree
                tree={tree}
                mapName={map.name}
                currentParentId={parentId}
                selectedNodeId={selectedNodeId}
                onOpenLevel={(pid) => { setShowTree(false); openTreeLevel(pid) }}
                onSelectNode={(node) => { setShowTree(false); openTreeNode(node) }}
              />
            </aside>
          </>
        )}
      </div>

      {selectedNodeId && !comparing && (
        <NodeDrawer
          orgId={orgId} mapId={mapId} nodeId={selectedNodeId} tree={tree}
          onClose={() => setSelectedNodeId(null)}
          onChanged={() => refresh()}
          onDrill={(id) => { setSelectedNodeId(null); drill(id) }}
          onCopy={() => copyNodes([selectedNodeId])}
        />
      )}

      {comparing && diff && (
        <DiffPanel diff={diff} onClose={exitCompare} onJump={jumpTo} />
      )}

      {showDocs && (
        <ArtifactLibrary orgId={orgId} mapId={mapId} canEdit={map.can_edit} onClose={() => setShowDocs(false)} />
      )}

      {showSaveTpl && (
        <SaveTemplateModal orgId={orgId} mapId={mapId} mapName={map.name} onClose={() => setShowSaveTpl(false)} />
      )}

      {showRefPicker && (
        <ReferenceMapModal orgId={orgId} excludeId={mapId} onClose={() => setShowRefPicker(false)} onPick={addReference} />
      )}

      {/* Decision branch chooser — "what does this connection mean?" Cancel breaks the connection. */}
      {branchPick && (
        <Dialog open onOpenChange={(next) => { if (!next) cancelBranch() }}>
          <DialogContent size="sm">
            <DialogHeader>
              <DialogTitle>What does this branch mean?</DialogTitle>
            </DialogHeader>
            <DialogBody>
              <p className="text-label text-text-secondary">Pick the outcome for this route out of the decision.</p>
            </DialogBody>
            <DialogFooter>
              <Button variant="secondary" onClick={() => chooseBranch('no')}>No</Button>
              <Button onClick={() => chooseBranch('yes')}>Yes</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Change a lane's department — clicking the lane name. Warns how many steps move with it. */}
      {laneRename && (() => {
        const count = flow?.nodes.filter((n) => n.pool === 'company' && n.department_id === laneRename.deptId).length ?? 0
        return (
          <Dialog open onOpenChange={(next) => { if (!next) setLaneRename(null) }}>
            <DialogContent size="sm">
              <DialogHeader>
                <DialogTitle>Change lane&rsquo;s department</DialogTitle>
              </DialogHeader>
              <DialogBody>
                <p className="text-label text-text-secondary mb-3">
                  Re-point <span className="font-medium text-text-primary">{laneRename.name}</span> at another department.{' '}
                  {count > 0
                    ? <>All <span className="font-medium text-warning">{count} step{count !== 1 ? 's' : ''}</span> in this lane will move to it.</>
                    : <>This lane is empty.</>}
                </p>
                <DepartmentSelect
                  inline value="" departments={departments} onChange={applyLaneRename}
                  placeholder="Move to which department"
                  lockedReason={(id) => (id === laneRename.deptId ? 'Current lane' : null)}
                />
              </DialogBody>
              {count === 0 && (
                <DialogFooter>
                  <Button variant="danger" onClick={removeLane}>Remove this empty lane</Button>
                </DialogFooter>
              )}
            </DialogContent>
          </Dialog>
        )
      })()}

      {/* Lane "+" picker — choose what kind of step to drop into the chosen lane. */}
      {laneAdd && (
        <Dialog open onOpenChange={(next) => { if (!next) setLaneAdd(null) }}>
          <DialogContent size="sm">
            <DialogHeader>
              <DialogTitle>Add to this lane</DialogTitle>
            </DialogHeader>
            <DialogBody className="space-y-0.5">
              {LANE_ADD_KINDS.map((k) => (
                <button key={k} onClick={() => addLaneKind(k)}
                  className={`w-full flex items-start gap-2.5 px-2.5 py-2 rounded-lg hover:bg-surface-control text-left transition-colors ${FOCUS}`}>
                  <span className="text-primary-text mt-0.5">{KIND_META[k].icon}</span>
                  <span className="min-w-0">
                    <span className="block text-meta font-medium text-text-primary">{KIND_META[k].label}</span>
                    <span className="block text-meta text-text-muted">{KIND_META[k].hint}</span>
                  </span>
                </button>
              ))}
            </DialogBody>
          </DialogContent>
        </Dialog>
      )}

      <ConfirmDialog
        open={showDeleteMap}
        danger
        title="Delete this entire map?"
        message={`This permanently deletes “${map.name}” and everything in it — all steps, connections, documents and saved versions. This cannot be undone.`}
        confirmLabel="Delete map"
        loading={deletingMap}
        onConfirm={deleteMap}
        onCancel={() => { if (!deletingMap) setShowDeleteMap(false) }}
      />
    </div>
  )
}

// ─── Reference-a-map picker ──────────────────────────────────────────────────
function ReferenceMapModal({ orgId, excludeId, onClose, onPick }: {
  orgId: string; excludeId: string; onClose: () => void; onPick: (m: { id: string; name: string }) => void
}) {
  const [maps, setMaps] = useState<ProcessMapSummary[] | null>(null)
  const [q, setQ] = useState('')
  useEffect(() => { processHierarchyApi.listMaps(orgId).then(setMaps).catch(() => setMaps([])) }, [orgId])
  const query = q.trim().toLowerCase()
  const filtered = (maps ?? []).filter((m) => m.id !== excludeId && m.name.toLowerCase().includes(query))
  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><LinkIcon size={16} /> Reference a map</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search maps…" aria-label="Search maps" className="max-w-none" />
          <div>
            {maps === null ? (
              <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-primary-text" /></div>
            ) : filtered.length === 0 ? (
              <p className="text-meta text-text-muted text-center py-8">No other maps{q ? ' match' : ' yet'}.</p>
            ) : (
              <div className="space-y-0.5">
                {filtered.map((m) => (
                  <button key={m.id} onClick={() => onPick({ id: m.id, name: m.name })}
                    className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-surface-control text-left transition-colors ${FOCUS}`}>
                    <Workflow size={16} className="shrink-0 text-primary-text" />
                    <span className="truncate text-meta text-text-primary">{m.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <p className="text-meta text-text-muted">
            Drops an instance that opens the chosen map. Edits to that map show wherever it’s referenced.
          </p>
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}

function MenuItem({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left text-meta font-medium transition-colors ${FOCUS} ${danger ? 'text-danger hover:bg-danger-bg' : 'text-text-primary hover:bg-surface-control'}`}>
      <span className={danger ? 'text-danger' : 'text-text-secondary'}>{icon}</span> {label}
    </button>
  )
}

// ─── Save-as-template modal ──────────────────────────────────────────────────
function SaveTemplateModal({ orgId, mapId, mapName, onClose }: {
  orgId: string; mapId: string; mapName: string; onClose: () => void
}) {
  const [name, setName] = useState(`${mapName} template`)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  async function save() {
    if (!name.trim() || busy) return
    setBusy(true)
    try { await processHierarchyApi.saveAsTemplate(orgId, mapId, { name: name.trim() }); setDone(true); setTimeout(onClose, 900) }
    catch { toast.error('Could not save the template. Please try again.'); setBusy(false) }
  }
  return (
    <Dialog open onOpenChange={(next) => { if (!next && !busy) onClose() }}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Save as template</DialogTitle>
        </DialogHeader>
        {done ? (
          <DialogBody>
            <p className="text-success text-body inline-flex items-center gap-2 py-4"><Check size={16} /> Template saved.</p>
          </DialogBody>
        ) : (
          <>
            <DialogBody>
              <Label className="mb-2" htmlFor="save-template-name" required>Template name</Label>
              <Input id="save-template-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} className="max-w-none" />
              <p className="text-meta text-text-muted mt-2">Freezes this map’s current structure so you can spin up new maps from it later.</p>
            </DialogBody>
            <DialogFooter>
              <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
              <Button onClick={save} disabled={!name.trim()} loading={busy} loadingLabel="Saving">Save template</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ─── Diff panel ─────────────────────────────────────────────────────────────
const CHANGE_COLOR: Record<string, string> = { added: 'var(--success)', removed: 'var(--danger)', changed: 'var(--warning)' }
const FIELD_LABEL: Record<string, string> = {
  name: 'name', kind: 'type', status: 'status', description: 'description',
  responsible_user_id: 'responsible person', responsible_role_id: 'responsible role',
  parent_node_id: 'moved level', checklist: 'checklist', documents: 'documents',
  label: 'label', condition_kind: 'branch', source_node_id: 'source', target_node_id: 'target',
}

function DiffPanel({ diff, onClose, onJump }: {
  diff: MapDiff
  onClose: () => void
  onJump: (parentNodeId: string | null, nodeId: string | null, removed: boolean) => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return createPortal(
    <div className="fixed inset-0 z-60 pointer-events-none">
      <div className="absolute right-0 top-0 h-full w-full max-w-[400px] bg-surface shadow-xl border-l border-border-light flex flex-col pointer-events-auto animate-[slideInRight_.22s_ease-out]">
        <div className="flex items-center gap-2 px-4 py-4 border-b border-border-light">
          <GitCompare size={16} className="text-primary-text" />
          <span className="text-body font-medium text-text-primary">Changes</span>
          <span className="text-meta text-text-muted">{diff.summary.total_changes} total</span>
          <Tooltip label="Close"><Button variant="ghost" size="icon" onClick={onClose} aria-label="Close" className="ml-auto"><X size={16} /></Button></Tooltip>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 text-meta">
          {diff.summary.total_changes === 0 && (
            <p className="text-text-secondary text-center py-8">No differences between these two versions.</p>
          )}

          {diff.nodes.length > 0 && (
            <Section title="Nodes">
              {diff.nodes.map((n) => (
                <button key={n.id} onClick={() => onJump(n.parent_node_id, n.id, n.change === 'removed')}
                  className={`w-full text-left flex items-start gap-2 px-2 py-1.5 rounded-lg hover:bg-surface-sunken ${FOCUS}`}>
                  <span className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ background: CHANGE_COLOR[n.change] }} />
                  <span className="flex-1 min-w-0">
                    <span className="text-text-primary font-medium">{n.name}</span>
                    <span className="text-meta text-text-muted ml-1.5 capitalize">{n.change}</span>
                    {n.fields.length > 0 && (
                      <span className="block text-meta text-text-muted">{n.fields.map((f) => FIELD_LABEL[f.field] ?? f.field).join(', ')}</span>
                    )}
                  </span>
                </button>
              ))}
            </Section>
          )}

          {diff.connections.length > 0 && (
            <Section title="Connections">
              {diff.connections.map((c) => (
                <button key={c.id} onClick={() => onJump(c.parent_node_id, null, false)}
                  className={`w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-surface-sunken ${FOCUS}`}>
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: CHANGE_COLOR[c.change] }} />
                  <span className="text-text-secondary capitalize">{c.change} connection</span>
                  {c.fields.length > 0 && <span className="text-meta text-text-muted">({c.fields.map((f) => FIELD_LABEL[f.field] ?? f.field).join(', ')})</span>}
                </button>
              ))}
            </Section>
          )}

          {diff.artifacts.length > 0 && (
            <Section title="Documents">
              {diff.artifacts.map((a) => (
                <div key={a.id} className="flex items-center gap-2 px-2 py-1.5">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: CHANGE_COLOR[a.change] }} />
                  <span className="text-text-primary">{a.name}</span>
                  <span className="text-meta text-text-muted capitalize">{a.change}</span>
                </div>
              ))}
            </Section>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-meta font-medium text-text-muted mb-1">{title}</p>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}

// ─── Visibility filter panel ──────────────────────────────────────────────
function VisibilityPanel({ flow, visible, onChange, onClose }: {
  flow: FlowLevel; visible: Set<string> | null; onChange: (s: Set<string> | null) => void; onClose: () => void
}) {
  const allIds = useMemo(() => flow.nodes.map((n) => n.id), [flow.nodes])
  const isShown = (id: string) => !visible || visible.has(id)
  const toggle = (id: string) => {
    const base = new Set(visible ?? allIds)
    if (base.has(id)) base.delete(id); else base.add(id)
    onChange(base.size === allIds.length ? null : base)
  }
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute right-0 top-[calc(100%+6px)] z-50 w-72 bg-surface border border-border-light rounded-lg shadow-lg p-3 animate-[popIn_.12s_ease-out]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-meta font-medium text-text-primary">Show nodes</span>
          <Button variant="secondary" size="sm" onClick={() => onChange(null)}>View all</Button>
        </div>
        <div className="max-h-64 overflow-y-auto space-y-0.5">
          {flow.nodes.map((n) => (
            <button key={n.id} onClick={() => toggle(n.id)}
              role="checkbox" aria-checked={isShown(n.id)}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-surface-sunken text-left text-meta ${FOCUS}`}>
              <span className={`w-4 h-4 rounded-xs border flex items-center justify-center shrink-0 ${isShown(n.id) ? 'bg-primary border-primary' : 'border-border'}`}>
                {isShown(n.id) && <Check size={12} className="text-primary-foreground" />}
              </span>
              <span className="text-primary-text shrink-0">{KIND_META[n.kind].icon}</span>
              <span className="truncate text-text-primary">{n.name}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  )
}

// ─── Versions panel ────────────────────────────────────────────────────────
function VersionsPanel({ orgId, mapId, canEdit, onClose, onRestored, onCompare }: {
  orgId: string; mapId: string; canEdit: boolean; onClose: () => void; onRestored: () => void
  onCompare: (base: string, target: string, baseLabel: string, targetLabel: string) => void
}) {
  const [snaps, setSnaps] = useState<SnapshotSummary[] | null>(null)
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [baseRef, setBaseRef] = useState('')
  const [targetRef, setTargetRef] = useState('live')
  const [confirmRestore, setConfirmRestore] = useState<SnapshotSummary | null>(null)
  const [restoring, setRestoring] = useState(false)

  const reload = useCallback(() => { processHierarchyApi.listSnapshots(orgId, mapId).then(setSnaps).catch(() => setSnaps([])) }, [orgId, mapId])
  useEffect(() => { reload() }, [reload])

  const refOptions = useMemo(
    () => [{ value: 'live', label: 'Live (working)' }, ...(snaps ?? []).map((s) => ({ value: s.id, label: s.label }))],
    [snaps],
  )
  const labelOf = (v: string) => refOptions.find((o) => o.value === v)?.label ?? v
  const canCompare = baseRef && targetRef && baseRef !== targetRef

  async function create() {
    if (!label.trim() || busy) return
    setBusy(true)
    try { await processHierarchyApi.createSnapshot(orgId, mapId, { label: label.trim() }); setLabel(''); reload() }
    catch { toast.error('Could not save this version.') }
    finally { setBusy(false) }
  }
  async function restore() {
    if (!confirmRestore) return
    setRestoring(true)
    try {
      await processHierarchyApi.restoreSnapshot(orgId, mapId, confirmRestore.id)
      setConfirmRestore(null); onClose(); onRestored()
    } catch { toast.error('Could not restore that version.'); setRestoring(false) }
  }

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute right-0 top-[calc(100%+6px)] z-50 w-80 bg-surface border border-border-light rounded-lg shadow-lg p-3 animate-[popIn_.12s_ease-out]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-meta font-medium text-text-primary">Saved versions</span>
          <Tooltip label="Close"><Button variant="ghost" size="icon" onClick={onClose} aria-label="Close"><X size={16} /></Button></Tooltip>
        </div>

        {/* Compare */}
        <div className="mb-3 pb-3 border-b border-border-light">
          <p className="text-meta font-medium text-text-muted mb-1.5">Compare (as-is → to-be)</p>
          <div className="flex items-center gap-1.5">
            <div className="flex-1 min-w-0">
              <StyledSelect value={baseRef} onChange={setBaseRef} placeholder="From…"
                options={refOptions} size="sm" />
            </div>
            <span className="text-text-muted text-meta shrink-0">→</span>
            <div className="flex-1 min-w-0">
              <StyledSelect value={targetRef} onChange={setTargetRef} placeholder="To…"
                options={refOptions} size="sm" />
            </div>
          </div>
          <Button variant="secondary" disabled={!canCompare} onClick={() => onCompare(baseRef, targetRef, labelOf(baseRef), labelOf(targetRef))}
            className="mt-2 w-full">
            <GitCompare size={16} /> Compare
          </Button>
        </div>

        {canEdit && (
          <div className="flex items-center gap-2 mb-3">
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="For example, as-is 2026" aria-label="Version name"
              onKeyDown={(e) => e.key === 'Enter' && create()} className="flex-1" />
            <Tooltip label="Save version">
              <Button size="icon" onClick={create} disabled={!label.trim()} loading={busy} aria-label="Save version">
                <Plus size={16} />
              </Button>
            </Tooltip>
          </div>
        )}
        <div className="max-h-64 overflow-y-auto space-y-1">
          {snaps === null ? <p className="text-meta text-text-muted py-2">Loading…</p>
            : snaps.length === 0 ? <p className="text-meta text-text-muted py-2">No versions saved yet.</p>
            : snaps.map((s) => (
              <div key={s.id} className="flex items-center gap-2 bg-surface-sunken border border-border-light rounded-[6px] px-2 py-1.5">
                <div className="flex-1 min-w-0">
                  <p className="text-meta font-medium text-text-primary truncate">{s.label}</p>
                  <p className="text-meta text-text-muted">{formatDate(s.created_at)}</p>
                </div>
                {canEdit && (
                  <Tooltip label="Restore this version">
                    <Button variant="secondary" size="sm" onClick={() => setConfirmRestore(s)} className="shrink-0">
                      <RotateCcw size={16} /> Restore
                    </Button>
                  </Tooltip>
                )}
              </div>
            ))}
        </div>
      </div>

      <ConfirmDialog
        open={!!confirmRestore}
        danger
        title="Restore this version?"
        message={confirmRestore ? `This replaces the current map with “${confirmRestore.label}”. Any unsaved changes to the live map will be lost.` : ''}
        confirmLabel="Restore version"
        loading={restoring}
        onConfirm={restore}
        onCancel={() => { if (!restoring) setConfirmRestore(null) }}
      />
    </>
  )
}
