/**
 * Phone-login helpers for the browser. This is the SINGLE frontend mirror of the
 * backend's country table + number normalisation (backend/src/common/countries.ts
 * and identifier.util.ts). Every phone input on the site uses these — do not write
 * a second copy. The backend re-normalises and re-validates on save and on lookup,
 * so it stays the source of truth; this just gives the user a tidy, correct field.
 */

export interface CountryOption {
  code: string // "+91", stored WITH the plus
  name: string // "India"
  nationalDigits: number // 10
}

export const COUNTRIES: CountryOption[] = [
  { code: '+91', name: 'India', nationalDigits: 10 },
  { code: '+971', name: 'UAE', nationalDigits: 9 },
  { code: '+1', name: 'USA/Canada', nationalDigits: 10 },
  { code: '+44', name: 'UK', nationalDigits: 10 },
  { code: '+65', name: 'Singapore', nationalDigits: 8 },
  { code: '+61', name: 'Australia', nationalDigits: 9 },
]

export const DEFAULT_COUNTRY = '+91'

export function findCountry(code: string): CountryOption | undefined {
  return COUNTRIES.find((c) => c.code === code)
}

/** How many national digits the chosen country expects (used for maxLength). */
export function nationalDigitsFor(code: string): number {
  return findCountry(code)?.nationalDigits ?? 15
}

/**
 * Clean a typed/pasted national number for the chosen country:
 *   - keep digits only;
 *   - if a whole "+91..." was pasted, silently drop the country-code prefix;
 *   - drop a single leading trunk 0.
 * Then clamp to the country's expected length. Never shows an error — it just
 * fixes the value (mirrors the backend's normaliseNationalNumber).
 */
export function cleanNationalNumber(raw: string, countryCode: string): string {
  const d = normaliseNationalNumber(raw, countryCode)
  const c = findCountry(countryCode)
  return c && d.length > c.nationalDigits ? d.slice(0, c.nationalDigits) : d
}

/**
 * The same normalisation as the backend's normalizeNationalNumber, WITHOUT the
 * final clamp: digits only, a pasted country-code prefix dropped, one leading
 * trunk 0 dropped. A validator needs this form, because clamping would turn an
 * over-long number ("9876543210123") into a valid-looking one before it is checked.
 */
export function normaliseNationalNumber(raw: string, countryCode: string): string {
  let d = (raw ?? '').replace(/\D/g, '')
  const c = findCountry(countryCode)
  if (c) {
    const cc = c.code.replace(/\D/g, '')
    if (cc && d.startsWith(cc) && d.length > c.nationalDigits) d = d.slice(cc.length)
    if (d.length > c.nationalDigits && d.startsWith('0')) d = d.slice(1)
  }
  return d
}

/** Dropdown options for the shared country-code selector. */
export function countryCodeOptions() {
  return COUNTRIES.map((c) => ({ value: c.code, label: `${c.code}  ${c.name}` }))
}
