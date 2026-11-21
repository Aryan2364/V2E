import type { ReactNode } from 'react'
import type { Workbook } from 'exceljs'

export type ImportPhase = 'upload' | 'preview' | 'result' | 'history' | 'batch-detail'
export type DetailOrigin = 'history' | 'import'
/** How date cells in an .xlsx are turned into YYYY-MM-DD text. */
export type DateMode = 'utc' | 'local' | 'none'

/** One template/import column. The key is also the header alias for itself. */
export interface ColumnSpec<K extends string = string> {
  key: K
  /** Header text written to the template (and the error report), e.g. "name *". */
  label: string
  /** Blue header in the template. */
  required?: boolean
  /** Other header spellings accepted on upload, already normalised (see normalizeHeader). */
  aliases?: readonly string[]
}

export interface RowParseSpec<K extends string, TRow> {
  /** Columns that must be present in the header, else `missingColumnsError`. */
  headerRequired: readonly K[]
  missingColumnsError: string
  /** Turn a row's cells into the payload row. Return null to skip the row (e.g. the guide row). */
  mapRow?: (get: (key: K) => string, ctx: { sourceRow: number }) => TRow | null
  /** Sheet to read from an .xlsx; the first sheet when absent or missing. */
  sheetName?: string
  dateMode: DateMode
}

export interface ImportIssue {
  severity: 'error' | 'warning'
  message: string
  field?: string | null
}

export interface ErrorReportEntry {
  payload: object
  status: string
  reason: string
}

/** What a commit gives back to the wizard. */
export interface CommitOutcome<TRes> {
  result: TRes
  /** When set, the wizard lands on this batch's detail page instead of the result page. */
  openBatchId?: string
}

/** Everything the wizard exposes to an entity's view slots. */
export interface ImportViewCtx<TRow, TVal, TRes, TBatch, TDetail, TUndo> {
  fileName: string
  rows: TRow[]
  validation: TVal | null
  result: TRes | null
  undoResult: TUndo | null
  batches: TBatch[]
  detail: TDetail | null
  loadingDetail: boolean
  detailOrigin: DetailOrigin
  importing: boolean
  undoingId: string | null
  /** Spreadsheet row for a backend row number (index + 2). */
  excelRow: (rowNum: number) => number
  setPhase: (p: ImportPhase) => void
  openBatch: (id: string, origin?: DetailOrigin) => void
  /** Ask to undo (confirms first when the config has an undo confirmation). */
  requestUndo: (id: string) => void
  /** Import straight away, skipping the confirmation. */
  importNow: () => void
  /** Ask to import (opens the confirmation when the config has one). */
  requestImport: () => void
  chooseAnotherFile: () => void
  downloadReport: (entries: ErrorReportEntry[], filename: string) => void
}

export interface ConfirmSpec<TVal> {
  title: (v: TVal) => string
  description: ReactNode
  /** danger = destructive styling (live accounts); primary = plain. */
  tone: 'danger' | 'primary'
}

export type ViewSlot<TRow, TVal, TRes, TBatch, TDetail, TUndo> = (
  ctx: ImportViewCtx<TRow, TVal, TRes, TBatch, TDetail, TUndo>,
) => ReactNode

export interface ImportConfig<
  K extends string,
  TRow,
  TVal,
  TRes,
  TBatch extends { id: string },
  TDetail extends { id: string },
  TUndo,
> {
  /** Modal title on the upload step, e.g. "Import Employees". */
  title: string
  phaseTitles?: Partial<Record<ImportPhase, string>>
  columns: readonly ColumnSpec<K>[]
  parse: RowParseSpec<K, TRow>
  template: {
    fileName: string
    /** Fill the workbook (sheets, header, examples, dropdowns). */
    build: (wb: Workbook) => void | Promise<void>
  }
  /** Step 1 card copy. */
  uploadIntro: ReactNode
  uploadStep2Label: string
  historyButtonLabel: string

  /** Server-side validation. When present the wizard has a preview step. */
  validate?: (rows: TRow[]) => Promise<TVal>
  preview?: {
    render: ViewSlot<TRow, TVal, TRes, TBatch, TDetail, TUndo>
    readyCount: (v: TVal) => number
    /** Full-page workspace for the review step. */
    fullPage: boolean
    /** Warning beside the footer buttons. Absent = no footer (the slot carries its own buttons). */
    footerWarning?: (v: TVal) => ReactNode
    /** Shows a back arrow in the header (back to upload). */
    backArrow?: boolean
    confirm?: ConfirmSpec<TVal>
    /** Label of the footer's import button. */
    importLabel: (ready: number) => string
  }
  /** Direct flow only: noun for the "Ready to import N ..." banner. */
  directNoun?: string

  commit: (rows: TRow[], fileName: string, sourceRows: number[]) => Promise<CommitOutcome<TRes>>
  /** Where a failed commit is reported. */
  commitErrorMode: 'inline' | 'toast'
  commitErrorFallback: string

  renderResult: ViewSlot<TRow, TVal, TRes, TBatch, TDetail, TUndo>

  history: {
    list: () => Promise<TBatch[]>
    undo: (batchId: string) => Promise<TUndo>
    detail?: (batchId: string) => Promise<TDetail>
    undoToast: (res: TUndo) => { kind: 'success' | 'warning'; message: string }
    undoErrorFallback: string
    undoConfirm?: { description: ReactNode }
    render: ViewSlot<TRow, TVal, TRes, TBatch, TDetail, TUndo>
    renderDetail?: ViewSlot<TRow, TVal, TRes, TBatch, TDetail, TUndo>
  }
}
