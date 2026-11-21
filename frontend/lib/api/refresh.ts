import axios from 'axios'

// ─── Single-flight token refresh (cross-tab safe) ────────────────────────────
//
// The refresh token lives in an httpOnly cookie (set by the server, invisible to
// scripts), so this module never sees it. It only asks the server to refresh and
// stores the new ACCESS token.
//
// The refresh token rotates on every use and only a short "grace" window keeps
// the previous one alive server-side. So if several callers refresh at once —
// multiple browser tabs waking together, or this tab's proactive timer racing
// the reactive 401 interceptor — all but one would hand the server an
// already-rotated token and get force-logged-out.
//
// This module collapses every concurrent refresh into ONE network call:
//   • Across tabs: the Web Locks API serialises `v2e_token_refresh`, so only one
//     tab refreshes; the others wait, then find the freshly-stored token and use
//     it without hitting the network.
//   • Within a tab: a shared in-flight promise (and the same re-check) dedupes.
//
// It also refuses to nuke the session on a *transient* failure (network blip /
// 5xx). Only a definitive rejection (401, or no refresh token at all) is treated
// as "session is really gone".

const BASE_URL = ''

function getAccess(): string | null {
  return typeof window !== 'undefined' ? localStorage.getItem('access_token') : null
}
// A refresh token written to localStorage by an earlier version of the app. It is sent
// once, in the request body, so the server can move that session into the cookie; the
// copy is then deleted. New sign-ins never write it.
function getLegacyRefresh(): string | null {
  return typeof window !== 'undefined' ? localStorage.getItem('refresh_token') : null
}

// Is this access token already past (or within 5s of) its expiry?
function isExpired(token: string | null): boolean {
  if (!token) return true
  try {
    const json = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return typeof json.exp === 'number' ? Date.now() >= json.exp * 1000 - 5_000 : false
  } catch {
    return false
  }
}

export class RefreshError extends Error {
  /** true = the session is definitively gone (log out); false = transient, keep session. */
  definitive: boolean
  constructor(message: string, definitive: boolean) {
    super(message)
    this.name = 'RefreshError'
    this.definitive = definitive
  }
}

// The actual refresh, run while holding the lock. `prevAccess` is the token the
// caller already tried with — if storage now holds a newer, still-valid token,
// another caller beat us to it and we reuse that instead of refreshing again.
async function doRefresh(prevAccess: string | null): Promise<string> {
  const current = getAccess()
  if (current && current !== prevAccess && !isExpired(current)) {
    return current
  }

  // With no cookie (never signed in, signed out, or the session ended) the server
  // answers 401, which is the definitive "session is gone" below.
  const legacy = getLegacyRefresh()

  try {
    const { data } = await axios.post(
      `${BASE_URL}/api/v1/auth/refresh`,
      legacy ? { refresh_token: legacy } : {},
      { withCredentials: true, headers: { 'X-V2E-Auth': 'cookie' } },
    )
    const access: string | undefined = data.data?.access_token ?? data.access_token
    if (!access) throw new RefreshError('refresh_failed', true)
    if (typeof window !== 'undefined') {
      localStorage.setItem('access_token', access)
      // The session now lives in the cookie, so the old copy must go: the server
      // prefers a token in the body, and a stale one would be refused for ever.
      if (legacy) localStorage.removeItem('refresh_token')
    }
    return access
  } catch (err) {
    if (err instanceof RefreshError) throw err
    const status = (err as { response?: { status?: number } })?.response?.status
    // 401 → the refresh token is truly invalid → definitive logout.
    // Anything else (offline, 5xx, timeout) → transient → keep the session.
    throw new RefreshError('refresh_failed', status === 401)
  }
}

let inflight: Promise<string> | null = null

/**
 * Get a fresh access token, coordinating with every other tab and every other
 * in-tab caller so the server sees at most one refresh per rotation.
 * @param prevAccess the access token the caller already failed/expired with.
 */
export async function refreshAccessToken(prevAccess: string | null): Promise<string> {
  if (typeof navigator !== 'undefined' && 'locks' in navigator) {
    // Cross-tab serialisation. `ifAvailable:false` (default) makes waiters queue.
    return navigator.locks.request('v2e_token_refresh', () => doRefresh(prevAccess))
  }
  // Fallback for browsers without the Web Locks API: in-tab single-flight only.
  if (!inflight) {
    inflight = doRefresh(prevAccess).finally(() => {
      inflight = null
    })
  }
  return inflight
}
