import { SetMetadata } from '@nestjs/common';

export const ALLOW_SELECTION_TOKEN_KEY = 'allowSelectionToken';

/**
 * Marks an endpoint the organisation-selection token may call.
 *
 * Signing in with several organisations returns a short-lived `org_selection` token
 * (type claim, no organisationId) instead of a session. It exists only to pick a
 * firm: list the person's organisations and switch into one. Every other endpoint
 * rejects it (JwtAuthGuard), so it can never be mistaken for a signed-in session.
 */
export const AllowSelectionToken = () =>
  SetMetadata(ALLOW_SELECTION_TOKEN_KEY, true);
