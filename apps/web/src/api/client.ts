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
  (response) => response,
  (error: AxiosError) => {
    const status = error.response?.status;
    const originalRequest = error.config as (typeof error.config & { _retry?: boolean }) | undefined;
    const requestUrl = originalRequest?.url || '';
    const isAuthRoute = requestUrl.includes('/auth/login') || requestUrl.includes('/auth/refresh');

    if (status === 401 && originalRequest && !originalRequest._retry && !isAuthRoute) {
      const { refreshToken, setToken, logout } = useAuthStore.getState();

      if (!refreshToken) {
        logout();
        window.location.href = '/login';
        return Promise.reject(error);
      }

      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          pendingRequests.push((newToken) => {
            if (!newToken) {
              reject(error);
              return;
            }
            originalRequest.headers = originalRequest.headers || {};
            originalRequest.headers.Authorization = `Bearer ${newToken}`;
            resolve(apiClient(originalRequest));
          });
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

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

          setToken(newAccessToken);
          flushPendingRequests(newAccessToken);

          originalRequest.headers = originalRequest.headers || {};
          originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
          return apiClient(originalRequest);
        })
        .catch((refreshErr) => {
          flushPendingRequests(null);
          logout();
          window.location.href = '/login';
          return Promise.reject(refreshErr);
        })
        .finally(() => {
          isRefreshing = false;
        });
    }

    if (status === 401) {
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
