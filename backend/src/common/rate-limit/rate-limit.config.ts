import { ExecutionContext } from '@nestjs/common';
import { ThrottlerModuleOptions } from '@nestjs/throttler';
import {
  AUTH_RATE_LIMIT,
  AuthRateLimitOptions,
  MINUTE,
} from './rate-limit.decorator';

/**
 * Rate limiting covers the authentication routes only, through two throttlers that
 * RateLimitGuard (registered globally) enforces:
 *
 *  auth     - only routes marked @AuthRateLimit({ perIp }). Keyed by IP + account.
 *  account  - only routes marked @AuthRateLimit({ perAccount }). Keyed by account.
 *
 * Every other route is skipped: there is no API-wide limit yet. Neither throttler
 * relies on the proxy forwarding the real client IP. If every request arrived from
 * one address, each account would still have its own count.
 *
 * The limit/ttl values below are placeholders: every route that enables a throttler
 * sets its own through the decorator.
 *
 * Storage is in memory, which is correct for ONE backend process. If the backend is
 * ever scaled to several containers, each keeps its own counts and the effective
 * limit multiplies; move the storage to Redis at that point.
 */
function authMeta(context: ExecutionContext): AuthRateLimitOptions | undefined {
  return Reflect.getMetadata(AUTH_RATE_LIMIT, context.getHandler()) as
    | AuthRateLimitOptions
    | undefined;
}

export const rateLimitConfig: ThrottlerModuleOptions = {
  throttlers: [
    {
      name: 'auth',
      limit: 10,
      ttl: 15 * MINUTE,
      skipIf: (ctx) => !authMeta(ctx)?.perIp,
    },
    {
      name: 'account',
      limit: 30,
      ttl: 15 * MINUTE,
      skipIf: (ctx) => !authMeta(ctx)?.perAccount,
    },
  ],
  errorMessage: (_ctx, detail) => {
    const seconds = Math.max(
      1,
      Math.ceil(detail.timeToBlockExpire || detail.timeToExpire || 60),
    );
    if (seconds < 60)
      return `Too many attempts. Please wait ${seconds} seconds and try again.`;
    const minutes = Math.ceil(seconds / 60);
    return `Too many attempts. Please wait ${minutes} minute${minutes === 1 ? '' : 's'} and try again.`;
  },
};
