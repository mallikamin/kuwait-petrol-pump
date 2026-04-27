/**
 * Shared helpers for stand-alone QB ops scripts (qb-health-check,
 * qb-seed-discover, ad-hoc audits). The runtime QB workers use the full
 * token-refresh.ts pipeline (with Redis single-flight, audit logging, etc.)
 * — these helpers are deliberately lighter: a script run is short-lived,
 * single-process, and never racing the worker for the same connection
 * because a refresh issued here returns a fresh access token without
 * persisting it (the worker re-refreshes when it next needs one).
 *
 * Centralised so we stop reinventing the same crypto + HTTP glue in every
 * one-off diagnostic.
 */

import * as crypto from 'crypto';
import * as https from 'https';
import { decryptToken } from '../services/quickbooks/encryption';

const QB_OAUTH_HOST = 'oauth.platform.intuit.com';

function qbApiHost(): string {
  return process.env.QUICKBOOKS_ENVIRONMENT === 'production'
    ? 'quickbooks.api.intuit.com'
    : 'sandbox-quickbooks.api.intuit.com';
}

function httpsRequest(opts: https.RequestOptions, body?: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode || 0, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

export interface QBTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  x_refresh_token_expires_in: number;
}

/**
 * Exchange a refresh token for a fresh access token via the Intuit
 * OAuth bearer endpoint. Bypasses the intuit-oauth SDK (4.2.2 has a
 * known bug — see qb_integration_live memory).
 */
export async function refreshAccessToken(refreshToken: string): Promise<QBTokens> {
  const clientId = process.env.QUICKBOOKS_CLIENT_ID;
  const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('QUICKBOOKS_CLIENT_ID / QUICKBOOKS_CLIENT_SECRET not set');
  }
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const body = `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`;
  const res = await httpsRequest(
    {
      hostname: QB_OAUTH_HOST,
      path: '/oauth2/v1/tokens/bearer',
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        'Content-Length': Buffer.byteLength(body).toString(),
      },
    },
    body,
  );
  if (res.status !== 200) {
    throw new Error(`QB token refresh failed ${res.status}: ${res.body}`);
  }
  return JSON.parse(res.body) as QBTokens;
}

/**
 * Fetch a fresh access token for an organisation using its stored
 * encrypted refresh token. Caller passes the qb_connection row.
 */
export async function getFreshAccessToken(connection: { refreshTokenEncrypted: string }): Promise<string> {
  const refresh = decryptToken(connection.refreshTokenEncrypted);
  const tokens = await refreshAccessToken(refresh);
  return tokens.access_token;
}

/**
 * Run a QBO `query` API call. SQL is the QBO subset, e.g.
 *   "SELECT * FROM Account WHERE Active IN (true, false) MAXRESULTS 1000"
 */
export async function qbQuery(
  realmId: string,
  accessToken: string,
  sql: string,
): Promise<any> {
  const path = `/v3/company/${realmId}/query?query=${encodeURIComponent(sql)}&minorversion=65`;
  const res = await httpsRequest({
    hostname: qbApiHost(),
    path,
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });
  if (res.status !== 200) {
    throw new Error(`QB query failed ${res.status}: ${res.body}`);
  }
  return JSON.parse(res.body);
}

/**
 * Pull every entity of a given QB type. QBO caps each page at 1000;
 * we paginate via STARTPOSITION until the server returns fewer rows
 * than requested.
 */
export async function qbListAll(
  realmId: string,
  accessToken: string,
  qbType: string,
  options: { includeInactive?: boolean } = {},
): Promise<any[]> {
  const all: any[] = [];
  const pageSize = 1000;
  let start = 1;
  // QBO filter for soft-deleted rows: Active IN (true,false). Without it,
  // inactive entities are hidden — and that's exactly what bit us with the
  // deleted loss-expense accounts.
  const where = options.includeInactive ? ` WHERE Active IN (true, false)` : '';
  while (true) {
    const sql = `SELECT * FROM ${qbType}${where} STARTPOSITION ${start} MAXRESULTS ${pageSize}`;
    const data = await qbQuery(realmId, accessToken, sql);
    const rows: any[] = (data.QueryResponse && data.QueryResponse[qbType]) || [];
    all.push(...rows);
    if (rows.length < pageSize) break;
    start += pageSize;
  }
  return all;
}

/**
 * Post a JSON message to a webhook (Slack-style {text}, Discord-compatible).
 * Fails closed: webhook errors don't bring the calling script down.
 */
export async function postWebhookAlert(text: string): Promise<void> {
  const url = process.env.QB_ALERT_WEBHOOK_URL;
  if (!url) return;
  try {
    const u = new URL(url);
    const body = JSON.stringify({ text });
    await httpsRequest(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body).toString(),
        },
      },
      body,
    );
  } catch (err: any) {
    console.error(`[webhook] failed: ${err?.message || err}`);
  }
}

export function parseFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return undefined;
  return args[i + 1];
}

export function hasFlag(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}
