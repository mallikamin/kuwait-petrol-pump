/**
 * Token Refresh Tests (Critical Path)
 * Tests for proactive refresh, single-flight lock, and error classification
 */

import { PrismaClient } from '@prisma/client';
import { getValidAccessToken } from './token-refresh';
import { QBTokenExpiredError, QBTransientError } from './errors';
import { redis } from '../../config/redis';
import OAuthClient from 'intuit-oauth';

jest.mock('../../config/redis', () => ({
  redis: {
    set: jest.fn(),
    del: jest.fn(),
  },
}));

jest.mock('intuit-oauth');

jest.mock('./encryption', () => ({
  encryptToken: jest.fn((token) => `encrypted_${token}`),
  decryptToken: jest.fn((token) => token.replace('encrypted_', '')),
  redactToken: jest.fn((token: string) =>
    !token || token.length <= 8
      ? '[REDACTED]'
      : `${token.substring(0, 4)}...${token.substring(token.length - 4)}`
  ),
}));

jest.mock('./audit-logger', () => ({
  AuditLogger: {
    log: jest.fn().mockResolvedValue(undefined),
  },
}));

describe('Token Refresh - Critical Path Tests', () => {
  let mockPrisma: any;
  let mockOAuthClient: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock Prisma
    mockPrisma = {
      qBConnection: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    };

    // Mock OAuth Client
    mockOAuthClient = {
      setToken: jest.fn(),
      refresh: jest.fn(),
      getToken: jest.fn(),
    };

    (OAuthClient as any).mockImplementation(() => mockOAuthClient);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Proactive Refresh (10min buffer)', () => {
    it('should refresh token when expiring within 10 minutes', async () => {
      const organizationId = 'org-123';
      const now = new Date();
      const expiresIn8Min = new Date(now.getTime() + 8 * 60 * 1000);

      // Setup: Token expires in 8 minutes (< 10min buffer)
      mockPrisma.qBConnection.findFirst.mockResolvedValue({
        id: 'conn-1',
        organizationId,
        realmId: 'realm-123',
        accessTokenEncrypted: 'encrypted_old_access',
        refreshTokenEncrypted: 'encrypted_old_refresh',
        accessTokenExpiresAt: expiresIn8Min,
        isActive: true,
      });

      // Mock Redis lock acquisition
      (redis.set as any).mockResolvedValue('OK');
      (redis.del as any).mockResolvedValue(1);

      // Mock successful refresh
      mockOAuthClient.refresh.mockResolvedValue({
        getToken: () => ({
          access_token: 'new_access',
          refresh_token: 'new_refresh',
          expires_in: 3600,
          x_refresh_token_expires_in: 8640000,
        }),
      });

      mockPrisma.qBConnection.update.mockResolvedValue({});

      await getValidAccessToken(organizationId, mockPrisma);

      // Verify refresh was triggered
      expect(mockOAuthClient.refresh).toHaveBeenCalled();
      expect(mockPrisma.qBConnection.update).toHaveBeenCalled();
    });

    it('should NOT refresh token when > 10 minutes until expiry', async () => {
      const organizationId = 'org-123';
      const now = new Date();
      const expiresIn15Min = new Date(now.getTime() + 15 * 60 * 1000);

      mockPrisma.qBConnection.findFirst.mockResolvedValue({
        id: 'conn-1',
        organizationId,
        realmId: 'realm-123',
        accessTokenEncrypted: 'encrypted_current_access',
        refreshTokenEncrypted: 'encrypted_current_refresh',
        accessTokenExpiresAt: expiresIn15Min,
        isActive: true,
      });

      const result = await getValidAccessToken(organizationId, mockPrisma);

      // Verify NO refresh was triggered
      expect(mockOAuthClient.refresh).not.toHaveBeenCalled();
      expect(result.accessToken).toBe('current_access');
    });
  });

  describe('Single-Flight Lock (Concurrent Refresh Prevention)', () => {
    it('should prevent concurrent refreshes using Redis lock', async () => {
      const organizationId = 'org-123';
      const now = new Date();
      const expiresIn5Min = new Date(now.getTime() + 5 * 60 * 1000);

      mockPrisma.qBConnection.findFirst.mockResolvedValue({
        id: 'conn-1',
        organizationId,
        realmId: 'realm-123',
        accessTokenEncrypted: 'encrypted_old_access',
        refreshTokenEncrypted: 'encrypted_old_refresh',
        accessTokenExpiresAt: expiresIn5Min,
        isActive: true,
      });

      // First call acquires lock
      (redis.set as any).mockResolvedValueOnce('OK');
      (redis.del as any).mockResolvedValue(1);

      mockOAuthClient.refresh.mockResolvedValue({
        getToken: () => ({
          access_token: 'new_access',
          refresh_token: 'new_refresh',
          expires_in: 3600,
          x_refresh_token_expires_in: 8640000,
        }),
      });

      mockPrisma.qBConnection.update.mockResolvedValue({});

      await getValidAccessToken(organizationId, mockPrisma);

      // Verify lock was acquired
      expect(redis.set).toHaveBeenCalledWith(
        `qb:token-refresh:${organizationId}`,
        '1',
        { NX: true, EX: 30 }
      );

      // Verify lock was released
      expect(redis.del).toHaveBeenCalledWith(`qb:token-refresh:${organizationId}`);
    });

    it('should wait and retry if another refresh is in progress (lock not acquired)', async () => {
      const organizationId = 'org-123';
      const now = new Date();
      const expiresIn5Min = new Date(now.getTime() + 5 * 60 * 1000);
      const expiresIn20Min = new Date(now.getTime() + 20 * 60 * 1000);

      // Initial connection (expired)
      mockPrisma.qBConnection.findFirst.mockResolvedValueOnce({
        id: 'conn-1',
        organizationId,
        realmId: 'realm-123',
        accessTokenEncrypted: 'encrypted_old_access',
        refreshTokenEncrypted: 'encrypted_old_refresh',
        accessTokenExpiresAt: expiresIn5Min,
        isActive: true,
      });

      // After waiting, connection has been refreshed by other process
      mockPrisma.qBConnection.findFirst.mockResolvedValueOnce({
        id: 'conn-1',
        organizationId,
        realmId: 'realm-123',
        accessTokenEncrypted: 'encrypted_new_access',
        refreshTokenEncrypted: 'encrypted_new_refresh',
        accessTokenExpiresAt: expiresIn20Min,
        isActive: true,
      });

      // Lock not acquired (another process is refreshing)
      (redis.set as any).mockResolvedValue(null);

      const result = await getValidAccessToken(organizationId, mockPrisma);

      // Verify NO refresh was triggered (used token refreshed by other process)
      expect(mockOAuthClient.refresh).not.toHaveBeenCalled();
      expect(result.accessToken).toBe('new_access');
    });
  });

  describe('Error Classification', () => {
    it('should throw QBTokenExpiredError and deactivate connection on invalid_grant', async () => {
      const organizationId = 'org-123';
      const now = new Date();
      const expiresIn5Min = new Date(now.getTime() + 5 * 60 * 1000);

      mockPrisma.qBConnection.findFirst.mockResolvedValue({
        id: 'conn-1',
        organizationId,
        realmId: 'realm-123',
        accessTokenEncrypted: 'encrypted_old_access',
        refreshTokenEncrypted: 'encrypted_invalid_refresh',
        accessTokenExpiresAt: expiresIn5Min,
        isActive: true,
      });

      (redis.set as any).mockResolvedValue('OK');
      (redis.del as any).mockResolvedValue(1);

      // Mock invalid_grant error
      mockOAuthClient.refresh.mockRejectedValue({
        authResponse: { body: { error: 'invalid_grant' }, status: 400 },
        message: 'Invalid grant',
      });

      mockPrisma.qBConnection.update.mockResolvedValue({});

      await expect(getValidAccessToken(organizationId, mockPrisma)).rejects.toThrow(QBTokenExpiredError);

      // Verify connection was deactivated
      expect(mockPrisma.qBConnection.update).toHaveBeenCalledWith({
        where: { id: 'conn-1' },
        data: { isActive: false },
      });
    });

    it('should throw QBTransientError and NOT deactivate connection on network error', async () => {
      const organizationId = 'org-123';
      const now = new Date();
      const expiresIn5Min = new Date(now.getTime() + 5 * 60 * 1000);

      mockPrisma.qBConnection.findFirst.mockResolvedValue({
        id: 'conn-1',
        organizationId,
        realmId: 'realm-123',
        accessTokenEncrypted: 'encrypted_old_access',
        refreshTokenEncrypted: 'encrypted_refresh',
        accessTokenExpiresAt: expiresIn5Min,
        isActive: true,
      });

      (redis.set as any).mockResolvedValue('OK');
      (redis.del as any).mockResolvedValue(1);

      // Mock network error (503)
      mockOAuthClient.refresh.mockRejectedValue({
        authResponse: { status: 503 },
        message: 'Service unavailable',
      });

      await expect(getValidAccessToken(organizationId, mockPrisma)).rejects.toThrow(QBTransientError);

      // Verify connection was NOT deactivated
      expect(mockPrisma.qBConnection.update).not.toHaveBeenCalled();
    });

    it('should NOT deactivate on bare 400 without invalid_grant body', async () => {
      const organizationId = 'org-123';
      const now = new Date();
      const expiresIn5Min = new Date(now.getTime() + 5 * 60 * 1000);

      mockPrisma.qBConnection.findFirst.mockResolvedValue({
        id: 'conn-1',
        organizationId,
        realmId: 'realm-123',
        accessTokenEncrypted: 'encrypted_old_access',
        refreshTokenEncrypted: 'encrypted_refresh',
        accessTokenExpiresAt: expiresIn5Min,
        isActive: true,
      });

      (redis.set as any).mockResolvedValue('OK');
      (redis.del as any).mockResolvedValue(1);

      // 400 without Intuit's invalid_grant code — previously this wrongly killed the connection
      mockOAuthClient.refresh.mockRejectedValue({
        authResponse: { body: { error: 'invalid_request' }, status: 400 },
        message: 'Bad Request',
      });

      await expect(getValidAccessToken(organizationId, mockPrisma)).rejects.toThrow(QBTransientError);
      expect(mockPrisma.qBConnection.update).not.toHaveBeenCalled();
    });

    it('should NOT deactivate on bare 401 without invalid_grant body', async () => {
      const organizationId = 'org-123';
      const now = new Date();
      const expiresIn5Min = new Date(now.getTime() + 5 * 60 * 1000);

      mockPrisma.qBConnection.findFirst.mockResolvedValue({
        id: 'conn-1',
        organizationId,
        realmId: 'realm-123',
        accessTokenEncrypted: 'encrypted_old_access',
        refreshTokenEncrypted: 'encrypted_refresh',
        accessTokenExpiresAt: expiresIn5Min,
        isActive: true,
      });

      (redis.set as any).mockResolvedValue('OK');
      (redis.del as any).mockResolvedValue(1);

      // 401 without invalid_grant — previously this wrongly killed the connection
      mockOAuthClient.refresh.mockRejectedValue({
        authResponse: { status: 401 },
        message: 'Unauthorized',
      });

      await expect(getValidAccessToken(organizationId, mockPrisma)).rejects.toThrow(QBTransientError);
      expect(mockPrisma.qBConnection.update).not.toHaveBeenCalled();
    });

    it('should NOT deactivate when error message contains "invalid" but code is not invalid_grant', async () => {
      const organizationId = 'org-123';
      const now = new Date();
      const expiresIn5Min = new Date(now.getTime() + 5 * 60 * 1000);

      mockPrisma.qBConnection.findFirst.mockResolvedValue({
        id: 'conn-1',
        organizationId,
        realmId: 'realm-123',
        accessTokenEncrypted: 'encrypted_old_access',
        refreshTokenEncrypted: 'encrypted_refresh',
        accessTokenExpiresAt: expiresIn5Min,
        isActive: true,
      });

      (redis.set as any).mockResolvedValue('OK');
      (redis.del as any).mockResolvedValue(1);

      // Error phrasing that previously tripped the broad string match
      mockOAuthClient.refresh.mockRejectedValue({
        message: 'invalid JSON response from upstream',
      });

      await expect(getValidAccessToken(organizationId, mockPrisma)).rejects.toThrow(QBTransientError);
      expect(mockPrisma.qBConnection.update).not.toHaveBeenCalled();
    });

    it('should NOT deactivate when error message contains "expired" but code is not invalid_grant', async () => {
      const organizationId = 'org-123';
      const now = new Date();
      const expiresIn5Min = new Date(now.getTime() + 5 * 60 * 1000);

      mockPrisma.qBConnection.findFirst.mockResolvedValue({
        id: 'conn-1',
        organizationId,
        realmId: 'realm-123',
        accessTokenEncrypted: 'encrypted_old_access',
        refreshTokenEncrypted: 'encrypted_refresh',
        accessTokenExpiresAt: expiresIn5Min,
        isActive: true,
      });

      (redis.set as any).mockResolvedValue('OK');
      (redis.del as any).mockResolvedValue(1);

      // Generic "expired" phrasing — e.g. socket, cert, cache — not the refresh token
      mockOAuthClient.refresh.mockRejectedValue({
        message: 'request expired before response was received',
      });

      await expect(getValidAccessToken(organizationId, mockPrisma)).rejects.toThrow(QBTransientError);
      expect(mockPrisma.qBConnection.update).not.toHaveBeenCalled();
    });

    it('should deactivate on 401 when Intuit returns invalid_grant body', async () => {
      const organizationId = 'org-123';
      const now = new Date();
      const expiresIn5Min = new Date(now.getTime() + 5 * 60 * 1000);

      mockPrisma.qBConnection.findFirst.mockResolvedValue({
        id: 'conn-1',
        organizationId,
        realmId: 'realm-123',
        accessTokenEncrypted: 'encrypted_old_access',
        refreshTokenEncrypted: 'encrypted_invalid_refresh',
        accessTokenExpiresAt: expiresIn5Min,
        isActive: true,
      });

      (redis.set as any).mockResolvedValue('OK');
      (redis.del as any).mockResolvedValue(1);

      // Rare but valid shape: 401 + explicit invalid_grant → real token death
      mockOAuthClient.refresh.mockRejectedValue({
        authResponse: { body: { error: 'invalid_grant' }, status: 401 },
        message: 'Unauthorized',
      });

      mockPrisma.qBConnection.update.mockResolvedValue({});

      await expect(getValidAccessToken(organizationId, mockPrisma)).rejects.toThrow(QBTokenExpiredError);
      expect(mockPrisma.qBConnection.update).toHaveBeenCalledWith({
        where: { id: 'conn-1' },
        data: { isActive: false },
      });
    });

    it('should short-circuit and NOT call Intuit if re-fetch inside lock shows token is already fresh', async () => {
      // Regression test for the stale-snapshot race:
      // If another process rotates the refresh token between our pre-lock read
      // and our lock acquisition, the pre-lock snapshot holds the now-dead T1.
      // After acquiring the lock, we must re-fetch so we never send Intuit T1.
      // Better still: if the re-fetched token is already fresh, skip the call
      // entirely so we don't burn an unnecessary refresh.
      const organizationId = 'org-123';
      const now = new Date();
      const expiresIn5Min = new Date(now.getTime() + 5 * 60 * 1000); // stale view
      const expiresIn50Min = new Date(now.getTime() + 50 * 60 * 1000); // refreshed view

      // Pre-lock read: caller sees "expires in 5 min" (stale)
      mockPrisma.qBConnection.findFirst.mockResolvedValueOnce({
        id: 'conn-1',
        organizationId,
        realmId: 'realm-123',
        accessTokenEncrypted: 'encrypted_old_access',
        refreshTokenEncrypted: 'encrypted_old_refresh',
        accessTokenExpiresAt: expiresIn5Min,
        refreshTokenExpiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
        lastSyncAt: null,
        createdAt: now,
        isActive: true,
      });

      // Post-lock re-fetch: another worker already refreshed (fresh 50min token)
      mockPrisma.qBConnection.findFirst.mockResolvedValueOnce({
        id: 'conn-1',
        organizationId,
        realmId: 'realm-123',
        accessTokenEncrypted: 'encrypted_new_access',
        refreshTokenEncrypted: 'encrypted_new_refresh',
        accessTokenExpiresAt: expiresIn50Min,
        refreshTokenExpiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
        lastSyncAt: null,
        createdAt: now,
        isActive: true,
      });

      (redis.set as any).mockResolvedValue('OK');
      (redis.del as any).mockResolvedValue(1);

      const result = await getValidAccessToken(organizationId, mockPrisma);

      // Verify we did NOT call Intuit — the re-fetch saw a fresh token
      expect(mockOAuthClient.refresh).not.toHaveBeenCalled();
      expect(result.accessToken).toBe('new_access');
      expect(redis.del).toHaveBeenCalledWith(`qb:token-refresh:${organizationId}`);
    });

    it('should always persist BOTH access and refresh tokens on successful refresh', async () => {
      const organizationId = 'org-123';
      const now = new Date();
      const expiresIn5Min = new Date(now.getTime() + 5 * 60 * 1000);

      mockPrisma.qBConnection.findFirst.mockResolvedValue({
        id: 'conn-1',
        organizationId,
        realmId: 'realm-123',
        accessTokenEncrypted: 'encrypted_old_access',
        refreshTokenEncrypted: 'encrypted_old_refresh',
        accessTokenExpiresAt: expiresIn5Min,
        isActive: true,
      });

      (redis.set as any).mockResolvedValue('OK');
      (redis.del as any).mockResolvedValue(1);

      mockOAuthClient.refresh.mockResolvedValue({
        getToken: () => ({
          access_token: 'new_access',
          refresh_token: 'new_refresh',
          expires_in: 3600,
          x_refresh_token_expires_in: 8640000,
        }),
      });

      mockPrisma.qBConnection.update.mockResolvedValue({});

      await getValidAccessToken(organizationId, mockPrisma);

      // Verify BOTH tokens were persisted
      expect(mockPrisma.qBConnection.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'conn-1' },
          data: expect.objectContaining({
            accessTokenEncrypted: 'encrypted_new_access',
            refreshTokenEncrypted: 'encrypted_new_refresh',
            accessTokenExpiresAt: expect.any(Date),
            refreshTokenExpiresAt: expect.any(Date),
          }),
        })
      );
    });
  });
});
