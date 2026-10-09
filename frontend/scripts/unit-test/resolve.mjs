// Module resolve hook for the unit tests (see register.mjs).
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export async function resolve(specifier, context, next) {
  let base = null
  if (specifier.startsWith('@/')) base = path.join(root, specifier.slice(2))
  else if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL?.startsWith('file:')) {
    base = fileURLToPath(new URL(specifier, context.parentURL))
  }
  if (base && !path.extname(base)) {
    for (const ext of ['.ts', '.tsx', '/index.ts']) {
      if (existsSync(base + ext)) return next(pathToFileURL(base + ext).href, context)
    }
  }
  return next(base ? pathToFileURL(base).href : specifier, context)
}
