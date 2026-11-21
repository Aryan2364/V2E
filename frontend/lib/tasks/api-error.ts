import { getErrorMessage } from '@/lib/api/errors'

/**
 * The server's own sentence for a failed task call (400 / 403 ...), or the
 * given fallback. Phone sheets show it inline so a refusal always says why.
 * A thin name for getErrorMessage (lib/api/errors.ts), kept for its callers.
 */
export function apiErrorMessage(e: unknown, fallback: string): string {
  return getErrorMessage(e, { fallback })
}
