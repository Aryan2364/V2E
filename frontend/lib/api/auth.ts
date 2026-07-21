import apiClient from './client';
import type { AuthTokens, AuthUser, ApiResponse, OrgMembership, LoginResponse } from '../types';

export async function login(email: string, password: string): Promise<LoginResponse> {
  const { data } = await apiClient.post<{ data: LoginResponse }>('/api/v1/auth/login', {
    email,
    password,
  });
  return data.data;
}

export async function adminLogin(email: string, password: string): Promise<AuthTokens> {
  const { data } = await apiClient.post<{ data: AuthTokens }>('/api/v1/auth/admin-login', {
    email,
    password,
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

export async function refreshToken(token: string): Promise<{ access_token: string; refresh_token?: string }> {
  const { data } = await apiClient.post<ApiResponse<{ access_token: string; refresh_token?: string }>>(
    '/api/v1/auth/refresh',
    { refresh_token: token }
  );
  return data.data;
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
