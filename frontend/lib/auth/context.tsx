'use client';

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { login as apiLogin, logout as apiLogout, getMe, switchOrg as apiSwitchOrg } from '../api/auth';
import { refreshAccessToken } from '../api/refresh';
import type { AuthUser, OrgChoice } from '../types';

// Decode a JWT's `exp` claim (seconds → ms). Returns null if unreadable.
function getTokenExpiryMs(token: string): number | null {
  try {
    const payload = token.split('.')[1];
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof json.exp === 'number' ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

// ─── Context Shape ─────────────────────────────────────────────────────────────

interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  pendingOrgSelection: OrgChoice[] | null;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  selectOrg: (organizationId: string) => Promise<void>;
  switchOrg: (organizationId: string) => Promise<void>;
}

// ─── Context ───────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingOrgSelection, setPendingOrgSelection] = useState<OrgChoice[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      const token = typeof window !== 'undefined'
        ? localStorage.getItem('access_token')
        : null;

      if (!token) {
        setIsLoading(false);
        return;
      }

      // On a cold start the Next dev proxy route and the backend build are still
      // compiling on-demand, so the very first /auth/me can stall for many
      // seconds. Give each attempt a bounded timeout and retry a few times so the
      // boot self-heals instead of hanging the splash forever (previously this
      // needed a manual page reload). A definitive auth failure (401) is already
      // handled by the axios interceptor (refresh → redirect), so it won't retry.
      const MAX_ATTEMPTS = 4;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS && !cancelled; attempt++) {
        try {
          const me = await getMe({ timeout: 15_000 });
          if (!cancelled) setUser(me);
          break;
        } catch (err) {
          const status = (err as { response?: { status?: number } })?.response?.status;

          // Genuine "session is gone" — clear it and stop. (A 401 that could be
          // refreshed never reaches here; the interceptor handles those.)
          if (status === 401 || status === 403) {
            localStorage.removeItem('access_token');
            localStorage.removeItem('refresh_token');
            break;
          }

          // Transient (timeout / network blip / cold-start 5xx): keep the session
          // and retry with a short backoff. Only give up after the last attempt —
          // and even then, keep the tokens so a later reload can recover.
          if (attempt === MAX_ATTEMPTS) break;
          await new Promise((r) => setTimeout(r, 600 * attempt));
        }
      }

      if (!cancelled) setIsLoading(false);
    }

    restoreSession();
    return () => {
      cancelled = true;
    };
  }, []);

  // Proactively refresh the access token shortly before it expires, so background
  // pollers (notifications, clock, …) never fire a request with a just-expired
  // token — which the server would log as a 401 before the reactive interceptor
  // silently refreshes and retries. If this proactive refresh fails, the axios
  // interceptor's reactive refresh still covers us.
  useEffect(() => {
    if (!user || typeof window === 'undefined') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const schedule = () => {
      if (cancelled) return;
      const token = localStorage.getItem('access_token');
      const exp = token ? getTokenExpiryMs(token) : null;
      if (!exp) return;
      // Refresh 60s before expiry, but never sooner than 5s from now.
      const delay = Math.max(5_000, exp - Date.now() - 60_000);
      timer = setTimeout(async () => {
        if (cancelled) return;
        try {
          // Shared single-flight refresh — coordinates with the axios interceptor
          // and other tabs via a Web Lock, so this proactive refresh can't race
          // them into an "already rotated" logout.
          await refreshAccessToken(token);
        } catch {
          /* reactive interceptor will handle a later 401 if this was transient */
        } finally {
          if (!cancelled) schedule();
        }
      }, delay);
    };

    schedule();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [user]);

  const login = useCallback(async (email: string, password: string) => {
    const result = await apiLogin(email, password);

    if ('requires_org_selection' in result && result.requires_org_selection) {
      if (typeof window !== 'undefined') {
        localStorage.setItem('selection_token', result.selection_token);
        // Store selection token as access_token so the API client can attach it
        localStorage.setItem('access_token', result.selection_token);
      }
      setPendingOrgSelection(result.organizations);
      router.replace('/select-org');
      return;
    }

    const tokens = result as import('../types').AuthTokens;
    if (typeof window !== 'undefined') {
      localStorage.setItem('access_token', tokens.access_token);
      localStorage.setItem('refresh_token', tokens.refresh_token);
    }

    setUser(tokens.user);
  }, [router]);

  const selectOrg = useCallback(async (organizationId: string) => {
    const tokens = await apiSwitchOrg(organizationId);
    if (typeof window !== 'undefined') {
      localStorage.setItem('access_token', tokens.access_token);
      localStorage.setItem('refresh_token', tokens.refresh_token);
      localStorage.removeItem('selection_token');
    }
    setPendingOrgSelection(null);
    setUser(tokens.user);
  }, []);

  const switchOrg = useCallback(async (organizationId: string) => {
    const tokens = await apiSwitchOrg(organizationId);
    if (typeof window !== 'undefined') {
      localStorage.setItem('access_token', tokens.access_token);
      localStorage.setItem('refresh_token', tokens.refresh_token);
    }
    setUser(tokens.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiLogout();
    } catch {
      // Best-effort — proceed with local cleanup regardless
    } finally {
      if (typeof window !== 'undefined') {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        localStorage.removeItem('selection_token');
      }
      setUser(null);
      setPendingOrgSelection(null);
      router.push('/login');
    }
  }, [router]);

  const value: AuthContextValue = {
    user,
    isLoading,
    isAuthenticated: !!user,
    pendingOrgSelection,
    login,
    logout,
    selectOrg,
    switchOrg,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ─── Hook ──────────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
