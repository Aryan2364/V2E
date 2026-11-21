import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { MINUTE } from './rate-limit.decorator';

/**
 * Blocks an IP that produces too many FAILED sign-ins, across all accounts.
 *
 * Why: the per-route limits (@AuthRateLimit) count per account, so a script that
 * tries one password against thousands of different emails ("password spraying")
 * never trips them: each account sees one attempt. Every attempt still costs a
 * ~250 ms bcrypt check, so such a script can also slow the whole backend down.
 *
 * Why only failures: a firm of 200 people signing in from one office IP at 9 AM
 * produces 200 successes and a handful of typos. Successes are never counted, so
 * the office never comes near the limit, while a script hits it within seconds.
 *
 * A blocked IP is refused BEFORE the password is checked, so it costs no bcrypt
 * work. Blocks are temporary: the count resets when its window ends.
 *
 * Counts are kept in memory (correct for one backend process; see rate-limit.config.ts).
 */
export const FAILED_LOGIN_LIMIT = 500;
export const FAILED_LOGIN_WINDOW_MS = 15 * MINUTE;

interface IpRecord {
  failures: number;
  /** When the current window ends and the count resets. */
  resetAt: number;
}

@Injectable()
export class FailedLoginLimiter {
  private readonly records = new Map<string, IpRecord>();
  private nextSweepAt = 0;

  /** Throws 429 if this IP has used up its failed sign-ins for the current window. */
  assertNotBlocked(ip: string): void {
    const record = this.current(ip);
    if (!record || record.failures < FAILED_LOGIN_LIMIT) return;
    const minutes = Math.max(1, Math.ceil((record.resetAt - Date.now()) / MINUTE));
    throw new HttpException(
      `Too many failed sign-in attempts from your network. Please wait ${minutes} minute${minutes === 1 ? '' : 's'} and try again.`,
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  /** Count one failed sign-in (wrong email / mobile number or password) for this IP. */
  recordFailure(ip: string): void {
    const now = Date.now();
    const record = this.current(ip);
    if (record) record.failures += 1;
    else this.records.set(ip, { failures: 1, resetAt: now + FAILED_LOGIN_WINDOW_MS });
    this.sweep(now);
  }

  /** The IP's record if its window is still open; an expired one is dropped. */
  private current(ip: string): IpRecord | undefined {
    const record = this.records.get(ip);
    if (record && record.resetAt <= Date.now()) {
      this.records.delete(ip);
      return undefined;
    }
    return record;
  }

  /** Drop expired records about once a minute, so memory never grows without bound. */
  private sweep(now: number): void {
    if (now < this.nextSweepAt) return;
    this.nextSweepAt = now + MINUTE;
    for (const [ip, record] of this.records) {
      if (record.resetAt <= now) this.records.delete(ip);
    }
  }
}
