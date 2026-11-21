/**
 * The `trust proxy` setting (trust-proxy.ts): how TRUST_PROXY is read, and which
 * client IP Express then resolves from X-Forwarded-For. The rate limits key on that
 * IP, so a client must never be able to choose it.
 */
import express from 'express';
import request from 'supertest';
import { DEFAULT_TRUST_PROXY, trustProxySetting } from './trust-proxy';

describe('trustProxySetting: reading TRUST_PROXY', () => {
  it('defaults to trusting only loopback and private-network proxies', () => {
    expect(trustProxySetting(undefined)).toBe(DEFAULT_TRUST_PROXY);
    expect(trustProxySetting('')).toBe(DEFAULT_TRUST_PROXY);
    expect(trustProxySetting('   ')).toBe(DEFAULT_TRUST_PROXY);
    expect(DEFAULT_TRUST_PROXY).toBe('loopback, linklocal, uniquelocal');
  });

  it('a number is a hop count', () => {
    expect(trustProxySetting('2')).toBe(2);
  });

  it('"true" and "false" are booleans', () => {
    expect(trustProxySetting('true')).toBe(true);
    expect(trustProxySetting('false')).toBe(false);
  });

  it('anything else is passed through as an Express trust list', () => {
    expect(trustProxySetting('loopback, 10.0.0.0/8')).toBe(
      'loopback, 10.0.0.0/8',
    );
  });
});

describe('client IP that Express resolves with the default setting', () => {
  // A minimal app with the same setting as the backend, echoing the resolved IP.
  // Supertest connects over loopback, the way the Next.js proxy reaches the backend.
  function appWith(setting: boolean | number | string) {
    const app = express();
    app.set('trust proxy', setting);
    app.get('/ip', (req, res) => {
      res.json({ ip: req.ip });
    });
    return app;
  }
  const ipSeen = async (
    forwardedFor?: string,
    setting = trustProxySetting(undefined),
  ) => {
    const call = request(appWith(setting)).get('/ip');
    const res = await (forwardedFor
      ? call.set('X-Forwarded-For', forwardedFor)
      : call);
    return res.body.ip as string;
  };

  it('uses the client IP the proxy put in X-Forwarded-For', async () => {
    expect(await ipSeen('49.36.12.5')).toBe('49.36.12.5');
  });

  it('ignores an IP the client wrote itself: the proxy appends the real one, which wins', async () => {
    // The client sent "X-Forwarded-For: 1.2.3.4"; Caddy appended the real address.
    expect(await ipSeen('1.2.3.4, 49.36.12.5')).toBe('49.36.12.5');
  });

  it('skips private-network proxies between the client and the backend', async () => {
    // client -> Caddy (adds client IP) -> a proxy on 10.x (adds Caddy's address) -> backend
    expect(await ipSeen('49.36.12.5, 10.0.0.7')).toBe('49.36.12.5');
  });

  it('without the header, falls back to the address that connected', async () => {
    expect(await ipSeen(undefined)).toMatch(/127\.0\.0\.1|::1/);
  });

  it('with TRUST_PROXY=false the header is ignored entirely', async () => {
    expect(await ipSeen('49.36.12.5', trustProxySetting('false'))).toMatch(
      /127\.0\.0\.1|::1/,
    );
  });
});
