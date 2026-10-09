import { Client } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

const rawUrl =
  process.env['DATABASE_URL'] ??
  'postgresql://postgres:postgres@localhost:5432/orgos?schema=public';
const needsSsl = rawUrl.includes('sslmode');
const connectionString = needsSsl ? rawUrl.replace(/[?&]sslmode=[^&]*/g, '') : rawUrl;

const AARAV_USER_ID = 'acf63ab1-357b-48e2-ba19-fc69d834cb24';

const TABLES_TO_TRUNCATE = [
  // Transactional & Social Tables (reference users/departments/roles)
  'leaves',
  'bulletin_comments',
  'bulletin_reactions',
  'bulletin_posts',
  'bulletin_boards',
  'knowledge_comments',
  'knowledge_reactions',
  'knowledge_posts',
  'messages',
  'conversation_members',
  'conversations',
  'announcement_reads',
  'announcements',
  
  // Project Tables
  'project_comments',
  'project_documents',
  'project_activity_logs',
  'project_task_dependencies',
  'project_tasks',
  'project_milestones',
  'project_members',
  'projects',
  
  // Ticket Tables
  'ticket_activity_logs',
  'ticket_comments',
  'ticket_notifications',
  'ticket_resolver_group_members',
  'ticket_resolver_groups',
  'ticket_escalations',
  'ticket_checklists',
  'tickets',
  
  // Workflow Tables
  'workflow_instance_steps',
  'workflow_notifications',
  'workflow_discussion_reads',
  'workflow_instances',
  'workflow_access',
  'workflow_steps',
  'workflow_triggers',
  'workflow_templates',

  // Dept and Roles
  'roles',
  'departments',

  // Import Batches
  'employee_import_batches',
];

async function main() {
  const client = new Client({
    connectionString,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();

  try {
    // 1. Verify Aarav Kapoor exists
    const { rows: aaravCheck } = await client.query(
      `SELECT id, name, email FROM "public"."users" WHERE id = $1`,
      [AARAV_USER_ID]
    );

    if (aaravCheck.length === 0) {
      throw new Error(`Could not find user Aarav Kapoor with ID: ${AARAV_USER_ID}`);
    }
    console.log(`👤 Found user to preserve: ${aaravCheck[0].name} (${aaravCheck[0].email})`);

    // 2. Fetch all table names to verify
    const { rows } = await client.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables
       WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
    );
    const existingTableNames = new Set(rows.map(r => r.tablename));

    const tablesToClear = TABLES_TO_TRUNCATE
      .filter(t => existingTableNames.has(t))
      .map(t => `"public"."${t}"`);

    console.log('🧹 Beginning database clean-up...');
    await client.query('BEGIN');
    await client.query("SET session_replication_role = 'replica'"); // disable constraints

    // 3. Truncate target tables
    if (tablesToClear.length > 0) {
      console.log(`- Truncating ${tablesToClear.length} dependency and organizational tables...`);
      await client.query(`TRUNCATE ${tablesToClear.join(', ')} RESTART IDENTITY CASCADE`);
    }

    // 4. Clean up employee profiles
    // Keep Aarav's profile but clear role_id and department_id since roles and depts are deleted
    console.log('- Cleaning employee profiles...');
    await client.query(
      `DELETE FROM "public"."employee_profiles" WHERE user_id <> $1`,
      [AARAV_USER_ID]
    );
    await client.query(
      `UPDATE "public"."employee_profiles" SET role_id = NULL, department_id = NULL, reporting_to_user_id = NULL WHERE user_id = $1`,
      [AARAV_USER_ID]
    );

    // 5. Clean up organization members
    // Keep only Aarav and superadmin, and ensure Aarav is admin
    console.log('- Cleaning organization members...');
    // Fetch superadmin user ids to preserve them too
    const { rows: superAdmins } = await client.query(
      `SELECT id FROM "public"."users" WHERE is_super_admin = true`
    );
    const superAdminIds = superAdmins.map(s => s.id);
    const usersToPreserve = [AARAV_USER_ID, ...superAdminIds];

    await client.query(
      `DELETE FROM "public"."organization_members" WHERE user_id NOT IN (${usersToPreserve.map((_, i) => `$${i + 1}`).join(', ')})`,
      usersToPreserve
    );
    await client.query(
      `UPDATE "public"."organization_members" SET is_admin = true WHERE user_id = $1`,
      [AARAV_USER_ID]
    );

    // 6. Clean up users
    // Keep Aarav and super admins
    console.log('- Cleaning users...');
    await client.query(
      `DELETE FROM "public"."users" WHERE id NOT IN (${usersToPreserve.map((_, i) => `$${i + 1}`).join(', ')})`,
      usersToPreserve
    );

    await client.query("SET session_replication_role = 'origin'");
    await client.query('COMMIT');

    console.log('✅ Clean-up completed successfully. All other users, departments, and roles deleted.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('❌ Clean-up failed:', err);
  process.exit(1);
});
