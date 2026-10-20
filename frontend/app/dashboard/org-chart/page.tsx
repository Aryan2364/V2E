'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  getRectOfNodes,
  getTransformForBounds,
  type Node,
  type Edge,
  type NodeMouseHandler,
  BackgroundVariant,
  ReactFlowProvider,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { useAuth } from '@/lib/auth/context'
import { usePermissions } from '@/lib/auth/use-permissions'
import { getDepartments, updateDepartmentPosition } from '@/lib/api/departments'
import { getEmployees } from '@/lib/api/employees'
import { getUsers } from '@/lib/api/users'
import { computeTreeLayout } from '@/lib/org-chart-layout'
import { computeNodeColors, type NodeColor } from '@/lib/org-chart-colors'
import DeptNode, { type DeptNodeData } from '@/components/org-chart/DeptNode'
import DeptInfoPanel from '@/components/org-chart/DeptInfoPanel'
import DeptFormDrawer, { type DeptFormTarget } from '@/components/org-chart/DeptFormDrawer'
import DeptTableView from '@/components/org-chart/DeptTableView'
import ImportDepartmentsModal from '@/components/org-chart/ImportDepartmentsModal'
import ViewToggle, { type ViewMode } from '@/components/ui/ViewToggle'
import { useFlowNav, CanvasScrollbars, FlowNavStyles } from '@/components/ui/flow-nav'
import { toast } from '@/components/ui/sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/shell/page-header'
import type { Department, EmployeeProfile, User } from '@/lib/types'
import { DownloadIcon, NetworkIcon, PlusIcon, LayoutGridIcon, SearchIcon, CheckIcon, UploadIcon } from 'lucide-react'

const nodeTypes = { deptNode: DeptNode }
const STRUCTURE_LEAF = 'settings.organization.structure'

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

// ─── Builders ─────────────────────────────────────────────────────────────────

function buildNodes(
  departments: Department[],
  colors: Record<string, NodeColor>,
  opts: { canEdit: boolean; highlightIds: Set<string>; onEdit: (d: Department) => void },
): Node<DeptNodeData>[] {
  return departments.map((dept) => ({
    id: dept.id,
    type: 'deptNode',
    position: { x: dept.position_x, y: dept.position_y },
    data: {
      name: dept.name,
      headName: dept.head_user?.name,
      teamCount: dept._count?.employee_profiles ?? 0,
      roleCount: dept._count?.roles ?? 0,
      canEdit: opts.canEdit,
      highlighted: opts.highlightIds.has(dept.id),
      onEdit: () => opts.onEdit(dept),
      colors: colors[dept.id],
    },
    draggable: opts.canEdit,
  }))
}

function buildEdges(departments: Department[], colors: Record<string, NodeColor>): Edge[] {
  const ids = new Set(departments.map((d) => d.id))
  return departments
    .filter((d) => d.parent_department_id && ids.has(d.parent_department_id))
    .map((d) => ({
      id: `e-${d.parent_department_id}-${d.id}`,
      source: d.parent_department_id!,
      target: d.id,
      style: { stroke: colors[d.id]?.base ?? 'var(--border)', strokeWidth: 2, opacity: 0.55 },
      type: 'smoothstep',
    }))
}

// ─── Inner chart (must be inside ReactFlowProvider) ───────────────────────────

interface InnerProps {
  departments: Department[]
  colorMap: Record<string, NodeColor>
  canEdit: boolean
  orgId: string
  query: string
  onSelect: (d: Department) => void
  onEdit: (d: Department) => void
  onDepartmentsChange: (next: Department[]) => void
}

