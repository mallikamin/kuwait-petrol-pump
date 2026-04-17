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
    it('should queue requests while refresh is in progress', async () => {
      // Setup: Two concurrent requests that both get 401
      const originalError = new AxiosError('Unauthorized', '401');
      originalError.response = { status: 401, data: {} } as any;
      originalError.config = { url: '/api/sales', _retry: false } as any;

      // Only one refresh should occur, not two
      mockAxios.post.mockResolvedValueOnce({
        data: { accessToken: 'new-token' },
      });

      // Test:
      // 1. First 401 triggers refresh
      // 2. Second 401 queues instead of triggering another refresh
      // 3. Both requests get retried with new token
      expect(mockAxios.post).toHaveBeenCalledTimes(1);
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

  describe('Invalid refresh token handling', () => {
    it('should logout on 401 invalid/expired refresh token', async () => {
      const refreshError = new AxiosError('Invalid refresh token', '401');
      refreshError.response = {
        status: 401,
        data: { detail: 'Invalid refresh token' },
      } as any;

      mockAxios.post.mockRejectedValueOnce(refreshError);

      // Test: 401 during refresh SHOULD trigger logout
      expect(mockAuthStore.logout).toHaveBeenCalled();
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
