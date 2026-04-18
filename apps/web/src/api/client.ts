import axios, { AxiosError, AxiosInstance } from 'axios';
import { useAuthStore } from '@/store/auth';
import { sessionDebugger } from '@/utils/sessionDebug';

// Guard: Default to '/api' if VITE_API_URL is empty/invalid
const API_URL = import.meta.env.VITE_API_URL?.trim() || '/api';

// Validate baseURL is not malformed
const isValidBaseURL = (url: string): boolean => {
  if (url.startsWith('/')) return true; // Relative URL
  try {
    new URL(url); // Try parsing as absolute URL
    return true;
  } catch {
    return false;
  }
};

const FINAL_API_URL = isValidBaseURL(API_URL) ? API_URL : '/api';

if (FINAL_API_URL !== API_URL) {
  console.warn(`[API Client] Invalid VITE_API_URL="${API_URL}", falling back to "/api"`);
}

export const apiClient: AxiosInstance = axios.create({
  baseURL: FINAL_API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

let isRefreshing = false;
let pendingRequests: Array<(token: string | null) => void> = [];
let refreshAttempts = 0;
const MAX_REFRESH_ATTEMPTS = 2;
const MAX_TRANSIENT_RETRIES = 3; // Retry 503 errors up to 3 times
const RETRY_DELAY_MS = 1000; // Base delay: 1 second

// Diagnostic logging for session stability debugging
const logAuth = (event: string, data?: Record<string, any>) => {
  const timestamp = new Date().toISOString();
  console.log(`[Auth] ${timestamp} ${event}`, data || '');
  // Also log to persistent session debug logger for error reporting
  sessionDebugger.log(event, data);
};

const flushPendingRequests = (token: string | null) => {
  pendingRequests.forEach((cb) => cb(token));
  pendingRequests = [];
};

// Helper: Retry refresh with exponential backoff for transient errors
const attemptRefreshWithRetry = async (
  refreshToken: string,
  retryCount: number = 0
): Promise<string> => {
  try {
    const response = await axios.post(
      `${FINAL_API_URL}/auth/refresh`,
      { refreshToken },
      { headers: { 'Content-Type': 'application/json' } }
    );

    const newAccessToken = response.data?.accessToken || response.data?.access_token;
    if (!newAccessToken || typeof newAccessToken !== 'string') {
      throw new Error('Refresh response missing access token');
    }

    return newAccessToken;
  } catch (error: any) {
    const status = error.response?.status;
    // 429 (nginx auth rate-limit) is transient too: backing off and retrying
    // avoids forced logout when the browser briefly bursts refresh calls
    // (e.g. multiple tabs waking from sleep at once).
    const isTransient = !status || status >= 500 || status === 429;

    // If transient error and retries remaining, wait and retry
    if (isTransient && retryCount < MAX_TRANSIENT_RETRIES) {
      const delay = RETRY_DELAY_MS * Math.pow(2, retryCount); // Exponential backoff
      logAuth(`Transient refresh error, retrying in ${delay}ms`, {
        status,
        retryCount: retryCount + 1,
        maxRetries: MAX_TRANSIENT_RETRIES,
      });

      await new Promise(resolve => setTimeout(resolve, delay));
      return attemptRefreshWithRetry(refreshToken, retryCount + 1);
    }

    // No more retries or non-transient error, rethrow
    throw error;
  }
};

/**
 * Proactively refresh the access token without waiting for a 401.
 *
 * Returns `true` on success, `false` on transient failure (caller should
 * keep the session; we'll try again later), and throws on auth-invalid (401)
 * so the caller can choose to logout.
 *
 * Safe to call concurrently with the interceptor: we reuse the `isRefreshing`
 * flag and queue so only one refresh is in flight at a time.
 */
export const refreshAccessToken = async (): Promise<boolean> => {
  const { refreshToken, setToken } = useAuthStore.getState();
  if (!refreshToken) return false;

  // If the interceptor is already refreshing, wait for it and inherit the result.
  if (isRefreshing) {
    return new Promise<boolean>((resolve) => {
      pendingRequests.push((newToken) => resolve(!!newToken));
    });
  }

  isRefreshing = true;
  try {
    const newAccessToken = await attemptRefreshWithRetry(refreshToken);
    setToken(newAccessToken);
    flushPendingRequests(newAccessToken);
    refreshAttempts = 0;
    logAuth('Proactive token refresh successful');
    return true;
  } catch (err: any) {
    const status = err?.response?.status;
    if (status === 401) {
      // Definitive auth failure: surface to caller
      flushPendingRequests(null);
      logAuth('Proactive refresh: auth invalid', { status });
      throw err;
    }
    // Transient or unknown error: keep session, caller will retry later
    flushPendingRequests(null);
    logAuth('Proactive refresh: transient failure (will retry later)', { status });
    return false;
  } finally {
    isRefreshing = false;
  }
};

// Request interceptor
apiClient.interceptors.request.use(
  (config) => {
    const token = useAuthStore.getState().token;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    // Normalize URLs: prevent /api/api/... duplication
    // baseURL is already '/api', so strip '/api/' prefix from request URLs
    if (config.url?.startsWith('/api/')) {
      config.url = config.url.replace(/^\/api\//, '/');
    } else if (config.url?.startsWith('api/')) {
      config.url = '/' + config.url.replace(/^api\//, '');
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor
apiClient.interceptors.response.use(
  (response) => {
    // Reset refresh attempts on successful response
    refreshAttempts = 0;
    return response;
  },
  (error: AxiosError) => {
    const status = error.response?.status;
    const originalRequest = error.config as (typeof error.config & { _retry?: boolean }) | undefined;
    const requestUrl = originalRequest?.url || '';
    const isAuthRoute = requestUrl.includes('/auth/login') || requestUrl.includes('/auth/refresh');

    // CRITICAL: Only attempt refresh for 401 on non-auth routes that haven't been retried
    if (status === 401 && originalRequest && !originalRequest._retry && !isAuthRoute) {
      const { refreshToken, setToken, logout } = useAuthStore.getState();

      logAuth('401 on non-auth route, attempting refresh', {
        url: requestUrl,
        hasRefreshToken: !!refreshToken,
      });

      // No refresh token = permanently logged out, no recovery possible
      if (!refreshToken) {
        logAuth('No refresh token available, logging out', { url: requestUrl });
        sessionDebugger.logLogout('No refresh token available', { url: requestUrl });
        logout();
        window.location.href = '/login';
        return Promise.reject(error);
      }

      // Already refreshing: queue this request to retry after refresh completes
      if (isRefreshing) {
        logAuth('Refresh already in progress, queueing request', {
          url: requestUrl,
          pendingCount: pendingRequests.length,
        });
        return new Promise((resolve, reject) => {
          pendingRequests.push((newToken) => {
            // If refresh failed, reject with original error
            if (!newToken) {
              // ✅ LESS NOISY: Use console.debug instead of logAuth for queue rejections
              console.debug(`[Auth] Queued request rejected (refresh failed): ${requestUrl}`);
              reject(error);
              return;
            }
            logAuth('Queued request retrying with new token', { url: requestUrl });
            // CRITICAL FIX: Mark as retried to prevent infinite loop
            // If this retry also fails with 401, it won't start another refresh
            originalRequest._retry = true;
            originalRequest.headers = originalRequest.headers || {};
            originalRequest.headers.Authorization = `Bearer ${newToken}`;
            resolve(apiClient(originalRequest));
          });
        });
      }

      // Mark request as retried to prevent infinite refresh loops
      originalRequest._retry = true;
      isRefreshing = true;
      refreshAttempts += 1;

      // Prevent runaway refresh attempts (should never happen, but safety net)
      if (refreshAttempts > MAX_REFRESH_ATTEMPTS) {
        isRefreshing = false;
        logAuth('Max refresh attempts exceeded, logging out', {
          maxAttempts: MAX_REFRESH_ATTEMPTS,
        });
        sessionDebugger.logLogout('Max refresh attempts exceeded', {
          attempts: refreshAttempts,
          maxAllowed: MAX_REFRESH_ATTEMPTS,
        });
        logout();
        window.location.href = '/login';
        return Promise.reject(new Error('Max refresh attempts exceeded'));
      }

      logAuth('Starting token refresh', {
        url: requestUrl,
        attempt: refreshAttempts,
      });

      return attemptRefreshWithRetry(refreshToken)
        .then((newAccessToken) => {
          // Successfully refreshed: reset attempts counter
          refreshAttempts = 0;
          logAuth('Token refresh successful', { url: requestUrl });
          setToken(newAccessToken);
          flushPendingRequests(newAccessToken);

          originalRequest.headers = originalRequest.headers || {};
          originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
          return apiClient(originalRequest);
        })
        .catch((refreshErr) => {
          // On refresh failure: distinguish auth-invalid from transient/infrastructure errors
          const refreshStatus = refreshErr.response?.status;

          // 401 = confirmed auth failure (invalid/expired refresh token)
          // 503 = service temporarily unavailable (Redis down, backend issue, etc.)
          // Other 5xx, network errors = transient failures
          const isAuthInvalid = refreshStatus === 401;
          // Treat 429 (rate-limited) as transient alongside network/5xx so a
          // throttled refresh never forces logout - the retry loop will
          // eventually succeed when the window resets.
          const isTransient = !refreshStatus || refreshStatus >= 500 || refreshStatus === 429;

          if (isAuthInvalid) {
            // Permanent auth failure: logout required
            const authInvalidReason = refreshErr.response?.data?.detail || refreshErr.message || 'Unknown';
            logAuth('Token refresh failed: auth invalid, logging out', {
              url: requestUrl,
              status: refreshStatus,
              reason: authInvalidReason,
            });
            sessionDebugger.logLogout('Auth invalid - refresh token expired or invalid', {
              url: requestUrl,
              status: refreshStatus,
              reason: authInvalidReason,
            });
            flushPendingRequests(null);
            logout();
            window.location.href = '/login';
          } else if (isTransient) {
            // Transient infrastructure error: don't logout
            // Reject pending requests so they can be retried/handled by UI
            logAuth('Token refresh failed: transient error, NOT logging out (user may retry)', {
              url: requestUrl,
              status: refreshStatus,
              reason: refreshErr.response?.data?.detail || refreshErr.message,
              pendingQueueSize: pendingRequests.length,
            });
            flushPendingRequests(null);
          } else {
            // Other errors (4xx that aren't 401, etc.): flush and reject
            logAuth('Token refresh failed: other error', {
              url: requestUrl,
              status: refreshStatus,
              reason: refreshErr.response?.data?.detail || refreshErr.message,
            });
            flushPendingRequests(null);
          }

          return Promise.reject(refreshErr);
        })
        .finally(() => {
          isRefreshing = false;
        });
    }

    // REMOVED: Aggressive catch-all 401 handler that was causing false logouts
    // Previous code at lines 173-178 was problematic:
    //   if (status === 401 && !isRefreshing) { logout() }
    // This could trigger false logouts on:
    //   - Auth route failures (login/refresh itself should not auto-logout)
    //   - Other legitimate 401 cases
    // All genuine auth failures are already handled in the refresh logic above.
    // Auth routes returning 401 are legitimate and should reject, not logout.

    return Promise.reject(error);
  }
);

export const handleApiError = (error: unknown): string => {
  if (axios.isAxiosError(error)) {
    return error.response?.data?.detail || error.message || 'An error occurred';
  }
  return 'An unexpected error occurred';
};
