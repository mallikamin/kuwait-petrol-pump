/**
 * QB Token Keepalive Service
 * Proactively refreshes tokens before they expire to reduce reconnect frequency
 */

import { PrismaClient } from '@prisma/client';
import { getValidAccessToken } from './token-refresh';
import { redis } from '../../config/redis';

const prisma = new PrismaClient();

// Run keepalive every 30 minutes
const KEEPALIVE_INTERVAL_MS = 30 * 60 * 1000;

// Refresh tokens that will expire in less than 20 minutes
const REFRESH_THRESHOLD_MS = 20 * 60 * 1000;

// Lock to prevent multiple workers from running keepalive simultaneously
const KEEPALIVE_LOCK_KEY = 'qb:keepalive:lock';
const KEEPALIVE_LOCK_TTL = 60; // 60 seconds

/**
 * Acquire global keepalive lock (prevents multiple workers from running simultaneously)
 */
async function acquireKeepaliveLock(): Promise<boolean> {
  try {
    const acquired = await redis.set(KEEPALIVE_LOCK_KEY, '1', { NX: true, EX: KEEPALIVE_LOCK_TTL });
    return acquired === 'OK';
  } catch (error) {
    console.error('[QB Keepalive] Failed to acquire lock:', error);
    return false;
  }
}

/**
 * Release global keepalive lock
 */
async function releaseKeepaliveLock(): Promise<void> {
  try {
    await redis.del(KEEPALIVE_LOCK_KEY);
  } catch (error) {
    console.error('[QB Keepalive] Failed to release lock:', error);
  }
}

/**
 * Run keepalive refresh cycle
 * Scans all active QB connections and proactively refreshes tokens expiring soon
 */
export async function runKeepalive(): Promise<void> {
  const lockAcquired = await acquireKeepaliveLock();
  if (!lockAcquired) {
    console.log('[QB Keepalive] Another worker is running keepalive, skipping');
    return;
  }

  const stats = {
    scanned: 0,
    refreshed: 0,
    failed: 0,
    expired: 0,
  };

  try {
    const now = new Date();
    const connections = await prisma.qBConnection.findMany({
      where: { isActive: true },
      select: {
        id: true,
        organizationId: true,
        companyName: true,
        accessTokenExpiresAt: true,
        refreshTokenExpiresAt: true,
      },
    });

    stats.scanned = connections.length;
    console.log(`[QB Keepalive] Scanning ${connections.length} active connections`);

    for (const conn of connections) {
      try {
        // Check if access token will expire soon
        const expiresAt = new Date(conn.accessTokenExpiresAt);
        const timeUntilExpiry = expiresAt.getTime() - now.getTime();

        if (timeUntilExpiry < REFRESH_THRESHOLD_MS) {
          console.log(
            `[QB Keepalive] Refreshing token for org ${conn.organizationId} (expires in ${Math.round(timeUntilExpiry / 60000)} min)`
          );

          // Call getValidAccessToken which will handle the refresh
          await getValidAccessToken(conn.organizationId, prisma);
          stats.refreshed++;

          console.log(`[QB Keepalive] Successfully refreshed token for org ${conn.organizationId}`);
        }
      } catch (error: any) {
        // Connection became inactive (refresh token expired)
        if (error.name === 'QBTokenExpiredError') {
          stats.expired++;
          console.log(`[QB Keepalive] Connection expired for org ${conn.organizationId}`);
        } else {
          stats.failed++;
          console.error(`[QB Keepalive] Failed to refresh org ${conn.organizationId}:`, error.message);
        }
      }
    }

    console.log(
      JSON.stringify({
        event: 'qb_keepalive_complete',
        ...stats,
      })
    );
  } catch (error) {
    console.error('[QB Keepalive] Unexpected error:', error);
  } finally {
    await releaseKeepaliveLock();
  }
}

/**
 * Start keepalive service (call this on server startup)
 */
export function startKeepaliveService(): NodeJS.Timeout {
  console.log(`[QB Keepalive] Starting service (interval: ${KEEPALIVE_INTERVAL_MS / 60000} minutes)`);

  // Run immediately on startup
  runKeepalive().catch((error) => {
    console.error('[QB Keepalive] Startup run failed:', error);
  });

  // Schedule periodic runs
  return setInterval(() => {
    runKeepalive().catch((error) => {
      console.error('[QB Keepalive] Scheduled run failed:', error);
    });
  }, KEEPALIVE_INTERVAL_MS);
}

/**
 * Stop keepalive service
 */
export function stopKeepaliveService(intervalId: NodeJS.Timeout): void {
  clearInterval(intervalId);
  console.log('[QB Keepalive] Service stopped');
}
