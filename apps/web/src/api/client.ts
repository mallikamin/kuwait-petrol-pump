import axios, { AxiosError, AxiosInstance } from 'axios';
import { useAuthStore } from '@/store/auth';

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

const flushPendingRequests = (token: string | null) => {
  pendingRequests.forEach((cb) => cb(token));
  pendingRequests = [];
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

    // Only attempt refresh for 401 on non-auth routes that haven't been retried
    if (status === 401 && originalRequest && !originalRequest._retry && !isAuthRoute) {
      const { refreshToken, setToken, logout } = useAuthStore.getState();

      // No refresh token = permanently logged out, no recovery possible
      if (!refreshToken) {
        logout();
        window.location.href = '/login';
        return Promise.reject(error);
      }

      // Already refreshing: queue this request to retry after refresh completes
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          pendingRequests.push((newToken) => {
            // If refresh failed, reject with original error
            if (!newToken) {
              reject(error);
              return;
            }
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
        logout();
        window.location.href = '/login';
        return Promise.reject(new Error('Max refresh attempts exceeded'));
      }

      return axios
        .post(`${FINAL_API_URL}/auth/refresh`, { refreshToken }, {
          headers: { 'Content-Type': 'application/json' },
        })
        .then((refreshResponse) => {
          const newAccessToken =
            refreshResponse.data?.accessToken ||
            refreshResponse.data?.access_token;

          if (!newAccessToken || typeof newAccessToken !== 'string') {
            throw new Error('Refresh response missing access token');
          }

          // Successfully refreshed: reset attempts counter
          refreshAttempts = 0;
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
          const isTransient = !refreshStatus || refreshStatus >= 500; // Network error or 5xx

          if (isAuthInvalid) {
            // Permanent auth failure: logout required
            flushPendingRequests(null);
            logout();
            window.location.href = '/login';
          } else if (isTransient) {
            // Transient infrastructure error: don't logout
            // Reject pending requests so they can be retried/handled by UI
            flushPendingRequests(null);
          } else {
            // Other errors (4xx that aren't 401, etc.): flush and reject
            flushPendingRequests(null);
          }

          return Promise.reject(refreshErr);
        })
        .finally(() => {
          isRefreshing = false;
        });
    }

    // Catch all remaining 401s (auth routes, retried requests, etc.)
    // Only logout on 401s not handled by refresh logic above
    if (status === 401 && !isRefreshing) {
      useAuthStore.getState().logout();
      window.location.href = '/login';
    }

    return Promise.reject(error);
  }
);

export const handleApiError = (error: unknown): string => {
  if (axios.isAxiosError(error)) {
    return error.response?.data?.detail || error.message || 'An error occurred';
  }
  return 'An unexpected error occurred';
};
