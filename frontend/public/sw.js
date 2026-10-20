/* V2E service worker.
 *
 * Registered at /sw.js, scope /. Two jobs:
 *
 * 1. PHONE NOTIFICATIONS, in every layout (unchanged behaviour): `push` shows
 *    the notification, `notificationclick` opens its link. lib/push.ts
 *    registers this file when someone turns device notifications on, on a
 *    computer or a phone. Added for the phone (FRONTEND_RULES_PHONE.md 41.12):
 *      - the app icon badge (Badging API), when the payload carries a
 *        badge_count: set to that number, cleared at 0;
 *      - a click focuses a V2E window that is already open and moves it to the
 *        link, and opens a new window only when none is open.
 *
 * 2. THE INSTALLED PHONE APP OPENING OFFLINE - 41.14 rule 9. ON PHONES ONLY:
 *    the worker reads the device the same way the server guesses the layout
 *    (lib/layout.server.ts: the mobile client hint, or the user agent), and on
 *    a computer it never answers a fetch, so desktop is exactly as before.
 *      - Page HTML is NEVER cached: pages are private and change. A
 *        navigation always goes to the network. When it fails (no
 *        connection) or has not answered in 8 seconds, the offline screen
 *        (app/offline/page.tsx) answers instead, cached ahead of time, so the
 *        installed app never shows the browser's error page. The address
 *        stays the one asked for, so "Try again" reloads that screen.
 *      - /api is NEVER cached or answered here, nor is anything that is not
 *        a GET, nor other sites. They pass straight through.
 *      - Static assets only - Next's content-hashed build files
 *        (/_next/static/*), the app icons and the favicon - are kept the first
 *        time they are fetched. A content-hashed file can never be stale (a
 *        new release asks for new names), so it is served from the cache; an
 *        icon is served from the cache and refreshed behind it. The runtime
 *        cache is trimmed so it cannot grow for ever.
 *
 * Plain JavaScript, no build step and no package. Kept small on purpose.
 */

/* ── Which device is this? (mirrors lib/layout.server.ts) ─────────────────── */

function v2eIsPhone() {
  const nav = self.navigator || {}
  if (nav.userAgentData && typeof nav.userAgentData.mobile === 'boolean') {
    return nav.userAgentData.mobile
  }
  const ua = nav.userAgent || ''
  return (
    /iPhone|iPod|Windows Phone|Opera Mini|IEMobile/i.test(ua) ||
    (/Android/i.test(ua) && /Mobile/i.test(ua)) ||
    (/Firefox/i.test(ua) && /Mobile/i.test(ua))
  )
}

const V2E_ON_PHONE = v2eIsPhone()

/* ── Caches ───────────────────────────────────────────────────────────────── */

/** Raise only when a change here makes an existing cache unreadable. */
const V2E_CACHE_VERSION = 1
const V2E_CACHE_PREFIX = 'v2e-'
/** The offline screen and the files it draws with. Never trimmed. */
const V2E_OFFLINE_CACHE = `${V2E_CACHE_PREFIX}offline-${V2E_CACHE_VERSION}`
/** Static files seen while the app is used. Trimmed to V2E_STATIC_MAX entries. */
const V2E_STATIC_CACHE = `${V2E_CACHE_PREFIX}static-${V2E_CACHE_VERSION}`
const V2E_STATIC_MAX = 400

const V2E_OFFLINE_URL = '/offline'

/*
 * Static assets only.
 *   - Content-hashed build files: /_next/static/... whose file name carries a
 *     hash, with no query string. Served cache-first: a hashed name never
 *     changes content. A development build's files are not hashed
 *     (/_next/static/chunks/app/page.js), so they are never cached and a dev
 *     server is never fought.
 *   - The app icons, favicon and icon mark: not hashed, so served from the
 *     cache while a fresh copy is fetched behind it.
 */
const V2E_BUILD_FILE = /^\/_next\/static\//
const V2E_HASHED_NAME = /(?:^|[-.])[0-9a-f]{8,}(?:[-.]|$)/i
const V2E_ICON_PATH = /^\/(?:icons\/[^/]+|favicon\.ico|icon\.svg)$/

function v2eIsHashedBuildFile(url) {
  if (!V2E_BUILD_FILE.test(url.pathname) || url.search) return false
  const name = url.pathname.slice(url.pathname.lastIndexOf('/') + 1)
  return V2E_HASHED_NAME.test(name)
}

