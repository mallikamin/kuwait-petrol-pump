import OAuthClient from 'intuit-oauth';
import { PrismaClient } from '@prisma/client';
import { encryptToken, decryptToken, redactToken } from './encryption';
import { redis } from '../../config/redis';
import { QBTokenExpiredError, QBTransientError } from './errors';
import { AuditLogger } from './audit-logger';

const prisma = new PrismaClient();

// Lock TTL: 30 seconds (should be enough for refresh operation)
const LOCK_TTL_SECONDS = 30;

/**
 * Get OAuth client configured with environment variables
 */
function getOAuthClient(): OAuthClient {
  return new OAuthClient({
    clientId: process.env.QUICKBOOKS_CLIENT_ID || '',
    clientSecret: process.env.QUICKBOOKS_CLIENT_SECRET || '',
    environment: (process.env.QUICKBOOKS_ENVIRONMENT || 'sandbox') as 'sandbox' | 'production',
    redirectUri: process.env.QUICKBOOKS_REDIRECT_URI || '',
  });
}

/**
 * Acquire single-flight lock for token refresh
 * Prevents concurrent refresh calls from racing and corrupting token state
 */
async function acquireRefreshLock(organizationId: string): Promise<boolean> {
  const lockKey = `qb:token-refresh:${organizationId}`;
  try {
    const acquired = await redis.set(lockKey, '1', { NX: true, EX: LOCK_TTL_SECONDS });
    return acquired === 'OK';
  } catch (error) {
    console.error(`[QB Token] Lock acquisition failed for org ${organizationId}:`, error);
    return false;
  }
}

/**
 * Release single-flight lock
 */
async function releaseRefreshLock(organizationId: string): Promise<void> {
  const lockKey = `qb:token-refresh:${organizationId}`;
  try {
    await redis.del(lockKey);
  } catch (error) {
    console.error(`[QB Token] Lock release failed for org ${organizationId}:`, error);
  }
}

/**
 * Get a valid access token, auto-refreshing if expired
 *
 * @param organizationId - Organization ID
 * @param prismaClient - Optional Prisma client (for transaction support)
 * @returns Access token and realm ID
 * @throws QBTokenExpiredError if QB not connected or refresh token expired
 * @throws QBTransientError if refresh fails due to transient error
 */
