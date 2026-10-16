'use client'

import { useMemo, useState, useEffect } from 'react'
import { ChevronRight, Search, X, Workflow } from 'lucide-react'
import { KIND_META } from './kind-meta'
import Tooltip from '@/components/ui/tooltip'
import type { TreeNode } from '@/lib/api/process-hierarchy'

const CONTAINER_KINDS = new Set(['container', 'subprocess'])

interface Props {
  tree: TreeNode[]
  mapName: string
  currentParentId: string | null
  selectedNodeId: string | null
  onOpenLevel: (parentId: string | null) => void
  onSelectNode: (node: TreeNode) => void
}

export default function HierarchyTree({ tree, mapName, currentParentId, selectedNodeId, onOpenLevel, onSelectNode }: Props) {
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const childrenBy = useMemo(() => {
    const m = new Map<string | null, TreeNode[]>()
    tree.forEach((n) => {
      const list = m.get(n.parent_node_id) ?? []
      list.push(n); m.set(n.parent_node_id, list)
    })
    m.forEach((list) => list.sort((a, b) => a.sort_order - b.sort_order))
    return m
  }, [tree])

  const nameById = useMemo(() => new Map(tree.map((n) => [n.id, n])), [tree])

  // Auto-expand the ancestors of the current level / selected node so the user
  // always sees where they are.
  useEffect(() => {
    const focus = selectedNodeId ?? currentParentId
    if (!focus) return
    setExpanded((prev) => {
      const next = new Set(prev)
      let cur: string | null | undefined = focus
      while (cur) { next.add(cur); cur = nameById.get(cur)?.parent_node_id }
      return next
    })
  }, [selectedNodeId, currentParentId, nameById])

  const toggle = (id: string) => setExpanded((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  // ─── Search: flat matches with their path ───────────────────────────────────
  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return null
    const pathOf = (n: TreeNode) => {
      const crumbs: string[] = []
      let cur = n.parent_node_id ? nameById.get(n.parent_node_id) : undefined
      while (cur) { crumbs.unshift(cur.name); cur = cur.parent_node_id ? nameById.get(cur.parent_node_id) : undefined }
      return crumbs
    }
    return tree
      .filter((n) => n.name.toLowerCase().includes(q))
      .slice(0, 50)
      .map((n) => ({ node: n, path: pathOf(n) }))
  }, [query, tree, nameById])

  function activate(n: TreeNode) {
    if (CONTAINER_KINDS.has(n.kind)) onOpenLevel(n.id)
    else onSelectNode(n)
  }

  const renderRow = (n: TreeNode, depth: number) => {
    const kids = childrenBy.get(n.id) ?? []
    const hasKids = kids.length > 0
    const isOpen = expanded.has(n.id)
    const isCurrent = currentParentId === n.id
    const isSelected = selectedNodeId === n.id
    return (
      <div key={n.id}>
        <div
          className={`group flex items-center gap-1 rounded-[6px] pr-2 py-1 cursor-pointer transition-colors ${
            isSelected || isCurrent ? 'bg-primary-subtle' : 'hover:bg-surface-control'
          }`}
          style={{ paddingLeft: 4 + depth * 14 }}
        >
          <button
            onClick={(e) => { e.stopPropagation(); if (hasKids) toggle(n.id) }}
            className={`shrink-0 w-4 h-4 flex items-center justify-center rounded-xs ${hasKids ? 'text-text-muted hover:bg-surface-control-pressed' : 'opacity-0 pointer-events-none'}`}
            aria-label={isOpen ? 'Collapse' : 'Expand'}
          >
            <ChevronRight size={13} className={`transition-transform ${isOpen ? 'rotate-90' : ''}`} />
          </button>
          <Tooltip label={n.name}>
            <button
              onClick={() => activate(n)}
              className="flex-1 min-w-0 flex items-center gap-1.5 text-left"
            >
              <span className="shrink-0 text-primary-text">{KIND_META[n.kind].icon}</span>
              <span className={`flex-1 min-w-0 truncate text-meta ${isSelected || isCurrent ? 'text-primary-text font-medium' : 'text-text-primary'}`}>{n.name}</span>
            </button>
          </Tooltip>
        </div>
        {hasKids && isOpen && kids.map((c) => renderRow(c, depth + 1))}
      </div>
    )
  }

  const roots = childrenBy.get(null) ?? []

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b border-border-light">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search steps…"
            className="w-full pl-8 pr-8 py-1.5 text-meta rounded-[8px] border border-border bg-surface-sunken focus:bg-surface focus:border-primary focus:outline-hidden text-text-primary placeholder:text-text-muted"
          />
          {query && (
            <button onClick={() => setQuery('')} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary">
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-1.5">
        {results ? (
          results.length === 0 ? (
            <p className="text-meta text-text-muted text-center py-8 px-3">No steps match “{query}”.</p>
          ) : (
            <div className="space-y-0.5">
              {results.map(({ node, path }) => (
                <button key={node.id} onClick={() => activate(node)}
                  className="w-full text-left rounded-[6px] px-2 py-1.5 hover:bg-surface-control transition-colors">
                  <div className="flex items-center gap-1.5">
                    <span className="shrink-0 text-primary-text">{KIND_META[node.kind].icon}</span>
                    <span className="flex-1 min-w-0 truncate text-meta text-text-primary font-medium">{node.name}</span>
                  </div>
                  {path.length > 0 && (
                    <p className="text-meta text-text-muted truncate pl-4">{path.join(' › ')}</p>
                  )}
                </button>
              ))}
            </div>
          )
        ) : (
          <>
            <button
              onClick={() => onOpenLevel(null)}
              className={`w-full flex items-center gap-1.5 rounded-[6px] px-2 py-1.5 mb-0.5 text-left transition-colors ${
                currentParentId === null ? 'bg-primary-subtle' : 'hover:bg-surface-control'
              }`}
            >
              <Workflow size={14} className="shrink-0 text-primary-text" />
              <span className={`flex-1 min-w-0 truncate text-meta font-medium ${currentParentId === null ? 'text-primary-text' : 'text-text-primary'}`}>{mapName}</span>
            </button>
            {roots.length === 0 ? (
              <p className="text-meta text-text-muted px-3 py-4">No steps yet.</p>
            ) : (
              roots.map((n) => renderRow(n, 1))
            )}
          </>
        )}
      </div>
    </div>
  )
}
