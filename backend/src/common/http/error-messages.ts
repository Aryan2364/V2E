import { STATUS_CODES } from 'http';

/**
 * The default sentence a user sees for each HTTP error status.
 *
 * Used by GlobalExceptionFilter when an error carries no message of its own, e.g.
 * `throw new ForbiddenException()` or a guard refusing a request. To say something
 * more specific, pass your own message where you throw; it always wins:
 *
 *   throw new NotFoundException('This task was deleted.');
 *
 * Wording follows the frontend writing rules (FRONTEND_RULES.md 7.2 and 37): plain
 * English, the cause then the next action, no "Error:" prefix, no exclamation marks.
 * The frontend keeps the same sentences in lib/api/errors.ts for failures that never
 * reach the server (no connection, a proxy error page).
 */
export const DEFAULT_ERROR_MESSAGES: Readonly<Record<number, string>> = {
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
};

/** The default sentence for a status; unknown 4xx / 5xx codes fall back to 400 / 500. */
export function defaultErrorMessage(status: number): string {
  return (
    DEFAULT_ERROR_MESSAGES[status] ??
    (status >= 500 ? DEFAULT_ERROR_MESSAGES[500] : DEFAULT_ERROR_MESSAGES[400])
  );
}

/**
 * True when a message is only the framework's stock text rather than words a
 * developer wrote: "Forbidden", "Forbidden resource" (a guard's refusal),
 * "Cannot GET /path" (no such route), "ThrottlerException: Too Many Requests",
 * "Internal server error" and similar. Those are replaced by the default above.
 */
export function isStockMessage(message: unknown, status: number): boolean {
  if (typeof message !== 'string') return !Array.isArray(message);
  const m = message.trim().toLowerCase();
  if (!m) return true;
  if (m === (STATUS_CODES[status] ?? '').toLowerCase()) return true;
  return (
    m === 'forbidden resource' ||
    m === 'internal server error' ||
    m.startsWith('throttlerexception') ||
    /^cannot (get|post|put|patch|delete|head|options) \//.test(m)
  );
}
