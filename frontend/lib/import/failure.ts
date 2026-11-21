import type { ImportIssue } from './types'

/**
 * Fixed vocabulary for the exported "failure_status" column: the same categories
 * for every file, so the column sorts and filters reliably in Excel. A row's blocking
 * (error) issues are mapped through `fieldLabels`; unknown fields become "Other".
 */
export function failureStatuses(
  issues: readonly ImportIssue[],
  fieldLabels: Record<string, string>,
  opts: { duplicate?: boolean } = {},
): string[] {
  const set = new Set<string>()
  if (opts.duplicate) set.add('Duplicate')
  for (const iss of issues) {
    if (iss.severity !== 'error') continue
    set.add(fieldLabels[iss.field ?? ''] ?? 'Other')
  }
  if (set.size === 0) set.add('Other')
  return Array.from(set)
}
