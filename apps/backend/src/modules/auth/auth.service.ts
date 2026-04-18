import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { prisma } from '../../config/database';
import { redis } from '../../config/redis';
import { env } from '../../config/env';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken, TokenPayload } from '../../utils/jwt';
import { AppError } from '../../middleware/error.middleware';

// Redis key helpers. We store refresh tokens per-session so concurrent logins
// from multiple workstations/tabs for the same user do not invalidate each
// other. The legacy per-user key is still honored for backward compatibility
// with tokens signed before this change.
const sessionKey = (userId: string, sessionId: string) => `refresh_token:${userId}:${sessionId}`;
const legacyUserKey = (userId: string) => `refresh_token:${userId}`;
const userSessionIndex = (userId: string) => `refresh_sessions:${userId}`;

export class AuthService {
  private getRefreshTokenTtlSeconds(): number {
    const raw = (env.JWT_REFRESH_EXPIRY || '30d').trim().toLowerCase();
    const match = raw.match(/^(\d+)\s*([smhd])$/);
    if (!match) return 30 * 24 * 60 * 60;

    const value = parseInt(match[1], 10);
    const unit = match[2];

    const multiplier =
      unit === 's' ? 1 :
      unit === 'm' ? 60 :
      unit === 'h' ? 3600 :
      86400; // 'd'

    return Math.max(60, value * multiplier);
  }

  async login(username: string, password: string) {
    // Use findFirst since compound unique requires organizationId
    // For single-org system, this finds the user by username
    const user = await prisma.user.findFirst({
      where: { username, isActive: true },
      include: { branch: true },
    });

    if (!user) {
      throw new AppError(401, 'Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      throw new AppError(401, 'Invalid credentials');
    }

    const sessionId = randomUUID();
    const payload: TokenPayload = {
      userId: user.id,
      email: user.email || user.username,
      role: user.role,
      organizationId: user.organizationId,
      branchId: user.branchId || undefined,
      sessionId,
    };

    const accessToken = generateAccessToken(payload);
    const refreshToken = generateRefreshToken(payload);
    const ttl = this.getRefreshTokenTtlSeconds();

    // Store the refresh token under the per-session key so this login does not
    // displace other active sessions for the same user.
    await redis.setEx(sessionKey(user.id, sessionId), ttl, refreshToken);

    // Track active session ids so we can revoke them all on password change.
    // Use a set with a matching TTL so it self-cleans.
    try {
      await redis.sAdd(userSessionIndex(user.id), sessionId);
      await redis.expire(userSessionIndex(user.id), ttl);
    } catch {
      // Non-fatal: the session key above is the source of truth for auth.
    }

    return {
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        full_name: user.fullName,
        role: user.role,
        branch: user.branch
          ? {
              id: user.branch.id,
              name: user.branch.name,
            }
          : null,
      },
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: 'bearer',
    };
  }

  async refresh(refreshToken: string) {
    try {
      const payload = verifyRefreshToken(refreshToken);

      // Prefer the per-session key. Fall back to the legacy per-user key so
      // tokens signed before the multi-session rollout keep working.
      let storedToken: string | null = null;
      if (payload.sessionId) {
        storedToken = await redis.get(sessionKey(payload.userId, payload.sessionId));
      }
      if (!storedToken) {
        storedToken = await redis.get(legacyUserKey(payload.userId));
      }

      if (!storedToken || storedToken !== refreshToken) {
        throw new AppError(401, 'Invalid refresh token');
      }

      // Reuse the existing sessionId when present so access tokens stay tied to
      // the same session across refreshes. Tokens minted before this change
      // have no sessionId; mint one now so future refreshes index correctly.
      const nextPayload: TokenPayload = {
        userId: payload.userId,
        email: payload.email,
        role: payload.role,
        organizationId: payload.organizationId,
        branchId: payload.branchId,
        sessionId: payload.sessionId,
      };
      const newAccessToken = generateAccessToken(nextPayload);

      return { accessToken: newAccessToken };
    } catch (error) {
      // Distinguish auth-invalid (401) from infrastructure failures (503)
      // Only 401 for confirmed invalid token; 503 for transient issues
      if (error instanceof AppError) {
        // Already explicit error (e.g., invalid token from line 84)
        throw error;
      }

      // JWT verification failure (malformed/tampered token)
      if (error instanceof Error && error.name === 'JsonWebTokenError') {
        throw new AppError(401, 'Invalid refresh token');
      }

      // JWT expiration (refresh token itself expired)
      if (error instanceof Error && error.name === 'TokenExpiredError') {
        throw new AppError(401, 'Refresh token expired');
      }

      // Infrastructure/transient failures (Redis down, network issue, etc.)
      // Return 503 to indicate service temporarily unavailable, not auth failure
      console.error('[Auth] Refresh error (transient):', error instanceof Error ? error.message : error);
      throw new AppError(503, 'Auth service temporarily unavailable');
    }
  }

  async logout(userId: string, sessionId?: string) {
    // Revoke only the current session so other active devices/tabs stay logged in.
    if (sessionId) {
      await redis.del(sessionKey(userId, sessionId));
      try {
        await redis.sRem(userSessionIndex(userId), sessionId);
      } catch {
        // Non-fatal index cleanup failure.
      }
    } else {
      // Legacy tokens without a sessionId - clear the old per-user key.
      await redis.del(legacyUserKey(userId));
    }
  }

  async changePassword(userId: string, oldPassword: string, newPassword: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new AppError(404, 'User not found');
    }

    const isPasswordValid = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!isPasswordValid) {
      throw new AppError(401, 'Invalid old password');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: hashedPassword },
    });

    // Invalidate every active session for this user so a leaked password
    // cannot be silently re-used from another workstation.
    await redis.del(legacyUserKey(userId));
    try {
      const sessions = await redis.sMembers(userSessionIndex(userId));
      if (sessions.length > 0) {
        await redis.del(sessions.map((sid) => sessionKey(userId, sid)));
      }
      await redis.del(userSessionIndex(userId));
    } catch {
      // Non-fatal: best-effort cleanup; stale keys will expire via TTL.
    }
  }
}
