import AsyncStorage from '@react-native-async-storage/async-storage';

interface RateLimitConfig {
  maxRequests: number; // Max OCR requests per period
  periodMs: number; // Time period in milliseconds
  storageKey: string;
}

interface RateLimitState {
  count: number;
  resetAt: number; // Timestamp when the count resets
}

/**
 * Simple rate limiter for OCR API calls
 * Prevents accidental bulk uploads and API abuse
 */
export class RateLimiter {
  private config: RateLimitConfig;

  constructor(config: Partial<RateLimitConfig> = {}) {
    this.config = {
      maxRequests: config.maxRequests || 50, // Default: 50 OCR per day
      periodMs: config.periodMs || 24 * 60 * 60 * 1000, // Default: 24 hours
      storageKey: config.storageKey || '@ocr_rate_limit',
    };
  }

  /**
   * Check if a new request is allowed
   * Returns { allowed: boolean, remaining: number, resetAt: Date }
   */
  async checkLimit(): Promise<{
    allowed: boolean;
    remaining: number;
    resetAt: Date;
    message?: string;
  }> {
    try {
      const state = await this.getState();
      const now = Date.now();

      // Reset if period has expired
      if (now >= state.resetAt) {
        const newState: RateLimitState = {
          count: 0,
          resetAt: now + this.config.periodMs,
        };
        await this.setState(newState);
        return {
          allowed: true,
          remaining: this.config.maxRequests - 1,
          resetAt: new Date(newState.resetAt),
        };
      }

      // Check if limit exceeded
      if (state.count >= this.config.maxRequests) {
        const resetDate = new Date(state.resetAt);
        const hoursLeft = Math.ceil((state.resetAt - now) / (60 * 60 * 1000));
        return {
          allowed: false,
          remaining: 0,
          resetAt: resetDate,
          message: `OCR limit reached (${this.config.maxRequests} per day). Resets in ${hoursLeft} hour(s).`,
        };
      }

      // Request allowed
      return {
        allowed: true,
        remaining: this.config.maxRequests - state.count - 1,
        resetAt: new Date(state.resetAt),
      };
    } catch (error) {
      console.error('Rate limit check error:', error);
      // Fail open - allow request if storage fails
      return {
        allowed: true,
        remaining: this.config.maxRequests,
        resetAt: new Date(Date.now() + this.config.periodMs),
      };
    }
  }

  /**
   * Increment the request count
   * Call this AFTER a successful OCR request
   */
  async incrementCount(): Promise<void> {
    try {
      const state = await this.getState();
      const now = Date.now();

      // Reset if period expired
      if (now >= state.resetAt) {
        const newState: RateLimitState = {
          count: 1,
          resetAt: now + this.config.periodMs,
        };
        await this.setState(newState);
      } else {
        // Increment count
        const newState: RateLimitState = {
          count: state.count + 1,
          resetAt: state.resetAt,
        };
        await this.setState(newState);
      }
    } catch (error) {
      console.error('Rate limit increment error:', error);
    }
  }

  /**
   * Get current usage stats
   */
  async getUsage(): Promise<{
    used: number;
    limit: number;
    remaining: number;
    resetAt: Date;
  }> {
    const state = await this.getState();
    const now = Date.now();

    // Reset if period expired
    if (now >= state.resetAt) {
      return {
        used: 0,
        limit: this.config.maxRequests,
        remaining: this.config.maxRequests,
        resetAt: new Date(now + this.config.periodMs),
      };
    }

    return {
      used: state.count,
      limit: this.config.maxRequests,
      remaining: Math.max(0, this.config.maxRequests - state.count),
      resetAt: new Date(state.resetAt),
    };
  }

  /**
   * Reset the rate limit (for testing or admin override)
   */
  async reset(): Promise<void> {
    const newState: RateLimitState = {
      count: 0,
      resetAt: Date.now() + this.config.periodMs,
    };
    await this.setState(newState);
  }

  private async getState(): Promise<RateLimitState> {
    try {
      const json = await AsyncStorage.getItem(this.config.storageKey);
      if (json) {
        return JSON.parse(json);
      }
    } catch (error) {
      console.error('Rate limit getState error:', error);
    }

    // Default state
    return {
      count: 0,
      resetAt: Date.now() + this.config.periodMs,
    };
  }

  private async setState(state: RateLimitState): Promise<void> {
    try {
      await AsyncStorage.setItem(
        this.config.storageKey,
        JSON.stringify(state)
      );
    } catch (error) {
      console.error('Rate limit setState error:', error);
    }
  }
}

// Export singleton instance with default config (50 OCR per day)
export const ocrRateLimiter = new RateLimiter({
  maxRequests: 50,
  periodMs: 24 * 60 * 60 * 1000, // 24 hours
  storageKey: '@ocr_rate_limit',
});
