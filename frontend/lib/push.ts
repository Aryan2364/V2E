import { notificationsApi } from '@/lib/api/notifications'

// Web Push subscription helpers. The service worker (public/sw.js) only handles
// push + notification clicks — it does no asset caching, so it's dev-safe.

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i)
  return outputArray
}

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    typeof Notification !== 'undefined'
  )
}

/**
 * Machine-readable reason why enabling push failed. Surfaced to the user so a
 * failure explains itself instead of a generic "try again". `secure-context`
 * is the common one: browsers only allow push on https:// or http://localhost,
 * never on a LAN address like http://192.168.x.x.
 */
export type EnablePushResult =
  | { ok: true }
  | {
      ok: false
      reason:
        | 'secure-context' // page not served over https/localhost
        | 'unsupported' // browser lacks serviceWorker/PushManager/Notification
        | 'denied' // user (or a prior choice) blocked notifications
        | 'dismissed' // permission prompt closed without choosing
        | 'no-vapid' // backend has no VAPID keys configured
        | 'sw-failed' // service worker failed to register
        | 'subscribe-failed' // pushManager.subscribe threw
      detail?: string
    }

// Plain-English explanation for each way enabling device notifications can fail,
// so the toast tells the user what to actually do instead of "try again".
export const PUSH_ERROR_MESSAGES: Record<Extract<EnablePushResult, { ok: false }>['reason'], string> = {
  'secure-context':
    'Device notifications only work on a secure address. Open the app at http://localhost or an https:// address — not a numeric IP like 192.168.x.x.',
  unsupported:
    "This browser doesn't support device notifications. Try the latest Chrome, Edge, or Firefox on desktop.",
  denied:
    'Notifications are blocked for this site in your browser. Click the padlock in the address bar → Site settings → allow Notifications, then try again.',
  dismissed: 'The permission prompt was closed. Click again and choose Allow to turn on device notifications.',
  'no-vapid': 'Device notifications are not set up on the server yet. Please contact your administrator.',
  'sw-failed': 'The browser could not start the notification service worker. Try a full refresh (Ctrl+Shift+R) and try again.',
  'subscribe-failed':
    "Windows or your browser refused the notification subscription. Check that notifications are enabled in Windows Settings → System → Notifications, and that Focus Assist isn't blocking them.",
}

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null
  try {
    return await navigator.serviceWorker.register('/sw.js')
  } catch {
    return null
  }
}

export type PushStatus = 'unsupported' | 'denied' | 'enabled' | 'disabled'

export async function getPushStatus(): Promise<PushStatus> {
  if (!pushSupported()) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  try {
    const reg = await navigator.serviceWorker.getRegistration('/sw.js')
    const sub = await reg?.pushManager.getSubscription()
    return sub ? 'enabled' : 'disabled'
  } catch {
    return 'disabled'
  }
}

/** Ask permission, subscribe to push, and register with the backend. */
export async function enablePush(orgId: string): Promise<EnablePushResult> {
  // A page must be a "secure context" for the Push API to exist at all. https://
  // and http://localhost qualify; a LAN address like http://192.168.x.x does not,
  // which is the usual reason push silently isn't available in local testing.
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    return { ok: false, reason: 'secure-context' }
  }
  if (!pushSupported()) return { ok: false, reason: 'unsupported' }

  let permission: NotificationPermission
  try {
    permission = await Notification.requestPermission()
  } catch (e) {
    return { ok: false, reason: 'dismissed', detail: String(e) }
  }
  if (permission === 'denied') return { ok: false, reason: 'denied' }
  if (permission !== 'granted') return { ok: false, reason: 'dismissed' }

  const { key } = await notificationsApi.getVapidKey(orgId)
  if (!key) return { ok: false, reason: 'no-vapid' } // backend has no VAPID keys configured

  const reg = await getRegistration()
  if (!reg) return { ok: false, reason: 'sw-failed' }
  await navigator.serviceWorker.ready

  let sub: PushSubscription
  try {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
    })
  } catch (e) {
    return { ok: false, reason: 'subscribe-failed', detail: String(e) }
  }

  const json = sub.toJSON()
  await notificationsApi.subscribePush(orgId, {
    endpoint: sub.endpoint,
    keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' },
    userAgent: navigator.userAgent,
  })
  return { ok: true }
}

export async function disablePush(orgId: string): Promise<void> {
  if (!pushSupported()) return
  const reg = await navigator.serviceWorker.getRegistration('/sw.js')
  const sub = await reg?.pushManager.getSubscription()
  if (sub) {
    await notificationsApi.unsubscribePush(orgId, sub.endpoint).catch(() => null)
    await sub.unsubscribe().catch(() => null)
  }
}

/* ------------------------------------------------------------------
   The phone's first-useful-moment offer (plan §9, kit §41.12 rule 4).
   Replaces NotificationsOptInPrompt on phone, which fires on open.

   Asked only the first time someone does something they'd want to hear
   back about: giving a task, or sending a comment. A "Skip for now" on
   the app's own sheet means it's offered again only from Notification
   choices; the plan's cooldown (3 days, matching the sister product)
   covers the moment-of-use offer only, not that screen's own button.
   Stored per person in localStorage, read/written in try/catch: a
   failure there just means "not declined, not offered" and is never
   fatal to the screen that calls it.
   ------------------------------------------------------------------ */

const OFFER_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000

type PushOfferState = { declinedAt?: number }

function offerKey(userId: string): string {
  return `v2e:phone:push-offer:${encodeURIComponent(userId)}`
}

function readOfferState(userId: string): PushOfferState {
  try {
    const raw = window.localStorage.getItem(offerKey(userId))
    return raw ? (JSON.parse(raw) as PushOfferState) : {}
  } catch {
    return {}
  }
}

function writeOfferState(userId: string, state: PushOfferState): void {
  try {
    window.localStorage.setItem(offerKey(userId), JSON.stringify(state))
  } catch {
    /* private mode / full quota: the offer just isn't remembered */
  }
}

/**
 * True when the phone-notifications sheet should be shown right now, at a
 * moment of use. Call this from the success path of giving a task or
 * sending a comment — never on first open. Synchronous and side-effect
 * free; the caller opens the sheet when it returns true.
 */
export function shouldOfferPushNow(userId: string | undefined): boolean {
  if (typeof window === 'undefined' || !userId) return false
  if (!pushSupported()) return false
  if (typeof Notification === 'undefined' || Notification.permission !== 'default') return false
  const state = readOfferState(userId)
  if (state.declinedAt && Date.now() - state.declinedAt < OFFER_COOLDOWN_MS) return false
  return true
}

/** Records a "Skip for now" on the app's own sheet, starting the cooldown. */
export function declinePushOffer(userId: string | undefined): void {
  if (!userId) return
  writeOfferState(userId, { declinedAt: Date.now() })
}
