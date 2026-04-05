import OAuthClient from 'intuit-oauth';
import { PrismaClient } from '@prisma/client';
import { encryptToken, decryptToken } from './encryption';

const prisma = new PrismaClient();

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
 * Get a valid access token, auto-refreshing if expired
 *
 * @param organizationId - Organization ID
 * @param prismaClient - Optional Prisma client (for transaction support)
 * @returns Access token and realm ID
 * @throws Error if QB not connected or refresh fails
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
    throw new Error('QuickBooks not connected');
  }

  // Check if access token is expired (with 5min buffer for safety)
  const now = new Date();
  const expiresAt = new Date(connection.accessTokenExpiresAt);
  const bufferMs = 5 * 60 * 1000; // 5 minutes

  if (expiresAt.getTime() - now.getTime() > bufferMs) {
    // Token still valid
    return {
      accessToken: decryptToken(connection.accessTokenEncrypted),
      realmId: connection.realmId,
    };
  }

  // Token expired - refresh it
  console.log(`[QB Token] Access token expired at ${expiresAt.toISOString()}, refreshing for org ${organizationId}`);

  const oauthClient = getOAuthClient();

  // Set the refresh token
  const refreshToken = decryptToken(connection.refreshTokenEncrypted);
  oauthClient.setToken({
    refresh_token: refreshToken,
  });

  try {
    const authResponse = await oauthClient.refresh();
    const token = authResponse.getToken();

    if (!token.access_token || !token.refresh_token) {
      throw new Error('Invalid token response from QuickBooks');
    }

    // Calculate expiration times
    const accessTokenExpiresAt = new Date(Date.now() + (token.expires_in || 3600) * 1000);
    const refreshTokenExpiresAt = new Date(Date.now() + (token.x_refresh_token_expires_in || 8640000) * 1000);

    // Update database with new tokens
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

    console.log(`[QB Token] Successfully refreshed for org ${organizationId}, expires at ${accessTokenExpiresAt.toISOString()}`);

    return {
      accessToken: token.access_token,
      realmId: connection.realmId,
    };
  } catch (error: any) {
    console.error('[QB Token] Refresh failed:', error.message || error);

    // Mark connection as inactive if refresh token is invalid
    if (error.authResponse?.status === 400) {
      await db.qBConnection.update({
        where: { id: connection.id },
        data: { isActive: false },
      });
      throw new Error('QB refresh token expired. Please reconnect QuickBooks.');
    }

    throw new Error(`QB token refresh failed: ${error.message || 'Unknown error'}`);
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
