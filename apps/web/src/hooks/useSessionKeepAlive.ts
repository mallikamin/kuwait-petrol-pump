import { useEffect, useRef } from 'react';
import { useAuthStore } from '@/store/auth';
import { refreshAccessToken } from '@/api/client';

// How often to proactively refresh while the user is authenticated.
// POS access tokens live 24h by default; refreshing every 30 minutes keeps the
// session well away from the expiry boundary so no request ever 401s mid-flow.
const DEFAULT_INTERVAL_MS = 30 * 60 * 1000;

// If a refresh returns a transient failure, retry sooner instead of waiting a
// full interval - prevents slow drift into an expired access token while
// Redis/backend recovers.
const RETRY_INTERVAL_MS = 2 * 60 * 1000;

// Base64url decode helper - avoids adding a JWT library just to peek at `exp`.
const decodeJwtPayload = (token: string): { exp?: number } | null => {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4));
    const json = atob(base64 + pad);
    return JSON.parse(json);
  } catch {
    return null;
  }
};

/**
 * Keeps the user's session alive by proactively refreshing the access token on
 * an interval while the app is open and the user is authenticated.
 *
 * Why: the 401-triggered refresh path works, but it forces the user's first
 * post-expiry request to pay the refresh latency (and risks a logout if the
 * refresh hits a transient failure at exactly that moment). Sliding refresh
 * keeps the token fresh and decouples session continuity from request timing.
 *
 * The hook also refreshes on tab re-focus - a workstation that was left
 * overnight will have its token refreshed as soon as the user returns, before
 * any real request can fail.
 */
export function useSessionKeepAlive(intervalMs: number = DEFAULT_INTERVAL_MS) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isAuthenticated) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    let cancelled = false;

    const schedule = (delay: number) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(async () => {
        if (cancelled) return;
        try {
          const ok = await refreshAccessToken();
          schedule(ok ? intervalMs : RETRY_INTERVAL_MS);
        } catch {
          // Auth-invalid was thrown: let the interceptor handle logout when the
          // next real request 401s. Don't reschedule.
        }
      }, delay);
    };

    const pickInitialDelay = (): number => {
      const { token } = useAuthStore.getState();
      if (!token) return intervalMs;
      const payload = decodeJwtPayload(token);
      if (!payload?.exp) return intervalMs;
      // Refresh at the halfway point between now and expiry, capped at the
      // configured interval. Never less than 1 minute to avoid hot-loops if a
      // token arrives already near expiry.
      const remainingMs = payload.exp * 1000 - Date.now();
      const half = Math.floor(remainingMs / 2);
      return Math.max(60 * 1000, Math.min(intervalMs, half));
    };

    const onFocus = () => {
      // Pull the session forward when the user returns after idle/sleep.
      schedule(0);
    };

    schedule(pickInitialDelay());
    window.addEventListener('focus', onFocus);

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      window.removeEventListener('focus', onFocus);
    };
  }, [isAuthenticated, intervalMs]);
}
