'use client'

import React from 'react'
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table'
import { cn } from '@/lib/utils'

export interface ResponsiveColumn<T> {
  key: string
  header: React.ReactNode
  render: (row: T, index: number) => React.ReactNode
  /** Label shown beside the value in the mobile card. Defaults to `header`. */
  mobileLabel?: React.ReactNode
  /** Hide this column entirely in the mobile card view. */
  hideOnMobile?: boolean
  /** Headline value of the mobile card (rendered large, no label). Exactly one column; defaults to first. */
  primary?: boolean
  align?: 'left' | 'right' | 'center'
  cellClassName?: string
  headerClassName?: string
  /** Also hide on the DESKTOP table below this breakpoint (progressive disclosure). */
  desktopHiddenBelow?: 'md' | 'lg' | 'xl'
}

interface ResponsiveTableProps<T> {
  columns: ResponsiveColumn<T>[]
  rows: T[]
  rowKey: (row: T, index: number) => string
  onRowClick?: (row: T, index: number) => void
  emptyState?: React.ReactNode
  loading?: boolean
  skeletonRows?: number
  className?: string
  /** Header strip above the table/cards (e.g. count + Export CSV). */
  toolbar?: React.ReactNode
  /** When set and returns true for a row, an expanded full-width region is rendered under it. */
  isExpanded?: (row: T, index: number) => boolean
  /** Content of the expanded full-width region (desktop: colSpan row; mobile: under the card). */
  renderExpanded?: (row: T, index: number) => React.ReactNode
  /**
   * Cap the body height and scroll it internally (header stays pinned) instead of
   * growing the page. Accepts a number (px) or any CSS length, e.g. 'min(60vh,560px)'.
   */
  maxBodyHeight?: number | string
  /**
   * Fill the height the parent gives it and scroll the rows inside (section 10, scroll
   * ownership): the parent is a flex column with a definite height, and this table is the
   * data area. Header and the page's other zones stay put; only the rows scroll. In a parent
   * with no set height it simply takes its natural height, so the page scrolls instead.
   * Use instead of maxBodyHeight, never with it.
   */
  fill?: boolean
  /** Ref to the desktop scroll container — lets callers persist/restore its scroll position. */
  scrollContainerRef?: React.Ref<HTMLDivElement>
  /** Override the header row (thead) styling — e.g. a coloured header band. Defaults to the kit band. */
  headerRowClassName?: string
  /** Override each header cell (th) bg + text — e.g. white-on-blue. Defaults to the kit band's text colour. */
  headerCellClassName?: string
  /**
   * Minimum width of the table itself (px or any CSS length). Without this the
   * table is `w-full` and SHRINKS to fit, so a wide column set silently squashes
   * instead of overflowing — and no horizontal scrollbar ever appears. Set it on
   * column-heavy tables so they scroll rather than cramming.
   */
  minTableWidth?: number | string
}

const alignClass = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
} as const

const desktopHideClass = {
  md: 'hidden md:table-cell',
  lg: 'hidden lg:table-cell',
  xl: 'hidden xl:table-cell',
} as const

/**
 * Thin adapter over the kit's `table.tsx` (sections 10, 11.1, 22) that KEEPS
 * ResponsiveTable's own mobile card-list behaviour: the kit's table has no
 * card mode, and real screens rely on this component collapsing to cards
 * below `md`. Desktop/tablet renders the kit's table parts (so it gets the
 * section 36 band, sticky header and kit tokens); the mobile card list below
 * `md` is plain kit-token-styled markup, driven by the same breakpoint.
 *
 * Exported prop API is unchanged from the pre-kit implementation, so none of
 * this component's 23 call sites need to change.
 */
