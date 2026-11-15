import { PrismaPg } from '@prisma/adapter-pg';

/** Reads DATABASE_URL (no fallback — env validation guarantees it, this is the last line of defence). */
export function getDatabaseUrl(): string {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is not set');
  return url;
}

/** Splits an optional sslmode param out of the URL into pg's ssl option. */
export function pgConnectionOptions(): {
  connectionString: string;
  ssl: { rejectUnauthorized: boolean } | undefined;
} {
  const rawUrl = getDatabaseUrl();
  const needsSsl = rawUrl.includes('sslmode');
  return {
    connectionString: needsSsl
      ? rawUrl.replace(/[?&]sslmode=[^&]*/g, '')
      : rawUrl,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  };
}

export function createPgAdapter(): PrismaPg {
  return new PrismaPg(pgConnectionOptions());
}
