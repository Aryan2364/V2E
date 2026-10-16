'use client'

import React, { useState } from 'react'
import { Handle, Position, type NodeProps } from 'reactflow'
import { Play, Flag, ExternalLink, ChevronRight, Pencil, FileText, Maximize2, Minimize2, Folder, Link2, StickyNote, ListChecks, Square, Plus, GripVertical } from 'lucide-react'
import type { ProcessNodeKind, DiffChangeKind, ProcessArtifactContentType } from '@/lib/api/process-hierarchy'
import { KIND_META } from './kind-meta'
import Tooltip from '@/components/ui/tooltip'

export { KIND_META }

export interface ProcessNodeData {
  name: string
  kind: ProcessNodeKind
  childCount: number
  docCount?: number // input + output documents attached to this node
  drillable: boolean
  selected: boolean
  diff?: DiffChangeKind // when comparing versions — tints the node
  linkedMapName?: string | null // cross-map link target
  onEdit?: () => void // open the side panel to edit this node's details (pencil)
  canExpand?: boolean // references a map → can be unfolded in place
  onToggleExpand?: () => void // expand/collapse this area inline
  checklist?: { id: string; text: string }[] // task checklist — shown/expanded on the box
}

const DIFF_COLOR: Partial<Record<DiffChangeKind, string>> = {
  added: 'var(--success)',
  removed: 'var(--danger)',
  changed: 'var(--warning)',
}

/** Border colour: selection wins, then a diff tint, else the kind accent. */
export function borderColor(data: ProcessNodeData, accent: string): string {
  if (data.selected) return 'var(--primary-text)'
  if (data.diff && DIFF_COLOR[data.diff]) return DIFF_COLOR[data.diff]!
  return accent
}

const handleStyle: React.CSSProperties = { width: 7, height: 7, background: 'var(--primary)', border: '2px solid var(--surface)' }

// Four connection dots (top / right / bottom / left), each usable as input OR output — the canvas
// runs in connectionMode="loose", and enforces the rule "left = input only, right = output only"
// on connect. Drag from any dot to start a line; the dot you leave and the dot you drop on are
// remembered as the connection's source_side / target_side so YOU choose how a line attaches.
function FourHandles({ hidden }: { hidden?: Set<'top' | 'right' | 'bottom' | 'left'> }) {
  const sides: Array<['top' | 'right' | 'bottom' | 'left', Position]> = [
    ['top', Position.Top], ['right', Position.Right], ['bottom', Position.Bottom], ['left', Position.Left],
  ]
  return (
    <>
      {sides.map(([id, pos]) => (hidden?.has(id) ? null : (
        <Handle key={id} id={id} type="source" position={pos} style={handleStyle} />
      )))}
    </>
  )
}

/** Small top-right pencil — opens the side panel to edit this node's details.
    Stops propagation so it never triggers the node's click-to-enter. */
function EditButton({ data }: { data: ProcessNodeData }) {
  if (!data.onEdit) return null
  return (
    <Tooltip label="Edit details">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); data.onEdit!() }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); data.onEdit!() } }}
        className="nodrag absolute top-1 right-1 w-5 h-5 inline-flex items-center justify-center rounded-[6px] text-text-muted hover:text-primary-text hover:bg-primary-subtle transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
        aria-label={`Edit ${data.name}`}
      >
        <Pencil size={12} />
      </button>
    </Tooltip>
  )
}

