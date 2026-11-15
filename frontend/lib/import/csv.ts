// Shared CSV and header helpers for the bulk-import modals. Pure functions, no React,
// so they can be unit-tested with Node's own test runner.

/** Minimal RFC-4180 CSV parser: handles quoted fields, escaped quotes, CRLF and a BOM. */
export function parseCsv(input: string): string[][] {
  let text = input
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else inQuotes = false
      } else field += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

/** "Name *" becomes "name", "Parent Dept (optional)" becomes "parent_dept": the key a header is looked up by. */
export function normalizeHeader(h: string): string {
  return h
    .replace(/\*/g, '')
    .replace(/\(.*?\)/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
}

/** Non-blank values, de-duplicated, first occurrence wins. */
export function uniq(arr: string[]): string[] {
  return Array.from(new Set(arr.filter((v) => v && v.trim() !== '')))
}

/** Case/space-insensitive key for matching names. */
export const norm = (s: string): string => s.trim().toLowerCase()

/** YYYY-MM-DD in UTC. */
export function toYmdUtc(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** YYYY-MM-DD in the browser's local time zone. */
export function toYmdLocal(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** An API error's message(s) as one string, or the fallback. */
export function apiErrorMessage(err: unknown, fallback: string): string {
  const msg = (err as { response?: { data?: { message?: string | string[] } } } | null)?.response?.data?.message
  if (msg === undefined || msg === null || msg === '') return fallback
  return Array.isArray(msg) ? msg.join(', ') : msg
}

/** Save a Blob as a file through a temporary link. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
