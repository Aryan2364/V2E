import axios from 'axios'

/**
 * One place to turn a failed API call into the sentence the user sees.
 *
 *   getErrorMessage(err)                                   // what the server said
 *   getErrorMessage(err, { fallback: 'Could not save the task.' })
 *
 * The backend decides the words. Every error response carries a message: either the
 * one written where the error was thrown, or the default for its status
 * (backend/src/common/http/error-messages.ts). Show it as it is. To change what users
 * read, change it on the backend, so the API and the screen never disagree.
 *
 * Order, first match wins:
 *   1. The server's message.
 *   2. No connection at all: ERROR_MESSAGES.network.
 *   3. `fallback`, for a call whose failure needs context-specific words.
 *   4. The default for the status, then ERROR_MESSAGES.unknown. These only show when
 *      the response did not come from the API (a proxy error page, a non-JSON reply).
 */

/** Defaults by HTTP status. Kept in step with backend/src/common/http/error-messages.ts. */
export const ERROR_MESSAGES = {
  network: 'We could not reach the server. Check your connection and try again.',
  unknown: 'Something went wrong. Try again.',
  byStatus: {
    400: 'Some of the details are not valid. Check them and try again.',
    401: 'Your session has ended. Sign in again to continue.',
    403: 'You are not allowed to do this.',
    404: 'We could not find this. It may have been moved or deleted.',
    405: 'This action is not supported.',
    408: 'The request took too long. Try again.',
    409: 'This clashes with a recent change. Refresh the page and try again.',
    413: 'This is too large to upload. Choose a smaller file and try again.',
    415: 'This file type is not supported.',
    422: 'Some of the details are not valid. Check them and try again.',
    429: 'Too many attempts. Wait a moment and try again.',
    500: 'Something went wrong on our side. Try again in a moment.',
    502: 'The service is not reachable right now. Try again in a moment.',
    503: 'The service is not available right now. Try again in a moment.',
    504: 'The service took too long to answer. Try again in a moment.',
  } as Readonly<Record<number, string>>,
} as const

export interface ErrorMessageOptions {
  /** Words for this call when the server sent none. Beats the per-status default. */
  fallback?: string
}

/** HTTP status of a failed call; undefined when there was no response (offline, timeout). */
export function getErrorStatus(err: unknown): number | undefined {
  return axios.isAxiosError(err) ? err.response?.status : undefined
}

/** The message the server sent with a failed call, if it sent one. */
export function getServerMessage(err: unknown): string | undefined {
  if (!axios.isAxiosError(err)) return undefined
  const message = (err.response?.data as { message?: unknown } | undefined)?.message
  if (typeof message === 'string' && message.trim()) return message
  if (Array.isArray(message)) {
    const parts = message.filter((m): m is string => typeof m === 'string' && !!m.trim())
    if (parts.length) return parts.join(' ')
  }
  return undefined
}

/** The sentence to show for a failed API call. See the file comment for the order. */
export function getErrorMessage(err: unknown, options: ErrorMessageOptions = {}): string {
  const server = getServerMessage(err)
  if (server) return server

  if (axios.isAxiosError(err) && !err.response) return ERROR_MESSAGES.network
  if (options.fallback) return options.fallback

  const status = getErrorStatus(err)
  if (status !== undefined) {
    return ERROR_MESSAGES.byStatus[status] ?? (status >= 500 ? ERROR_MESSAGES.byStatus[500] : ERROR_MESSAGES.unknown)
  }
  return ERROR_MESSAGES.unknown
}
