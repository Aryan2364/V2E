'use client'

import React, { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight, ChevronDown, AlertTriangle, CheckCircle2, Send, Users } from 'lucide-react'
import type { PeopleTree as PeopleTreeData, PersonNode } from '@/lib/types/tasks'
import Tooltip from '@/components/ui/Tooltip'

interface TreeNode extends PersonNode { children: TreeNode[] }

function buildForest(nodes: PersonNode[], rootUserId: string): TreeNode[] {
  const byId = new Map<string, TreeNode>(nodes.map((n) => [n.user_id, { ...n, children: [] }]))
  const roots: TreeNode[] = []
  for (const n of Array.from(byId.values())) {
    const parent = n.reporting_to_user_id ? byId.get(n.reporting_to_user_id) : undefined
    if (parent && parent.user_id !== n.user_id) parent.children.push(n)
    else roots.push(n)
  }
  // Sort: the viewer (root) first, then by workload desc, then name.
  const sortNodes = (arr: TreeNode[]) => {
    arr.sort((a, b) =>
      (a.user_id === rootUserId ? -1 : b.user_id === rootUserId ? 1 : 0) ||
      b.assignee.total - a.assignee.total ||
      a.name.localeCompare(b.name),
    )
    arr.forEach((n) => sortNodes(n.children))
  }
  sortNodes(roots)
  return roots
}

function initials(name: string) {
  return name.split(' ').filter(Boolean).map((n) => n[0]).join('').slice(0, 2).toUpperCase() || '?'
}

function Stat({ icon, value, color, title }: { icon: React.ReactNode; value: number; color: string; title: string }) {
  return (
    <Tooltip label={title}>
      <span className="inline-flex items-center gap-1 text-[12px] font-medium tabular-nums" style={{ color }}>
        {icon}{value}
      </span>
    </Tooltip>
  )
}

function Row({ node, depth }: { node: TreeNode; depth: number }) {
  const router = useRouter()
  const [open, setOpen] = useState(depth < 1)
  const hasChildren = node.children.length > 0

  return (
    <div>
      <div
        className="flex items-center gap-2 py-2 pr-2 rounded-[8px] hover:bg-surface-sunken transition-colors"
        style={{ paddingLeft: depth * 18 + 4 }}
      >
        <button
          onClick={() => hasChildren && setOpen((v) => !v)}
          className={`w-5 h-5 flex items-center justify-center rounded-[4px] shrink-0 ${hasChildren ? 'text-text-secondary hover:bg-surface-control-pressed' : 'opacity-0 pointer-events-none'}`}
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <div className="w-7 h-7 rounded-full bg-primary text-white text-[10px] font-bold flex items-center justify-center shrink-0">
          {initials(node.name)}
        </div>
        <button onClick={() => router.push(`/dashboard/tasks/people/${node.user_id}`)} className="min-w-0 flex-1 text-left group">
          <p className="text-[14px] font-medium text-text-primary truncate group-hover:text-primary-text transition-colors">{node.name}</p>
          {(node.role_title || node.department_name) && (
            <p className="text-[12px] text-text-muted truncate">{[node.role_title, node.department_name].filter(Boolean).join(' · ')}</p>
          )}
        </button>
        <div className="flex items-center gap-3 shrink-0 pl-2">
          <Stat icon={<Users size={12} />} value={node.assignee.total} color="#475569" title="Tasks assigned to them" />
          {node.assignee.overdue > 0 && <Stat icon={<AlertTriangle size={12} />} value={node.assignee.overdue} color="#DC2626" title="Overdue" />}
          <Stat icon={<CheckCircle2 size={12} />} value={node.assignee.completed} color="#16A34A" title="Completed" />
          <Stat icon={<Send size={12} />} value={node.assigned_count} color="#0891B2" title="Tasks they assigned to others" />
        </div>
      </div>
      {open && hasChildren && (
        <div className="border-l border-border-light" style={{ marginLeft: depth * 18 + 14 }}>
          {node.children.map((c) => <Row key={c.user_id} node={c} depth={depth + 1} />)}
        </div>
      )}
    </div>
  )
}

/**
 * Interactive reporting tree for Team / Organization scope. Expand node by node; each row
 * shows workload (assigned-to: total / overdue / completed) and delegation (assigned-by).
 * Click a person → their Employee Work Report.
 */
export default function PeopleTree({ data }: { data: PeopleTreeData }) {
  const forest = useMemo(() => buildForest(data.nodes, data.root_user_id), [data])
  if (!data.nodes.length) {
    return <p className="text-[13px] text-text-muted py-6 text-center">No people in this view.</p>
  }
  return (
    <div className="bg-white border border-border-light rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.06)] p-3 flex flex-col h-[420px]">
      <div className="flex items-center justify-between px-1 pb-2 mb-1 border-b border-border-light shrink-0">
        <p className="text-[13px] font-semibold text-text-primary">Reporting tree · workload</p>
        <p className="text-[11px] text-text-muted hidden sm:flex items-center gap-3">
          <span className="inline-flex items-center gap-1"><Users size={11} /> assigned</span>
          <span className="inline-flex items-center gap-1 text-danger"><AlertTriangle size={11} /> overdue</span>
          <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 size={11} /> done</span>
          <span className="inline-flex items-center gap-1 text-text-secondary"><Send size={11} /> delegated</span>
        </p>
      </div>
      <div className="flex-1 overflow-y-auto pr-1 -mr-1">
        {forest.map((n) => <Row key={n.user_id} node={n} depth={0} />)}
      </div>
    </div>
  )
}
