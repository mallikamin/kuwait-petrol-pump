/**
 * OAuth State Token Security (P0)
 * - HMAC-signed state with nonce
 * - Redis TTL for single-use validation
 * - Prevents CSRF and replay attacks
 */

import * as crypto from 'crypto';
import { createClient } from 'redis';

const redis = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
});

redis.connect().catch(console.error);

const STATE_SECRET = process.env.QB_STATE_SECRET || process.env.JWT_SECRET || '';
const STATE_TTL = 600; // 10 minutes

if (!STATE_SECRET) {
  throw new Error('QB_STATE_SECRET or JWT_SECRET required for OAuth state signing');
}

interface StatePayload {
  organizationId: string;
  userId: string;
  nonce: string;
  exp: number;
}

/**
 * Generate signed OAuth state token
 */
export async function generateState(organizationId: string, userId: string): Promise<string> {
  const nonce = crypto.randomBytes(16).toString('hex');
  const exp = Math.floor(Date.now() / 1000) + STATE_TTL;

  const payload: StatePayload = { organizationId, userId, nonce, exp };
  const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString('base64url');

  // HMAC signature
  const hmac = crypto.createHmac('sha256', STATE_SECRET);
  hmac.update(payloadBase64);
  const signature = hmac.digest('base64url');

  const stateToken = `${payloadBase64}.${signature}`;

  // Store nonce in Redis with TTL
  await redis.setEx(`qb:state:${nonce}`, STATE_TTL, '1');

  return stateToken;
}

/**
 * Validate OAuth state token (signature + expiry + single-use nonce)
 */
export async function validateState(stateToken: string): Promise<StatePayload> {
  const parts = stateToken.split('.');
  if (parts.length !== 2) {
    throw new Error('Invalid state token format');
  }

  const [payloadBase64, signature] = parts;

  // Verify HMAC signature
  const hmac = crypto.createHmac('sha256', STATE_SECRET);
  hmac.update(payloadBase64);
  const expectedSignature = hmac.digest('base64url');

  if (signature !== expectedSignature) {
    throw new Error('Invalid state signature');
  }

  // Decode payload
  const payload: StatePayload = JSON.parse(
    Buffer.from(payloadBase64, 'base64url').toString('utf-8')
  );

  // Check expiry
  if (payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('State token expired');
  }

  // Check nonce (single-use)
  const nonceExists = await redis.get(`qb:state:${payload.nonce}`);
  if (!nonceExists) {
    throw new Error('State nonce already used or invalid');
  }

  // Delete nonce (single-use enforcement)
  await redis.del(`qb:state:${payload.nonce}`);

  return payload;
}
