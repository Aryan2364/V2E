/**
 * The per-IP failed sign-in limit: an IP with FAILED_LOGIN_LIMIT wrong sign-ins
 * (across any accounts) inside FAILED_LOGIN_WINDOW_MS is refused until the window
 * ends. Uses fake timers to move the clock instead of waiting.
 */
import { HttpException } from '@nestjs/common';
import {
  FAILED_LOGIN_LIMIT,
  FAILED_LOGIN_WINDOW_MS,
  FailedLoginLimiter,
} from './failed-login.limiter';

const MINUTE = 60_000;

function fail(limiter: FailedLoginLimiter, ip: string, times: number) {
  for (let i = 0; i < times; i++) limiter.recordFailure(ip);
}

function blockError(
  limiter: FailedLoginLimiter,
  ip: string,
): HttpException | null {
  try {
    limiter.assertNotBlocked(ip);
    return null;
  } catch (err) {
    return err as HttpException;
  }
}

describe('FailedLoginLimiter', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-20T09:00:00Z'));
  });
  afterEach(() => jest.useRealTimers());

  it('the limit is 500 failures per 15 minutes', () => {
    expect(FAILED_LOGIN_LIMIT).toBe(500);
    expect(FAILED_LOGIN_WINDOW_MS).toBe(15 * MINUTE);
  });

  it('an IP with no failures is let through', () => {
    expect(blockError(new FailedLoginLimiter(), '203.0.113.1')).toBeNull();
  });

  it('an IP just under the limit is still let through', () => {
    const limiter = new FailedLoginLimiter();
    fail(limiter, '203.0.113.1', FAILED_LOGIN_LIMIT - 1);
    expect(blockError(limiter, '203.0.113.1')).toBeNull();
  });

  it('an IP that reaches the limit is refused with 429 and how long to wait', () => {
    const limiter = new FailedLoginLimiter();
    fail(limiter, '203.0.113.1', FAILED_LOGIN_LIMIT);
    const err = blockError(limiter, '203.0.113.1');
    expect(err).toBeInstanceOf(HttpException);
    expect(err!.getStatus()).toBe(429);
    expect(err!.message).toBe(
      'Too many failed sign-in attempts from your network. Please wait 15 minutes and try again.',
    );
  });

  it('other IPs are not affected by a blocked one', () => {
    const limiter = new FailedLoginLimiter();
    fail(limiter, '203.0.113.1', FAILED_LOGIN_LIMIT);
    expect(blockError(limiter, '203.0.113.1')).not.toBeNull();
    expect(blockError(limiter, '198.51.100.7')).toBeNull();
  });

  it('the wait shown counts down as the window passes', () => {
    const limiter = new FailedLoginLimiter();
    fail(limiter, '203.0.113.1', FAILED_LOGIN_LIMIT);
    jest.advanceTimersByTime(10 * MINUTE);
    expect(blockError(limiter, '203.0.113.1')!.message).toContain(
      'Please wait 5 minutes',
    );
    jest.advanceTimersByTime(4 * MINUTE + 30_000);
    expect(blockError(limiter, '203.0.113.1')!.message).toContain(
      'Please wait 1 minute and',
    );
  });

  it('the block ends when the window ends, and counting starts again from zero', () => {
    const limiter = new FailedLoginLimiter();
    fail(limiter, '203.0.113.1', FAILED_LOGIN_LIMIT);
    jest.advanceTimersByTime(FAILED_LOGIN_WINDOW_MS);
    expect(blockError(limiter, '203.0.113.1')).toBeNull();
    fail(limiter, '203.0.113.1', FAILED_LOGIN_LIMIT - 1);
    expect(blockError(limiter, '203.0.113.1')).toBeNull();
  });

  it('the window starts at the first failure: failures spread over 15 minutes add up', () => {
    const limiter = new FailedLoginLimiter();
    fail(limiter, '203.0.113.1', FAILED_LOGIN_LIMIT / 2);
    jest.advanceTimersByTime(14 * MINUTE);
    fail(limiter, '203.0.113.1', FAILED_LOGIN_LIMIT / 2);
    expect(blockError(limiter, '203.0.113.1')).not.toBeNull();
  });

  it('failures from an earlier window do not carry over', () => {
    const limiter = new FailedLoginLimiter();
    fail(limiter, '203.0.113.1', FAILED_LOGIN_LIMIT - 1);
    jest.advanceTimersByTime(FAILED_LOGIN_WINDOW_MS + 1);
    limiter.recordFailure('203.0.113.1');
    expect(blockError(limiter, '203.0.113.1')).toBeNull();
  });
});
