import { Logger } from '@nestjs/common';
import { Client } from 'pg';
import { pgConnectionOptions } from '../prisma/pg-connection';

const logger = new Logger('CronLock');
const running = new Set<string>();

/**
 * Runs a scheduled job at most once at a time:
 *  (a) in-process: skipped if the same job name is still running here;
 *  (b) cluster-wide: guarded by a Postgres session advisory lock
 *      (`pg_try_advisory_lock(hashtext(name))`) on a dedicated connection, so only one
 *      app instance runs the job. The lock dies with the connection, so a crashed
 *      instance can never leave it stuck; it is also released explicitly in `finally`.
 * When DATABASE_URL is unset (unit tests) only the in-process guard applies.
 * Errors from `fn` are logged, never thrown, so a failing sweep cannot crash the scheduler.
 */
export async function runExclusive(
  name: string,
  fn: () => Promise<unknown>,
): Promise<void> {
  if (running.has(name)) {
    logger.debug(
      `${name}: previous run still in progress in this process — skipped`,
    );
    return;
  }
  running.add(name);
  let lockClient: Client | null = null;
  try {
    if (process.env['DATABASE_URL']) {
      lockClient = new Client(pgConnectionOptions());
      let acquired = false;
      try {
        await lockClient.connect();
        const res = await lockClient.query<{ locked: boolean }>(
          'SELECT pg_try_advisory_lock(hashtext($1)) AS locked',
          [`cron:${name}`],
        );
        acquired = res.rows[0]?.locked === true;
      } catch (err) {
        logger.warn(
          `${name}: could not take advisory lock, skipping run: ${err instanceof Error ? err.message : err}`,
        );
        await closeQuietly(lockClient);
        lockClient = null;
        return;
      }
      if (!acquired) {
        logger.debug(`${name}: running on another instance — skipped`);
        await closeQuietly(lockClient);
        lockClient = null;
        return;
      }
    }
    await fn();
  } catch (err) {
    logger.error(
      `${name} failed: ${err instanceof Error ? (err.stack ?? err.message) : err}`,
    );
  } finally {
    if (lockClient) {
      try {
        await lockClient.query('SELECT pg_advisory_unlock(hashtext($1))', [
          `cron:${name}`,
        ]);
      } catch {
        /* the lock is released when the connection closes below */
      }
      await closeQuietly(lockClient);
    }
    running.delete(name);
  }
}

async function closeQuietly(client: Client): Promise<void> {
  try {
    await client.end();
  } catch {
    /* already closed */
  }
}
