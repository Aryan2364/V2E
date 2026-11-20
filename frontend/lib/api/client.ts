import axios, { AxiosInstance, InternalAxiosRequestConfig, AxiosResponse, AxiosError } from 'axios';
import { refreshAccessToken, RefreshError } from './refresh';

const BASE_URL = '';

const apiClient: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  headers: {
    'Content-Type': 'application/json',
    // Opt in to the httpOnly refresh-token cookie: with this header the server sets
    // the cookie and keeps the refresh token out of every response body, so no script
    // on the page can read it. It is also the CSRF guard for the cookie refresh, as a
    // cross-site page cannot send a custom header. See backend/src/auth/auth-cookie.ts.
    'X-V2E-Auth': 'cookie',
  },
  // Send the cookie. Same-origin requests do already; this keeps it working if the
  // API ever moves to another origin.
  withCredentials: true,
});

// ─── Request Interceptor — attach Bearer token ──────────────────────────────
apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('access_token');
      if (token && config.headers) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }
    return config;
  },
  (error: AxiosError) => Promise.reject(error)
);

// ─── Response Interceptor — handle 401 / token refresh ─────────────────────
// Refresh coordination (cross-tab single-flight, transient-vs-definitive) lives
// in ./refresh. Here we just: on a 401, get a fresh token and retry once; only
// tear down the session when the refresh is *definitively* rejected (401 / no
// token) — a transient network blip must not log the user out.
apiClient.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {
      // Auth endpoints return 401 for bad credentials — don't intercept them
      const url = originalRequest.url ?? '';
      if (
        url.includes('/auth/login') ||
        url.includes('/auth/admin-login') ||
        url.includes('/auth/register') ||
        url.includes('/auth/refresh')
      ) {
        return Promise.reject(error);
      }

      originalRequest._retry = true;

      // The access token this request already failed with — so refresh() can tell
      // whether another tab has meanwhile stored a newer one.
      const triedToken = ((originalRequest.headers?.Authorization as string) ?? '')
        .replace(/^Bearer\s+/i, '') || null;

      try {
        const newAccessToken = await refreshAccessToken(triedToken);
        if (originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
        }
        return apiClient(originalRequest);
      } catch (refreshError) {
        // Only redirect to login when the session is genuinely gone. On a
        // transient failure, reject this one request but keep the user signed in.
        if (refreshError instanceof RefreshError && refreshError.definitive) {
          clearAuthAndRedirect();
        }
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

function clearAuthAndRedirect() {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    window.location.href = '/login';
  }
}

export default apiClient;
