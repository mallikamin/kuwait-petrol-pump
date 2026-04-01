/**
 * OCR Rate Limiter
 *
 * Limits OCR requests to 50/day per user to prevent Claude API cost overruns.
 * Uses Redis for distributed rate limiting across server restarts.
 */

import { redis } from '../../config/redis';

export class OCRRateLimitError extends Error {
  constructor(
    message: string,
    public readonly remainingRequests: number,
    public readonly resetAt: Date
  ) {
    super(message);
    this.name = 'OCRRateLimitError';
  }
}

export class OCRRateLimiter {
  // OCR quota: 50 requests per day per user
  private static readonly MAX_REQUESTS_PER_DAY = 50;

  /**
   * Check if user has remaining OCR quota
   * Returns remaining quota or throws OCRRateLimitError
   */
  static async checkQuota(userId: string): Promise<number> {
    const today = this.getTodayKey();
    const key = `ocr:quota:${userId}:${today}`;

    // Get current usage
    const currentUsage = await redis.get(key);
    const usageCount = currentUsage ? parseInt(currentUsage) : 0;

    // Check if limit exceeded
    if (usageCount >= this.MAX_REQUESTS_PER_DAY) {
      const resetAt = this.getResetTime();
      throw new OCRRateLimitError(
        `OCR quota exceeded. You have used ${usageCount}/${this.MAX_REQUESTS_PER_DAY} requests today. Resets at ${resetAt.toISOString()}`,
        0,
        resetAt
      );
    }

    return this.MAX_REQUESTS_PER_DAY - usageCount;
  }

  /**
   * Increment user's OCR usage count
   */
  static async incrementUsage(userId: string): Promise<number> {
    const today = this.getTodayKey();
    const key = `ocr:quota:${userId}:${today}`;

    // Increment counter
    const newCount = await redis.incr(key);

    // Set expiry to end of day (only on first increment)
    if (newCount === 1) {
      const secondsUntilMidnight = this.getSecondsUntilMidnight();
      await redis.expire(key, secondsUntilMidnight);
    }

    return newCount;
  }

  /**
   * Get remaining quota for user
   */
  static async getRemainingQuota(userId: string): Promise<{
    used: number;
    remaining: number;
    total: number;
    resetAt: Date;
  }> {
    const today = this.getTodayKey();
    const key = `ocr:quota:${userId}:${today}`;

    const currentUsage = await redis.get(key);
    const used = currentUsage ? parseInt(currentUsage) : 0;
    const remaining = Math.max(0, this.MAX_REQUESTS_PER_DAY - used);

    return {
      used,
      remaining,
      total: this.MAX_REQUESTS_PER_DAY,
      resetAt: this.getResetTime(),
    };
  }

  /**
   * Reset quota for user (admin use only)
   */
  static async resetQuota(userId: string): Promise<void> {
    const today = this.getTodayKey();
    const key = `ocr:quota:${userId}:${today}`;
    await redis.del(key);
    console.log(`[OCR Rate Limiter] Quota reset for user ${userId}`);
  }

  /**
   * Get today's date key (YYYY-MM-DD format)
   */
  private static getTodayKey(): string {
    const now = new Date();
    return now.toISOString().split('T')[0]; // "2026-04-01"
  }

  /**
   * Get seconds until midnight (for Redis expiry)
   */
  private static getSecondsUntilMidnight(): number {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    return Math.floor((tomorrow.getTime() - now.getTime()) / 1000);
  }

  /**
   * Get reset time (midnight tonight)
   */
  private static getResetTime(): Date {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    return tomorrow;
  }
}
