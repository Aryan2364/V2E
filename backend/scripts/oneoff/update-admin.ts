import { Client } from 'pg';
import * as bcrypt from 'bcryptjs';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../../.env') });

const rawUrl =
  process.env['DATABASE_URL'] ??
  'postgresql://postgres:postgres@localhost:5432/orgos?schema=public';
const needsSsl = rawUrl.includes('sslmode');
const connectionString = needsSsl ? rawUrl.replace(/[?&]sslmode=[^&]*/g, '') : rawUrl;

const AARAV_USER_ID = 'acf63ab1-357b-48e2-ba19-fc69d834cb24';
const NEW_EMAIL = 'aryan@rgbindia.com';
const NEW_PASSWORD = 'SleepingCats';

async function main() {
  const client = new Client({
    connectionString,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();

  try {
    const passwordHash = await bcrypt.hash(NEW_PASSWORD, 12);

    console.log(`🔐 Hashing password and updating admin user...`);
    
    const { rows } = await client.query(
      `UPDATE "public"."users" 
       SET email = $1, password_hash = $2 
       WHERE id = $3
       RETURNING id, name, email`,
      [NEW_EMAIL, passwordHash, AARAV_USER_ID]
    );

    if (rows.length === 0) {
      throw new Error(`Failed to update user. Aarav Kapoor (ID: ${AARAV_USER_ID}) not found.`);
    }

    console.log(`✅ Admin user updated:`);
    console.log(`  - Name: ${rows[0].name}`);
    console.log(`  - New Email/ID: ${rows[0].email}`);
    console.log(`  - Password: [Updated to ${NEW_PASSWORD}]`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('❌ Update failed:', err);
  process.exit(1);
});
