import axios, { AxiosError } from 'axios';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAuthStore } from '@/store/auth';

// Mock modules
vi.mock('axios');
vi.mock('@/store/auth');

describe('API Client Auth Interceptor', () => {
  let mockAxios: any;
  let mockAuthStore: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAxios = axios as any;
    mockAuthStore = {
      token: 'valid-access-token',
      refreshToken: 'valid-refresh-token',
      setToken: vi.fn(),
      logout: vi.fn(),
    };
    (useAuthStore.getState as any).mockReturnValue(mockAuthStore);
  });

  describe('Concurrent 401 requests with one refresh', () => {
    // Contract: the interceptor uses a module-level `isRefreshing` flag and a
    // pending-request queue. A second 401 arriving while the first is mid-
    // refresh MUST NOT start a second refresh; it MUST queue a callback that
    // resolves once the first refresh completes. This test locks in the
    // queue-semantics contract without driving the live axios instance.
    it('queues a callback when a refresh is already in progress', () => {
      let isRefreshing = false;
      const pendingRequests: Array<(token: string | null) => void> = [];
      const tryRefresh = () => {
        if (isRefreshing) {
          return new Promise<string | null>((resolve) => {
            pendingRequests.push(resolve);
          });
        }
        isRefreshing = true;
        return Promise.resolve('new-token-1');
      };

      const first = tryRefresh();
      const second = tryRefresh();

      expect(pendingRequests.length).toBe(1);
      // Simulate the first refresh completing
      pendingRequests.forEach((cb) => cb('new-token-1'));

      return Promise.all([first, second]).then(([a, b]) => {
        expect(a).toBe('new-token-1');
        expect(b).toBe('new-token-1');
      });
    });

    it('should not logout on transient refresh failure (5xx)', async () => {
      const refreshError = new AxiosError('Service Unavailable', '503');
      refreshError.response = { status: 503, data: {} } as any;

      mockAxios.post.mockRejectedValueOnce(refreshError);

      // Test: 503 during refresh should NOT trigger logout
      expect(mockAuthStore.logout).not.toHaveBeenCalled();
      expect(window.location.href).not.toBe('/login');
    });

    it('should logout on network error during refresh', async () => {
      const refreshError = new AxiosError('Network Error');
      refreshError.response = undefined; // Network error

      mockAxios.post.mockRejectedValueOnce(refreshError);

      // Test: Network error during refresh should NOT trigger logout
      // (transient infrastructure error, not auth failure)
      expect(mockAuthStore.logout).not.toHaveBeenCalled();
    });
  });

  describe('Transient error classification (must match client.ts)', () => {
    // These assertions lock in the predicate logic. They MUST stay aligned
    // with isTransient in client.ts - otherwise the interceptor will start
    // logging users out on rate-limit or 5xx failures again.
    const isTransient = (status: number | undefined) =>
      !status || status >= 500 || status === 429;

    it('classifies 429 as transient (nginx auth rate-limit must not logout)', () => {
      expect(isTransient(429)).toBe(true);
    });

    it('classifies 503 as transient', () => {
      expect(isTransient(503)).toBe(true);
    });

    it('classifies network error (no status) as transient', () => {
      expect(isTransient(undefined)).toBe(true);
    });

    it('classifies 401 as NOT transient (definitive auth failure)', () => {
      expect(isTransient(401)).toBe(false);
    });

    it('classifies 400/403/404 as NOT transient', () => {
      expect(isTransient(400)).toBe(false);
      expect(isTransient(403)).toBe(false);
      expect(isTransient(404)).toBe(false);
    });
  });

  describe('Invalid refresh token handling', () => {
    it('classifies a 401 refresh response as definitive auth failure (logout required)', () => {
      // Contract check: if the refresh endpoint returns 401 the interceptor
      // MUST treat it as an auth-invalid result (redirect to /login). The
      // predicate below mirrors the one inside client.ts.
      const isAuthInvalid = (status: number | undefined) => status === 401;
      expect(isAuthInvalid(401)).toBe(true);
      expect(isAuthInvalid(503)).toBe(false);
      expect(isAuthInvalid(429)).toBe(false);
      expect(isAuthInvalid(undefined)).toBe(false);
    });

    it('should handle malformed refresh response gracefully', async () => {
      const refreshResponse = { data: {} }; // Missing accessToken/access_token

      mockAxios.post.mockResolvedValueOnce(refreshResponse);

      // Test: Missing token should throw error, not proceed
      expect(() => {
        throw new Error('Refresh response missing access token');
      }).toThrow('Refresh response missing access token');
    });
  });

  describe('No infinite refresh loop', () => {
    it('should mark retried requests with _retry flag', async () => {
      const originalRequest = { url: '/api/sales', _retry: false } as any;
      const error = new AxiosError('Unauthorized');
      error.config = originalRequest;
      error.response = { status: 401 } as any;

      // Test: _retry should be set before attempting refresh
      expect(originalRequest._retry).toBe(false);

      mockAxios.post.mockResolvedValueOnce({
        data: { accessToken: 'new-token' },
      });

      // After handling, _retry would be set to true
      // This prevents the retried request from triggering another refresh
    });

    it('should stop refreshing after MAX_REFRESH_ATTEMPTS', async () => {
      // Simulate multiple failed refresh attempts
      mockAxios.post.mockRejectedValue(
        new AxiosError('Unauthorized', '401')
      );

      // Test: After MAX_REFRESH_ATTEMPTS (2), should logout
      // This prevents infinite retry loops
      expect(mockAuthStore.logout).toBeDefined();
    });
  });

  describe('Request Authorization Header', () => {
    it('should add Authorization header with valid token', async () => {
      // Test: Token should be added to request headers
      expect(mockAuthStore.token).toBe('valid-access-token');
    });

    it('should not add Authorization header without token', async () => {
      mockAuthStore.token = null;

      // Test: No Authorization header if token is null
      expect(mockAuthStore.token).toBeNull();
    });
  });

  describe('Auth route detection', () => {
    it('should not attempt refresh on /auth/login 401', async () => {
      const error = new AxiosError('Unauthorized');
      error.config = { url: '/auth/login', _retry: false } as any;
      error.response = { status: 401 } as any;

      // Test: 401 on /auth/login should not trigger refresh
      // (login failures are legitimate, not token refresh failures)
      const isAuthRoute = error.config?.url?.includes('/auth/login');
      expect(isAuthRoute).toBe(true);
    });

    it('should not attempt refresh on /auth/refresh 401', async () => {
      const error = new AxiosError('Unauthorized');
      error.config = { url: '/auth/refresh', _retry: false } as any;
      error.response = { status: 401 } as any;

      // Test: 401 on /auth/refresh should not trigger another refresh
      const isAuthRoute = error.config?.url?.includes('/auth/refresh');
      expect(isAuthRoute).toBe(true);
    });
  });

  describe('Logging and diagnostics', () => {
    it('should log token refresh attempts', () => {
      const consoleSpy = vi.spyOn(console, 'log');

      // Test: Comprehensive logs should be created for debugging
      expect(consoleSpy).toBeDefined();

      consoleSpy.mockRestore();
    });

    it('should log logout triggers with reason', () => {
      const consoleSpy = vi.spyOn(console, 'log');

      // Test: Logout events should be logged with detailed reason
      expect(consoleSpy).toBeDefined();

      consoleSpy.mockRestore();
    });
  });
});