function OrgChartInner({
  departments,
  colorMap,
  canEdit,
  orgId,
  query,
  onSelect,
  onEdit,
  onDepartmentsChange,
}: InnerProps) {
  const { setCenter, getNodes } = useReactFlow()
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges] = useEdgesState([])
  const [exporting, setExporting] = useState(false)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')

  const highlightIds = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return new Set<string>()
    return new Set(departments.filter((d) => d.name.toLowerCase().includes(q)).map((d) => d.id))
  }, [query, departments])

  // Shared Figma-style canvas navigation — the same pan / wheel-scroll / ⌘-scroll zoom / bounded
  // extent / smooth ease / faint scrollbars / auto-minimap the process map uses.
  const nav = useFlowNav(nodes)

  // Rebuild nodes when the server data, edit-ability, colors or highlight set changes.
  // (Transient drag moves go through onNodesChange and are persisted on drag stop.)
  useEffect(() => {
    setNodes(buildNodes(departments, colorMap, { canEdit, highlightIds, onEdit }))
    setEdges(buildEdges(departments, colorMap))
  }, [departments, colorMap, canEdit, highlightIds, onEdit, setNodes, setEdges])

  // Center on the first search match.
  useEffect(() => {
    if (highlightIds.size === 0) return
    const first = departments.find((d) => highlightIds.has(d.id))
    if (first) setCenter(first.position_x + 90, first.position_y + 45, { zoom: 1, duration: 400 })
  }, [highlightIds, departments, setCenter])

  // Anchor the view on the top of the tree (root/Executive) at a readable zoom.
  // Fitting all nodes would shrink a large org chart to an unreadable speck, so we
  // open at the root and let the user pan / use the minimap to explore downward.
  const focusTop = useCallback(
    (duration = 0) => {
      if (!departments.length) return
      const ids = new Set(departments.map((d) => d.id))
      const root =
        departments
          .filter((d) => !d.parent_department_id || !ids.has(d.parent_department_id))
          .sort((a, b) => a.position_y - b.position_y)[0] ?? departments[0]
      setCenter(root.position_x + 90, root.position_y + 240, { zoom: 0.75, duration })
    },
    [departments, setCenter],
  )

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_, node) => {
      const dept = departments.find((d) => d.id === node.id)
      if (dept) onSelect(dept)
    },
    [departments, onSelect],
  )

  const handleDragStop = useCallback(
    async (_: React.MouseEvent, node: Node) => {
      if (!canEdit) return
      // Reflect immediately so panels/auto-arrange use fresh coords.
      onDepartmentsChange(
        departments.map((d) =>
          d.id === node.id ? { ...d, position_x: node.position.x, position_y: node.position.y } : d,
        ),
      )
      try {
        setSaveStatus('saving')
        await updateDepartmentPosition(orgId, node.id, node.position.x, node.position.y)
        setSaveStatus('saved')
        setTimeout(() => setSaveStatus('idle'), 1800)
      } catch {
        setSaveStatus('error')
      }
    },
    [canEdit, departments, onDepartmentsChange, orgId],
  )

  const handleAutoArrange = useCallback(async () => {
    const layout = computeTreeLayout(departments)
    const next = departments.map((d) => ({
      ...d,
      position_x: layout[d.id]?.x ?? d.position_x,
      position_y: layout[d.id]?.y ?? d.position_y,
    }))
    onDepartmentsChange(next)
    setTimeout(() => focusTop(400), 60)
    try {
      setSaveStatus('saving')
      await Promise.all(
        next.map((d) => updateDepartmentPosition(orgId, d.id, d.position_x, d.position_y)),
      )
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 1800)
    } catch {
      setSaveStatus('error')
    }
  }, [departments, onDepartmentsChange, orgId, focusTop])

  // Export the WHOLE chart (not just what's on screen) to a PNG. We snapshot the
  // `.react-flow__viewport` pane — which holds only the nodes + edges — so the
  // minimap/controls/background overlays never leak in (the old html2canvas pass
  // captured the container, mangling the minimap canvas). The pane is re-framed
  // to the full node bounds so nothing is clipped at the current zoom/pan.
  const handleExport = useCallback(async () => {
    const allNodes = getNodes()
    const viewport = document.querySelector('.react-flow__viewport') as HTMLElement | null
    if (!allNodes.length || !viewport) return
    setExporting(true)
    try {
      const PAD = 0.12
      const bounds = getRectOfNodes(allNodes)
      const width = Math.min(4096, Math.max(320, Math.round(bounds.width * (1 + PAD * 2))))
      const height = Math.min(4096, Math.max(320, Math.round(bounds.height * (1 + PAD * 2))))
      const [tx, ty, scale] = getTransformForBounds(bounds, width, height, 0.2, 2, PAD)
      const { toPng } = await import('html-to-image')
      const dataUrl = await toPng(viewport, {
        backgroundColor: 'var(--surface)',
        width,
        height,
        pixelRatio: 2,
        cacheBust: true,
        style: {
          width: `${width}px`,
          height: `${height}px`,
          transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
        },
      })
      const link = document.createElement('a')
      link.href = dataUrl
      link.download = 'department-structure.png'
      link.click()
    } catch {
      toast.error('Could not export the image. Please try again.')
    } finally {
      setExporting(false)
    }
  }, [getNodes])

  return (
    <div
      className="bg-surface border border-border-light rounded-card shadow-card overflow-hidden"
      style={{ height: 640 }}
    >
      {/* Tree-only toolbar: arranging the canvas + exporting an image only make
          sense for the chart, so these controls live here (not in the table view). */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border-light flex-wrap">
        <span className="text-body font-medium text-text-primary">Org chart</span>
        <span className="text-meta text-text-muted hidden sm:inline">
          Drag to pan · Ctrl/⌘ + scroll or pinch to zoom
        </span>

        {/* Save status */}
        {canEdit && (
          <span className="text-meta min-w-[90px] ml-1">
            {saveStatus === 'saving' && <span className="text-text-muted">Saving…</span>}
            {saveStatus === 'saved' && (
              <span className="text-success inline-flex items-center gap-1">
                <CheckIcon size={13} /> All changes saved
              </span>
            )}
            {saveStatus === 'error' && <span className="text-danger">Save failed</span>}
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          {canEdit && (
            <Button type="button" variant="secondary" onClick={handleAutoArrange}>
              <LayoutGridIcon size={16} /> Auto-arrange
            </Button>
          )}
          <Button type="button" variant="secondary" onClick={handleExport} disabled={exporting} loading={exporting} loadingLabel="Exporting">
            <DownloadIcon size={16} /> Export PNG
          </Button>
        </div>
      </div>

      <div style={{ height: 'calc(640px - 57px)' }}>
        <FlowNavStyles />
        <ReactFlow
          {...nav.flowProps}
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          nodeTypes={nodeTypes}
          nodesDraggable={canEdit}
          nodesConnectable={false}
          onNodeClick={handleNodeClick}
          onNodeDragStop={handleDragStop}
          onInit={() => focusTop(0)}
          minZoom={0.2}
          maxZoom={2}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--border-light)" />
          <Controls showInteractive={false} />
          {!nav.isTouch && <CanvasScrollbars nodes={nodes} setInstant={nav.setInstant} />}
          {nav.needsMinimap && (
            <MiniMap nodeColor={() => 'var(--primary-text)'} maskColor="color-mix(in srgb, var(--text-primary) 5%, transparent)" pannable zoomable
              className="hidden! sm:block!" style={{ width: 180, height: 120 }} />
          )}
        </ReactFlow>
      </div>
    </div>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ canEdit, onAdd }: { canEdit: boolean; onAdd: () => void }) {
  return (
    <div className="bg-surface border border-border-light rounded-card shadow-card flex flex-col items-center justify-center py-12 text-center">
      <div className="w-16 h-16 rounded-full bg-surface-control flex items-center justify-center mb-4">
        <NetworkIcon size={28} className="text-text-muted" />
      </div>
      <h2 className="text-card-heading font-medium text-text-primary">No departments yet</h2>
      <p className="text-text-secondary text-body mt-1 max-w-xs">
        {canEdit
          ? 'Add your first department to start building the structure.'
          : 'Departments will appear here once they are created.'}
      </p>
      {canEdit && (
        <Button type="button" className="mt-4" onClick={onAdd}>
          <PlusIcon size={16} /> Add department
        </Button>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OrgChartPage() {
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''
  const { can } = usePermissions()
  const canEdit = can(STRUCTURE_LEAF, 'edit')

  const [departments, setDepartments] = useState<Department[]>([])
  const [employees, setEmployees] = useState<EmployeeProfile[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)

  const [selected, setSelected] = useState<Department | null>(null)
  const [formTarget, setFormTarget] = useState<DeptFormTarget | null>(null)
  const [view, setView] = useState<ViewMode>('tree')
  const [query, setQuery] = useState('')
  const [showImport, setShowImport] = useState(false)

  const openEdit = useCallback((d: Department) => setFormTarget({ mode: 'edit', department: d }), [])
  const openCreate = useCallback(() => setFormTarget({ mode: 'create' }), [])

  const matchCount = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return departments.length
    return departments.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        (d.head_user?.name ?? '').toLowerCase().includes(q),
    ).length
  }, [query, departments])

  const colorMap = useMemo(() => computeNodeColors(departments), [departments])

  const reload = useCallback(async () => {
    if (!orgId) return
    const [depts, emps, usrs] = await Promise.all([
      getDepartments(orgId),
      getEmployees(orgId).catch(() => [] as EmployeeProfile[]),
      getUsers(orgId).catch(() => [] as User[]),
    ])
    setDepartments(depts)
    setEmployees(emps)
    setUsers(usrs)
  }, [orgId])

  useEffect(() => {
    if (!orgId) {
      setLoading(false)
      return
    }
    reload().finally(() => setLoading(false))
  }, [orgId, reload])

  // Keep the open info panel in sync with refreshed data.
  const selectedLive = selected ? departments.find((d) => d.id === selected.id) ?? null : null
  const members = useMemo(
    () => (selectedLive ? employees.filter((e) => e.department_id === selectedLive.id) : []),
    [selectedLive, employees],
  )
  const subDepartments = useMemo(
    () =>
      selectedLive ? departments.filter((d) => d.parent_department_id === selectedLive.id) : [],
    [selectedLive, departments],
  )
  // Ancestor chain (root → immediate parent) for breadcrumb back-navigation.
  const ancestors = useMemo(() => {
    if (!selectedLive) return []
    const byId = new Map(departments.map((d) => [d.id, d]))
    const chain: Department[] = []
    let pid = selectedLive.parent_department_id
    const guard = new Set<string>()
    while (pid && byId.has(pid) && !guard.has(pid)) {
      guard.add(pid)
      const parent = byId.get(pid)!
      chain.unshift(parent)
      pid = parent.parent_department_id
    }
    return chain
  }, [selectedLive, departments])

  const handleSaved = useCallback(
    (saved: Department) => {
      setFormTarget(null)
      // Merge then refetch for accurate counts/relations.
      setDepartments((prev) => {
        const exists = prev.some((d) => d.id === saved.id)
        return exists ? prev.map((d) => (d.id === saved.id ? { ...d, ...saved } : d)) : [...prev, saved]
      })
      reload()
    },
    [reload],
  )

  const handleDeleted = useCallback(
    (id: string) => {
      setFormTarget(null)
      setSelected((cur) => (cur?.id === id ? null : cur))
      setDepartments((prev) => prev.filter((d) => d.id !== id))
      reload()
    },
    [reload],
  )

  if (loading) {
    return (
      <div className="flex h-64 flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 rounded-card" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Department structure"
        meta={
          canEdit
            ? 'Drag to arrange, click a department for details, and use the pencil to edit.'
            : 'Interactive view of your department structure and hierarchy.'
        }
        actions={
          canEdit ? (
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={() => setShowImport(true)}>
                <UploadIcon size={16} />
                Import
              </Button>
              <Button onClick={openCreate}>
                <PlusIcon size={16} />
                Add department
              </Button>
            </div>
          ) : undefined
        }
      />

      {departments.length === 0 ? (
        <EmptyState canEdit={canEdit} onAdd={openCreate} />
      ) : (
        <>
          {/* SearchIcon */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1 max-w-xs">
              <SearchIcon
                size={15}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
              />
              <input
                type="text"
                placeholder="Search departments…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-[10px] text-body rounded-lg border border-border focus:border-primary focus:outline-hidden bg-surface text-text-primary placeholder:text-text-muted"
              />
            </div>
          </div>

          {/* Count + view toggle */}
          <div className="flex items-center justify-between gap-3">
            <p className="text-body text-text-secondary">
              {query.trim()
                ? `${matchCount} of ${departments.length} departments`
                : `${departments.length} department${departments.length !== 1 ? 's' : ''}`}
            </p>
            <ViewToggle value={view} onChange={setView} />
          </div>

          {/* Table / Tree */}
          {view === 'table' ? (
            <DeptTableView
              departments={departments}
              colorMap={colorMap}
              query={query}
              canEdit={canEdit}
              onSelect={setSelected}
              onEdit={openEdit}
            />
          ) : (
            <ReactFlowProvider>
              <OrgChartInner
                departments={departments}
                colorMap={colorMap}
                canEdit={canEdit}
                orgId={orgId}
                query={query}
                onSelect={setSelected}
                onEdit={openEdit}
                onDepartmentsChange={setDepartments}
              />
            </ReactFlowProvider>
          )}
        </>
      )}

      {/* Read-only detail drawer */}
      <DeptInfoPanel
        department={selectedLive}
        accentColor={selectedLive ? colorMap[selectedLive.id]?.base : undefined}
        ancestors={ancestors}
        members={members}
        subDepartments={subDepartments}
        canEdit={canEdit}
        onEdit={(d) => {
          setSelected(null)
          setFormTarget({ mode: 'edit', department: d })
        }}
        onSelectDepartment={(d) => setSelected(d)}
        onClose={() => setSelected(null)}
      />

      {/* Create / edit drawer */}
      {canEdit && (
        <DeptFormDrawer
          target={formTarget}
          departments={departments}
          users={users}
          orgId={orgId}
          onClose={() => setFormTarget(null)}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
        />
      )}

      {/* Bulk import */}
      {canEdit && showImport && (
        <ImportDepartmentsModal
          orgId={orgId}
          departments={departments}
          users={users}
          onClose={() => setShowImport(false)}
          onImported={reload}
        />
      )}
    </div>
  )
}
