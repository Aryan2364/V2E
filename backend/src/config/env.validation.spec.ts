import { validateEnv } from './env.validation';

const base = { DATABASE_URL: 'postgresql://u:p@h:5432/d', JWT_SECRET: 'a', JWT_REFRESH_SECRET: 'b' };

describe('validateEnv', () => {
  it('accepts a minimal dev env', () => {
    expect(validateEnv(base)).toBe(base);
  });
  it('lists every missing required var', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL is required[\s\S]*JWT_SECRET is required[\s\S]*JWT_REFRESH_SECRET is required/);
  });
  it('requires CORS_ORIGIN and long secrets in production', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'production' })).toThrow(/CORS_ORIGIN is required/);
    expect(() => validateEnv({ ...base, NODE_ENV: 'production', CORS_ORIGIN: 'https://x' })).toThrow(/at least 32/);
    const long = { ...base, NODE_ENV: 'production', CORS_ORIGIN: 'https://x', JWT_SECRET: 'a'.repeat(32), JWT_REFRESH_SECRET: 'b'.repeat(32) };
    expect(() => validateEnv(long)).not.toThrow();
  });
  it('rejects partially configured R2 and VAPID', () => {
    expect(() => validateEnv({ ...base, R2_BUCKET: 'b' })).toThrow(/R2 storage is partially/);
    expect(() => validateEnv({ ...base, VAPID_PUBLIC_KEY: 'k' })).toThrow(/Web push is partially/);
  });
  it('rejects a non-postgres DATABASE_URL', () => {
    expect(() => validateEnv({ ...base, DATABASE_URL: 'mysql://x' })).toThrow(/DATABASE_URL must start/);
  });
});
