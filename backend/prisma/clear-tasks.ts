import { Client } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { S3Client, DeleteObjectsCommand } from '@aws-sdk/client-s3';

// Load env variables
dotenv.config({ path: path.join(__dirname, '../.env') });

const rawUrl =
  process.env['DATABASE_URL'] ??
  'postgresql://postgres:postgres@localhost:5432/orgos?schema=public';
const needsSsl = rawUrl.includes('sslmode');
const connectionString = needsSsl ? rawUrl.replace(/[?&]sslmode=[^&]*/g, '') : rawUrl;

const TASK_TABLES = [
  'task_attachments',
  'task_assignees',
  'task_checklists',
  'task_reminders',
  'task_escalations',
  'task_activity_logs',
  'task_comments',
  'task_archives',
  'task_assignee_frequencies',
  'task_tag_links',
  'recurring_schedule_entries',
  'recurring_templates',
  'checklist_template_access_rules',
  'checklist_template_import_batches',
  'task_checklist_templates',
  'tasks',
  'task_tags',
  'task_categories',
  'task_priorities',
  'task_statuses',
  'task_masters'
];

/** Build an R2 client from env, or null if storage isn't configured. */
function r2Client(): { client: S3Client; bucket: string } | null {
  const accountId = process.env['R2_ACCOUNT_ID'];
  const accessKeyId = process.env['R2_ACCESS_KEY_ID'];
  const secretAccessKey = process.env['R2_SECRET_ACCESS_KEY'];
  const bucket = process.env['R2_BUCKET'];
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  const endpoint = process.env['R2_ENDPOINT'] || `https://${accountId}.r2.cloudflarestorage.com`;
  return {
    client: new S3Client({
      region: 'auto',
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
    }),
    bucket,
  };
}

/**
 * Delete the R2 objects backing task/comment attachments BEFORE the DB rows are
 * wiped (we need their storage_key to find them). Only touches keys referenced
 * in task_attachments, so other prefixes (future ticket/project files) are safe.
 */
async function purgeAttachmentsFromR2(client: Client) {
  const r2 = r2Client();
  if (!r2) {
    console.log('ℹ️  R2 not configured — skipping object-storage cleanup.');
    return;
  }
  let keys: string[] = [];
  try {
    const { rows } = await client.query<{ storage_key: string }>(
      `SELECT storage_key FROM task_attachments WHERE storage_key IS NOT NULL`,
    );
    keys = rows.map((r) => r.storage_key).filter(Boolean);
  } catch {
    // task_attachments may not exist on older databases — nothing to purge.
    return;
  }
  if (keys.length === 0) {
    console.log('ℹ️  No attachment files to delete from R2.');
    return;
  }
  console.log(`🗑️  Deleting ${keys.length} attachment file(s) from R2...`);
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    await r2.client.send(
      new DeleteObjectsCommand({
        Bucket: r2.bucket,
        Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
      }),
    );
  }
  console.log('✅ R2 attachment files deleted.');
}

async function main() {
  const client = new Client({
    connectionString,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();

  try {
    // 1) Purge the files from R2 first (needs the storage_keys still in the DB).
    await purgeAttachmentsFromR2(client);

    // 2) Wipe the task tables.
    const { rows } = await client.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables
       WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
    );

    const existingTableNames = new Set(rows.map(r => r.tablename));
    const tablesToClear = TASK_TABLES
      .filter(t => existingTableNames.has(t))
      .map(t => `"public"."${t}"`);

    if (tablesToClear.length === 0) {
      console.log('ℹ️ No task tables found to clear.');
      return;
    }

    console.log(`🧹 Wiping ${tablesToClear.length} task-related tables...`);

    await client.query('BEGIN');
    await client.query("SET session_replication_role = 'replica'"); // disable foreign key constraints
    await client.query(`TRUNCATE ${tablesToClear.join(', ')} RESTART IDENTITY CASCADE`);
    await client.query("SET session_replication_role = 'origin'");
    await client.query('COMMIT');

    console.log('✅ All task data, attachments and configurations deleted successfully.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('❌ Wipe failed:', err);
  process.exit(1);
});
