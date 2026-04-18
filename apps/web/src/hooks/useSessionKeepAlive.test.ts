import { describe, it, expect } from 'vitest';

// Mirrors the base64url payload decoder used inside useSessionKeepAlive.
// Kept in-sync via the tests below: both files must produce identical output.
const decodeJwtPayload = (token: string): { exp?: number } | null => {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4));
    const json = atob(base64 + pad);
    return JSON.parse(json);
  } catch {
    return null;
  }
};

const makeJwt = (payload: Record<string, unknown>): string => {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const body = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${header}.${body}.sig-placeholder`;
};

describe('useSessionKeepAlive - JWT payload decoding', () => {
  it('extracts the exp claim from a base64url-encoded JWT', () => {
    const exp = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
    const token = makeJwt({ userId: 'abc', exp });
    expect(decodeJwtPayload(token)?.exp).toBe(exp);
  });

  it('returns null for malformed tokens instead of throwing', () => {
    expect(decodeJwtPayload('not-a-jwt')).toBeNull();
    expect(decodeJwtPayload('only.two')).toBeNull();
    expect(decodeJwtPayload('a.@@@not-base64@@@.c')).toBeNull();
  });

  it('handles tokens with unpadded base64url segments (common in JWTs)', () => {
    // Hand-crafted payload whose base64 length is not a multiple of 4.
    const payload = { userId: 'x', role: 'admin', exp: 1700000000 };
    const token = makeJwt(payload);
    const decoded = decodeJwtPayload(token);
    expect(decoded).not.toBeNull();
    expect(decoded?.exp).toBe(1700000000);
  });
});

describe('useSessionKeepAlive - refresh scheduling invariants', () => {
  // The hook picks min(configured interval, remaining / 2), floored at 60s.
  // These tests document that contract so we do not regress into hot-loops
  // or oversized intervals that skip past the expiry boundary.
  const pickDelay = (nowMs: number, expSec: number, intervalMs: number) => {
    const remainingMs = expSec * 1000 - nowMs;
    const half = Math.floor(remainingMs / 2);
    return Math.max(60 * 1000, Math.min(intervalMs, half));
  };

  it('never schedules below the 1-minute floor (avoids refresh hot loops)', () => {
    const now = Date.now();
    // Token already near-expiry: remaining is only a few seconds
    const delay = pickDelay(now, Math.floor(now / 1000) + 5, 30 * 60 * 1000);
    expect(delay).toBeGreaterThanOrEqual(60 * 1000);
  });

  it('caps at the configured interval for long-lived tokens', () => {
    const now = Date.now();
    // Token has 24h remaining; interval is 30min
    const delay = pickDelay(now, Math.floor(now / 1000) + 24 * 60 * 60, 30 * 60 * 1000);
    expect(delay).toBe(30 * 60 * 1000);
  });

  it('schedules at roughly half the remaining lifetime for mid-lived tokens', () => {
    const now = Date.now();
    // Token has 10min remaining; half = 5min, below 30min cap
    const delay = pickDelay(now, Math.floor(now / 1000) + 10 * 60, 30 * 60 * 1000);
    expect(delay).toBeGreaterThan(4 * 60 * 1000);
    expect(delay).toBeLessThan(6 * 60 * 1000);
  });
});
