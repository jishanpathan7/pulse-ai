/**
 * token-refresh — schedules silent access-token refresh before expiry.
 *
 * Access token TTL: 15 min (900s). We refresh at 80% of TTL = 720s.
 * On 401 from refresh: sets auth store to unauthenticated (forces re-login).
 */

import { refreshTokens } from './auth-client.js';
import { useAuthStore } from './auth-store.js';

const REFRESH_AT_MS = 720 * 1000; // 12 min — 80% of 15 min TTL

let timer: ReturnType<typeof setTimeout> | null = null;

export function scheduleTokenRefresh(): void {
  cancelTokenRefresh();
  timer = setTimeout(() => {
    void (async () => {
      const ok = await refreshTokens();
      if (ok) {
        // Rotation succeeded — schedule next
        scheduleTokenRefresh();
      } else {
        // Refresh token expired or revoked — force re-login
        useAuthStore.getState().setUnauthenticated();
      }
    })();
  }, REFRESH_AT_MS);
}

export function cancelTokenRefresh(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}
