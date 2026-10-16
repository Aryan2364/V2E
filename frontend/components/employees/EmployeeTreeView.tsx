'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlowProvider,
  useNodesState,
  useEdgesState,
  useReactFlow,
  useStore,
  type Node,
  type Edge,
  type NodeMouseHandler,
  type Viewport,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { Maximize2, Users, Zap } from 'lucide-react'
import { computeNodeColors } from '@/lib/org-chart-colors'
import { levelColors } from '@/lib/role-levels'
import { useFlowNav, CanvasScrollbars, FlowNavStyles } from '@/components/ui/flow-nav'
import {
  buildEmployeeForest,
  computeForestLayout,
  groupFreeRadicalsByDept,
  layoutFreeRadicals,
  NODE_W,
  NODE_H,
} from '@/lib/employee-tree'
import EmployeeNode, { type EmployeeNodeData } from './EmployeeNode'
import Tooltip from '@/components/ui/tooltip'
import type { Department, EmployeeProfile, EmployeeStatus } from '@/lib/types'

interface Props {
  /** Employees to actually render as nodes (after search + department filter). */
  employees: EmployeeProfile[]
  /**
   * The full (unfiltered) employee set, used to detect connections that were
   * filtered out — a hidden manager above or hidden reports below a shown node.
   * Defaults to `employees` (no filtering → no hidden neighbours).
   */
  allEmployees?: EmployeeProfile[]
  departments: Department[]
  /**
   * Open a profile. Supplied by the page so it can save the scroll position
   * before navigating (so "back" returns here in place). Falls back to a plain
   * router push.
   */
  onOpenEmployee?: (id: string) => void
}

interface HiddenInfo {
  hiddenManager: boolean
  hiddenReports: boolean
}

const statusDot: Record<EmployeeStatus, string> = {
  active: 'bg-success',
  inactive: 'bg-danger',
}

// Don't let the auto-fit / "Fit" zoom out past this — below it node text is
// unreadable, so we'd rather start readable (and let the user pan) than show an
// unusable overview where every card is a smudge.
const FIT_MIN_ZOOM = 0.65

// Persist the canvas position so navigating into a profile and back (browser
// back) restores the chart exactly as the user left it, rather than snapping
// back to a fresh fit.
const VIEWPORT_KEY = 'org-chart-viewport'

function readSavedViewport(): Viewport | null {
  try {
    const raw = sessionStorage.getItem(VIEWPORT_KEY)
    if (!raw) return null
    const v = JSON.parse(raw)
    if (
      typeof v?.x === 'number' &&
      typeof v?.y === 'number' &&
      typeof v?.zoom === 'number' &&
      Number.isFinite(v.x) &&
      Number.isFinite(v.y) &&
      Number.isFinite(v.zoom)
    ) {
      return v as Viewport
    }
  } catch {
    /* ignore malformed storage */
  }
  return null
}

function saveViewport(v: Viewport) {
  try {
    sessionStorage.setItem(VIEWPORT_KEY, JSON.stringify(v))
  } catch {
    /* storage unavailable — non-fatal */
  }
}

function initials(name: string): string {
  const p = name.trim().split(/\s+/)
  return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase() || '?'
}

function useIsDesktop() {
  const [desktop, setDesktop] = useState(true)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)')
    const update = () => setDesktop(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  return desktop
}

// ─── Free-radical cluster label (a tiny reactflow node) ─────────────────────────

function FrLabelNode({ data }: { data: { label: string; color: string } }) {
  return (
    <div className="inline-flex items-center gap-1.5 rounded-full bg-surface border border-border-light px-2.5 py-1 shadow-xs">
      <Zap size={11} className="text-warning" />
      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: data.color }} />
      <span className="text-[11px] font-medium text-text-secondary">Unlinked · {data.label}</span>
    </div>
  )
}

const nodeTypes = { employeeNode: EmployeeNode, frLabel: FrLabelNode }

// ─── Canvas (reactflow) ─────────────────────────────────────────────────────────

