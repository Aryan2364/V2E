// `node --import ./scripts/unit-test/register.mjs --test …` — lets Node's own test runner
// (with its built-in TypeScript type stripping) load the app's pure .ts modules: resolves
// the "@/…" alias and extensionless relative imports. No test framework is installed.
import { register } from 'node:module'

register('./resolve.mjs', import.meta.url)
