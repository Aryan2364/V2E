import { Client } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../../.env') });

const rawUrl =
  process.env['DATABASE_URL'] ??
  'postgresql://postgres:postgres@localhost:5432/orgos?schema=public';
const needsSsl = rawUrl.includes('sslmode');
const connectionString = needsSsl ? rawUrl.replace(/[?&]sslmode=[^&]*/g, '') : rawUrl;

async function main() {
  const client = new Client({
    connectionString,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();

  try {
    console.log('🛡️ Identifying Super Admins...');
    // Find super admins to log them
    const { rows: superAdmins } = await client.query(
      `SELECT id, name, email FROM "public"."users" WHERE is_super_admin = true`
    );
    console.log(`Preserving Super Admin accounts:`);
    superAdmins.forEach((sa) => {
      console.log(`  - [${sa.id}] ${sa.name} (${sa.email})`);
    });

    if (superAdmins.length === 0) {
      console.warn('⚠️ WARNING: No Super Admins found! Proceeding will leave the users table empty.');
    }

    // Get all public table names in the database
    const { rows: tables } = await client.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables
       WHERE schemaname = 'public' 
         AND tablename <> '_prisma_migrations'
         AND tablename <> 'users'`
    );

    const tablesToTruncate = tables.map((t) => `"public"."${t.tablename}"`);

    console.log('⚡ Starting database reset...');
    await client.query('BEGIN');
    await client.query("SET session_replication_role = 'replica'"); // disable foreign key checks

    // 1. Truncate all tables except users and prisma migrations
    if (tablesToTruncate.length > 0) {
      console.log(`- Truncating ${tablesToTruncate.length} tables...`);
      await client.query(`TRUNCATE ${tablesToTruncate.join(', ')} RESTART IDENTITY CASCADE`);
    }

    // 2. Delete all non-superadmin users
    console.log('- Wiping all non-superadmin users from the "users" table...');
    const { rowCount } = await client.query(
      `DELETE FROM "public"."users" WHERE is_super_admin = false`
    );
    console.log(`  Deleted ${rowCount} regular user records.`);

    await client.query("SET session_replication_role = 'origin'");
    await client.query('COMMIT');

    console.log('✅ Wiped all data. Database is now empty except for Super Admin accounts.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('❌ Reset failed:', err);
  process.exit(1);
});
