const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const env = fs.readFileSync(path.join(__dirname, '../../.env'), 'utf8');
for (const line of env.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const rawUrl = process.env['DATABASE_URL'];
const needsSsl = rawUrl.includes('sslmode');
const connectionString = needsSsl ? rawUrl.replace(/[?&]sslmode=[^&]*/g, '') : rawUrl;
const adapter = new PrismaPg({ connectionString, ssl: needsSsl ? { rejectUnauthorized: false } : undefined });
module.exports = new PrismaClient({ adapter });
