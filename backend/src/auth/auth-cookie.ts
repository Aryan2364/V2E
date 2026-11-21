import type { Request, Response } from 'express';

/**
 * The refresh token as an httpOnly cookie.
 *
 * Why: a refresh token kept in localStorage can be read by any script that runs on
 * the page (an XSS bug), and it lives 30 days. An httpOnly cookie cannot be read by
 * scripts at all, so the long-lived credential never reaches JavaScript.
 *
 * Opt-in per request. A client sends `X-V2E-Auth: cookie` (the web app does, on every
 * call through its API client). Only then does the server set the cookie and leave
 * the refresh token OUT of the response body. A client without the header keeps the
 * old behaviour (token in the body, token in the request body), so an old tab, a
 * cached PWA or a future wrapper app on another origin is not broken by this.
 *
 * Scope of the cookie:
 *   - httpOnly                         — scripts cannot read it
 *   - Secure                           — HTTPS only in production (AUTH_COOKIE_SECURE)
 *   - SameSite=Strict                  — never sent on a cross-site request
 *   - Path=/api/v1/auth                — only sent to the auth endpoints, never to the
 *                                        rest of the API
 *   - no Domain                        — host-only, so a sibling subdomain cannot read it
 * and the cookie-based refresh also requires the custom header above, which a
 * cross-site page cannot send without a CORS preflight (our CORS allows only the
 * configured origins). That is the CSRF guard.
 */

export const REFRESH_COOKIE = 'v2e_refresh';
export const AUTH_MODE_HEADER = 'x-v2e-auth';
const COOKIE_PATH = '/api/v1/auth';

/** Did this request opt in to cookie mode? */
export function isCookieMode(req: Request): boolean {
  return String(req.headers[AUTH_MODE_HEADER] ?? '').toLowerCase() === 'cookie';
}

/** HTTPS-only cookie in production; plain HTTP is fine for local development. */
function cookieSecure(): boolean {
  const flag = process.env.AUTH_COOKIE_SECURE;
  if (flag !== undefined && flag !== '') return flag.toLowerCase() === 'true';
  return process.env.NODE_ENV === 'production';
}

/** The refresh cookie's value from the request, or null. No cookie-parser needed. */
export function readRefreshCookie(req: Request): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== REFRESH_COOKIE) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim()) || null;
    } catch {
      return null;
    }
  }
  return null;
}

/** The token's own expiry in ms from now, so the cookie lives exactly as long as the token. */
function lifetimeMs(refreshToken: string): number {
  try {
    const payload = JSON.parse(
      Buffer.from(refreshToken.split('.')[1], 'base64url').toString('utf8'),
    ) as {
      exp?: unknown;
    } | null;
    if (typeof payload?.exp === 'number')
      return Math.max(0, payload.exp * 1000 - Date.now());
  } catch {
    /* fall through */
  }
  return 30 * 24 * 60 * 60 * 1000;
}

export function setRefreshCookie(res: Response, refreshToken: string): void {
  res.cookie(REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: 'strict',
    path: COOKIE_PATH,
    maxAge: lifetimeMs(refreshToken),
  });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: 'strict',
    path: COOKIE_PATH,
  });
}

/**
 * Shape a token-issuing response for the client that asked.
 *   cookie mode  : set the cookie, return the body WITHOUT the refresh token.
 *   legacy mode  : return the body unchanged.
 * A result with no refresh token (the organisation-selection response) clears any
 * old cookie in cookie mode, so no earlier session sits beside the picker.
 */
export function withRefreshCookie<T extends Record<string, any>>(
  req: Request,
  res: Response,
  result: T,
): Omit<T, 'refresh_token'> | T {
  if (!isCookieMode(req)) return result;
  if (typeof result?.refresh_token === 'string') {
    setRefreshCookie(res, result.refresh_token);
    const rest = { ...result };
    delete rest.refresh_token;
    return rest;
  }
  clearRefreshCookie(res);
  return result;
}