function Flow({
  nodes,
  edges,
  fitRef,
  onOpen,
}: {
  nodes: Node[]
  edges: Edge[]
  fitRef: { current: (() => void) | null }
  onOpen: (id: string) => void
}) {
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState(nodes)
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState(edges)
  const [interacted, setInteracted] = useState(false)
  const { setViewport } = useReactFlow()
  const paneW = useStore((s) => s.width)
  const paneH = useStore((s) => s.height)

  // Content bounding box — drives both the readable "top of the tree" framing
  // and the pan bounds.
  const bbox = useMemo(() => {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    nodes.forEach((n) => {
      minX = Math.min(minX, n.position.x)
      minY = Math.min(minY, n.position.y)
      maxX = Math.max(maxX, n.position.x + NODE_W)
      maxY = Math.max(maxY, n.position.y + NODE_H)
    })
    if (!Number.isFinite(minX)) return null
    return { minX, minY, maxX, maxY }
  }, [nodes])

  // Frame the chart at the TOP of the tree (roots near the top edge) at a
  // readable zoom, horizontally centered. This is what "load" and "Fit" both
  // do — a wide org never fits-to-screen readably, so instead of zooming out
  // to an unreadable smudge we anchor the top and let the user pan/zoom.
  const frameTop = useCallback(
    (duration: number) => {
      if (!bbox || !paneW || !paneH) return
      const contentW = bbox.maxX - bbox.minX
      const PAD_X = 80
      const zoom = Math.min(1, Math.max(FIT_MIN_ZOOM, paneW / (contentW + PAD_X * 2)))
      const centerX = (bbox.minX + bbox.maxX) / 2
      const TOP_PAD = 32
      setViewport(
        { x: paneW / 2 - centerX * zoom, y: TOP_PAD - bbox.minY * zoom, zoom },
        { duration },
      )
    },
    [bbox, paneW, paneH, setViewport],
  )

  // Expose Fit to the toolbar button rendered outside the provider.
  useEffect(() => {
    fitRef.current = () => frameTop(300)
    return () => {
      fitRef.current = null
    }
  }, [frameTop, fitRef])

  // Initial framing: restore the saved viewport (browser back returns here) or,
  // failing that, frame the top of the tree. Runs once, after the pane has been
  // measured.
  const didInit = useRef(false)
  useEffect(() => {
    if (didInit.current || !paneW || !paneH) return
    didInit.current = true
    const saved = readSavedViewport()
    if (saved) setViewport(saved, { duration: 0 })
    else frameTop(0)
  }, [paneW, paneH, frameTop, setViewport])

  // Shared Figma-style canvas navigation — the same pan / wheel-scroll / ⌘-scroll zoom / bounded
  // extent / smooth ease / faint scrollbars / auto-minimap the process map uses.
  const nav = useFlowNav(rfNodes)

  // Keep the canvas in sync with the data and re-frame when it actually changes
  // (e.g. a filter is applied) — but not on the first sync, which the initial
  // framing effect handles.
  const firstSync = useRef(true)
  useEffect(() => {
    setRfNodes(nodes)
    setRfEdges(edges)
    if (firstSync.current) {
      firstSync.current = false
      return
    }
    const t = setTimeout(() => frameTop(300), 50)
    return () => clearTimeout(t)
  }, [nodes, edges, setRfNodes, setRfEdges, frameTop])

  const onNodeClick: NodeMouseHandler = (_e, node) => {
    const id = (node.data as { empId?: string })?.empId
    if (id) onOpen(id)
  }

  return (
    <>
    <FlowNavStyles />
    <ReactFlow
      {...nav.flowProps}
      nodes={rfNodes}
      edges={rfEdges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={onNodeClick}
      onMoveStart={() => setInteracted(true)}
      onMoveEnd={(_e, vp) => saveViewport(vp)}
      nodeTypes={nodeTypes}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable
      minZoom={0.2}
      maxZoom={2.5}
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--border-light)" />
      <Panel position="bottom-center">
        <div
          className={`pointer-events-none select-none rounded-full border border-border-light bg-white/85 px-3 py-1 text-[11px] font-medium text-text-muted shadow-xs backdrop-blur transition-opacity duration-500 ${
            interacted ? 'opacity-0' : 'opacity-100'
          }`}
        >
          Scroll or drag to move · ⌘/Ctrl + scroll to zoom
        </div>
      </Panel>
      <Controls showInteractive={false} onFitView={() => frameTop(300)} />
      {!nav.isTouch && <CanvasScrollbars nodes={rfNodes} setInstant={nav.setInstant} />}
      {nav.needsMinimap && (
        <MiniMap nodeColor={() => 'var(--primary-text)'} maskColor="color-mix(in srgb, var(--text-primary) 5%, transparent)" pannable zoomable
          className="hidden! sm:block!" style={{ width: 180, height: 120 }} />
      )}
    </ReactFlow>
    </>
  )
}

