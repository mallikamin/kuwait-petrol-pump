/**
 * QuickBooks Rate Limiter & Circuit Breaker
 *
 * Rule 6: Protect against QB API rate limits and cascading failures
 * - Circuit breaker pattern (open/half-open/closed states)
 * - Exponential backoff on failures
 * - Automatic recovery
 * - Request throttling
 */

import { redis } from '../../config/redis';

// Circuit breaker states
export enum CircuitState {
  CLOSED = 'CLOSED', // Normal operation
  OPEN = 'OPEN', // Blocking requests (too many failures)
  HALF_OPEN = 'HALF_OPEN', // Testing recovery
}

export class RateLimitError extends Error {
  constructor(
    message: string,
    public readonly retryAfterMs: number
  ) {
    super(message);
    this.name = 'RateLimitError';
  }
}

export class CircuitBreakerError extends Error {
  constructor(
    message: string,
    public readonly circuitState: CircuitState,
    public readonly retryAfterMs: number
  ) {
    super(message);
    this.name = 'CircuitBreakerError';
  }
}

export class RateLimiter {
  // QuickBooks Online API limits: 500 req/min per company
  private static readonly MAX_REQUESTS_PER_MINUTE = 450; // Leave buffer
  private static readonly MAX_REQUESTS_PER_SECOND = 10;

  // Circuit breaker thresholds
  private static readonly FAILURE_THRESHOLD = 5; // Open circuit after 5 failures
  private static readonly SUCCESS_THRESHOLD = 2; // Close circuit after 2 successes in half-open
  private static readonly OPEN_TIMEOUT_MS = 60000; // 1 minute before trying half-open
  private static readonly HALF_OPEN_TIMEOUT_MS = 30000; // 30 seconds in half-open state

  /**
   * Check if request is allowed (rate limit + circuit breaker)
   */
  static async checkRequest(
    connectionId: string,
    operation: string
  ): Promise<void> {
    // 1. Check circuit breaker state
    await this.checkCircuitBreaker(connectionId);

    // 2. Check rate limits
    await this.checkRateLimit(connectionId);

    // 3. Increment request counter
    await this.incrementRequestCounter(connectionId);
  }

  /**
   * Record successful request
   */
  static async recordSuccess(connectionId: string): Promise<void> {
    const stateKey = `qb:circuit:${connectionId}:state`;
    const successKey = `qb:circuit:${connectionId}:success`;

    const state = await redis.get(stateKey);

    if (state === CircuitState.HALF_OPEN) {
      // Increment success counter
      const successCount = await redis.incr(successKey);
      await redis.expire(successKey, 60);

      if (successCount >= this.SUCCESS_THRESHOLD) {
        // Close the circuit
        await this.closeCircuit(connectionId);
        console.log(`[Circuit Breaker] ✓ Circuit CLOSED for connection ${connectionId}`);
      }
    }
  }

  /**
   * Record failed request
   */
  static async recordFailure(
    connectionId: string,
    error: Error,
    statusCode?: number
  ): Promise<void> {
    // Check if this is a rate limit error (429)
    if (statusCode === 429) {
      await this.handleRateLimitError(connectionId);
      return;
    }

    // Check if this is a server error (5xx) or timeout
    const isTransientError =
      (statusCode && statusCode >= 500) ||
      error.message.includes('timeout') ||
      error.message.includes('ECONNRESET');

    if (!isTransientError) {
      // Not a transient error, don't count towards circuit breaker
      return;
    }

    // Increment failure counter
    const failureKey = `qb:circuit:${connectionId}:failures`;
    const failureCount = await redis.incr(failureKey);
    await redis.expire(failureKey, 60);

    console.warn(
      `[Circuit Breaker] Failure ${failureCount}/${this.FAILURE_THRESHOLD} for connection ${connectionId}`
    );

    if (failureCount >= this.FAILURE_THRESHOLD) {
      await this.openCircuit(connectionId);
      console.error(`[Circuit Breaker] 🚨 Circuit OPENED for connection ${connectionId}`);
    }
  }

