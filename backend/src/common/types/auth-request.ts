import type { Request } from 'express';

/** The user object JwtStrategy.validate() attaches to `req.user`. */
export interface AuthUser {
  id: string;
  email: string | null;
  country_code: string | null;
  phone: string | null;
  name: string;
  isSuperAdmin: boolean;
  /** Null only for org-less tokens (super-admin portal); org-scoped routes (OrgScopeGuard) always have it. */
  organizationId: string;
  is_admin: boolean;
  system_role_id: string | null;
  isTestOrg: boolean;
  employee_profile_id: string | null;
  /** Device session id (null for pre-sessions tokens). */
  sid: string | null;
}

/** An authenticated HTTP request (after JwtAuthGuard). */
export interface AuthRequest extends Request {
  user: AuthUser;
}
