// Fails when a tracked text file is not valid UTF-8.
//
// Why this exists: an editor that guesses the wrong encoding can save a Windows-1252
// character (typically an em dash, byte 0x97) into a source file. TypeScript tolerates
// it, so `tsc` and `nest build` pass, but the dev compiler (swc) refuses the file, skips
// it and the app then crashes with "Cannot find module". This check catches it in CI.
//
// Run from the repository root:  node scripts/check-utf8.mjs
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const TEXT = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|css|scss|prisma|sql|yml|yaml|sh|html|txt|env|example)$/i
const decoder = new TextDecoder('utf-8', { fatal: true })

const isValid = (bytes) => {
  try {
    decoder.decode(bytes)
    return true
  } catch {
    return false
  }
}

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  .split('\0')
  .filter((f) => f && TEXT.test(f))

const bad = []
for (const file of files) {
  let bytes
  try {
    bytes = readFileSync(file)
  } catch {
    continue // listed by git but deleted in the working tree
  }
  if (isValid(bytes)) continue

  // Find the first bad line (0x0A never appears inside a multi-byte UTF-8 character).
  let line = 1
  let start = 0
  for (let i = 0; i <= bytes.length; i++) {
    if (i === bytes.length || bytes[i] === 0x0a) {
      if (!isValid(bytes.subarray(start, i))) break
      line++
      start = i + 1
    }
  }
  bad.push(`${file}:${line}`)
}

if (bad.length) {
  console.error('These files are not valid UTF-8 (usually a Windows-1252 dash or quote):')
  for (const where of bad) console.error('  ' + where)
  console.error('\nOpen each one, re-save it as UTF-8 and retype the odd character.')
  process.exit(1)
}
console.log(`UTF-8 check passed (${files.length} files).`)
