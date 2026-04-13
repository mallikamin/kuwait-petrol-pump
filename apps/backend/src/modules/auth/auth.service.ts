import bcrypt from 'bcrypt';
import { prisma } from '../../config/database';
import { redis } from '../../config/redis';
import { env } from '../../config/env';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../../utils/jwt';
import { AppError } from '../../middleware/error.middleware';

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

    const payload = {
      userId: user.id,
      email: user.email || user.username,
      role: user.role,
      organizationId: user.organizationId,
      branchId: user.branchId || undefined,
    };

    const accessToken = generateAccessToken(payload);
    const refreshToken = generateRefreshToken(payload);

    // Store refresh token in Redis with TTL aligned to configured refresh expiry.
    await redis.setEx(`refresh_token:${user.id}`, this.getRefreshTokenTtlSeconds(), refreshToken);

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

      // Check if token exists in Redis
      const storedToken = await redis.get(`refresh_token:${payload.userId}`);
      if (!storedToken || storedToken !== refreshToken) {
        throw new AppError(401, 'Invalid refresh token');
      }

      // Generate new access token
      const newAccessToken = generateAccessToken(payload);

      return { accessToken: newAccessToken };
    } catch (error) {
      throw new AppError(401, 'Invalid refresh token');
    }
  }

  async logout(userId: string) {
    // Remove refresh token from Redis
    await redis.del(`refresh_token:${userId}`);
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

    // Invalidate all refresh tokens
    await redis.del(`refresh_token:${userId}`);
  }
}
