/**
 * authStore — global auth state.
 *
 * 'loading'       — checking session on startup (show nothing / spinner)
 * 'unauthenticated' — no valid session, show login screen
 * 'authenticated'   — valid session, show workspace
 */

import { create } from 'zustand';
import type { AuthUser } from './auth-client.js';
import { getMe, logout as apiLogout } from './auth-client.js';

type AuthStatus = 'loading' | 'unauthenticated' | 'authenticated';

interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
}

interface AuthActions {
  /** Called after successful login/register — sets user + status. */
  setAuthenticated: (user: AuthUser) => void;
  /** Called on logout or 401 — clears user. */
  setUnauthenticated: () => void;
  /** Call /auth/logout then clear local state. */
  logout: () => Promise<void>;
  /** Bootstrap: check existing session cookie. */
  checkSession: () => Promise<void>;
}

export const useAuthStore = create<AuthState & AuthActions>((set) => ({
  status: 'loading',
  user: null,

  setAuthenticated: (user) => set({ status: 'authenticated', user }),

  setUnauthenticated: () => set({ status: 'unauthenticated', user: null }),

  logout: async () => {
    await apiLogout().catch(() => undefined); // best-effort
    set({ status: 'unauthenticated', user: null });
  },

  checkSession: async () => {
    try {
      const user = await getMe();
      if (user !== null) {
        set({ status: 'authenticated', user });
      } else {
        set({ status: 'unauthenticated', user: null });
      }
    } catch {
      // Network error (API unreachable) — treat as unauthenticated
      set({ status: 'unauthenticated', user: null });
    }
  },
}));
