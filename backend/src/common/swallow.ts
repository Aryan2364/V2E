import { Logger } from '@nestjs/common';

const logger = new Logger('BestEffort');

/**
 * For fire-and-forget / best-effort promises: `.catch(swallow('Service.method', null))`.
 * Keeps the swallow-and-continue semantics but leaves a warn-level trace instead of
 * silently discarding the failure.
 */
export function swallow<T = undefined>(
  context: string,
  fallback?: T,
): (err: unknown) => T {
  return (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`${context} failed (ignored): ${msg}`);
    return fallback as T;
  };
}
