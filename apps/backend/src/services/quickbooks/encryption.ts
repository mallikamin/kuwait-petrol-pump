/**
 * QuickBooks Token Encryption Service
 *
 * Rule 7: Secrets/security hardening
 * - AES-256-GCM encryption for tokens at rest
 * - Key rotation support
 * - Redaction for logs
 */

import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // bytes
const AUTH_TAG_LENGTH = 16; // bytes
const KEY_LENGTH = 32; // bytes for AES-256

/**
 * Get encryption key from environment
 *
 * MUST be 32 bytes (64 hex chars or 44 base64 chars)
 */
function getEncryptionKey(): Buffer {
  const keyString = process.env.QB_TOKEN_ENCRYPTION_KEY;

  if (!keyString) {
    throw new Error(
      'QB_TOKEN_ENCRYPTION_KEY not set in environment. Generate with: openssl rand -base64 32'
    );
  }

  // Try base64 first
  let key: Buffer;
  try {
    key = Buffer.from(keyString, 'base64');
  } catch {
    // Try hex
    key = Buffer.from(keyString, 'hex');
  }

  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `QB_TOKEN_ENCRYPTION_KEY must be ${KEY_LENGTH} bytes (current: ${key.length} bytes)`
    );
  }

  return key;
}

/**
 * Encrypt a QuickBooks token (access or refresh token)
 *
 * Returns format: {iv}:{authTag}:{encryptedData}
 * All parts are hex-encoded
 */
export function encryptToken(token: string): string {
  if (!token) {
    throw new Error('Cannot encrypt empty token');
  }

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(token, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:encrypted
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt a QuickBooks token
 *
 * Expects format: {iv}:{authTag}:{encryptedData}
 */
export function decryptToken(encryptedToken: string): string {
  if (!encryptedToken) {
    throw new Error('Cannot decrypt empty token');
  }

  const parts = encryptedToken.split(':');

  if (parts.length !== 3) {
    throw new Error(
      'Invalid encrypted token format. Expected format: {iv}:{authTag}:{encrypted}'
    );
  }

  const [ivHex, authTagHex, encrypted] = parts;

  const key = getEncryptionKey();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Redact token for logging (show only first/last 4 chars)
 *
 * Example: "eyJhbGciOiJIUzI1..." -> "eyJh...UzI1"
 */
export function redactToken(token: string): string {
  if (!token || token.length <= 8) {
    return '[REDACTED]';
  }

  return `${token.substring(0, 4)}...${token.substring(token.length - 4)}`;
}

/**
 * Redact sensitive data in objects for logging
 *
 * Recursively redacts fields like: token, password, secret, key, authorization
 */
export function redactSensitiveData(obj: any): any {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => redactSensitiveData(item));
  }

  const redacted: any = {};
  const sensitiveKeys = [
    'token',
    'access_token',
    'refresh_token',
    'password',
    'secret',
    'key',
    'authorization',
    'bearer',
    'api_key',
    'apikey'
  ];

  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();

    if (sensitiveKeys.some(sk => lowerKey.includes(sk))) {
      redacted[key] = '[REDACTED]';
    } else if (typeof value === 'object') {
      redacted[key] = redactSensitiveData(value);
    } else {
      redacted[key] = value;
    }
  }

  return redacted;
}

/**
 * Redact HTTP headers for logging
 */
export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const redacted: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();

    if (
      lowerKey.includes('authorization') ||
      lowerKey.includes('cookie') ||
      lowerKey.includes('token')
    ) {
      redacted[key] = '[REDACTED]';
    } else {
      redacted[key] = value;
    }
  }

  return redacted;
}

/**
 * Rotate encryption key (re-encrypt all tokens with new key)
 *
 * Process:
 * 1. Set QB_TOKEN_ENCRYPTION_KEY_NEW in environment
 * 2. Call this function
 * 3. Swap: QB_TOKEN_ENCRYPTION_KEY = QB_TOKEN_ENCRYPTION_KEY_NEW
 * 4. Remove QB_TOKEN_ENCRYPTION_KEY_NEW
 */
export async function rotateEncryptionKey(
  prisma: any,
  newKey: string
): Promise<number> {
  console.log('🔄 Starting encryption key rotation...');

  // Temporarily override env with new key for encryption
  const originalKey = process.env.QB_TOKEN_ENCRYPTION_KEY;
  const originalKeyBuffer = getEncryptionKey();

  // Get all connections
  const connections = await prisma.qBConnection.findMany({
    where: {
      accessTokenEncrypted: { not: null }
    },
    select: {
      id: true,
      accessTokenEncrypted: true,
      refreshTokenEncrypted: true
    }
  });

  let rotated = 0;

  for (const conn of connections) {
    try {
      // Decrypt with old key
      const accessToken = conn.accessTokenEncrypted
        ? decryptToken(conn.accessTokenEncrypted)
        : null;
      const refreshToken = conn.refreshTokenEncrypted
        ? decryptToken(conn.refreshTokenEncrypted)
        : null;

      // Override env with new key
      process.env.QB_TOKEN_ENCRYPTION_KEY = newKey;

      // Re-encrypt with new key
      const newAccessToken = accessToken ? encryptToken(accessToken) : null;
      const newRefreshToken = refreshToken ? encryptToken(refreshToken) : null;

      // Restore original key
      process.env.QB_TOKEN_ENCRYPTION_KEY = originalKey;

      // Update database
      await prisma.qBConnection.update({
        where: { id: conn.id },
        data: {
          accessTokenEncrypted: newAccessToken,
          refreshTokenEncrypted: newRefreshToken
        }
      });

      rotated++;
    } catch (error) {
      console.error(`❌ Failed to rotate key for connection ${conn.id}:`, error);
      // Restore original key and abort
      process.env.QB_TOKEN_ENCRYPTION_KEY = originalKey;
      throw error;
    }
  }

  // Restore original key
  process.env.QB_TOKEN_ENCRYPTION_KEY = originalKey;

  console.log(`✅ Rotated encryption key for ${rotated} connections`);

  return rotated;
}

/**
 * Verify encryption/decryption works correctly
 *
 * Use for testing after key rotation
 */
export function testEncryption(): boolean {
  const testToken = 'test-token-123456789';

  try {
    const encrypted = encryptToken(testToken);
    const decrypted = decryptToken(encrypted);

    if (decrypted !== testToken) {
      console.error('❌ Encryption test failed: decrypted value does not match');
      return false;
    }

    console.log('✅ Encryption test passed');
    return true;
  } catch (error) {
    console.error('❌ Encryption test failed:', error);
    return false;
  }
}

/**
 * Generate a new encryption key
 *
 * Returns base64-encoded 32-byte key
 */
export function generateEncryptionKey(): string {
  const key = crypto.randomBytes(KEY_LENGTH);
  return key.toString('base64');
}
