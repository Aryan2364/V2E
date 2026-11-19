import { BadRequestException } from '@nestjs/common';
import { DEFAULT_COUNTRY_CODE, findCountry } from './countries';

/**
 * Login identity helpers. A user signs in with EITHER an email OR a phone number.
 *
 * A phone is TWO parts: a dialling country code ("+91") kept separate from the
 * national number (digits only). The SAME functions here are used on every save
 * path and every lookup path, so a number registered as "+91 / 9876543210" is
 * matched no matter whether the person later types spaces, dashes, a leading 0,
 * or pastes the whole "+91 98765 43210" back in. Do not write a second copy of
 * this logic anywhere on the backend.
 */

/** Strip everything except digits. '' if nothing usable. */
export function normalizePhone(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\D/g, '');
}

/**
 * Is this the way a person writes a phone number? Digits, plus the separators people
 * type or paste: spaces, dashes, dots, brackets and a "+". Nothing else.
 *
 * normalizePhone() drops every non-digit, so without this check "98fdsf76dsf543210"
 * is quietly read as 9876543210 and matches a real account. Login must never accept
 * letters inside a number; they can only be a typo or someone probing.
 */
const PHONE_INPUT = /^[\d\s().+-]+$/;
export function isWellFormedPhoneInput(raw: string | null | undefined): boolean {
  const v = (raw ?? '').trim();
  return PHONE_INPUT.test(v) && /\d/.test(v);
}

/** A value is treated as an email if it contains '@'. */
export function looksLikeEmail(raw: string | null | undefined): boolean {
  return !!raw && raw.includes('@');
}

/**
 * Reduce a typed national number to canonical digits for a given country:
 *   1. strip every non-digit;
 *   2. if the result begins with that country's dialling digits AND is longer
 *      than the national length, drop that pasted country-code prefix
 *      ("+91 98765 43210" → "919876543210" → "9876543210");
 *   3. drop a single leading trunk 0 ("09876543210" → "9876543210").
 * This is the paste/format safety net and runs identically on save and lookup.
 */
export function normalizeNationalNumber(
  rawNumber: string | null | undefined,
  countryCode: string | null | undefined,
): string {
  let d = normalizePhone(rawNumber);
  const country = findCountry(countryCode);
  if (country) {
    const ccDigits = normalizePhone(country.code); // "+91" -> "91"
    if (ccDigits && d.startsWith(ccDigits) && d.length > country.nationalDigits) {
      d = d.slice(ccDigits.length);
    }
    if (d.length > country.nationalDigits && d.startsWith('0')) {
      d = d.slice(1);
    }
  }
  return d;
}

export type IdentifierKind = 'email' | 'phone';
export type ClassifiedIdentifier =
  | { kind: 'email'; value: string }
  | { kind: 'phone'; countryCode: string; value: string };

/**
 * Classify a typed login identifier. If it contains '@' it's an email (trimmed
 * only — case is deliberately left untouched, out of scope). Otherwise it's a
 * phone: the digits are normalised for the given country code (defaulting to
 * +91 when none is supplied), and the canonical (countryCode, value) PAIR is
 * what callers must look up on.
 */
export function classifyIdentifier(
  raw: string | null | undefined,
  countryCode?: string | null,
): ClassifiedIdentifier {
  const trimmed = (raw ?? '').trim();
  if (looksLikeEmail(trimmed)) return { kind: 'email', value: trimmed };
  const cc = (countryCode ?? '').trim() || DEFAULT_COUNTRY_CODE;
  // Not a well-formed number (letters, symbols, no digits): give it NO value, which
  // every caller reads as "no such account" and skips the lookup.
  if (!isWellFormedPhoneInput(trimmed)) return { kind: 'phone', countryCode: cc, value: '' };
  return { kind: 'phone', countryCode: cc, value: normalizeNationalNumber(trimmed, cc) };
}

/**
 * Validate + normalise a phone pair for SAVING. The country code must be one we
 * support, and the national number must be EXACTLY that country's digit count.
 * Throws a clear, user-facing message otherwise. Returns the canonical parts.
 */
export function validatePhonePair(
  countryCode: string | null | undefined,
  rawNumber: string | null | undefined,
): { country_code: string; phone: string } {
  const country = findCountry(countryCode);
  if (!country) {
    throw new BadRequestException('Please choose a valid country code for the phone number.');
  }
  const phone = normalizeNationalNumber(rawNumber, country.code);
  if (phone.length !== country.nationalDigits) {
    throw new BadRequestException(
      `Please enter a ${country.nationalDigits} digit number for ${country.name} (${country.code}).`,
    );
  }
  return { country_code: country.code, phone };
}

/**
 * Resolve the phone identity to STORE from raw form inputs, enforcing the
 * "both together or both NULL" rule. If no number was entered, returns both
 * NULL (the country code alone is meaningless). If a number was entered, it is
 * validated for the chosen country (default +91) and returned as a canonical pair.
 */
export function resolvePhoneForSave(
  countryCode: string | null | undefined,
  rawNumber: string | null | undefined,
): { country_code: string | null; phone: string | null } {
  if (!normalizePhone(rawNumber)) {
    return { country_code: null, phone: null };
  }
  return validatePhonePair(countryCode || DEFAULT_COUNTRY_CODE, rawNumber);
}