export default function ResponsiveTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  emptyState,
  loading = false,
  skeletonRows = 5,
  className = '',
  toolbar,
  isExpanded,
  renderExpanded,
  maxBodyHeight,
  fill = false,
  scrollContainerRef,
  headerRowClassName,
  headerCellClassName,
  minTableWidth,
}: ResponsiveTableProps<T>) {
  const primaryIdx = Math.max(0, columns.findIndex((c) => c.primary))
  const primary = columns[primaryIdx]
  const cardColumns = columns.filter((c) => !c.hideOnMobile)
  const card = 'bg-surface border border-border-light rounded-xl shadow-card overflow-hidden'
  const bodyMaxHeight =
    maxBodyHeight == null
      ? undefined
      : typeof maxBodyHeight === 'number'
        ? `${maxBodyHeight}px`
        : maxBodyHeight

  if (!loading && rows.length === 0 && emptyState) {
    return <>{emptyState}</>
  }

  return (
    <div className={cn(card, fill && 'flex min-h-0 flex-1 flex-col', className)}>
      {toolbar && (
        <div className="flex items-center justify-between gap-3 px-4 md:px-5 py-3 border-b border-border-light">
          {toolbar}
        </div>
      )}

      {/* Desktop / tablet: the kit's table (md+) */}
      <div
        ref={scrollContainerRef}
        className={cn(
          'table-scroll hidden md:block',
          fill ? 'min-h-0 flex-1 overflow-auto' : bodyMaxHeight ? 'overflow-auto' : 'overflow-x-auto',
        )}
        style={bodyMaxHeight ? { maxHeight: bodyMaxHeight } : undefined}
      >
        <Table
          style={
            minTableWidth
              ? { minWidth: typeof minTableWidth === 'number' ? `${minTableWidth}px` : minTableWidth }
              : undefined
          }
        >
          <TableHeader className={headerRowClassName}>
            <TableRow>
              {columns.map((col) => (
                <TableHead
                  key={col.key}
                  numeric={col.align === 'right'}
                  className={cn(
                    alignClass[col.align ?? 'left'],
                    col.desktopHiddenBelow ? desktopHideClass[col.desktopHiddenBelow] : '',
                    headerCellClassName,
                    col.headerClassName,
                  )}
                >
                  {col.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading
              ? Array.from({ length: skeletonRows }).map((_, r) => (
                  <TableRow key={r}>
                    {columns.map((col) => (
                      <TableCell key={col.key}>
                        <div className="h-4 rounded-md bg-surface-control animate-pulse" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              : rows.map((row, i) => {
                  const expanded = isExpanded?.(row, i) ?? false
                  return (
                    <React.Fragment key={rowKey(row, i)}>
                      <TableRow
                        onClick={onRowClick ? () => onRowClick(row, i) : undefined}
                        className={cn(
                          onRowClick && 'cursor-pointer hover:bg-surface-control',
                          expanded && 'bg-surface-sunken',
                        )}
                      >
                        {columns.map((col) => (
                          <TableCell
                            key={col.key}
                            numeric={col.align === 'right'}
                            className={cn(
                              alignClass[col.align ?? 'left'],
                              col.desktopHiddenBelow ? desktopHideClass[col.desktopHiddenBelow] : '',
                              col.cellClassName,
                            )}
                          >
                            {col.render(row, i)}
                          </TableCell>
                        ))}
                      </TableRow>
                      {expanded && renderExpanded && (
                        <TableRow className="bg-surface-sunken">
                          <TableCell colSpan={columns.length} className="pb-4 pt-0 border-b border-border-light">
                            {renderExpanded(row, i)}
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  )
                })}
          </TableBody>
        </Table>
      </div>

      {/* Mobile: stacked cards (below md) — ResponsiveTable's own mode; the
          kit's table has no equivalent, so this stays plain kit-token markup
          driven by the same breakpoint as the desktop table above. */}
      <div
        className={cn(
          'md:hidden divide-y divide-border-light',
          fill ? 'min-h-0 flex-1 overflow-auto' : bodyMaxHeight ? 'overflow-auto' : '',
        )}
        style={bodyMaxHeight ? { maxHeight: bodyMaxHeight } : undefined}
      >
        {loading
          ? Array.from({ length: skeletonRows }).map((_, r) => (
              <div key={r} className="p-4 space-y-2">
                <div className="h-5 w-1/2 rounded-md bg-surface-control animate-pulse" />
                <div className="h-4 w-3/4 rounded-md bg-surface-control animate-pulse" />
              </div>
            ))
          : rows.map((row, i) => (
              <div
                key={rowKey(row, i)}
                onClick={onRowClick ? () => onRowClick(row, i) : undefined}
                className={cn(
                  'p-4 min-h-[44px]',
                  onRowClick && 'cursor-pointer active:bg-surface-control hover:bg-surface-sunken transition-colors',
                )}
              >
                <div className="text-body font-medium text-text-primary mb-2">{primary.render(row, i)}</div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
                  {cardColumns.map((col) =>
                    col === primary ? null : (
                      <React.Fragment key={col.key}>
                        <dt className="text-label text-text-muted self-center">{col.mobileLabel ?? col.header}</dt>
                        <dd className="text-body text-text-primary min-w-0 text-right">{col.render(row, i)}</dd>
                      </React.Fragment>
                    ),
                  )}
                </dl>
                {(isExpanded?.(row, i) ?? false) && renderExpanded && (
                  <div className="mt-3">{renderExpanded(row, i)}</div>
                )}
              </div>
            ))}
        {!loading && rows.length === 0 && emptyState}
      </div>
    </div>
  )
}
