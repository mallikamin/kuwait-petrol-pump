import OAuthClient from 'intuit-oauth';
import { PrismaClient } from '@prisma/client';
import { encryptToken, decryptToken } from './encryption';
import { redis } from '../../config/redis';
import { QBTokenExpiredError, QBTransientError } from './errors';

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

  try {
    const oauthClient = getOAuthClient();

    // Set the refresh token
    const refreshToken = decryptToken(connection.refreshTokenEncrypted);
    oauthClient.setToken({
      refresh_token: refreshToken,
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

    return {
      accessToken: token.access_token,
      realmId: connection.realmId,
    };
  } catch (error: any) {
    // Classify error for proper handling
    const errorCode = error.authResponse?.body?.error;
    const errorStatus = error.authResponse?.status;

    console.error(
      JSON.stringify({
        event: 'qb_token_refresh_error',
        organizationId,
        errorCode,
        errorStatus,
        errorMessage: error.message || String(error),
      })
    );

    // Classification: invalid_grant or 400/401 = expired refresh token (requires reconnect)
    if (
      errorCode === 'invalid_grant' ||
      errorStatus === 400 ||
      errorStatus === 401 ||
      error.message?.includes('invalid') ||
      error.message?.includes('expired')
    ) {
      await db.qBConnection.update({
        where: { id: connection.id },
        data: { isActive: false },
      });
      throw new QBTokenExpiredError('QuickBooks refresh token expired. Please reconnect.');
    }

    // Classification: network/transient errors (do NOT deactivate)
    if (
      errorStatus === 500 ||
      errorStatus === 502 ||
      errorStatus === 503 ||
      errorStatus === 504 ||
      error.code === 'ECONNREFUSED' ||
      error.code === 'ETIMEDOUT' ||
      error.code === 'ENOTFOUND'
    ) {
      throw new QBTransientError('QuickBooks API temporarily unavailable. Please retry.', error);
    }

    // Unknown error - treat as transient to avoid disconnecting unnecessarily
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
