import axios from 'axios'

/**
 * The server's own sentence for a failed task call (400 / 403 ...), or the
 * given fallback. Phone sheets show it inline so a refusal always says why.
 */
export function apiErrorMessage(e: unknown, fallback: string): string {
  if (axios.isAxiosError(e)) {
    const message = (e.response?.data as { message?: unknown } | undefined)?.message
    if (typeof message === 'string' && message) return message
    if (Array.isArray(message) && typeof message[0] === 'string') return message[0]
  }
  return fallback
}
