import { AuthService } from './auth.service';
import { prisma } from '../../config/database';
import { redis } from '../../config/redis';
import { generateRefreshToken } from '../../utils/jwt';
import { AppError } from '../../middleware/error.middleware';
import bcrypt from 'bcrypt';

jest.mock('../../config/database', () => ({
  prisma: {
    user: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock('../../config/redis', () => ({
  redis: {
    setEx: jest.fn(),
    get: jest.fn(),
    del: jest.fn(),
    sAdd: jest.fn(),
    sRem: jest.fn(),
    sMembers: jest.fn(),
    expire: jest.fn(),
  },
}));

jest.mock('bcrypt');

describe('AuthService - 24h session stability', () => {
  let service: AuthService;
  const userId = '11111111-1111-1111-1111-111111111111';
  const orgId = '22222222-2222-2222-2222-222222222222';

  beforeEach(() => {
    service = new AuthService();
    jest.clearAllMocks();
    // Default: Redis writes succeed; set index ops succeed.
    (redis.setEx as jest.Mock).mockResolvedValue('OK');
    (redis.del as jest.Mock).mockResolvedValue(1);
    (redis.sAdd as jest.Mock).mockResolvedValue(1);
    (redis.sRem as jest.Mock).mockResolvedValue(1);
    (redis.sMembers as jest.Mock).mockResolvedValue([]);
    (redis.expire as jest.Mock).mockResolvedValue(1);
  });

  describe('login', () => {
    it('stores the refresh token under a per-session key so concurrent logins do not collide', async () => {
      (prisma.user.findFirst as jest.Mock).mockResolvedValue({
        id: userId,
        username: 'cashier1',
        email: null,
        passwordHash: 'hashed',
        role: 'cashier',
        organizationId: orgId,
        branchId: null,
        fullName: 'Cashier One',
        branch: null,
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const resultA = await service.login('cashier1', 'pw');
      const resultB = await service.login('cashier1', 'pw');

      const keysWritten = (redis.setEx as jest.Mock).mock.calls.map(([key]) => key);
      expect(keysWritten).toHaveLength(2);
      expect(keysWritten[0]).toMatch(/^refresh_token:11111111-1111-1111-1111-111111111111:[0-9a-f-]{36}$/);
      expect(keysWritten[1]).toMatch(/^refresh_token:11111111-1111-1111-1111-111111111111:[0-9a-f-]{36}$/);
      // Two distinct session keys, not the same slot being overwritten
      expect(keysWritten[0]).not.toBe(keysWritten[1]);

      // Session index is updated so changePassword can revoke everything.
      expect(redis.sAdd).toHaveBeenCalledTimes(2);

      // Each login must return its own refresh token
      expect(resultA.refresh_token).not.toBe(resultB.refresh_token);
    });

    it('applies the configured refresh TTL of >= 24h', async () => {
      (prisma.user.findFirst as jest.Mock).mockResolvedValue({
        id: userId,
        username: 'u',
        email: null,
        passwordHash: 'h',
        role: 'admin',
        organizationId: orgId,
        branchId: null,
        fullName: 'U',
        branch: null,
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await service.login('u', 'pw');

      const [, ttlSeconds] = (redis.setEx as jest.Mock).mock.calls[0];
      // Default JWT_REFRESH_EXPIRY in tests is 30d; even with env overrides we
      // want at least a full day so 24h continuous use never trips the TTL.
      expect(ttlSeconds).toBeGreaterThanOrEqual(24 * 60 * 60);
    });
  });

  describe('refresh', () => {
    it('issues a new access token when the per-session key matches', async () => {
      const token = generateRefreshToken({
        userId,
        email: 'u@x',
        role: 'admin',
        organizationId: orgId,
        sessionId: 'session-abc',
      });
      (redis.get as jest.Mock).mockImplementation(async (key: string) => {
        return key === `refresh_token:${userId}:session-abc` ? token : null;
      });

      const result = await service.refresh(token);
      expect(result.accessToken).toEqual(expect.any(String));
    });

    it('falls back to the legacy per-user key for tokens signed before multi-session rollout', async () => {
      const legacyToken = generateRefreshToken({
        userId,
        email: 'u@x',
        role: 'admin',
        organizationId: orgId,
        // sessionId intentionally omitted - pre-existing production token
      });
      (redis.get as jest.Mock).mockImplementation(async (key: string) => {
        return key === `refresh_token:${userId}` ? legacyToken : null;
      });

      const result = await service.refresh(legacyToken);
      expect(result.accessToken).toEqual(expect.any(String));
    });

    it('returns 401 when neither the session key nor the legacy key contain this token', async () => {
      const token = generateRefreshToken({
        userId,
        email: 'u@x',
        role: 'admin',
        organizationId: orgId,
        sessionId: 'stale-session',
      });
      (redis.get as jest.Mock).mockResolvedValue(null);

      await expect(service.refresh(token)).rejects.toMatchObject({ statusCode: 401 });
    });

    it('maps Redis outages to 503 (transient) so the client does not logout', async () => {
      const token = generateRefreshToken({
        userId,
        email: 'u@x',
        role: 'admin',
        organizationId: orgId,
        sessionId: 's',
      });
      (redis.get as jest.Mock).mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(service.refresh(token)).rejects.toMatchObject({ statusCode: 503 });
    });

    it('returns 401 for malformed tokens (JsonWebTokenError)', async () => {
      await expect(service.refresh('not.a.jwt')).rejects.toBeInstanceOf(AppError);
      await expect(service.refresh('not.a.jwt')).rejects.toMatchObject({ statusCode: 401 });
    });
  });

  describe('logout', () => {
    it('revokes only the current session so other devices stay logged in', async () => {
      await service.logout(userId, 'session-abc');
      expect(redis.del).toHaveBeenCalledWith(`refresh_token:${userId}:session-abc`);
      expect(redis.sRem).toHaveBeenCalledWith(`refresh_sessions:${userId}`, 'session-abc');
      // Must NOT clear the legacy per-user key (which would affect other devices)
      expect(redis.del).not.toHaveBeenCalledWith(`refresh_token:${userId}`);
    });

    it('clears the legacy key for pre-multi-session tokens', async () => {
      await service.logout(userId);
      expect(redis.del).toHaveBeenCalledWith(`refresh_token:${userId}`);
    });
  });

  describe('changePassword', () => {
    it('revokes every active session (password leak mitigation)', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: userId,
        passwordHash: 'old',
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (bcrypt.hash as jest.Mock).mockResolvedValue('new-hash');
      (prisma.user.update as jest.Mock).mockResolvedValue({});
      (redis.sMembers as jest.Mock).mockResolvedValue(['s1', 's2', 's3']);

      await service.changePassword(userId, 'old', 'newpass1');

      expect(redis.del).toHaveBeenCalledWith(`refresh_token:${userId}`);
      expect(redis.del).toHaveBeenCalledWith([
        `refresh_token:${userId}:s1`,
        `refresh_token:${userId}:s2`,
        `refresh_token:${userId}:s3`,
      ]);
      expect(redis.del).toHaveBeenCalledWith(`refresh_sessions:${userId}`);
    });
  });
});
