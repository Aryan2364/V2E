// Finds every *.test.ts under a __tests__ folder and runs them with node --test,
// so adding a test file never means editing package.json.
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const skip = new Set(['node_modules', '.next', 'public', 'out']);
const files = [];

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(entry.name) || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.test.ts') && full.includes('__tests__')) files.push(relative(root, full));
  }
}

walk(root);
files.sort();

const result = spawnSync(
  process.execPath,
  [
    '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
    '--import',
    './scripts/unit-test/register.mjs',
    '--test',
    ...files,
  ],
  { stdio: 'inherit' },
);
process.exit(result.status ?? 1);
