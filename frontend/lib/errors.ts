import axios from 'axios'

/**
 * The user-facing sentence for a failed call: the server's own message when it
 * sent one (400 / 403 / 409 ...; a validation array yields its first entry),
 * otherwise the fallback. Never returns a raw exception text, so nothing
 * technical reaches the screen. Use it in `catch (e: unknown)` blocks.
 */
export function getErrorMessage(e: unknown, fallback = 'Something went wrong. Try again.'): string {
  if (axios.isAxiosError(e)) {
    const message = (e.response?.data as { message?: unknown } | undefined)?.message
    if (typeof message === 'string' && message) return message
    if (Array.isArray(message) && typeof message[0] === 'string') return message[0]
  }
  return fallback
}