export async function getValidAccessToken(
  organizationId: string,
  prismaClient?: PrismaClient
): Promise<{ accessToken: string; realmId: string }> {
  const db = prismaClient || prisma;

  const connection = await db.qBConnection.findFirst({
    where: { organizationId, isActive: true },
  });

  if (!connection) {
    throw new QBTokenExpiredError('QuickBooks not connected');
  }

  // Check if access token is expired (with 10min buffer for proactive refresh)
  const now = new Date();
  const expiresAt = new Date(connection.accessTokenExpiresAt);
  const bufferMs = 10 * 60 * 1000; // 10 minutes (increased from 5min)

  if (expiresAt.getTime() - now.getTime() > bufferMs) {
    // Token still valid
    console.log(`[QB Token] Token valid for org ${organizationId}, expires at ${expiresAt.toISOString()}`);
    return {
      accessToken: decryptToken(connection.accessTokenEncrypted),
      realmId: connection.realmId,
    };
  }

  // Token expired or expiring soon - refresh it with single-flight lock
  console.log(`[QB Token] Proactive refresh for org ${organizationId} (expires at ${expiresAt.toISOString()})`);

  // Acquire lock to prevent concurrent refreshes
  const lockAcquired = await acquireRefreshLock(organizationId);
  if (!lockAcquired) {
    // Another refresh is in progress, wait briefly and retry getting token
    console.log(`[QB Token] Concurrent refresh detected for org ${organizationId}, waiting...`);
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Re-fetch connection to get potentially refreshed token
    const updatedConnection = await db.qBConnection.findFirst({
      where: { organizationId, isActive: true },
    });

    if (!updatedConnection) {
      throw new QBTokenExpiredError('QuickBooks connection lost during refresh');
    }

    // Check if token was refreshed by the other process
    const updatedExpiresAt = new Date(updatedConnection.accessTokenExpiresAt);
    if (updatedExpiresAt.getTime() - now.getTime() > bufferMs) {
      console.log(`[QB Token] Token refreshed by concurrent process for org ${organizationId}`);
      return {
        accessToken: decryptToken(updatedConnection.accessTokenEncrypted),
        realmId: updatedConnection.realmId,
      };
    }

    // Still expired, throw error (don't retry to avoid infinite loop)
    throw new QBTransientError('Token refresh lock timeout', { organizationId });
  }

  // Re-fetch INSIDE the lock so we always use the freshest refresh token.
  // Prevents a stale-snapshot race: if another caller refreshed+rotated T1→T2
  // between our initial findFirst (pre-lock) and our refresh call, we would
  // otherwise send Intuit the now-invalid T1 and trigger a false "invalid"
  // error that looks like an Intuit-side token death.
  const lockedConnection = await db.qBConnection.findFirst({
    where: { id: connection.id, isActive: true },
  });

  if (!lockedConnection || !lockedConnection.refreshTokenEncrypted) {
    await releaseRefreshLock(organizationId);
    throw new QBTokenExpiredError('QuickBooks connection no longer active');
  }

  // If another process already refreshed while we were waiting for the lock,
  // short-circuit: their new token is valid, no reason to burn another refresh.
  const lockedExpiresAt = lockedConnection.accessTokenExpiresAt
    ? new Date(lockedConnection.accessTokenExpiresAt)
    : null;
  if (lockedExpiresAt && lockedExpiresAt.getTime() - now.getTime() > bufferMs) {
    console.log(`[QB Token] Refresh preempted by concurrent process for org ${organizationId}`);
    await releaseRefreshLock(organizationId);
    return {
      accessToken: decryptToken(lockedConnection.accessTokenEncrypted!),
      realmId: lockedConnection.realmId,
    };
  }

  const oldRefreshToken = decryptToken(lockedConnection.refreshTokenEncrypted);
  const refreshAttemptStartedAt = new Date();

  // Persistent forensic trail: we lose container stdout on every redeploy,
  // so the audit log is the only durable record of what Intuit told us.
  await AuditLogger.log({
    operation: 'TOKEN_REFRESH_ATTEMPT',
    entity_type: 'qb_connection',
    entity_id: connection.id,
    direction: 'APP_TO_QB',
    status: 'PENDING',
    metadata: {
      organizationId,
      realmId: lockedConnection.realmId,
      pid: process.pid,
      accessTokenExpiresAt: lockedConnection.accessTokenExpiresAt?.toISOString() ?? null,
      refreshTokenExpiresAt: lockedConnection.refreshTokenExpiresAt?.toISOString() ?? null,
      refreshTokenHead: redactToken(oldRefreshToken),
      lastSyncAt: lockedConnection.lastSyncAt?.toISOString() ?? null,
      minutesUntilAccessExpiry: lockedConnection.accessTokenExpiresAt
        ? Math.round((lockedConnection.accessTokenExpiresAt.getTime() - refreshAttemptStartedAt.getTime()) / 60000)
        : null,
    },
  });

  try {
    const oauthClient = getOAuthClient();

    oauthClient.setToken({
      refresh_token: oldRefreshToken,
    });

    // Attempt refresh
    const authResponse = await oauthClient.refresh();
    const token = authResponse.getToken();

    if (!token.access_token || !token.refresh_token) {
      throw new Error('Invalid token response from QuickBooks');
    }

    // Calculate expiration times
    const accessTokenExpiresAt = new Date(Date.now() + (token.expires_in || 3600) * 1000);
    const refreshTokenExpiresAt = new Date(Date.now() + (token.x_refresh_token_expires_in || 8640000) * 1000);

    // Update database with BOTH new tokens
    await db.qBConnection.update({
      where: { id: connection.id },
      data: {
        accessTokenEncrypted: encryptToken(token.access_token),
        accessTokenExpiresAt,
        refreshTokenEncrypted: encryptToken(token.refresh_token),
        refreshTokenExpiresAt,
        lastSyncAt: new Date(),
      },
    });

    console.log(
      JSON.stringify({
        event: 'qb_token_refresh_success',
        organizationId,
        accessTokenExpiresAt: accessTokenExpiresAt.toISOString(),
        refreshTokenExpiresAt: refreshTokenExpiresAt.toISOString(),
      })
    );

    await AuditLogger.log({
      operation: 'TOKEN_REFRESH_SUCCESS',
      entity_type: 'qb_connection',
      entity_id: connection.id,
      direction: 'APP_TO_QB',
      status: 'SUCCESS',
      metadata: {
        organizationId,
        realmId: connection.realmId,
        pid: process.pid,
        oldRefreshTokenHead: redactToken(oldRefreshToken),
        newRefreshTokenHead: redactToken(token.refresh_token),
        refreshTokenRotated: oldRefreshToken !== token.refresh_token,
        accessTokenExpiresAt: accessTokenExpiresAt.toISOString(),
        refreshTokenExpiresAt: refreshTokenExpiresAt.toISOString(),
        durationMs: Date.now() - refreshAttemptStartedAt.getTime(),
      },
    });

    return {
      accessToken: token.access_token,
      realmId: connection.realmId,
    };
  } catch (error: any) {
    // Classify error for proper handling
    const errorCode = error.authResponse?.body?.error;
    const errorStatus = error.authResponse?.status;
    const willDeactivate = errorCode === 'invalid_grant';

    console.error(
      JSON.stringify({
        event: 'qb_token_refresh_error',
        organizationId,
        errorCode,
        errorStatus,
        errorMessage: error.message || String(error),
      })
    );

    // Swallow audit-log faults in the failure path — we must not mask
    // the original refresh error with an audit-logger DB hiccup.
    try {
      await AuditLogger.log({
        operation: 'TOKEN_REFRESH_FAILURE',
        entity_type: 'qb_connection',
        entity_id: connection.id,
        direction: 'APP_TO_QB',
        status: 'FAILURE',
        error_message: error.message || String(error),
        request_payload: {
          refreshTokenHead: redactToken(oldRefreshToken),
        },
        response_payload: {
          status: errorStatus,
          body: error.authResponse?.body ?? null,
          intuit_tid: error.authResponse?.headers?.intuit_tid ?? null,
        },
        metadata: {
          organizationId,
          realmId: lockedConnection.realmId,
          pid: process.pid,
          errorCode,
          errorStatus,
          willDeactivate,
          refreshTokenExpiresAt: lockedConnection.refreshTokenExpiresAt?.toISOString() ?? null,
          minutesSinceConnectionEstablished: lockedConnection.createdAt
            ? Math.round((refreshAttemptStartedAt.getTime() - lockedConnection.createdAt.getTime()) / 60000)
            : null,
          durationMs: Date.now() - refreshAttemptStartedAt.getTime(),
        },
      });
    } catch (auditError) {
      console.error('[QB Token] Failed to write TOKEN_REFRESH_FAILURE audit entry:', auditError);
    }

    // Deactivate ONLY on Intuit's explicit "refresh token dead" signal.
    // A bare 400/401 or error messages containing "invalid"/"expired" are
    // frequently transient (clock skew, momentary upstream blip, generic
    // network phrasing) and previously caused unnecessary reconnects.
    if (willDeactivate) {
      await db.qBConnection.update({
        where: { id: connection.id },
        data: { isActive: false },
      });
      throw new QBTokenExpiredError('QuickBooks refresh token expired. Please reconnect.');
    }

    // Everything else is transient: keepalive + next caller will retry.
    // This covers 400/401 without invalid_grant, 5xx, network codes, and
    // unknown shapes — none of them justify forcing a user-visible reconnect.
    throw new QBTransientError(`QB token refresh failed: ${error.message || 'Unknown error'}`, error);
  } finally {
    // Always release lock
    await releaseRefreshLock(organizationId);
  }
}

/**
 * Get API URL for QuickBooks based on environment
 */
export function getQBApiUrl(): string {
  const oauthClient = getOAuthClient();
  return oauthClient.environment === 'sandbox'
    ? 'https://sandbox-quickbooks.api.intuit.com'
    : 'https://quickbooks.api.intuit.com';
}
