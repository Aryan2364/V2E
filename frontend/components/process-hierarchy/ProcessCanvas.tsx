'use client'

import { useEffect, useCallback, useMemo, useRef, useState } from 'react'
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  Panel,
  useNodesState,
  useEdgesState,
  useReactFlow,
  useStore,
  useStoreApi,
  getRectOfNodes,
  getTransformForBounds,
  ReactFlowProvider,
  BackgroundVariant,
  MarkerType,
  ConnectionMode,
  type Node,
  type Edge,
  type Connection,
  type NodeMouseHandler,
  type EdgeMouseHandler,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { createPortal } from 'react-dom'
import { Trash2, X, Maximize2, Minimize2, Copy } from 'lucide-react'
import { nodeTypes, type ProcessNodeData } from './nodes'
import FloatingEdge, { FloatingStepEdge } from './floating-edge'
import { buildNested, type NodeMeta, type SubDesc } from './nested-render'
import { buildSwimlane, CONTENT_X, type LaneBand } from './swimlane-layout'
import StyledSelect from '@/components/ui/StyledSelect'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import Tooltip from '@/components/ui/tooltip'
import { useFlowNav, useIsTouchDevice, CanvasScrollbars, FlowNavStyles } from '@/components/ui/flow-nav'

const edgeTypes = { floating: FloatingEdge, floatingStep: FloatingStepEdge }
import type { FlowLevel, ProcessConditionKind, ProcessConnection, DiffChangeKind, ProcessPool } from '@/lib/api/process-hierarchy'

interface Props {
  flow: FlowLevel
  canEdit: boolean
  swimlane?: boolean // render the pool/lane layout instead of the free-form canvas
  onAddInLane?: (pool: ProcessPool, departmentId: string | null) => void // lane "+" in swimlane view
  onRenameLane?: (laneId: string, departmentId: string, currentName: string) => void // click a lane name → change its department
  onReorderLanes?: (laneIds: string[]) => void | Promise<void> // drag a lane's grip → new top→bottom order of department lanes
  onReorderPools?: (pools: ProcessPool[]) => void | Promise<void> // drag a pool's grip → new top→bottom order of pools
  onAppendFromNode?: (nodeId: string, pool: ProcessPool | null, departmentId: string | null, sourceSide?: string) => void // click a node's exit dot → append a connected step
  onDecisionConnect?: (source: string, target: string, sourceSide?: string, targetSide?: string) => void // drag FROM a decision → choose Yes/No in a pop-up
  onReassignLane?: (nodeId: string, pool: ProcessPool | null, departmentId: string | null, positionX: number) => void // drag a node onto another lane → change its pool/department (null pool = dropped in the no-lane area)
  selectedNodeId: string | null
  visibleNodeIds: Set<string> | null // null = show all
  diffStatus?: Record<string, DiffChangeKind> | null // when comparing versions
  onSelectNode: (nodeId: string) => void
  onDrill: (nodeId: string) => void
  onConnect: (source: string, target: string, condition: ProcessConditionKind, sourceSide?: string, targetSide?: string) => void
  onNodeDragStop: (nodeId: string, x: number, y: number) => void
  onUpdateConnection?: (id: string, dto: { label?: string; condition_kind?: ProcessConditionKind }) => void
  onDeleteConnection?: (id: string) => void
  // Box-select support: persist a group's new canvas positions, and delete a group.
  onNodesMove?: (positions: { id: string; position_x: number; position_y: number }[]) => void | Promise<void>
  // A box-selected group dragged onto other lane(s) → reassign each node's pool/department (+ x).
  onNodesReassign?: (items: { id: string; pool: ProcessPool | null; department_id: string | null; position_x: number; position_y: number }[]) => void | Promise<void>
  onDeleteNodes?: (ids: string[]) => Promise<void> | void
  // Rendered as the rightmost item in the canvas's top-right control cluster
  // (used to float the page's "Add step" primary over the canvas).
  topRightExtra?: React.ReactNode
  // Phase-3: fetch an area's inner flow so it can be unfolded inline — either a
  // referenced map (getFlow(mapId, null)) or a drill-down container (getFlow(mapId, nodeId)).
  loadFlowAt?: (mapId: string, parentNodeId: string | null) => Promise<FlowLevel>
  // Preview a document (input/output) clicked straight on the canvas.
  onOpenDoc?: (artifactId: string) => void
  // Filled by the canvas with a fn that returns the flow-coords at the centre of what's
  // on screen right now — so a newly added node lands where the user is looking.
  spawnCenterRef?: React.MutableRefObject<(() => { x: number; y: number }) | null>
  // Filled with the auto-layout position every node WOULD get, so the page can bake unfrozen
  // (legacy) nodes into stored positions once — freezing the layout so edits never re-flow it.
  autoPositionsRef?: React.MutableRefObject<Record<string, { x: number; y: number }> | null>
  // Lets the page trigger a PNG export from its ⋯ menu (the button no longer sits on the canvas).
  exportPngRef?: React.MutableRefObject<(() => void) | null>
  // Copy the given nodes to the clipboard (from the multi-select action bar).
  onCopyNodes?: (ids: string[]) => void
  // Paste the clipboard into the current level (Ctrl/Cmd+V).
  onPaste?: () => void
  // Open a different map (clicking an unfolded inline child drills into its own map).
  onOpenMap?: (mapId: string) => void
}

