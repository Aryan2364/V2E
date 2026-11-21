/**
 * The httpOnly refresh-token cookie (auth-cookie.ts): when it is used, what flags it
 * carries, how it is read back, and that the refresh token never appears in a
 * cookie-mode response body.
 */
import {
  AUTH_MODE_HEADER,
  REFRESH_COOKIE,
  clearRefreshCookie,
  isCookieMode,
  readRefreshCookie,
  setRefreshCookie,
  withRefreshCookie,
} from './auth-cookie';

const req = (headers: Record<string, string> = {}): any => ({ headers });
const res = () => ({ cookie: jest.fn(), clearCookie: jest.fn() });

/** A JWT-shaped token whose payload expires `secondsFromNow` from now. */
function tokenExpiringIn(secondsFromNow: number) {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + secondsFromNow })).toString(
    'base64url',
  );
  return `header.${payload}.signature`;
}

describe('isCookieMode', () => {
  it('is on only when the client sends the opt-in header', () => {
    expect(isCookieMode(req({ [AUTH_MODE_HEADER]: 'cookie' }))).toBe(true);
    expect(isCookieMode(req({ [AUTH_MODE_HEADER]: 'COOKIE' }))).toBe(true);
    expect(isCookieMode(req())).toBe(false);
    expect(isCookieMode(req({ [AUTH_MODE_HEADER]: 'body' }))).toBe(false);
  });
});

describe('readRefreshCookie', () => {
  it('reads the refresh cookie among other cookies', () => {
    expect(readRefreshCookie(req({ cookie: `theme=dark; ${REFRESH_COOKIE}=abc.def; lang=en` }))).toBe('abc.def');
  });

  it('decodes an URL-encoded value', () => {
    expect(readRefreshCookie(req({ cookie: `${REFRESH_COOKIE}=a%2Bb` }))).toBe('a+b');
  });

  it('returns null when there is no cookie header, no refresh cookie, or an empty one', () => {
    expect(readRefreshCookie(req())).toBeNull();
    expect(readRefreshCookie(req({ cookie: 'theme=dark' }))).toBeNull();
    expect(readRefreshCookie(req({ cookie: `${REFRESH_COOKIE}=` }))).toBeNull();
  });

  it('does not match a cookie whose name only starts the same', () => {
    expect(readRefreshCookie(req({ cookie: `${REFRESH_COOKIE}_old=stale` }))).toBeNull();
  });

  it('returns null for a malformed encoded value instead of throwing', () => {
    expect(readRefreshCookie(req({ cookie: `${REFRESH_COOKIE}=%E0%A4%A` }))).toBeNull();
  });
});

describe('setRefreshCookie', () => {
  const OLD_ENV = process.env;
  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('is httpOnly, SameSite=Strict, limited to the auth path, and lives as long as the token', () => {
    const r = res();
    setRefreshCookie(r as any, tokenExpiringIn(3600));
    const [name, value, options] = r.cookie.mock.calls[0];
    expect(name).toBe(REFRESH_COOKIE);
    expect(value).toContain('header.');
    expect(options).toMatchObject({ httpOnly: true, sameSite: 'strict', path: '/api/v1/auth' });
    expect(options.maxAge).toBeGreaterThan(3590 * 1000);
    expect(options.maxAge).toBeLessThanOrEqual(3600 * 1000);
    expect(options.domain).toBeUndefined(); // host-only: no sibling subdomain can read it
  });

  it('is Secure in production', () => {
    process.env = { ...OLD_ENV, NODE_ENV: 'production', AUTH_COOKIE_SECURE: '' };
    const r = res();
    setRefreshCookie(r as any, tokenExpiringIn(60));
    expect(r.cookie.mock.calls[0][2].secure).toBe(true);
  });

  it('is not Secure in local development (plain HTTP)', () => {
    process.env = { ...OLD_ENV, NODE_ENV: 'development', AUTH_COOKIE_SECURE: '' };
    const r = res();
    setRefreshCookie(r as any, tokenExpiringIn(60));
    expect(r.cookie.mock.calls[0][2].secure).toBe(false);
  });

  it('AUTH_COOKIE_SECURE overrides the environment default', () => {
    process.env = { ...OLD_ENV, NODE_ENV: 'production', AUTH_COOKIE_SECURE: 'false' };
    const r = res();
    setRefreshCookie(r as any, tokenExpiringIn(60));
    expect(r.cookie.mock.calls[0][2].secure).toBe(false);
  });

  it('falls back to 30 days for a token without a readable expiry', () => {
    const r = res();
    setRefreshCookie(r as any, 'not-a-jwt');
    expect(r.cookie.mock.calls[0][2].maxAge).toBe(30 * 24 * 60 * 60 * 1000);
  });
});

describe('withRefreshCookie', () => {
  const tokens = () => ({ access_token: 'access', refresh_token: tokenExpiringIn(3600), user: { id: 'u1' } });

  it('cookie mode: sets the cookie and leaves the refresh token OUT of the body', () => {
    const r = res();
    const body = withRefreshCookie(req({ [AUTH_MODE_HEADER]: 'cookie' }), r as any, tokens());
    expect(r.cookie).toHaveBeenCalledTimes(1);
    expect(body).not.toHaveProperty('refresh_token');
    expect(body).toMatchObject({ access_token: 'access', user: { id: 'u1' } });
  });

  it('without the header: the body is returned unchanged and no cookie is set (older clients)', () => {
    const r = res();
    const result = tokens();
    const body = withRefreshCookie(req(), r as any, result);
    expect(body).toBe(result);
    expect(r.cookie).not.toHaveBeenCalled();
  });

  it('cookie mode with no refresh token (organisation picker): clears any old cookie', () => {
    const r = res();
    const result = { requires_org_selection: true, selection_token: 'sel' };
    const body = withRefreshCookie(req({ [AUTH_MODE_HEADER]: 'cookie' }), r as any, result);
    expect(r.clearCookie).toHaveBeenCalledWith(REFRESH_COOKIE, expect.objectContaining({ path: '/api/v1/auth' }));
    expect(body).toEqual(result);
  });
});

describe('clearRefreshCookie', () => {
  it('clears with the same name and path the cookie was set with', () => {
    const r = res();
    clearRefreshCookie(r as any);
    expect(r.clearCookie).toHaveBeenCalledWith(
      REFRESH_COOKIE,
      expect.objectContaining({ httpOnly: true, sameSite: 'strict', path: '/api/v1/auth' }),
    );
  });
});
