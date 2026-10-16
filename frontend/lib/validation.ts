/**
 * Field checks shared by every screen (41.3 rule 1: validation is written
 * once, and both layouts use it). Each returns the message to show below
 * the field (11.3 rule 6, inline-field-error.tsx), or null when the value
 * is fine. Every message gives the cause, then the next action (7.2 rule
 * 2), and each check has the kit's one wording, so the same mistake reads
 * the same on every screen.
 *
 * Run them when the person leaves the field and again on submit, never on
 * every keystroke (11.3 rule 6).
 *
 * A field that is OPTIONAL checks emptiness first and calls these only
 * when something was typed: each check treats an empty value as missing.
 *
 * No "use client": plain functions, safe to call from a server component
 * or a server action as well (the backend repeats its own checks).
 *
 * The words are English, the kit's defaults. A product in another language
 * takes them from its strings file (37.6 rule 2); VALIDATION_TEXT below is
 * the one place they live, so that file has one place to replace.
 */

/** The digits of an Indian mobile number (11.7 rule 1, section 0.1 item 6). */
const MOBILE_LENGTH = 10

/** The country code an Indian product puts before the number (11.7 rule 1). */
const INDIA = "+91"

type ValidationText = {
  emailMissing: string
  emailIncomplete: string
  /** The person's own number, empty: sign-in, Profile. */
  mobileMissing: string
  /** Someone else's number, empty: "Enter a phone number." */
  mobileMissingNamed: (label: string) => string
  /** Not 10 digits, naming the field: "Enter a 10-digit mobile number, like 98765 43210." */
  mobileLength: (label: string) => string
}

/** The kit's one example number, in every mobile number message. */
const EXAMPLE_MOBILE = "98765 43210"

const VALIDATION_TEXT: ValidationText = {
  emailMissing: "Enter your email address, like name@company.com.",
  emailIncomplete: "Enter a complete email address, like name@company.com.",
  mobileMissing: "Enter your mobile number.",
  mobileMissingNamed: (label) => `Enter a ${label}.`,
  mobileLength: (label) => `Enter a 10-digit ${label}, like ${EXAMPLE_MOBILE}.`,
}

/** The field a mobile number message names when the caller names none. */
const MOBILE_LABEL = "mobile number"

/** Something, an @, something, a dot, something: the browser's own check is not used (section 1 rule 5). */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** An email address: present, and complete. Surrounding spaces are ignored. */
function emailError(value: string): string | null {
  const v = value.trim()
  if (v === "") return VALIDATION_TEXT.emailMissing
  if (!EMAIL_SHAPE.test(v)) return VALIDATION_TEXT.emailIncomplete
  return null
}

/**
 * The national number, digits only and not cut short: a pasted or
 * autofilled "+91 98765 43210" or "098765 43210" loses its country code or
 * its trunk 0.
 */
function nationalNumber(value: string, countryCode: string): string {
  let digits = value.replace(/\D/g, "")
  const cc = countryCode.replace(/\D/g, "")
  if (digits.length > MOBILE_LENGTH && cc && digits.startsWith(cc)) digits = digits.slice(cc.length)
  if (digits.length > MOBILE_LENGTH && digits.startsWith("0")) digits = digits.slice(1)
  return digits
}

/**
 * What a mobile number field keeps as the person types or pastes: the
 * national number, digits only, at most 10. "+91 98765 43210" becomes
 * "9876543210". Use it in the field's onChange, where the country code is
 * fixed at the field's start (11.7 rule 1); `countryCode` is that code,
 * +91 by default.
 */
function mobileDigits(value: string, countryCode: string = INDIA): string {
  return nationalNumber(value, countryCode).slice(0, MOBILE_LENGTH)
}

/**
 * A 10-digit Indian mobile number (11.7 rule 1). Takes what the field
 * holds, with or without spaces, +91 or a leading 0.
 *
 * The words are the person's own number by default, as on sign-in and
 * Profile: "Enter your mobile number." and "Enter a 10-digit mobile
 * number, like 98765 43210." For someone else's number, such as a
 * customer's, pass the field's label in lower case and the words name that
 * field instead:
 *
 *   mobileError(value, { label: "phone number" })
 *   // "Enter a phone number." / "Enter a 10-digit phone number, like 98765 43210."
 */
function mobileError(value: string, { label }: { label?: string } = {}): string | null {
  const digits = nationalNumber(value, INDIA)
  if (digits === "") {
    return label === undefined ? VALIDATION_TEXT.mobileMissing : VALIDATION_TEXT.mobileMissingNamed(label)
  }
  if (digits.length !== MOBILE_LENGTH) return VALIDATION_TEXT.mobileLength(label ?? MOBILE_LABEL)
  return null
}

export { emailError, mobileDigits, mobileError, VALIDATION_TEXT, type ValidationText }