  /**
   * Check circuit breaker state
   */
  private static async checkCircuitBreaker(connectionId: string): Promise<void> {
    const stateKey = `qb:circuit:${connectionId}:state`;
    const openedAtKey = `qb:circuit:${connectionId}:opened_at`;

    const state = await redis.get(stateKey);

    if (state === CircuitState.OPEN) {
      // Check if timeout has passed
      const openedAt = await redis.get(openedAtKey);
      if (openedAt) {
        const elapsedMs = Date.now() - parseInt(openedAt);
        if (elapsedMs >= this.OPEN_TIMEOUT_MS) {
          // Transition to half-open
          await this.halfOpenCircuit(connectionId);
          console.log(`[Circuit Breaker] Circuit HALF-OPEN for connection ${connectionId}`);
          return;
        }
      }

      // Circuit is still open
      const retryAfterMs = this.OPEN_TIMEOUT_MS - (Date.now() - parseInt(openedAt || '0'));
      throw new CircuitBreakerError(
        `Circuit breaker is OPEN for connection ${connectionId}. Retry after ${Math.ceil(retryAfterMs / 1000)}s`,
        CircuitState.OPEN,
        retryAfterMs
      );
    }

    if (state === CircuitState.HALF_OPEN) {
      // Allow limited requests in half-open state
      const halfOpenKey = `qb:circuit:${connectionId}:half_open_at`;
      const halfOpenAt = await redis.get(halfOpenKey);
      if (halfOpenAt) {
        const elapsedMs = Date.now() - parseInt(halfOpenAt);
        if (elapsedMs >= this.HALF_OPEN_TIMEOUT_MS) {
          // Timeout in half-open, reopen circuit
          await this.openCircuit(connectionId);
          throw new CircuitBreakerError(
            `Circuit breaker timeout in HALF-OPEN state for connection ${connectionId}`,
            CircuitState.OPEN,
            this.OPEN_TIMEOUT_MS
          );
        }
      }
    }

    // Circuit is closed or half-open, allow request
  }

  /**
   * Check rate limits (per-minute and per-second)
   */
  private static async checkRateLimit(connectionId: string): Promise<void> {
    const now = Date.now();
    const minuteKey = `qb:rate:${connectionId}:minute:${Math.floor(now / 60000)}`;
    const secondKey = `qb:rate:${connectionId}:second:${Math.floor(now / 1000)}`;

    // Check per-minute limit
    const minuteCount = await redis.get(minuteKey);
    if (minuteCount && parseInt(minuteCount) >= this.MAX_REQUESTS_PER_MINUTE) {
      throw new RateLimitError(
        `Rate limit exceeded: ${this.MAX_REQUESTS_PER_MINUTE} requests/minute for connection ${connectionId}`,
        60000 // Retry after 1 minute
      );
    }

    // Check per-second limit
    const secondCount = await redis.get(secondKey);
    if (secondCount && parseInt(secondCount) >= this.MAX_REQUESTS_PER_SECOND) {
      throw new RateLimitError(
        `Rate limit exceeded: ${this.MAX_REQUESTS_PER_SECOND} requests/second for connection ${connectionId}`,
        1000 // Retry after 1 second
      );
    }
  }

  /**
   * Increment request counters
   */
  private static async incrementRequestCounter(connectionId: string): Promise<void> {
    const now = Date.now();
    const minuteKey = `qb:rate:${connectionId}:minute:${Math.floor(now / 60000)}`;
    const secondKey = `qb:rate:${connectionId}:second:${Math.floor(now / 1000)}`;

    await redis.incr(minuteKey);
    await redis.expire(minuteKey, 120); // Keep for 2 minutes

    await redis.incr(secondKey);
    await redis.expire(secondKey, 10); // Keep for 10 seconds
  }

  /**
   * Handle rate limit error from QB API (429)
   */
  private static async handleRateLimitError(connectionId: string): Promise<void> {
    // Open circuit immediately on rate limit
    await this.openCircuit(connectionId);
    console.error(
      `[Circuit Breaker] 🚨 Rate limit (429) detected - Circuit OPENED for connection ${connectionId}`
    );
  }

