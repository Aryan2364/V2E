/**
 * Organization-level access kill switch.
 *
 * A super admin can deactivate a whole firm (`Organization.status = 'inactive'`).
 * That flag is the ONLY thing that changes — memberships, users and passwords are
 * all left intact so the firm can be switched back on without re-provisioning
 * anyone. Which means nothing about a user's own record says "locked out": every
 * place that mints a session, refreshes one, or accepts one must ask the
 * organization as well. Those places are:
 *
 *   - `auth.service.ts`  login / switchOrg / getMyOrgs / refresh  (no new session)
 *   - `jwt.strategy.ts`  every authenticated HTTP request          (kills live ones)
 *   - `ws-auth.service.ts` socket handshake                        (kills live ones)
 *
 * The same three places also refuse a person whose membership has ended (below).
 *
 * Super admins are exempt — deactivation is administered from their portal, and
 * they must still be able to open the firm to inspect or reactivate it.
 *
 * `pending_setup` is deliberately NOT a lockout: it's the pre-onboarding state of
 * legacy rows, not a revocation.
 */
export const ORG_DEACTIVATED_MESSAGE =
  'Your organization’s access has been deactivated. Please contact your administrator.';

/**
 * Membership kill switch - the per-person sibling of the org kill switch above.
 * Removing or deactivating someone in an organisation (users.service deactivate,
 * employees.service delete) ends their membership row; the same three places
 * must then refuse that org's tokens, or a removed person keeps working in the
 * org until their refresh token expires (up to 30 days). Super admins are
 * exempt - they open firms they are not members of.
 */
export const MEMBERSHIP_ENDED_MESSAGE =
  'You no longer have access to this organization. Please contact your administrator.';

export function isOrganizationDeactivated(status: string | null | undefined): boolean {
  return status === 'inactive';
}