// ─── Mobile card tree ───────────────────────────────────────────────────────────

function EmpCard({
  emp,
  color,
  onOpen,
  freeRadical,
  hidden,
}: {
  emp: EmployeeProfile
  color: string
  onOpen: (id: string) => void
  freeRadical?: boolean
  hidden?: HiddenInfo
}) {
  const name = emp.user?.name ?? 'Unknown'
  return (
    <button
      type="button"
      onClick={() => onOpen(emp.id)}
      style={{ borderLeft: `4px solid ${color}` }}
      className={`relative w-full flex items-center gap-2.5 bg-surface rounded-xl border px-3 py-2.5 text-left hover:shadow-xs transition-shadow ${
        freeRadical ? 'border-dashed border-border' : 'border-border-light'
      }`}
    >
      {hidden?.hiddenManager && (
        <Tooltip label="Reports to someone hidden by the current filter">
        <span
          className="pointer-events-none absolute top-[-6px] left-6 w-2 h-2 rounded-full border-2 border-white shadow-xs"
          style={{ backgroundColor: color }}
        />
        </Tooltip>
      )}
      {hidden?.hiddenReports && (
        <Tooltip label="Has reports hidden by the current filter">
        <span
          className="pointer-events-none absolute bottom-[-6px] left-6 w-2 h-2 rounded-full border-2 border-white shadow-xs"
          style={{ backgroundColor: color }}
        />
        </Tooltip>
      )}
      <span
        className="w-9 h-9 shrink-0 rounded-full inline-flex items-center justify-center text-[11px] font-medium text-white"
        style={{ backgroundColor: color }}
      >
        {initials(name)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDot[emp.status]}`} />
          <span className="block text-sm font-medium text-text-primary truncate">{name}</span>
        </span>
        <span className="flex items-center gap-1.5 mt-0.5">
          <span className="text-xs text-text-muted truncate">{emp.role?.title ?? 'No role'}</span>
          {emp.role?.level && (
            <span
              className={`inline-flex items-center rounded-full px-1.5 py-px text-[10px] font-medium capitalize shrink-0 ${levelColors[emp.role.level]}`}
            >
              {emp.role.level}
            </span>
          )}
        </span>
      </span>
    </button>
  )
}

function MobileBranch({
  emp,
  forest,
  colorFor,
  onOpen,
  depth,
  hiddenOf,
}: {
  emp: EmployeeProfile
  forest: ReturnType<typeof buildEmployeeForest>
  colorFor: (deptId: string) => string
  onOpen: (id: string) => void
  depth: number
  hiddenOf: (id: string) => HiddenInfo | undefined
}) {
  const kids = forest.childrenOf.get(emp.user_id) ?? []
  return (
    <div>
      <EmpCard emp={emp} color={colorFor(emp.department_id)} onOpen={onOpen} hidden={hiddenOf(emp.id)} />
      {kids.length > 0 && (
        <div className="ml-4 mt-2 pl-3 border-l border-border-light flex flex-col gap-2">
          {kids.map((k) => (
            <MobileBranch
              key={k.id}
              emp={k}
              forest={forest}
              colorFor={colorFor}
              onOpen={onOpen}
              depth={depth + 1}
              hiddenOf={hiddenOf}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Main ───────────────────────────────────────────────────────────────────────

export default function EmployeeTreeView({ employees, allEmployees, departments, onOpenEmployee }: Props) {
  const router = useRouter()
  const isDesktop = useIsDesktop()
  const fitRef = useRef<(() => void) | null>(null)

  const colors = useMemo(() => computeNodeColors(departments), [departments])
  const colorFor = (deptId: string) => colors[deptId]?.base ?? 'var(--text-muted)'

  // Build the forest from the visible set, but classify roots against the FULL
  // org so a person whose manager/reports were merely filtered out stays in the
  // chart (as a standalone root carrying a dot) rather than being mislabelled
  // "unlinked". Also derive per-node hidden-neighbour flags for the dots.
  const { forest, hiddenInfo } = useMemo(() => {
    const all = allEmployees ?? employees
    const allByUser = new Map(all.map((e) => [e.user_id, e]))
    const totalReportsOf = new Map<string, number>()
    for (const e of all) {
      const mgr = e.reporting_to_user_id
      if (mgr && mgr !== e.user_id) totalReportsOf.set(mgr, (totalReportsOf.get(mgr) ?? 0) + 1)
    }
    const visibleUsers = new Set(employees.map((e) => e.user_id))
    const hasMgrInOrg = (e: EmployeeProfile) =>
      !!(e.reporting_to_user_id && e.reporting_to_user_id !== e.user_id && allByUser.has(e.reporting_to_user_id))
    const genuinelyUnlinked = (e: EmployeeProfile) =>
      !hasMgrInOrg(e) && (totalReportsOf.get(e.user_id) ?? 0) === 0

    const forest = buildEmployeeForest(employees, { isGenuinelyUnlinked: genuinelyUnlinked })

    const hiddenInfo = new Map<string, HiddenInfo>()
    for (const e of employees) {
      const hiddenManager = hasMgrInOrg(e) && !visibleUsers.has(e.reporting_to_user_id!)
      const visibleReports = forest.childrenOf.get(e.user_id)?.length ?? 0
      const totalReports = totalReportsOf.get(e.user_id) ?? 0
      hiddenInfo.set(e.id, { hiddenManager, hiddenReports: totalReports > visibleReports })
    }
    return { forest, hiddenInfo }
  }, [employees, allEmployees])

  const hasHiddenNeighbours = useMemo(
    () => Array.from(hiddenInfo.values()).some((h) => h.hiddenManager || h.hiddenReports),
    [hiddenInfo],
  )

  // Departments present in the current view, for the legend.
  const legend = useMemo(() => {
    const present = new Set(employees.map((e) => e.department_id))
    return departments.filter((d) => present.has(d.id))
  }, [employees, departments])

  const { nodes, edges } = useMemo(() => {
    const { pos, width, height } = computeForestLayout(forest)
    const clusters = groupFreeRadicalsByDept(forest.freeRadicals, departments)
    const { pos: frPos, labels } = layoutFreeRadicals(
      clusters,
      height,
      Math.max(width, 4 * 232),
    )

    const empById = new Map(employees.map((e) => [e.id, e]))
    const deptName = new Map(departments.map((d) => [d.id, d.name]))
    const toData = (emp: EmployeeProfile, freeRadical: boolean): EmployeeNodeData & { empId: string } => ({
      empId: emp.id,
      name: emp.user?.name ?? 'Unknown',
      roleTitle: emp.role?.title,
      level: emp.role?.level,
      department: emp.department?.name ?? deptName.get(emp.department_id),
      status: emp.status,
      color: colorFor(emp.department_id),
      freeRadical,
      hiddenManager: hiddenInfo.get(emp.id)?.hiddenManager,
      hiddenReports: hiddenInfo.get(emp.id)?.hiddenReports,
    })

    const ns: Node[] = []
    for (const [id, p] of Object.entries(pos)) {
      const emp = empById.get(id)
      if (emp) ns.push({ id, type: 'employeeNode', position: p, data: toData(emp, false), draggable: false })
    }
    for (const [id, p] of Object.entries(frPos)) {
      const emp = empById.get(id)
      if (emp) ns.push({ id, type: 'employeeNode', position: p, data: toData(emp, true), draggable: false })
    }
    labels.forEach((l, i) => {
      ns.push({
        id: `frlabel-${i}`,
        type: 'frLabel',
        position: { x: l.x, y: l.y },
        data: { label: l.dept?.name ?? 'No department', color: l.dept ? colorFor(l.dept.id) : 'var(--text-muted)' },
        draggable: false,
        selectable: false,
      })
    })

    const es: Edge[] = []
    forest.childrenOf.forEach((kids, mgrUserId) => {
      const mgr = forest.byUser.get(mgrUserId)
      if (!mgr) return
      kids.forEach((child) => {
        es.push({
          id: `e-${mgr.id}-${child.id}`,
          source: mgr.id,
          target: child.id,
          type: 'smoothstep',
          style: { stroke: colorFor(child.department_id), strokeWidth: 1.5, opacity: 0.5 },
        })
      })
    })
    return { nodes: ns, edges: es }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forest, employees, departments])

  const onOpen =
    onOpenEmployee ?? ((id: string) => router.push(`/settings/organization/employees/${id}`))

  if (employees.length === 0) {
    return (
      <div className="bg-surface border border-border-light rounded-card flex flex-col items-center justify-center py-12 text-center">
        <Users size={26} className="text-text-muted mb-2" />
        <p className="text-sm text-text-muted">No employees to chart.</p>
      </div>
    )
  }

  const freeRadicalClusters = groupFreeRadicalsByDept(forest.freeRadicals, departments)

  return (
    <div className="space-y-3">
      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-text-secondary">
        <span className="font-medium text-text-muted">Departments:</span>
        {legend.map((d) => (
          <span key={d.id} className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: colorFor(d.id) }} />
            {d.name}
          </span>
        ))}
        {forest.freeRadicals.length > 0 && (
          <span className="inline-flex items-center gap-1 text-text-muted">
            <Zap size={12} className="text-warning" /> unlinked = no manager &amp; no reports
          </span>
        )}
        {hasHiddenNeighbours && (
          <span className="inline-flex items-center gap-1.5 text-text-muted">
            <span className="w-2 h-2 rounded-full bg-text-muted border border-surface shadow-xs" />
            dot = connection hidden by filter (above = manager, below = reports)
          </span>
        )}
        {isDesktop && (
          <span className="ml-auto hidden items-center gap-3 md:inline-flex">
            <span className="text-text-muted">Drag to pan · Ctrl/⌘ + scroll or pinch to zoom</span>
            <button
              type="button"
              onClick={() => fitRef.current?.()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border-light bg-surface px-2.5 py-1 text-[11px] font-medium text-text-secondary transition-colors hover:bg-surface-sunken hover:text-text-primary"
            >
              <Maximize2 size={12} /> Fit
            </button>
          </span>
        )}
      </div>

      {isDesktop ? (
        <div
          className="rounded-card border border-border-light overflow-hidden bg-surface-sunken"
          style={{ height: 640 }}
        >
          <ReactFlowProvider>
            <Flow nodes={nodes} edges={edges} fitRef={fitRef} onOpen={onOpen} />
          </ReactFlowProvider>
        </div>
      ) : (
        <div className="space-y-4">
          {forest.connectedRoots.map((root) => (
            <div key={root.id} className="bg-surface-sunken border border-border-light rounded-card p-3">
              <MobileBranch
                emp={root}
                forest={forest}
                colorFor={colorFor}
                onOpen={onOpen}
                depth={0}
                hiddenOf={(id) => hiddenInfo.get(id)}
              />
            </div>
          ))}

          {freeRadicalClusters.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 mb-2 text-xs font-medium text-text-muted">
                <Zap size={13} className="text-warning" /> Free radicals (no manager &amp; no reports)
              </div>
              <div className="space-y-4">
                {freeRadicalClusters.map((c) => (
                  <div key={c.dept?.id ?? 'none'}>
                    <div className="flex items-center gap-1.5 mb-1.5 text-xs text-text-secondary">
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: c.dept ? colorFor(c.dept.id) : 'var(--text-muted)' }}
                      />
                      {c.dept?.name ?? 'No department'}
                    </div>
                    <div className="flex flex-col gap-2">
                      {c.people.map((e) => (
                        <EmpCard
                          key={e.id}
                          emp={e}
                          color={colorFor(e.department_id)}
                          onOpen={onOpen}
                          freeRadical
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
