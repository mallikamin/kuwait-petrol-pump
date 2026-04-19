/**
 * Raw HTTPS implementation of Intuit's OAuth2 refresh_token grant.
 *
 * Separated into its own module so tests can mock it cleanly. Do NOT inline
 * this back into token-refresh.ts — the separation is what keeps the unit
 * tests readable (we mock THIS module, not Node's global `https`).
 *
 * Why raw HTTPS instead of intuit-oauth SDK:
 * Empirically proven in prod on 2026-04-19 that intuit-oauth 4.2.2's
 * `OAuthClient.refresh()` fails synchronously (~40ms) with `null` response
 * body and `null` intuit_tid — no HTTP call reaches Intuit. The same refresh
 * token posted via raw HTTPS to oauth.platform.intuit.com returns HTTP 200
 * with fresh tokens + a valid intuit_tid. POS-Project (sister repo) has been
 * running 30+ days on this same raw-HTTPS approach with zero forced reconnects.
 */

import https from 'https';

const INTUIT_TOKEN_HOST = 'oauth.platform.intuit.com';
const INTUIT_TOKEN_PATH = '/oauth2/v1/tokens/bearer';

export interface IntuitTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  x_refresh_token_expires_in: number;
  token_type?: string;
}

export async function refreshTokenViaHttp(refreshToken: string): Promise<IntuitTokenResponse> {
  const clientId = process.env.QUICKBOOKS_CLIENT_ID || '';
  const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET || '';
  const creds = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const body = `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`;

  return new Promise<IntuitTokenResponse>((resolve, reject) => {
    const req = https.request(
      {
        hostname: INTUIT_TOKEN_HOST,
        path: INTUIT_TOKEN_PATH,
        method: 'POST',
        headers: {
          Authorization: `Basic ${creds}`,
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 15000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          let parsed: any = null;
          try {
            parsed = data ? JSON.parse(data) : null;
          } catch {
            parsed = null;
          }

          if (res.statusCode === 200 && parsed?.access_token && parsed?.refresh_token) {
            return resolve(parsed as IntuitTokenResponse);
          }

          // Shape non-2xx/malformed responses like the intuit-oauth SDK so the
          // caller's existing error classifier handles them identically
          // (checks error.authResponse.body.error === 'invalid_grant').
          const err: any = new Error(
            parsed?.error_description || parsed?.error || `Intuit token refresh HTTP ${res.statusCode}`
          );
          err.authResponse = {
            status: res.statusCode,
            body: parsed,
            headers: res.headers,
          };
          reject(err);
        });
      }
    );
    req.on('error', (err: any) => {
      // Network-layer failures — no HTTP response. No authResponse attached →
      // classifier treats as transient. Do NOT force-deactivate on these.
      reject(err);
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Intuit token refresh timeout after 15s'));
    });
    req.write(body);
    req.end();
  });
}
