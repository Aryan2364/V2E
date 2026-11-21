import { normalizeHeader } from './csv'
import type { ColumnSpec, RowParseSpec } from './types'

/** header text -> column key, for every key and alias. */
export function buildAliasMap<K extends string>(columns: readonly ColumnSpec<K>[]): Record<string, K> {
  const map: Record<string, K> = {}
  for (const c of columns) map[c.key] = c.key
  for (const c of columns) for (const a of c.aliases ?? []) map[a] = c.key
  return map
}

export interface ParsedGrid<TRow> {
  rows: TRow[]
  /** The true 1-based spreadsheet row each parsed row came from. */
  sourceRows: number[]
  error?: string
}

/**
 * Turn a header + cells grid into payload rows. The first occurrence of a column
 * wins; blank rows are skipped; `mapRow` may drop further rows (returns null).
 */
export function gridToRows<K extends string, TRow = Record<K, string>>(
  grid: string[][],
  columns: readonly ColumnSpec<K>[],
  spec: Pick<RowParseSpec<K, TRow>, 'headerRequired' | 'missingColumnsError' | 'mapRow'>,
): ParsedGrid<TRow> {
  if (grid.length === 0) return { rows: [], sourceRows: [], error: 'The file is empty.' }
  const aliasMap = buildAliasMap(columns)
  const idx: Partial<Record<K, number>> = {}
  grid[0].map(normalizeHeader).forEach((h, i) => {
    const col = aliasMap[h]
    if (col && idx[col] === undefined) idx[col] = i
  })
  if (spec.headerRequired.some((k) => idx[k] === undefined)) {
    return { rows: [], sourceRows: [], error: spec.missingColumnsError }
  }

  const rows: TRow[] = []
  const sourceRows: number[] = []
  for (let r = 1; r < grid.length; r++) {
    const cells = grid[r]
    if (!cells || cells.every((c) => (c ?? '').trim() === '')) continue
    const get = (k: K): string => {
      const i = idx[k]
      return i !== undefined ? (cells[i] ?? '').trim() : ''
    }
    let row: TRow | null
    if (spec.mapRow) row = spec.mapRow(get, { sourceRow: r + 1 })
    else {
      const all: Record<string, string> = {}
      for (const c of columns) all[c.key] = get(c.key)
      row = all as TRow
    }
    if (row === null) continue
    rows.push(row)
    sourceRows.push(r + 1) // grid index r (header at 0) -> 1-based Excel row
  }
  if (rows.length === 0) return { rows: [], sourceRows: [], error: 'No data rows found below the header.' }
  return { rows, sourceRows }
}
