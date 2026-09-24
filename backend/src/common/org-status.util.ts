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
 * Super admins are exempt — deactivation is administered from their portal, and
 * they must still be able to open the firm to inspect or reactivate it.
 *
 * `pending_setup` is deliberately NOT a lockout: it's the pre-onboarding state of
 * legacy rows, not a revocation.
 */
export const ORG_DEACTIVATED_MESSAGE =
  'Your organization’s access has been deactivated. Please contact your administrator.';

export function isOrganizationDeactivated(status: string | null | undefined): boolean {
  return status === 'inactive';
}