/** A build file named inside HTML or a stylesheet. */
const V2E_BUILT_FILE_IN_TEXT = /\/_next\/static\/[^"'\\\s<>()]+/g

/** Every request this worker makes has a deadline (kit section 14 rule 4). */
const V2E_DEADLINE_MS = 15000
/** A navigation slower than this gets the offline screen. */
const V2E_NAVIGATION_DEADLINE_MS = 8000

function v2eFetch(input, init) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), V2E_DEADLINE_MS)
  return fetch(input, { ...(init || {}), signal: controller.signal }).finally(() => clearTimeout(timer))
}

function v2eBuiltFiles(text) {
  return Array.from(new Set(text.match(V2E_BUILT_FILE_IN_TEXT) || []))
}

async function v2eCacheFile(cache, url) {
  try {
    const response = await v2eFetch(url, { cache: 'reload', credentials: 'same-origin' })
    if (!response.ok) return null
    const text = /\.css(?:\?|$)/.test(url) ? await response.clone().text() : null
    await cache.put(url, response)
    return text
  } catch {
    return null
  }
}

/**
 * Caches the offline screen and the files it needs (its scripts, styles and
 * the fonts its styles name), unless the cached copy is already this release's.
 */
async function v2eCacheOfflineScreen() {
  const response = await v2eFetch(V2E_OFFLINE_URL, { cache: 'reload', credentials: 'same-origin' })
  if (!response.ok) throw new Error(`The offline screen could not be fetched: ${response.status}`)
  const html = await response.clone().text()

  const cache = await caches.open(V2E_OFFLINE_CACHE)
  const current = await cache.match(V2E_OFFLINE_URL)
  if (current && (await current.text()) === html) return

  await cache.put(V2E_OFFLINE_URL, response)
  const files = v2eBuiltFiles(html)
  const styles = await Promise.all(files.map((url) => v2eCacheFile(cache, url)))
  const fromStyles = v2eBuiltFiles(styles.filter(Boolean).join('\n')).filter((url) => !files.includes(url))
  await Promise.all(fromStyles.map((url) => v2eCacheFile(cache, url)))

  // Drop files of an older offline screen that this one no longer names.
  const keep = new Set([V2E_OFFLINE_URL, ...files, ...fromStyles].map((u) => new URL(u, self.location.origin).href))
  const keys = await cache.keys()
  await Promise.all(keys.filter((req) => !keep.has(req.url)).map((req) => cache.delete(req)))
}

let v2ePutsSinceTrim = 0
async function v2eTrimStatic(cache) {
  v2ePutsSinceTrim += 1
  if (v2ePutsSinceTrim < 25) return
  v2ePutsSinceTrim = 0
  const keys = await cache.keys()
  const extra = keys.length - V2E_STATIC_MAX
  if (extra > 0) await Promise.all(keys.slice(0, extra).map((req) => cache.delete(req)))
}

/* ── Lifecycle ────────────────────────────────────────────────────────────── */

self.addEventListener('install', (event) => {
  // As before: a new worker takes over at once.
  self.skipWaiting()
  // On a phone, the offline screen is cached before the worker takes over.
  // Best effort: if it fails now, the page asks again on its next load.
  if (V2E_ON_PHONE) event.waitUntil(v2eCacheOfflineScreen().catch(() => {}))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(
        names
          .filter((n) => n.startsWith(V2E_CACHE_PREFIX) && n !== V2E_OFFLINE_CACHE && n !== V2E_STATIC_CACHE)
          .map((n) => caches.delete(n)),
      )
      await self.clients.claim()
    })(),
  )
})

/* The phone page asks once per load (lib/service-worker.ts), so the cached
   offline screen follows each new release. */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'REFRESH_OFFLINE' && V2E_ON_PHONE) {
    event.waitUntil(v2eCacheOfflineScreen().catch(() => {}))
  }
})

/* ── Fetch (phones only) ──────────────────────────────────────────────────── */

async function v2eOfflineScreen() {
  const cache = await caches.open(V2E_OFFLINE_CACHE)
  return cache.match(V2E_OFFLINE_URL)
}

const V2E_TOO_SLOW = Symbol('too slow')

function v2eNavigate(event) {
  const network = fetch(event.request)
  // Settle the request even if the race below stops waiting for it.
  event.waitUntil(network.then(() => undefined, () => undefined))

  return (async () => {
    let timer
    const deadline = new Promise((resolve) => {
      timer = setTimeout(() => resolve(V2E_TOO_SLOW), V2E_NAVIGATION_DEADLINE_MS)
    })
    try {
      const first = await Promise.race([network, deadline])
      if (first !== V2E_TOO_SLOW) return first
      const offline = await v2eOfflineScreen()
      return offline || (await network)
    } catch (error) {
      const offline = await v2eOfflineScreen()
      if (offline) return offline
      throw error
    } finally {
      clearTimeout(timer)
    }
  })()
}

