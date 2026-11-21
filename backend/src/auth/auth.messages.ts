import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';

/**
 * What sign-in and password reset tell the person. Kept in one place so every route
 * says the same thing for the same situation.
 *
 * Security rule: a refusal must never reveal whether an account exists. "Email not
 * found" vs "wrong password" lets anyone with curl test which emails and phone
 * numbers are registered, so every credential failure (unknown account, wrong
 * password, not a super admin) gets the SAME message, the same status and roughly
 * the same response time.
 *
 * Messages that explain the account's state (deactivated, no organization) are only
 * sent AFTER the password has been checked and is correct. Only the owner can see
 * them, so they reveal nothing to anyone guessing.
 */
export const AUTH_MESSAGES = {
  invalidCredentials:
    'The email, mobile number or password is not right. Check them and try again.',
  accountDeactivated:
    'Your account has been deactivated. Please contact your administrator.',
  superAdminDeactivated:
    'Your super admin access has been deactivated by another super admin. Please contact them to restore it.',
  noOrganization:
    'You are not a member of any active organization yet. Ask your administrator to add you.',
  resetCodeSent:
    'If an account uses this email, we have sent a 6-digit code to it.',
} as const;

/**
 * Wrong email / mobile number or password (or not a super admin, on the admin portal).
 * Its own class so callers can tell a failed guess apart from every other refusal
 * (deactivated account, rate limit): only this one counts toward the per-IP
 * failed sign-in limit (common/rate-limit/failed-login.limiter.ts).
 */
export class InvalidCredentialsException extends UnauthorizedException {
  constructor() {
    super(AUTH_MESSAGES.invalidCredentials);
  }
}

/**
 * A real bcrypt hash (cost 12, like stored passwords) to compare against when no
 * account matched. Without it, "unknown email" answers in ~1 ms and "wrong password"
 * in ~250 ms, and that difference alone reveals which accounts exist.
 */
export const TIMING_EQUALISER_HASH = bcrypt.hashSync(
  'timing-equaliser-not-a-password',
  12,
);
