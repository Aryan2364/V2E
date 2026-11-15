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
    const { rows: users } = await client.query(
      `SELECT id, name, email, is_super_admin FROM "public"."users" WHERE name ILIKE '%aarav%' OR name ILIKE '%kapoor%'`
    );
    console.log('👥 Matching Users:');
    users.forEach((u) => {
      console.log(`- [${u.id}] Name: "${u.name}", Email: "${u.email}", SuperAdmin: ${u.is_super_admin}`);
    });
  } finally {
    await client.end();
  }
}

main().catch(console.error);
