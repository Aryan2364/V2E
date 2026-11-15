'use client'

// Result and history views for imports that create records one by one on the client
// (departments, job roles): a created/failed summary, the failed rows, and a plain
// batch list with undo.

import type { ReactNode } from 'react'
import type { ViewSlot } from '@/lib/import/types'
import { BatchHistoryList, FailedRowItem, FailedTile, ListSection, SuccessTile } from './ImportParts'

export interface SimpleRowResult {
  row: number
  /** Department name / role title, shown beside the row number. */
  label: string
  status: 'created' | 'failed'
  error?: string
}

export interface SimpleResult {
  created: number
  failed: number
  results: SimpleRowResult[]
}

export interface SimpleBatch {
  id: string
  file_name: string | null
  status: string
  created_at: string
  imported_by: string
  created_count: number
  failed_count: number
  remaining: number
  can_undo: boolean
}

export interface SimpleUndo {
  undone: number
}

export function SimpleResultView({ result, note }: { result: SimpleResult; note: ReactNode }) {
  const failedRows = result.results.filter((r) => r.status === 'failed')
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 flex-wrap">
        <SuccessTile label={`${result.created} imported`} />
        {result.failed > 0 && <FailedTile label={`${result.failed} failed`} />}
      </div>
      {failedRows.length > 0 && (
        <ListSection title="Rows that need fixing" maxHeightClass="max-h-64">
          {failedRows.map((r) => (
            <FailedRowItem key={r.row} row={r.row} label={r.label} error={r.error} />
          ))}
        </ListSection>
      )}
      <p className="text-label text-text-secondary">{note}</p>
    </div>
  )
}

/** The history slot for a record noun ("department", "job role"). */
export function simpleHistoryRender<TRow, TVal>(
  noun: string,
): ViewSlot<TRow, TVal, SimpleResult, SimpleBatch, SimpleBatch, SimpleUndo> {
  return function SimpleHistory(ctx) {
    return (
    <BatchHistoryList
      batches={ctx.batches}
      undoingId={ctx.undoingId}
      onUndo={(id) => ctx.requestUndo(id)}
      noUndoLabel={(b) => (b.status === 'undone' ? 'Undone' : 'Cannot Undo')}
      above={
        ctx.undoResult ? (
          <div className="border border-border-light rounded-lg p-4 space-y-2">
            <p className="text-body font-medium text-text-primary">
              Removed {ctx.undoResult.undone} {noun}
              {ctx.undoResult.undone !== 1 ? 's' : ''}.
            </p>
          </div>
        ) : null
      }
    />
    )
  }
}
