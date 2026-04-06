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
    if (error.response?.status === 401) {
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
