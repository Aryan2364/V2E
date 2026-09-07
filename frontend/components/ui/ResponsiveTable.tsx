'use client'

import React from 'react'

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
  /** Ref to the desktop scroll container — lets callers persist/restore its scroll position. */
  scrollContainerRef?: React.Ref<HTMLDivElement>
  /** Override the header row (thead) styling — e.g. a coloured header band. Defaults to the light-gray strip. */
  headerRowClassName?: string
  /** Override each header cell (th) bg + text — e.g. white-on-blue. Defaults to gray-on-light. */
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
  scrollContainerRef,
  headerRowClassName = 'bg-[#F8FAFC] border-b border-[#E2E8F0]',
  headerCellClassName = 'text-[#475569] bg-[#F8FAFC]',
  minTableWidth,
}: ResponsiveTableProps<T>) {
  const primaryIdx = Math.max(0, columns.findIndex((c) => c.primary))
  const primary = columns[primaryIdx]
  const cardColumns = columns.filter((c) => !c.hideOnMobile)
  const card =
    'bg-white border border-[#E2E8F0] rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.08)] overflow-hidden'
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
    <div className={`${card} ${className}`}>
      {toolbar && (
        <div className="flex items-center justify-between gap-3 px-4 md:px-5 py-3 border-b border-[#E2E8F0]">
          {toolbar}
        </div>
      )}

      {/* Desktop / tablet: real table (md+) */}
      <div
        ref={scrollContainerRef}
        className={`table-scroll hidden md:block ${bodyMaxHeight ? 'overflow-auto' : 'overflow-x-auto'}`}
        style={bodyMaxHeight ? { maxHeight: bodyMaxHeight } : undefined}
      >
        <table
          className="w-full text-sm"
          style={
            minTableWidth
              ? { minWidth: typeof minTableWidth === 'number' ? `${minTableWidth}px` : minTableWidth }
              : undefined
          }
        >
          <thead className={`${headerRowClassName} ${bodyMaxHeight ? 'sticky top-0 z-10' : ''}`}>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={[
                    'px-4 py-3 text-xs font-semibold uppercase tracking-wider whitespace-nowrap',
                    headerCellClassName,
                    alignClass[col.align ?? 'left'],
                    col.desktopHiddenBelow ? desktopHideClass[col.desktopHiddenBelow] : '',
                    col.headerClassName ?? '',
                  ].join(' ')}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F1F5F9]">
            {loading
              ? Array.from({ length: skeletonRows }).map((_, r) => (
                  <tr key={r}>
                    {columns.map((col) => (
                      <td key={col.key} className="px-4 py-4">
                        <div className="h-4 rounded-md bg-[#F1F5F9] animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              : rows.map((row, i) => {
                  const expanded = isExpanded?.(row, i) ?? false
                  return (
                    <React.Fragment key={rowKey(row, i)}>
                      <tr
                        onClick={onRowClick ? () => onRowClick(row, i) : undefined}
                        className={`transition-colors hover:bg-[#F8FAFC] ${onRowClick ? 'cursor-pointer' : ''} ${expanded ? 'bg-[#F8FAFC]' : ''}`}
                      >
                        {columns.map((col) => (
                          <td
                            key={col.key}
                            className={[
                              'px-4 py-3.5 text-[#1E293B]',
                              alignClass[col.align ?? 'left'],
                              col.desktopHiddenBelow ? desktopHideClass[col.desktopHiddenBelow] : '',
                              col.cellClassName ?? '',
                            ].join(' ')}
                          >
                            {col.render(row, i)}
                          </td>
                        ))}
                      </tr>
                      {expanded && renderExpanded && (
                        <tr className="bg-[#F8FAFC]">
                          <td colSpan={columns.length} className="px-4 pb-4 pt-0 border-b border-[#E2E8F0]">
                            {renderExpanded(row, i)}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })}
          </tbody>
        </table>
      </div>

      {/* Mobile: stacked cards (below md) */}
      <div
        className={`md:hidden divide-y divide-[#E2E8F0] ${bodyMaxHeight ? 'overflow-auto' : ''}`}
        style={bodyMaxHeight ? { maxHeight: bodyMaxHeight } : undefined}
      >
        {loading
          ? Array.from({ length: skeletonRows }).map((_, r) => (
              <div key={r} className="p-4 space-y-2">
                <div className="h-5 w-1/2 rounded-md bg-[#F1F5F9] animate-pulse" />
                <div className="h-4 w-3/4 rounded-md bg-[#F1F5F9] animate-pulse" />
              </div>
            ))
          : rows.map((row, i) => (
              <div
                key={rowKey(row, i)}
                onClick={onRowClick ? () => onRowClick(row, i) : undefined}
                className={`p-4 min-h-[44px] ${onRowClick ? 'cursor-pointer active:bg-[#F1F5F9] hover:bg-[#F8FAFC] transition-colors' : ''}`}
              >
                <div className="text-[15px] font-semibold text-[#0F172A] mb-2">
                  {primary.render(row, i)}
                </div>
                <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1.5">
                  {cardColumns.map((col) =>
                    col === primary ? null : (
                      <React.Fragment key={col.key}>
                        <dt className="text-xs font-medium text-[#64748B] uppercase tracking-wide self-center">
                          {col.mobileLabel ?? col.header}
                        </dt>
                        <dd className="text-sm text-[#1E293B] min-w-0 text-right">
                          {col.render(row, i)}
                        </dd>
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
