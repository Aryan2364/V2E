/**
 * Sign-in validation (FRONTEND_RULES_ACCESS.md 11.7). The login API is called
 * only for an identifier the backend can act on, so a typo costs no request.
 *
 * The rule mirrors the backend's classifyIdentifier (backend/src/common/
 * identifier.util.ts), which is the source of truth:
 *   - an identifier containing "@" is an EMAIL;
 *   - anything else is a PHONE, which must be exactly the chosen country's
 *     digit count once the pasted "+91" and a leading trunk 0 are dropped.
 * Nothing is rejected here that the backend would accept, except text that is
 * plainly neither (letters in a number, "john"), which it could only fail.
 *
 * The words are the kit's: the email check and the 10-digit mobile message come
 * from lib/validation.ts, the digit counts from lib/phone.ts. Not a second copy.
 */
import { z } from 'zod'
import { DEFAULT_COUNTRY, findCountry, nationalDigitsFor, normaliseNationalNumber } from '@/lib/phone'
import { emailError, VALIDATION_TEXT } from '@/lib/validation'

export const IDENTIFIER_MISSING = 'Enter your email address or mobile number.'
export const IDENTIFIER_UNRECOGNISED =
  'Enter a complete email address, like name@company.com, or a mobile number.'
export const PASSWORD_MISSING = 'Enter your password.'

/** What a typed mobile number may contain besides digits: spaces, dashes, brackets, a leading +. */
const PHONE_CHARACTERS = /^[\d\s().+-]+$/

/** The message to show below the identifier field, or null when it is fine. */
function identifierProblem(raw: string, countryCode: string): string | null {
  const value = raw.trim()
  if (value === '') return IDENTIFIER_MISSING

  // Same test as the backend: "@" means email.
  if (value.includes('@')) return emailError(value)

  // No digit and no "@" (like "john"): the form shows no country picker, so it
  // can't be read as a number either.
  if (!/\d/.test(value)) return IDENTIFIER_UNRECOGNISED

  // From here the form treats it as a mobile number (the country picker is
  // showing), so every problem is worded as a mobile number problem, never an
  // email one. Letters in a number are wrong for the same reason a short one is.
  const needed = nationalDigitsFor(countryCode)
  if (!PHONE_CHARACTERS.test(value) || normaliseNationalNumber(value, countryCode).length !== needed) {
    return countryCode === DEFAULT_COUNTRY
      ? VALIDATION_TEXT.mobileLength('mobile number')
      : `Enter a ${needed}-digit mobile number for ${findCountry(countryCode)?.name ?? 'this country'}.`
  }
  return null
}

/** The identifier field alone, for checking it when the person leaves it. */
export function identifierSchema(countryCode: string) {
  return z.string().superRefine((raw, ctx) => {
    const problem = identifierProblem(raw, countryCode)
    if (problem) ctx.addIssue({ code: 'custom', message: problem })
  })
}

/** The password field alone. Only presence is checked: the server owns the password rules. */
export const passwordSchema = z.string().min(1, PASSWORD_MISSING)

/** The whole sign-in form. */
export const loginSchema = z
  .object({
    identifier: z.string(),
    countryCode: z.string(),
    password: z.string(),
  })
  .superRefine((form, ctx) => {
    const identifier = identifierSchema(form.countryCode).safeParse(form.identifier)
    if (!identifier.success) {
      ctx.addIssue({ code: 'custom', path: ['identifier'], message: identifier.error.issues[0].message })
    }
    const password = passwordSchema.safeParse(form.password)
    if (!password.success) {
      ctx.addIssue({ code: 'custom', path: ['password'], message: password.error.issues[0].message })
    }
  })

export type LoginForm = z.infer<typeof loginSchema>
