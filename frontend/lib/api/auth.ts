import apiClient from './client';
import type { AuthTokens, AuthUser, ApiResponse, OrgMembership, LoginResponse } from '../types';

/** `identifier` is an email address OR a phone number. `countryCode` (e.g. "+91")
 *  is sent only when the identifier is a phone number. */
export async function login(identifier: string, password: string, countryCode?: string): Promise<LoginResponse> {
  const { data } = await apiClient.post<{ data: LoginResponse }>('/api/v1/auth/login', {
    identifier,
    password,
    ...(countryCode ? { country_code: countryCode } : {}),
  });
  return data.data;
}

/** `identifier` is an email address OR a phone number. `countryCode` (e.g. "+91")
 *  is sent only when the identifier is a phone number. */
export async function adminLogin(identifier: string, password: string, countryCode?: string): Promise<AuthTokens> {
  const { data } = await apiClient.post<{ data: AuthTokens }>('/api/v1/auth/admin-login', {
    identifier,
    password,
    ...(countryCode ? { country_code: countryCode } : {}),
  });
  return data.data;
}

export async function register(registerData: {
  name: string;
  email: string;
  password: string;
  role?: string;
  organization_id?: string;
}): Promise<ApiResponse<AuthUser>> {
  const { data } = await apiClient.post<ApiResponse<AuthUser>>(
    '/api/v1/auth/register',
    registerData
  );
  return data;
}

// ─── Self-service password reset (OTP by email) ───────────────────────────────

export async function forgotPassword(email: string): Promise<void> {
  await apiClient.post('/api/v1/auth/forgot-password', { email });
}

export async function verifyResetOtp(email: string, otp: string): Promise<{ reset_token: string }> {
  const { data } = await apiClient.post<{ data: { reset_token: string } }>(
    '/api/v1/auth/reset-password/verify',
    { email, otp }
  );
  return data.data;
}

export async function resetPassword(
  email: string,
  reset_token: string,
  password: string
): Promise<void> {
  await apiClient.post('/api/v1/auth/reset-password', { email, reset_token, password });
}

/** Change the current (already logged-in) user's password directly — no OTP, no current password. */
export async function changePassword(password: string): Promise<void> {
  await apiClient.patch('/api/v1/auth/change-password', { password });
}

export async function logout(): Promise<void> {
  await apiClient.post('/api/v1/auth/logout');
}

export async function getMe(config?: import('axios').AxiosRequestConfig): Promise<AuthUser> {
  const { data } = await apiClient.get<ApiResponse<AuthUser>>('/api/v1/auth/me', config);
  return data.data;
}

export async function switchOrg(organizationId: string): Promise<AuthTokens> {
  const { data } = await apiClient.post<{ data: AuthTokens }>('/api/v1/auth/switch-org', {
    organizationId,
  });
  return data.data;
}

export async function getMyOrgs(): Promise<OrgMembership[]> {
  const { data } = await apiClient.get<ApiResponse<OrgMembership[]>>('/api/v1/auth/my-orgs');
  return data.data;
}
