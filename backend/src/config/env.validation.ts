/**
 * Fail-fast environment validation, wired into ConfigModule.forRoot({ validate }).
 * Hand-written (no extra dependency). Throws one error listing every problem.
 */
export type RawEnv = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export function validateEnv(config: RawEnv): RawEnv {
  const errors: string[] = [];
  const isProd = str(config['NODE_ENV']) === 'production';

  for (const key of ['DATABASE_URL', 'JWT_SECRET', 'JWT_REFRESH_SECRET']) {
    if (!str(config[key])) errors.push(`${key} is required`);
  }

  const dbUrl = str(config['DATABASE_URL']);
  if (dbUrl && !/^postgres(ql)?:\/\//.test(dbUrl)) {
    errors.push('DATABASE_URL must start with postgresql:// or postgres://');
  }

  const secret = str(config['JWT_SECRET']);
  const refresh = str(config['JWT_REFRESH_SECRET']);
  if (isProd) {
    if (secret && secret.length < 32) errors.push('JWT_SECRET must be at least 32 characters in production');
    if (refresh && refresh.length < 32) errors.push('JWT_REFRESH_SECRET must be at least 32 characters in production');
    if (secret && secret === refresh) errors.push('JWT_SECRET and JWT_REFRESH_SECRET must differ');
    if (!str(config['CORS_ORIGIN'])) errors.push('CORS_ORIGIN is required in production');
  }

  const port = str(config['PORT']);
  if (port && !/^\d+$/.test(port)) errors.push('PORT must be a number');

  // Optional feature groups: all-or-nothing, so a half-configured service fails at boot
  // instead of silently degrading.
  const r2Core = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'];
  const r2Set = r2Core.filter((k) => str(config[k]));
  if (r2Set.length > 0 && r2Set.length < r2Core.length) {
    errors.push(`R2 storage is partially configured; also set: ${r2Core.filter((k) => !str(config[k])).join(', ')}`);
  }
  const vapid = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'];
  const vapidSet = vapid.filter((k) => str(config[k]));
  if (vapidSet.length === 1) {
    errors.push(`Web push is partially configured; also set: ${vapid.find((k) => !str(config[k]))}`);
  }

  if (errors.length) {
    throw new Error(`Invalid environment configuration:\n - ${errors.join('\n - ')}`);
  }
  return config;
}