const DRILLABLE = new Set(['container', 'subprocess'])

// Fit whenever a level loads/changes. maxZoom 1 keeps sparse maps from blowing up
// past 100%; the uniform padding also keeps the top row clear of the floating
// hint toast and Add-step button.
// minZoom 0.6 keeps node text legible after a fit — on a big map it won't cram
// everything in (you pan), but nothing shrinks to an unreadable size.
const FIT_OPTIONS = { padding: 0.2, minZoom: 0.6, maxZoom: 1, duration: 300 }
// Below this zoom, unfolded areas fold back to boxes (semantic zoom). Kept under the
// fit minZoom (0.6) so auto-fitting an expand never trips it.
const LOD_THRESHOLD = 0.5

function Inner({
  flow, canEdit, swimlane = false, onAddInLane, onRenameLane, onReorderLanes, onReorderPools, onAppendFromNode, onDecisionConnect, onReassignLane, selectedNodeId, visibleNodeIds, diffStatus,
  onSelectNode, onDrill, onConnect, onNodeDragStop, onUpdateConnection, onDeleteConnection,
  onNodesMove, onNodesReassign, onDeleteNodes, topRightExtra, loadFlowAt, onOpenMap, onOpenDoc, spawnCenterRef, autoPositionsRef, onCopyNodes, onPaste, exportPngRef,
}: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const [edgeEdit, setEdgeEdit] = useState<{ conn: ProcessConnection; x: number; y: number; label: string } | null>(null)
  // On touch (phone/iPad) nodes must NOT be draggable — a finger tap should drill/open, not drag.
  // A node's own `draggable` flag overrides ReactFlow's nodesDraggable, so the layout builders below
  // need this too (not just the flow-level prop).
  const isTouch = useIsTouchDevice()

  // Inline expand/collapse of referenced areas (Phase-3 spike).
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [childFlows, setChildFlows] = useState<Record<string, FlowLevel>>({})
  const fetchSub = useCallback((desc: SubDesc) => {
    if (childFlows[desc.contentKey] || !loadFlowAt) return
    const p = desc.linkedMapId ? loadFlowAt(desc.linkedMapId, null) : loadFlowAt(desc.mapId, desc.nodeId)
    p.then((f) => setChildFlows((c) => ({ ...c, [desc.contentKey]: f }))).catch(() => {})
  }, [childFlows, loadFlowAt])
  const toggleExpand = useCallback((renderedId: string, desc: SubDesc) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(renderedId)) next.delete(renderedId)
      else { next.add(renderedId); fetchSub(desc) }
      return next
    })
  }, [fetchSub])

  const connById = useMemo(() => new Map(flow.connections.map((c) => [c.id, c])), [flow.connections])
  const kindById = useMemo(() => new Map(flow.nodes.map((n) => [n.id, n.kind])), [flow.nodes])

  // Semantic zoom: this only flips when the zoom crosses the LOD threshold (the
  // selector returns a boolean, so panning/fine zooming doesn't re-render the tree).
  const lodCollapse = useStore((s) => s.transform[2] < LOD_THRESHOLD)

  // Recursive nested render (top level + any unfolded areas, to any depth) — OR the
  // swimlane layout (pools + department lanes) when the Swimlane view is on.
  const metaRef = useRef<NodeMeta>({})
  const laneBandsRef = useRef<LaneBand[]>([])

  // ── Reorder swimlanes / pools by dragging a band's grip. Track the pointer over the band DOM
  // rects; on release, persist the new top→bottom order. A thin blue line marks the drop slot. ──
  const [reorderDrag, setReorderDrag] = useState<{ kind: 'lane' | 'pool'; indicatorY: number | null } | null>(null)
  const bandRects = useCallback((kind: 'lane' | 'pool') => {
    const rectOf = (el: HTMLElement) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, mid: r.top + r.height / 2 } }
    const out: { key: string; top: number; bottom: number; mid: number }[] = []
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('.react-flow__node'))) {
      const id = el.getAttribute('data-id') || ''
      if (kind === 'lane') { if (id.startsWith('band::lane:')) out.push({ key: id.slice('band::lane:'.length), ...rectOf(el) }) }
      else if (id === 'band::pool:customer') out.push({ key: 'customer', ...rectOf(el) })
      else if (id === 'band::pool:company') out.push({ key: 'company', ...rectOf(el) })
      else if (id === 'band::pool:vendor') out.push({ key: 'vendor', ...rectOf(el) })
    }
    return out.sort((a, b) => a.top - b.top)
  }, [])
  const beginReorder = useCallback((e: React.PointerEvent, kind: 'lane' | 'pool', id: string) => {
    if (!canEdit) return
    e.preventDefault(); e.stopPropagation()
    const dropSlotTop = (clientY: number) => {
      const all = bandRects(kind)
      let idx = all.length
      for (let i = 0; i < all.length; i++) { if (clientY < all[i].mid) { idx = i; break } }
      return idx < all.length ? all[idx].top : (all[all.length - 1]?.bottom ?? clientY)
    }
    setReorderDrag({ kind, indicatorY: null })
    const move = (ev: PointerEvent) => setReorderDrag({ kind, indicatorY: dropSlotTop(ev.clientY) })
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      setReorderDrag(null)
      const rects = bandRects(kind).filter((r) => r.key !== id)
      let insert = rects.length
      for (let i = 0; i < rects.length; i++) { if (ev.clientY < rects[i].mid) { insert = i; break } }
      const order = rects.map((r) => r.key); order.splice(insert, 0, id)
      if (kind === 'lane') {
        const laneByDept = new Map(flow.lanes.map((l) => [l.department_id, l.id]))
        const laneIds = order.map((d) => laneByDept.get(d)).filter((x): x is string => !!x)
        if (laneIds.length) onReorderLanes?.(laneIds)
      } else {
        onReorderPools?.(order as ProcessPool[])
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up, { once: true })
  }, [canEdit, bandRects, flow.lanes, onReorderLanes, onReorderPools])
  const onLaneReorderStart = useCallback((e: React.PointerEvent, departmentId: string) => beginReorder(e, 'lane', departmentId), [beginReorder])
  const onPoolReorderStart = useCallback((e: React.PointerEvent, pool: string) => beginReorder(e, 'pool', pool), [beginReorder])

  const { rfNodes, rfEdges } = useMemo(() => {
    if (swimlane) {
      const built = buildSwimlane(flow, {
        selectedNodeId, canEdit, isTouch, diffStatus: diffStatus ?? null, onEdit: onSelectNode, onAddInLane, onRenameLane,
        onLaneReorderStart: canEdit ? onLaneReorderStart : undefined,
        onPoolReorderStart: canEdit ? onPoolReorderStart : undefined,
      })
      metaRef.current = built.meta
      laneBandsRef.current = built.laneBands
      if (autoPositionsRef) autoPositionsRef.current = built.autoPositions
      return { rfNodes: built.nodes, rfEdges: built.edges }
    }
    laneBandsRef.current = []
    const built = buildNested(flow, {
      childFlows, expandedIds, currentMapId: flow.map_id, canEdit, isTouch,
      selectedNodeId, diffStatus: diffStatus ?? null, visibleNodeIds,
      onEdit: onSelectNode, onToggleExpand: toggleExpand, onOpenDoc, lodCollapse,
    })
    metaRef.current = built.meta
    return { rfNodes: built.nodes, rfEdges: built.edges }
  }, [swimlane, onAddInLane, onRenameLane, onLaneReorderStart, onPoolReorderStart, flow, childFlows, expandedIds, canEdit, isTouch, selectedNodeId, diffStatus, visibleNodeIds, onSelectNode, toggleExpand, onOpenDoc, lodCollapse])

  useEffect(() => { setNodes(rfNodes) }, [rfNodes, setNodes])
  useEffect(() => { setEdges(rfEdges) }, [rfEdges, setEdges])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setEdgeEdit(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const { getNodes, fitView } = useReactFlow()

  // Expose the flow-coords at the centre of the visible pane, read imperatively (no
  // re-render) from the store's live transform + pane size. Used to place new nodes.
  const storeApi = useStoreApi()
  useEffect(() => {
    if (!spawnCenterRef) return
    spawnCenterRef.current = () => {
      const { width, height, transform } = storeApi.getState()
      const [tx, ty, zoom] = transform
      return { x: (width / 2 - tx) / zoom, y: (height / 2 - ty) / zoom }
    }
    return () => { if (spawnCenterRef) spawnCenterRef.current = null }
  }, [spawnCenterRef, storeApi])

  // Box-select ("Select" mode): drag a marquee to grab several nodes, then drag the
  // group to reposition it or delete it together (with a warning).
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [confirmDelMany, setConfirmDelMany] = useState(false)
  const [deletingMany, setDeletingMany] = useState(false)

  const handleSelectionChange = useCallback(({ nodes: sel }: { nodes: Node[] }) => {
    setSelectedIds(sel.map((n) => n.id))
  }, [])
  // Which lane does a dropped node (by its vertical centre) belong to? Forgiving: if the centre
  // isn't strictly inside a lane but still falls within the pools' vertical span (a lane's padding,
  // or the small gap between two pools), snap to the NEAREST lane instead of rejecting the drop.
  // Only a drop truly BELOW every pool (or above them all) returns null — handled by the caller.
  const laneForCenter = useCallback((cy: number): LaneBand | null => {
    const bands = laneBandsRef.current
    if (!bands.length) return null
    const inside = bands.find((b) => cy >= b.yTop && cy < b.yBottom)
    if (inside) return inside
    const top = Math.min(...bands.map((b) => b.yTop))
    const bottom = Math.max(...bands.map((b) => b.yBottom))
    if (cy < top || cy > bottom) return null
    let best: LaneBand | null = null, bestD = Infinity
    for (const b of bands) {
      const d = cy < b.yTop ? b.yTop - cy : cy > b.yBottom ? cy - b.yBottom : 0
      if (d < bestD) { bestD = d; best = b }
    }
    return best
  }, [])

  const handleSelectionDragStop = useCallback(async (_: React.MouseEvent, dragged: Node[]) => {
    if (!swimlane) {
      onNodesMove?.(dragged.map((n) => ({ id: n.id, position_x: n.position.x, position_y: n.position.y })))
      return
    }
    // Swimlane: reassign each node to the lane it landed in — same rules as a single-node drag,
    // applied per node. Nodes that changed lane go through the batch reassign (pool/dept + x);
    // ones that stayed in place (or a lane-less node moved within the loose area) just save
    // their position; a pooled node dropped in the gap between lanes snaps back.
    const reassigns: { id: string; pool: ProcessPool | null; department_id: string | null; position_x: number; position_y: number }[] = []
    const moves: { id: string; position_x: number; position_y: number }[] = []
    const poolsBottom = laneBandsRef.current.length ? Math.max(...laneBandsRef.current.map((b) => b.yBottom)) : 0
    for (const node of dragged) {
      if (node.id.includes('::')) continue
      const cur = flow.nodes.find((n) => n.id === node.id)
      if (!cur) continue
      const cy = node.position.y + 48
      const newX = Math.max(CONTENT_X, Math.round(node.position.x))
      const band = laneForCenter(cy)
      if (band) {
        if (band.pool !== (cur.pool ?? null) || band.deptId !== (cur.department_id ?? null)) {
          reassigns.push({ id: node.id, pool: band.pool, department_id: band.deptId, position_x: newX, position_y: node.position.y })
        } else {
          moves.push({ id: node.id, position_x: newX, position_y: node.position.y })
        }
      } else if (!cur.pool) {
        moves.push({ id: node.id, position_x: newX, position_y: Math.round(node.position.y) })
      } else if (laneBandsRef.current.length && cy >= poolsBottom) {
        // Dropped in the no-lane area below the pools → make it lane-less.
        reassigns.push({ id: node.id, pool: null, department_id: null, position_x: newX, position_y: node.position.y })
      }
    }
    if (moves.length) await onNodesMove?.(moves)
    if (reassigns.length) await onNodesReassign?.(reassigns)
    // If nothing was persisted (e.g. the whole group was dropped in a gap), no rebuild fires — so
    // re-snap the dragged nodes back to their computed spots. Any persist triggers a rebuild that
    // already resets every node.
    if (!moves.length && !reassigns.length) setNodes(rfNodes)
  }, [swimlane, flow.nodes, onNodesMove, onNodesReassign, setNodes, rfNodes, laneForCenter])
  const clearSelection = useCallback(() => {
    setNodes((nds) => nds.map((n) => (n.selected ? { ...n, selected: false } : n)))
    setSelectedIds([])
  }, [setNodes])

  // Whole ⇄ Grouped: unfold every area on this level in place, or fold everything back.
  // An "area" is a referenced map OR a drill-down container with children.
  const topAreas = useMemo(
    () => flow.nodes.filter((n) => n.linked_map_id || (DRILLABLE.has(n.kind) && (n.child_count ?? 0) > 0)),
    [flow.nodes],
  )
  const anyExpanded = expandedIds.size > 0
  const fitOnNextExpand = useRef(false)
  const toggleAll = useCallback(() => {
    fitOnNextExpand.current = true
    if (anyExpanded) { setExpandedIds(new Set()); return }
    setExpandedIds(new Set(topAreas.map((n) => n.id)))
    for (const n of topAreas) {
      fetchSub(n.linked_map_id
        ? { contentKey: `map:${n.linked_map_id}`, linkedMapId: n.linked_map_id, mapId: flow.map_id, nodeId: n.id }
        : { contentKey: `node:${flow.map_id}:${n.id}`, linkedMapId: null, mapId: flow.map_id, nodeId: n.id })
    }
  }, [anyExpanded, topAreas, fetchSub, flow.map_id])

  // Figma-style canvas navigation (pan / wheel-scroll / ⌘-scroll zoom / bounded extent / smooth
  // ease / faint scrollbars / touch), shared verbatim with the department + employee trees.
  // Marquee-select (drag empty space = selection box) is on in edit mode on mouse/trackpad; the
  // hook turns it off on touch so one-finger drag pans instead. Pan on a mouse is then via
  // wheel / two-finger scroll, the scrollbars, hold-Space, or middle/right-drag.
  const nav = useFlowNav(nodes, { marquee: canEdit })

  // Re-fit the view each time we enter a new level (initial load, drill in, or
  // drill out). Keyed on the level id so dragging/adding within a level never
  // yanks the viewport. Double rAF lets the new nodes mount + measure first.
  const levelKey = flow.breadcrumb.length ? flow.breadcrumb[flow.breadcrumb.length - 1].id : 'root'
  useEffect(() => {
    let inner = 0
    const outer = requestAnimationFrame(() => { inner = requestAnimationFrame(() => fitView(FIT_OPTIONS)) })
    return () => { cancelAnimationFrame(outer); if (inner) cancelAnimationFrame(inner) }
  }, [levelKey, swimlane, fitView])

  // Copy / paste with the keyboard — Ctrl on Windows/Linux, ⌘ on Mac. Copies the box
  // selection, or the single selected node if there's no box selection. Ignored while
  // typing in a field so it never clobbers normal text copy/paste.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      const k = e.key.toLowerCase()
      if (k === 'c' && onCopyNodes) {
        const ids = selectedIds.length ? selectedIds : selectedNodeId ? [selectedNodeId] : []
        if (ids.length) { e.preventDefault(); onCopyNodes(ids) }
      } else if (k === 'v' && onPaste) {
        e.preventDefault(); onPaste()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedIds, selectedNodeId, onCopyNodes, onPaste])

  // Only re-fit the viewport on a *bulk* unfold/fold (the Whole toggle). Expanding a
  // single area leaves the viewport where it is, so it grows in place instead of the
  // whole canvas appearing to jump.
  const expandKey = useMemo(() => Array.from(expandedIds).sort().join('|'), [expandedIds])
  const firstExpandFit = useRef(true)
  useEffect(() => {
    if (firstExpandFit.current) { firstExpandFit.current = false; return }
    if (!fitOnNextExpand.current) return
    fitOnNextExpand.current = false
    let inner = 0
    const outer = requestAnimationFrame(() => { inner = requestAnimationFrame(() => fitView({ ...FIT_OPTIONS, duration: 350 })) })
    return () => { cancelAnimationFrame(outer); if (inner) cancelAnimationFrame(inner) }
  }, [expandKey, fitView])

  // Blue-dot interactions (swimlane): drag a dot → connect to an existing node (onConnect);
  // a plain click on a dot (no drag) → open the "add a connected next step" picker. We tell
  // them apart by whether a connection was made and how far the pointer moved.
  const connectStartRef = useRef<{ nodeId: string; handleId: string | null; x: number; y: number } | null>(null)
  const madeConnRef = useRef(false)
  const appendGuardRef = useRef(0) // timestamp — suppresses the node click that can follow a dot click
  // Route a source→target connection: from a decision it asks Yes/No (created in the pop-up),
  // otherwise it's a plain sequence flow created immediately. sourceSide/targetSide = the dots the
  // designer dragged from / dropped on (remembered so they choose how the line attaches).
  const connectNodes = useCallback((source: string, target: string, sourceSide?: string, targetSide?: string) => {
    if (!source || !target || source === target) return
    const src = flow.nodes.find((n) => n.id === source)
    if (src?.kind === 'decision' && onDecisionConnect) { onDecisionConnect(source, target, sourceSide, targetSide); return }
    onConnect(source, target, 'none', sourceSide, targetSide)
  }, [onConnect, onDecisionConnect, flow.nodes])
  const handleConnectStart = useCallback((e: any, params: { nodeId: string | null; handleId: string | null }) => {
    madeConnRef.current = false
    const p = e?.touches?.[0] ?? e
    connectStartRef.current = { nodeId: params.nodeId ?? '', handleId: params.handleId ?? null, x: p?.clientX ?? 0, y: p?.clientY ?? 0 }
  }, [])
  const handleConnectEnd = useCallback((e: any) => {
    const start = connectStartRef.current
    connectStartRef.current = null
    if (madeConnRef.current || !start || !swimlane) return
    const p = e?.changedTouches?.[0] ?? e
    const moved = Math.hypot((p?.clientX ?? 0) - start.x, (p?.clientY ?? 0) - start.y) > 6
    if (!moved) {
      // A plain dot click (no drag) → open the "add a connected next step" picker.
      if (!onAppendFromNode) return
      const src = flow.nodes.find((n) => n.id === start.nodeId)
      if (!src) return
      appendGuardRef.current = Date.now()
      onAppendFromNode(start.nodeId, src.pool ?? null, src.department_id ?? null, start.handleId ?? undefined)
      return
    }
    // A real drag that didn't land on a handle dot: if it was released anywhere over another node,
    // connect the two — the whole node body is a drop target, not just its handle.
    const el = document.elementFromPoint(p?.clientX ?? 0, p?.clientY ?? 0) as HTMLElement | null
    const targetId = el?.closest('.react-flow__node')?.getAttribute('data-id') ?? null
    if (!targetId || targetId === start.nodeId || targetId.startsWith('band::') || targetId.includes('::')) return
    // Dropped on the node body (not a specific dot) → target side is auto.
    connectNodes(start.nodeId, targetId, start.handleId ?? undefined, undefined)
  }, [swimlane, onAppendFromNode, flow.nodes, connectNodes])

  // A tap on a drillable node (container / sub-process / linked map) goes *inside*
  // it; the small pencil (handled in the node) opens the edit panel instead. A tap
  // on a leaf node has nothing to enter, so it opens the edit panel.
  const handleNodeClick: NodeMouseHandler = useCallback((_, node) => {
    if (Date.now() - appendGuardRef.current < 350) return // a dot-click just opened the append picker
    if (node.id.includes('::')) {
      // A step shown inside an unfolded area. If it lives in another map (a reference),
      // open that map to edit it; a same-map drill-down child is view-only inline.
      const m = metaRef.current[node.id]
      if (m && m.mapId !== flow.map_id && onOpenMap) onOpenMap(m.mapId)
      return
    }
    const d = node.data as ProcessNodeData
    if (DRILLABLE.has(d.kind) || d.linkedMapName) onDrill(node.id)
    else onSelectNode(node.id)
  }, [onDrill, onSelectNode, onOpenMap, flow.map_id])
  const handleEdgeClick: EdgeMouseHandler = useCallback((evt, edge) => {
    if (!canEdit) return
    const conn = connById.get(edge.id)
    if (!conn) return
    evt.stopPropagation()
    setEdgeEdit({ conn, x: evt.clientX, y: evt.clientY, label: conn.label ?? '' })
  }, [canEdit, connById])

  const handleExport = useCallback(async () => {
    const all = getNodes()
    const viewport = document.querySelector('.react-flow__viewport') as HTMLElement | null
    if (!all.length || !viewport) return
    try {
      const PAD = 0.12
      const bounds = getRectOfNodes(all)
      const width = Math.min(4096, Math.max(320, Math.round(bounds.width * (1 + PAD * 2))))
      const height = Math.min(4096, Math.max(320, Math.round(bounds.height * (1 + PAD * 2))))
      const [tx, ty, scale] = getTransformForBounds(bounds, width, height, 0.2, 2, PAD)
      const { toPng } = await import('html-to-image')
      const dataUrl = await toPng(viewport, {
        backgroundColor: 'var(--surface)', width, height, pixelRatio: 2, cacheBust: true,
        style: { width: `${width}px`, height: `${height}px`, transform: `translate(${tx}px, ${ty}px) scale(${scale})` },
      })
      const link = document.createElement('a')
      link.href = dataUrl
      link.download = 'process-map.png'
      link.click()
    } catch {
      /* ignore */
    }
  }, [getNodes])

  // Let the page's ⋯ menu trigger PNG export (the button no longer sits on the canvas).
  useEffect(() => {
    if (!exportPngRef) return
    exportPngRef.current = handleExport
    return () => { if (exportPngRef) exportPngRef.current = null }
  }, [exportPngRef, handleExport])
  // Alignment snap: on drop, if the node's vertical CENTRE lines up (within a small threshold)
  // with another node's centre, snap it to match exactly — so nodes on the same "row" align and the
  // connectors between them stay dead-straight (the fixed-band feel, snapped to real nodes, not a
  // rigid grid). Returns the y to save for this node's current position/height.
  const snapAlignY = useCallback((node: Node): number => {
    const h = node.height ?? 96
    const cy = node.position.y + h / 2
    const THRESH = 55 // how close two nodes' centres must get before they snap level (generous, so "near" lines up)
    let bestCentre: number | null = null, bestDiff = THRESH
    for (const n of nodes) {
      if (n.id === node.id || n.id.includes('::') || n.id.startsWith('band::')) continue
      const nc = n.position.y + (n.height ?? 96) / 2
      const d = Math.abs(nc - cy)
      if (d < bestDiff) { bestDiff = d; bestCentre = nc }
    }
    return Math.round((bestCentre != null ? bestCentre : cy) - h / 2)
  }, [nodes])

  const handleDragStop = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (node.id.includes('::')) return
      const snappedY = snapAlignY(node)
      if (swimlane) {
        // Which lane did it land in (by the node's vertical centre)?
        const cy = snappedY + (node.height ?? 96) / 2
        const newX = Math.max(CONTENT_X, Math.round(node.position.x))
        const band = laneForCenter(cy)
        const cur = flow.nodes.find((n) => n.id === node.id)
        if (!cur) { setNodes(rfNodes); return }
        if (band) {
          // Inside a lane: vertical is locked to the lane, horizontal is free. Different
          // department → reassign (keep the new x); same lane → just save the new x (spacing).
          if (band.pool !== (cur.pool ?? null) || band.deptId !== (cur.department_id ?? null)) {
            onReassignLane?.(node.id, band.pool, band.deptId, newX)
          } else {
            // A lane node is rendered lane-relative (offset + stored y); convert the dropped absolute
            // y back so it stores the value that renders it right where it was dropped — no jump.
            onNodeDragStop(node.id, newX, Math.round(snappedY - band.offset))
          }
        } else if (!cur.pool) {
          // A lane-less node (e.g. a container) — placed freely: save both x and y.
          onNodeDragStop(node.id, newX, snappedY)
        } else if (laneBandsRef.current.length && cy >= Math.max(...laneBandsRef.current.map((b) => b.yBottom))) {
          // Dropped in the no-lane area BELOW all the pools → drop its pool (make it lane-less).
          onReassignLane?.(node.id, null, null, newX)
        } else {
          setNodes(rfNodes) // dropped in a gap between two pools → not a real drop zone, snap back
        }
        return
      }
      // Free canvas: a container (band) dropped on top of another container ties on z-index and can
      // end up hidden behind the other's opaque frame — looking like it vanished. If it lands
      // overlapping another top-level container, nudge it straight down until it's clear, so it's
      // always visible where it's dropped.
      let finalY = snappedY
      if (node.type === 'band') {
        const dim = (n: Node) => ({
          w: n.width ?? (typeof n.style?.width === 'number' ? (n.style!.width as number) : 220),
          h: n.height ?? (typeof n.style?.height === 'number' ? (n.style!.height as number) : 88),
        })
        const me = dim(node)
        const x = node.position.x
        const others = nodes.filter((n) => n.type === 'band' && n.id !== node.id && !n.id.includes('::'))
        const overlaps = (yy: number) => others.some((o) => {
          const od = dim(o)
          return x < o.position.x + od.w && x + me.w > o.position.x && yy < o.position.y + od.h && yy + me.h > o.position.y
        })
        for (let i = 0; overlaps(finalY) && i < 200; i++) finalY += 20
      }
      onNodeDragStop(node.id, node.position.x, finalY)
    },
    [swimlane, flow.nodes, onReassignLane, rfNodes, setNodes, onNodeDragStop, snapAlignY, nodes, laneForCenter],
  )
  const handleConnect = useCallback(
    (c: Connection) => {
      madeConnRef.current = true // a real connection was drawn on a handle — not a dot click
      connectNodes(c.source ?? '', c.target ?? '', c.sourceHandle ?? undefined, c.targetHandle ?? undefined)
    },
    [connectNodes],
  )
  // The flow reads left→right, so a line can't LEAVE a left dot (that's an input) or ENTER a
  // right dot (that's an output). Blocks those; top/bottom stay free (loops route over them).
  const isValidConnection = useCallback(
    (c: Connection) => c.sourceHandle !== 'left' && c.targetHandle !== 'right',
    [],
  )

  const edgeFromDecision = edgeEdit ? kindById.get(edgeEdit.conn.source_node_id) === 'decision' : false

  return (
    <>
    <FlowNavStyles />
    <ReactFlow
      {...nav.flowProps}
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      // Touch is view + drill only: nodes don't drag (so a tap opens/drills a container instead
      // of moving it) and can't be wired up. Editing gestures are mouse/trackpad only.
      nodesDraggable={canEdit && !nav.isTouch}
      nodesConnectable={canEdit && !nav.isTouch}
      elementsSelectable
      onNodeClick={handleNodeClick}
      onEdgeClick={handleEdgeClick}
      onNodeDragStop={handleDragStop}
      onSelectionChange={handleSelectionChange}
      onSelectionDragStop={handleSelectionDragStop}
      onConnect={handleConnect}
      onConnectStart={handleConnectStart}
      onConnectEnd={handleConnectEnd}
      isValidConnection={isValidConnection}
      // Loose: any of a node's four dots can be an input OR an output (the input/output rule is
      // enforced in isValidConnection), so the designer picks how each line attaches.
      connectionMode={ConnectionMode.Loose}
      onPaneClick={() => setEdgeEdit(null)}
      fitView
      fitViewOptions={FIT_OPTIONS}
      minZoom={0.2}
      maxZoom={2}
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--border-light)" />
      {/* fitViewOptions must be repeated here — the Controls fit button uses its own,
          not the flow-level fitViewOptions (else it zooms in past 100%). */}
      <Controls showInteractive={false} fitViewOptions={FIT_OPTIONS} />
      {/* Faint scrollbars — the visible pan affordance for a mouse user in the Figma model. */}
      {!nav.isTouch && <CanvasScrollbars nodes={nodes} setInstant={nav.setInstant} />}
      {/* Minimap floats bottom-right; hidden on the narrowest screens so it can't
          overlap the zoom / add controls, and toggleable when it's in the way. */}
      {nav.needsMinimap && (
        // Paint the swimlane bands transparent so the minimap shows the actual step nodes, not
        // the full-width lane stripes that would otherwise cover everything.
        <MiniMap
          nodeColor={(n) => (n.type === 'swimlane' ? 'transparent' : 'var(--primary-text)')}
          nodeStrokeColor={(n) => (n.type === 'swimlane' ? 'transparent' : 'var(--primary-text)')}
          maskColor="color-mix(in srgb, var(--text-primary) 5%, transparent)" pannable zoomable
          className="hidden! sm:block!" style={{ width: 180, height: 120 }} />
      )}

      {/* Selection action bar — appears once 2+ nodes are box-selected (edit only). Sits
          bottom-centre (controls are bottom-left, minimap bottom-right) so it never hides
          behind the top-right toolbar; raised z-index keeps it above any panel overlap. */}
      {canEdit && selectedIds.length >= 2 && (
        <Panel position="bottom-center" style={{ zIndex: 20 }}>
          <div className="flex items-center gap-2 rounded-lg bg-text-primary text-primary-foreground shadow-lg px-3 py-1.5 text-meta">
            <span className="font-medium">{selectedIds.length} selected</span>
            <span className="text-primary-foreground/40">·</span>
            <span className="text-primary-foreground/70">drag to move</span>
            {onCopyNodes && (
              <button onClick={() => onCopyNodes(selectedIds)}
                className="ml-1 inline-flex items-center gap-1 px-2 py-1 rounded-[6px] bg-surface/10 hover:bg-surface/20 font-medium transition-colors">
                <Copy size={12} /> Copy
              </button>
            )}
            {canEdit && onDeleteNodes && (
              <button onClick={() => setConfirmDelMany(true)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-[6px] bg-danger hover:bg-danger-hover font-medium transition-colors">
                <Trash2 size={12} /> Delete
              </button>
            )}
            <button onClick={clearSelection} aria-label="Clear selection"
              className="inline-flex items-center px-1.5 py-1 rounded-[6px] hover:bg-surface/10 text-primary-foreground/80"><X size={13} /></button>
          </div>
        </Panel>
      )}

      {/* The canvas keeps a single primary — Add step. "Whole/Grouped" only appears when this
          level actually has areas to unfold in place. Auto-arrange, PNG export, the minimap and
          multi-select all moved off the canvas (⋯ menu, or automatic) so the map is the hero. */}
      <Panel position="top-right">
        <div className="flex items-center gap-1.5">
          {!swimlane && topAreas.length > 0 && (
            <Tooltip label={anyExpanded ? 'Collapse all areas' : 'Unfold all areas in place'}>
              <button onClick={toggleAll} aria-pressed={anyExpanded}
                className={`hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 text-meta font-medium rounded-lg border shadow-xs focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 ${anyExpanded ? 'bg-primary-subtle border-primary text-primary-text' : 'bg-surface border-border-light text-text-secondary hover:text-text-primary hover:border-border'}`}>
                {anyExpanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />} <span className="hidden md:inline">{anyExpanded ? 'Grouped' : 'Whole'}</span>
              </button>
            </Tooltip>
          )}
          {topRightExtra}
        </div>
      </Panel>

      {/* Connection editor popover */}
      {edgeEdit && (
        <div
          className="fixed z-80 w-60 bg-surface border border-border-light rounded-lg shadow-dialog p-3"
          style={{ left: Math.min(edgeEdit.x, window.innerWidth - 260), top: Math.min(edgeEdit.y, window.innerHeight - 210) }}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-meta font-medium text-text-primary">Connection</span>
            <button onClick={() => setEdgeEdit(null)} aria-label="Close" className="text-text-muted hover:text-text-primary"><X size={14} /></button>
          </div>
          <label className="block text-meta font-medium text-text-secondary mb-1">Label</label>
          <input
            value={edgeEdit.label}
            onChange={(e) => setEdgeEdit({ ...edgeEdit, label: e.target.value })}
            placeholder="e.g. Approved"
            className="w-full px-2.5 py-1.5 text-meta rounded-lg border border-border focus:border-primary focus:outline-hidden mb-2"
          />
          {edgeFromDecision && (
            <div className="mb-2">
              <label className="block text-meta font-medium text-text-secondary mb-1">Branch</label>
              <StyledSelect
                value={edgeEdit.conn.condition_kind}
                onChange={(v) => {
                  const cond = v as ProcessConditionKind
                  // Keep the label in step with the branch — unless the user typed a custom one.
                  const defaultFor = (k: ProcessConditionKind) => (k === 'yes' ? 'Yes' : k === 'no' ? 'No' : '')
                  const wasDefault = !edgeEdit.label.trim() || edgeEdit.label.trim() === defaultFor(edgeEdit.conn.condition_kind)
                  setEdgeEdit({
                    ...edgeEdit,
                    label: wasDefault ? defaultFor(cond) : edgeEdit.label,
                    conn: { ...edgeEdit.conn, condition_kind: cond },
                  })
                }}
                options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }, { value: 'none', label: 'No condition' }]}
                size="sm"
              />
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                onUpdateConnection?.(edgeEdit.conn.id, { label: edgeEdit.label.trim(), condition_kind: edgeEdit.conn.condition_kind })
                setEdgeEdit(null)
              }}
              className="flex-1 inline-flex items-center justify-center px-3 py-1.5 text-meta font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary-hover"
            >
              Save
            </button>
            <button
              onClick={() => { onDeleteConnection?.(edgeEdit.conn.id); setEdgeEdit(null) }}
              aria-label="Delete connection"
              className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-lg border border-danger-border text-danger hover:bg-danger-bg"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      )}
    </ReactFlow>

    {/* Drop-slot indicator while dragging a lane/pool grip to reorder. */}
    {reorderDrag?.indicatorY != null && typeof document !== 'undefined' && createPortal(
      (() => {
        const pane = document.querySelector('.react-flow')?.getBoundingClientRect()
        if (!pane) return null
        return (
          <div style={{ position: 'fixed', left: pane.left, width: pane.width, top: reorderDrag.indicatorY - 1.5, height: 0, borderTop: '3px solid var(--primary)', boxShadow: '0 0 0 1px var(--primary-ring)', zIndex: 60, pointerEvents: 'none' }} />
        )
      })(),
      document.body,
    )}

    <ConfirmDialog
      open={confirmDelMany}
      danger
      title={`Delete ${selectedIds.length} step${selectedIds.length !== 1 ? 's' : ''}?`}
      message="This permanently deletes the selected steps and anything nested inside them. This cannot be undone."
      confirmLabel="Delete"
      loading={deletingMany}
      onConfirm={async () => {
        setDeletingMany(true)
        try { await onDeleteNodes?.(selectedIds) }
        finally { setDeletingMany(false); setConfirmDelMany(false); setSelectedIds([]) }
      }}
      onCancel={() => { if (!deletingMany) setConfirmDelMany(false) }}
    />
    </>
  )
}

export default function ProcessCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <Inner {...props} />
    </ReactFlowProvider>
  )
}