function StepNode({ data }: NodeProps<ProcessNodeData>) {
  const isContainer = data.kind === 'container'
  const accent = data.kind === 'container' || data.kind === 'subprocess' ? 'var(--primary-text)' : 'var(--border)'
  const canOpen = data.drillable || !!data.linkedMapName
  const checks = data.checklist ?? []
  const [showChecks, setShowChecks] = useState(false)
  return (
    <>
      <FourHandles />
      <div
        className={`relative bg-surface rounded-lg px-2.5 py-1.5 shadow-xs flex flex-col justify-center ${canOpen ? 'cursor-pointer' : ''}`}
        style={{ border: `2px solid ${borderColor(data, accent)}`, width: isContainer ? 220 : 170, minHeight: isContainer ? 88 : 60 }}
      >
        {/* Drillable nodes: pencil edits; the body itself opens the level. */}
        {canOpen && <EditButton data={data} />}
        {data.canExpand && (
          <Tooltip label="Expand in place">
            <button type="button" onClick={(e) => { e.stopPropagation(); data.onToggleExpand?.() }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); data.onToggleExpand?.() } }}
              className="nodrag absolute top-1 right-7 w-5 h-5 inline-flex items-center justify-center rounded-[6px] text-text-muted hover:text-primary-text hover:bg-primary-subtle transition-colors"
              aria-label="Expand in place">
              <Maximize2 size={11} />
            </button>
          </Tooltip>
        )}
        <div className={`flex items-start gap-1.5 ${data.canExpand ? 'pr-12' : canOpen ? 'pr-4' : ''}`}>
          <span style={{ color: 'var(--primary-text)' }} className="shrink-0 mt-0.5">{KIND_META[data.kind].icon}</span>
          <span className="flex-1 min-w-0 text-meta font-medium text-text-primary leading-snug wrap-break-word">{data.name}</span>
        </div>
        {data.linkedMapName && data.linkedMapName !== data.name && (
          <div className="mt-1 flex items-center gap-1 text-[10px] font-medium text-primary-text">
            <ExternalLink size={10} /> <span className="truncate">{data.linkedMapName}</span>
          </div>
        )}
        {(canOpen || !!data.docCount) && (
          <div className="mt-1 flex items-center gap-2">
            {!!data.docCount && (
              <Tooltip label={`${data.docCount} document${data.docCount > 1 ? 's' : ''}`}>
                <button onClick={(e) => { e.stopPropagation(); data.onEdit?.() }}
                  className="nodrag inline-flex items-center gap-0.5 text-[10px] font-medium text-text-secondary hover:text-primary-text">
                  <FileText size={11} /> {data.docCount}
                </button>
              </Tooltip>
            )}
            {canOpen && (
              <span className="ml-auto inline-flex items-center gap-0.5 text-[10px] font-medium text-primary-text">
                {data.childCount ? `${data.childCount} inside` : 'Open'} <ChevronRight size={11} />
              </span>
            )}
          </div>
        )}
        {/* Checklist — a line under the box; the chevron loads the items onto the canvas. */}
        {checks.length > 0 && (
          <div className="mt-1 border-t border-border-light pt-1">
            <Tooltip label={showChecks ? 'Hide checklist' : 'Show checklist'}>
              <button type="button" onClick={(e) => { e.stopPropagation(); setShowChecks((v) => !v) }}
                className="nodrag inline-flex items-center gap-1 text-[10px] font-medium text-text-secondary hover:text-primary-text"
                aria-expanded={showChecks}>
                <ChevronRight size={11} className={`transition-transform ${showChecks ? 'rotate-90' : ''}`} />
                <ListChecks size={11} /> {checks.length} checklist item{checks.length !== 1 ? 's' : ''}
              </button>
            </Tooltip>
            {showChecks && (
              <ul className="mt-1 space-y-0.5">
                {checks.map((c) => (
                  <li key={c.id} className="flex items-start gap-1 text-[10px] leading-snug text-text-secondary">
                    <Square size={9} className="shrink-0 mt-0.5 text-text-muted" />
                    <span className="wrap-break-word">{c.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </>
  )
}

function DecisionNode({ data }: NodeProps<ProcessNodeData>) {
  return (
    <div className="relative" style={{ width: 96, height: 96 }}>
      <FourHandles />
      <div
        className="absolute bg-surface shadow-xs"
        style={{
          width: 66,
          height: 66,
          top: 15,
          left: 15,
          transform: 'rotate(45deg)',
          border: `2px solid ${borderColor(data, 'var(--warning)')}`,
          borderRadius: 6,
        }}
      />
      <div className="absolute inset-0 flex items-center justify-center px-3 text-center">
        <span className="line-clamp-3 text-[10px] font-medium text-text-primary leading-tight">{data.name}</span>
      </div>
    </div>
  )
}

function EventNode({ data }: NodeProps<ProcessNodeData>) {
  const isStart = data.kind === 'start_event'
  const accent = isStart ? 'var(--success)' : 'var(--danger)'
  return (
    <>
      {/* Start has no input (hide the left dot); End has no output (hide the right dot). */}
      <FourHandles hidden={new Set([isStart ? 'left' as const : 'right' as const])} />
      {/* 44px circle keeps the node bounds (so handles stay centered); the label is
          absolutely positioned below so you can read it on the canvas. */}
      <Tooltip label={data.name}>
        <div
          className="relative flex items-center justify-center rounded-full bg-surface shadow-xs"
          style={{ width: 44, height: 44, border: `3px solid ${borderColor(data, accent)}`, color: accent }}
          aria-label={data.name}
        >
          {isStart ? <Play size={18} /> : <Flag size={18} />}
          <span className="absolute top-[calc(100%+4px)] left-1/2 -translate-x-1/2 w-[120px] text-center text-meta font-medium leading-tight wrap-break-word pointer-events-none"
            style={{ color: accent }}>
            {data.name}
          </span>
        </div>
      </Tooltip>
    </>
  )
}

// ─── Band: an area unfolded in place. Sized by the canvas to hold its children,
// which render as child nodes inside it (ReactFlow parent/extent). ────────────
function BandNode({ data }: NodeProps<ProcessNodeData>) {
  return (
    <div className="w-full h-full rounded-card border-2 border-primary-ring bg-primary-subtle/40 shadow-xs">
      <Handle type="target" position={Position.Left} style={handleStyle} />
      <div className="absolute top-0 left-0 right-0 h-7 flex items-center gap-1.5 px-2 bg-primary-subtle border-b border-primary-border rounded-t-[10px]">
        <Folder size={13} className="text-primary-text shrink-0" />
        <span className="flex-1 min-w-0 truncate text-meta font-medium text-text-primary">{data.name}</span>
        <Tooltip label="Collapse">
          <button type="button" onClick={(e) => { e.stopPropagation(); data.onToggleExpand?.() }}
            className="nodrag shrink-0 w-5 h-5 inline-flex items-center justify-center rounded-xs text-text-muted hover:text-text-primary hover:bg-surface"
            aria-label="Collapse"><Minimize2 size={12} /></button>
        </Tooltip>
      </div>
      <Handle type="source" position={Position.Right} style={handleStyle} />
    </div>
  )
}

// ─── Note: a free-form sticky annotation. Not part of the flow — no handles, no
// connections; click to edit its text in the side panel. ─────────────────────
function NoteNode({ data }: NodeProps<ProcessNodeData>) {
  return (
    <div
      className={`relative rounded-[6px] px-3 py-2.5 shadow-xs ${data.selected ? 'ring-2 ring-primary' : ''}`}
      style={{ width: 190, minHeight: 96, background: 'var(--warning-bg)', border: '1px solid var(--warning-border)' }}
    >
      <div className="flex items-center gap-1 mb-1 text-warning">
        <StickyNote size={12} className="shrink-0" />
        <span className="text-[10px] font-medium uppercase tracking-wide">Note</span>
        {data.onEdit && <Pencil size={11} className="ml-auto text-warning" />}
      </div>
      <p className="text-meta leading-snug text-warning whitespace-pre-wrap wrap-break-word">
        {data.name || 'Empty note — click to write'}
      </p>
    </div>
  )
}

// ─── Swimlane band: a pool or a department lane, drawn behind the steps. The label
// runs vertically down the left strip (like the reference BPMN diagram). Non-interactive
// (pointer-events off in the layout) so panning/clicking passes through to the canvas. ──
export interface SwimlaneBandData { label: string; variant: 'pool' | 'lane'; onAdd?: () => void; onRename?: () => void; onReorderStart?: (e: React.PointerEvent) => void }
function SwimlaneBandNode({ data }: NodeProps<SwimlaneBandData>) {
  const isPool = data.variant === 'pool'
  return (
    <div
      className="relative w-full h-full"
      style={{
        border: `1.5px solid ${isPool ? 'var(--text-muted)' : 'var(--border)'}`,
        background: isPool ? 'color-mix(in srgb, var(--surface-sunken) 35%, transparent)' : 'color-mix(in srgb, var(--surface-control) 30%, transparent)',
        borderRadius: 4,
      }}
    >
      <div
        className="absolute left-0 top-0 bottom-0 flex flex-col items-center border-r"
        style={{ width: 30, borderColor: isPool ? 'var(--border)' : 'var(--border-light)', paddingTop: 6, gap: 4 }}
      >
        {/* Drag grip: reorder this lane among the department lanes, or this pool among the pools. */}
        {data.onReorderStart && (
          <Tooltip label={isPool ? 'Drag to reorder this pool' : 'Drag to reorder this lane'}>
            <button
              type="button"
              aria-label={isPool ? 'Reorder pool' : 'Reorder lane'}
              onPointerDown={(e) => { e.stopPropagation(); data.onReorderStart!(e) }}
              onClick={(e) => e.stopPropagation()}
              className="nodrag inline-flex items-center justify-center rounded-xs text-text-muted hover:text-primary-text hover:bg-primary-subtle focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
              style={{ pointerEvents: 'auto', cursor: 'grab', width: 20, height: 20, touchAction: 'none' }}
            >
              <GripVertical size={14} />
            </button>
          </Tooltip>
        )}
        <div className="flex-1 flex items-center justify-center min-h-0">
        {data.onRename ? (
          // Click the lane's name to re-point it at a different department (its steps move with it).
          <Tooltip label="Change this lane's department">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); data.onRename!() }}
              className="nodrag text-meta font-medium text-text-primary whitespace-nowrap hover:text-primary-text focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary rounded-xs"
              style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', pointerEvents: 'auto' }}
            >
              {data.label}
            </button>
          </Tooltip>
        ) : (
          <span
            className="text-meta font-medium text-text-primary whitespace-nowrap"
            style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
          >
            {data.label}
          </span>
        )}
        </div>
      </div>
      {/* Per-lane add (top-right): the band itself is click-through (pointer-events off in the
          layout), but this button re-enables pointer events. It opens a picker for WHAT to add. */}
      {data.onAdd && (
        <Tooltip label="Add a step to this lane">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); data.onAdd!() }}
            aria-label="Add a step to this lane"
            style={{ pointerEvents: 'auto' }}
            className="nodrag absolute top-2 right-2 w-6 h-6 inline-flex items-center justify-center rounded-[6px] text-primary-text hover:bg-primary-subtle transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Plus size={16} />
          </button>
        </Tooltip>
      )}
    </div>
  )
}

