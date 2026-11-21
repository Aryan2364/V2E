/**
 * Which proxies may tell us the client's real IP (Express `trust proxy`).
 *
 * Requests reach the backend through Caddy and the Next.js /api proxy, so the socket
 * address is a proxy's, never the user's. Caddy puts the real client IP in
 * X-Forwarded-For and Next passes it on. By default we trust that header only when it
 * was added by a proxy on loopback or a private network (Docker, a proxy on the
 * host); an address written by the client itself is never trusted past. Rate limits
 * keyed by IP (common/rate-limit) depend on this.
 *
 * Override with TRUST_PROXY: a hop count ("2"), "true" / "false", or an Express
 * trust list ("loopback, 10.0.0.0/8").
 */
export const DEFAULT_TRUST_PROXY = 'loopback, linklocal, uniquelocal';

export function trustProxySetting(raw: string | undefined): boolean | number | string {
  const value = (raw ?? '').trim();
  if (!value) return DEFAULT_TRUST_PROXY;
  if (/^\d+$/.test(value)) return Number(value);
  if (value === 'true' || value === 'false') return value === 'true';
  return value;
}
