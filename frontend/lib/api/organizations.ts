import apiClient from './client';
import type { Organization, OrgDetail, ApiResponse } from '../types';

// ─── Organizations API ────────────────────────────────────────────────────────

export async function getOrganizations(): Promise<Organization[]> {
  const { data } = await apiClient.get<ApiResponse<Organization[]>>('/api/v1/organizations');
  return data.data;
}

export async function getOrganization(id: string): Promise<OrgDetail> {
  const { data } = await apiClient.get<ApiResponse<OrgDetail>>(`/api/v1/organizations/${id}`);
  return data.data;
}

// Member-scoped: returns the caller's own org basic profile (any member, not
// just super admins). Use this for in-app pages like the dashboard header.
export async function getMyOrganization(id: string): Promise<Organization> {
  const { data } = await apiClient.get<ApiResponse<Organization>>(
    `/api/v1/organizations/${id}/summary`
  );
  return data.data;
}

export async function createOrganization(orgData: {
  name: string
  group_id?: string
  existing_user_id?: string
  admin_name?: string
  admin_email?: string
  admin_phone?: string
  admin_country_code?: string
  admin_password?: string
  logo_url?: string
  industry?: string
  country?: string
  timezone?: string
  status?: string
  is_test?: boolean
}): Promise<Organization> {
  const { data } = await apiClient.post<ApiResponse<Organization>>(
    '/api/v1/organizations',
    orgData
  );
  return data.data;
}

export interface OrgAdminAccountCheck {
  exists: boolean;
  /** Existing global name — shown (locked) when the login already exists. */
  name?: string;
}

/**
 * Does a global login already exist for this email? Lets the firm-creation form show
 * a password field only for a brand-new admin and hide it for an existing account.
 */
export async function checkOrgAdminAccount(identifier: string, countryCode?: string): Promise<OrgAdminAccountCheck> {
  const { data } = await apiClient.get<ApiResponse<OrgAdminAccountCheck>>(
    '/api/v1/organizations/check-account',
    { params: { identifier, ...(countryCode ? { country_code: countryCode } : {}) } }
  );
  return data.data;
}

export async function updateOrganization(
  id: string,
  orgData: Partial<Omit<Organization, 'id' | 'created_at' | 'updated_at'>>
): Promise<Organization> {
  const { data } = await apiClient.patch<ApiResponse<Organization>>(
    `/api/v1/organizations/${id}`,
    orgData
  );
  return data.data;
}

export async function deactivateOrganization(id: string): Promise<void> {
  await apiClient.delete(`/api/v1/organizations/${id}/deactivate`);
}

export async function reactivateOrganization(id: string): Promise<void> {
  await apiClient.post(`/api/v1/organizations/${id}/reactivate`);
}

// ─── Module entitlements (vendor ceiling — superadmin only) ────────────────────

export type EntitlementState = 'full' | 'preview' | 'off';

export interface ModuleEntitlement {
  module_key: string;
  label: string;
  /** Optional grouping heading for the portal (e.g. Governance line items). */
  group?: string;
  state: EntitlementState;
}

// Member-safe: the entitlement state map for the caller's own org (drives nav/feature gating).
export async function getMyEntitlements(orgId: string): Promise<Record<string, EntitlementState>> {
  const { data } = await apiClient.get<ApiResponse<{ entitlements?: Record<string, EntitlementState> }>>(
    `/api/v1/organizations/${orgId}/summary`
  );
  return data.data.entitlements ?? {};
}

export async function getEntitlements(orgId: string): Promise<{ modules: ModuleEntitlement[] }> {
  const { data } = await apiClient.get<ApiResponse<{ modules: ModuleEntitlement[] }>>(
    `/api/v1/organizations/${orgId}/entitlements`
  );
  return data.data;
}

export async function setEntitlements(
  orgId: string,
  entries: { module_key: string; state: EntitlementState }[]
): Promise<{ modules: ModuleEntitlement[] }> {
  const { data } = await apiClient.put<ApiResponse<{ modules: ModuleEntitlement[] }>>(
    `/api/v1/organizations/${orgId}/entitlements`,
    { entries }
  );
  return data.data;
}