function v2eKeep(cache, request, response) {
  if (response.status === 200 && response.type === 'basic') {
    cache
      .put(request, response.clone())
      .then(() => v2eTrimStatic(cache))
      .catch(() => {})
  }
  return response
}

/** A content-hashed build file: the cached copy, or the network, keeping it. */
async function v2eBuildFile(request) {
  const offline = await caches.open(V2E_OFFLINE_CACHE)
  const fromOffline = await offline.match(request, { ignoreVary: true })
  if (fromOffline) return fromOffline
  const cache = await caches.open(V2E_STATIC_CACHE)
  const cached = await cache.match(request, { ignoreVary: true })
  if (cached) return cached
  return v2eKeep(cache, request, await v2eFetch(request))
}

/** An icon: the cached copy at once, refreshed from the network behind it. */
async function v2eIcon(event) {
  const request = event.request
  const cache = await caches.open(V2E_STATIC_CACHE)
  const cached = await cache.match(request, { ignoreVary: true })
  const fresh = v2eFetch(request).then((response) => v2eKeep(cache, request, response))
  if (cached) {
    event.waitUntil(fresh.catch(() => {}))
    return cached
  }
  return fresh
}

self.addEventListener('fetch', (event) => {
  if (!V2E_ON_PHONE) return
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  // The API is never cached or answered here.
  if (url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate') {
    // The offline screen itself always comes from the network when it can.
    if (url.pathname === V2E_OFFLINE_URL) return
    event.respondWith(v2eNavigate(event))
    return
  }
  if (v2eIsHashedBuildFile(url)) {
    event.respondWith(v2eBuildFile(request))
    return
  }
  if (V2E_ICON_PATH.test(url.pathname)) {
    event.respondWith(v2eIcon(event))
  }
  // Everything else (RSC payloads, data) passes straight through.
})

/* ── Push notifications (every layout) ────────────────────────────────────── */

/** The app icon badge (Badging API), where the browser has one. */
function v2eSetBadge(count) {
  const nav = self.navigator
  if (!nav || typeof count !== 'number' || !Number.isFinite(count)) return Promise.resolve()
  try {
    if (count > 0 && typeof nav.setAppBadge === 'function') return nav.setAppBadge(Math.floor(count)).catch(() => {})
    if (count <= 0 && typeof nav.clearAppBadge === 'function') return nav.clearAppBadge().catch(() => {})
  } catch {
    /* not supported here */
  }
  return Promise.resolve()
}

const V2E_IS_ANDROID = /Android/i.test((self.navigator && self.navigator.userAgent) || '')

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { title: 'V2E', body: event.data ? event.data.text() : '' }
  }
  const title = data.title || 'V2E'
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, {
        body: data.body || '',
        // No large icon on Android: its header line already shows the V2E
        // symbol (the badge below) and the app name, so the big blue logo box
        // only repeated it. A computer's notification has no badge, so it
        // keeps the logo there.
        ...(V2E_IS_ANDROID ? {} : { icon: '/icons/icon-192.png' }),
        // Android draws the status-bar icon from the badge's alpha only, so it
        // must be the white symbol on transparent - the full-colour app icon
        // came out as a plain square.
        badge: '/icons/badge-96.png',
        data: { link: data.link || '/dashboard/notifications' },
      }),
      'badge_count' in data ? v2eSetBadge(Number(data.badge_count)) : Promise.resolve(),
    ]),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const link = (event.notification.data && event.notification.data.link) || '/dashboard/notifications'
  const target = new URL(link, self.location.origin).href

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const ours = windows.filter((c) => {
        try {
          return new URL(c.url).origin === self.location.origin
        } catch {
          return false
        }
      })
      // Prefer a window already on the link, then the focused one, then any.
      const client =
        ours.find((c) => c.url === target) || ours.find((c) => c.focused) || ours[0] || null

      if (!client) {
        await self.clients.openWindow(target)
        return
      }
      // Focus first, while the click still counts as the person's action.
      let focused = client
      try {
        focused = (await client.focus()) || client
      } catch {
        /* some browsers refuse; navigate anyway */
      }
      if (focused.url === target) return
      try {
        if (typeof focused.navigate === 'function') {
          await focused.navigate(target)
          return
        }
      } catch {
        /* an uncontrolled window cannot be navigated from here */
      }
      await self.clients.openWindow(target)
    })(),
  )
})
