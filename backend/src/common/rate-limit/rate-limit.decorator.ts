import { applyDecorators, SetMetadata } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

/** One window: at most `limit` requests per `ttl` milliseconds. */
export interface RateWindow {
  limit: number;
  ttl: number;
}

export interface AuthRateLimitOptions {
  /**
   * Keyed by client IP + the account named in the request (email / phone, else the
   * signed-in user). Stops one machine hammering one account without touching
   * colleagues on the same office IP, who sign in to their own accounts.
   */
  perIp?: RateWindow;
  /**
   * Keyed by the account alone (email / phone from the body, else the signed-in
   * user). The IP is NOT part of the key, so it cannot be dodged by rotating or
   * spoofing addresses. Set it looser than `perIp`: it is the ceiling for an
   * account no matter where the attempts come from.
   */
  perAccount?: RateWindow;
}

export const AUTH_RATE_LIMIT = 'v2e:auth-rate-limit';

/**
 * Strict limits for an authentication route. Routes without this decorator are
 * not rate limited. See rate-limit.config.ts.
 */
export function AuthRateLimit(opts: AuthRateLimitOptions) {
  const throttle: Record<string, { limit: number; ttl: number }> = {};
  if (opts.perIp)
    throttle.auth = { limit: opts.perIp.limit, ttl: opts.perIp.ttl };
  if (opts.perAccount)
    throttle.account = {
      limit: opts.perAccount.limit,
      ttl: opts.perAccount.ttl,
    };
  return applyDecorators(
    SetMetadata(AUTH_RATE_LIMIT, opts),
    Throttle(throttle),
  );
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