  /**
   * Open circuit (block all requests)
   */
  private static async openCircuit(connectionId: string): Promise<void> {
    const stateKey = `qb:circuit:${connectionId}:state`;
    const openedAtKey = `qb:circuit:${connectionId}:opened_at`;
    const failureKey = `qb:circuit:${connectionId}:failures`;

    await redis.set(stateKey, CircuitState.OPEN);
    await redis.set(openedAtKey, Date.now().toString());
    await redis.del(failureKey);

    await redis.expire(stateKey, this.OPEN_TIMEOUT_MS / 1000 + 60);
    await redis.expire(openedAtKey, this.OPEN_TIMEOUT_MS / 1000 + 60);
  }

  /**
   * Half-open circuit (test recovery)
   */
  private static async halfOpenCircuit(connectionId: string): Promise<void> {
    const stateKey = `qb:circuit:${connectionId}:state`;
    const halfOpenKey = `qb:circuit:${connectionId}:half_open_at`;
    const successKey = `qb:circuit:${connectionId}:success`;

    await redis.set(stateKey, CircuitState.HALF_OPEN);
    await redis.set(halfOpenKey, Date.now().toString());
    await redis.del(successKey);

    await redis.expire(stateKey, this.HALF_OPEN_TIMEOUT_MS / 1000 + 60);
    await redis.expire(halfOpenKey, this.HALF_OPEN_TIMEOUT_MS / 1000 + 60);
  }

  /**
   * Close circuit (resume normal operation)
   */
  private static async closeCircuit(connectionId: string): Promise<void> {
    const stateKey = `qb:circuit:${connectionId}:state`;
    const openedAtKey = `qb:circuit:${connectionId}:opened_at`;
    const halfOpenKey = `qb:circuit:${connectionId}:half_open_at`;
    const successKey = `qb:circuit:${connectionId}:success`;
    const failureKey = `qb:circuit:${connectionId}:failures`;

    await redis.del(stateKey);
    await redis.del(openedAtKey);
    await redis.del(halfOpenKey);
    await redis.del(successKey);
    await redis.del(failureKey);
  }

  /**
   * Get circuit breaker status
   */
  static async getCircuitStatus(
    connectionId: string
  ): Promise<{
    state: CircuitState;
    failureCount: number;
    successCount: number;
    openedAt?: number;
    requestsPerMinute: number;
    requestsPerSecond: number;
  }> {
    const stateKey = `qb:circuit:${connectionId}:state`;
    const failureKey = `qb:circuit:${connectionId}:failures`;
    const successKey = `qb:circuit:${connectionId}:success`;
    const openedAtKey = `qb:circuit:${connectionId}:opened_at`;

    const now = Date.now();
    const minuteKey = `qb:rate:${connectionId}:minute:${Math.floor(now / 60000)}`;
    const secondKey = `qb:rate:${connectionId}:second:${Math.floor(now / 1000)}`;

    const [state, failureCount, successCount, openedAt, minuteCount, secondCount] =
      await Promise.all([
        redis.get(stateKey),
        redis.get(failureKey),
        redis.get(successKey),
        redis.get(openedAtKey),
        redis.get(minuteKey),
        redis.get(secondKey),
      ]);

    return {
      state: (state as CircuitState) || CircuitState.CLOSED,
      failureCount: parseInt(failureCount || '0'),
      successCount: parseInt(successCount || '0'),
      openedAt: openedAt ? parseInt(openedAt) : undefined,
      requestsPerMinute: parseInt(minuteCount || '0'),
      requestsPerSecond: parseInt(secondCount || '0'),
    };
  }

  /**
   * Reset circuit breaker (emergency use only)
   */
  static async resetCircuit(connectionId: string): Promise<void> {
    await this.closeCircuit(connectionId);
    console.log(`[Circuit Breaker] Circuit RESET for connection ${connectionId}`);
  }
}