function ProcessNodeRenderer(props: NodeProps<ProcessNodeData>) {
  if (props.data.kind === 'decision') return <DecisionNode {...props} />
  if (props.data.kind === 'start_event' || props.data.kind === 'end_event') return <EventNode {...props} />
  if (props.data.kind === 'note') return <NoteNode {...props} />
  return <StepNode {...props} />
}

// ─── Document chip: a clickable input/output document hanging off a node by its own
// dotted line. Inputs sit above (line comes down into the node), outputs below. ──
export interface DocNodeData {
  name: string
  contentType: ProcessArtifactContentType
  io: 'input' | 'output'
  onOpen: () => void
}
export const DOC_CHIP_W = 150
export const DOC_CHIP_H = 30

function DocNode({ data }: NodeProps<DocNodeData>) {
  const Icon = data.contentType === 'link' ? Link2 : data.contentType === 'article' ? StickyNote : FileText
  const isInput = data.io === 'input'
  return (
    <>
      {/* One handle on the side facing the node, so the dotted line meets it cleanly. */}
      <Handle type="source" position={isInput ? Position.Bottom : Position.Top} style={{ opacity: 0 }} />
      <Tooltip label={`${isInput ? 'Input' : 'Output'} document — ${data.name}`}>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); data.onOpen() }}
          style={{ width: DOC_CHIP_W, height: DOC_CHIP_H }}
          className="nodrag group flex items-center gap-1.5 px-2 rounded-[7px] border border-dashed border-border bg-surface shadow-xs text-left transition-colors hover:border-primary"
        >
          <span className="w-[3px] self-stretch my-1 rounded-full shrink-0" style={{ background: isInput ? 'var(--text-secondary)' : 'var(--text-secondary)' }} />
          <Icon size={13} className="shrink-0" style={{ color: isInput ? 'var(--text-secondary)' : 'var(--text-secondary)' }} />
          <span className="flex-1 min-w-0 truncate text-meta font-medium text-text-secondary group-hover:text-text-primary">{data.name}</span>
        </button>
      </Tooltip>
    </>
  )
}

export const nodeTypes = { process: ProcessNodeRenderer, band: BandNode, document: DocNode, swimlane: SwimlaneBandNode }
