export const MAX_PAGE_SIZE = 200;

/**
 * Clamps a client-supplied page size to [1, max]. Non-numeric / NaN input falls back to
 * `fallback`, so `?limit=abc` can never reach Prisma as `take: NaN`.
 */
export function clampTake(raw: unknown, fallback = 25, max = MAX_PAGE_SIZE): number {
  const n = typeof raw === 'string' ? parseInt(raw, 10) : typeof raw === 'number' ? raw : NaN;
  const v = Number.isFinite(n) ? Math.trunc(n) : fallback;
  return Math.min(Math.max(v, 1), max);
}
