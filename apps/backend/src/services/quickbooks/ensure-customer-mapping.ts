import https from 'https';
import { prisma } from '../../config/database';
import { getValidAccessToken } from './token-refresh';
import { EntityMappingService } from './entity-mapping.service';

// These aliases must be pre-seeded in onboarding; never auto-create them —
// a missing mapping for one of these is a configuration error, not a new
// customer, and silently creating a QB row would mask the real problem.
const RESERVED_CUSTOMER_LOCAL_IDS = new Set([
  'walk-in',
  'bank-card-receivable',
  'pso-card-receivable',
  'hsd-gain-loss',
  'pmg-gain-loss',
]);

export interface EnsureCustomerMappingResult {
  qbId: string;
  source: 'existing_mapping' | 'qb_lookup_match' | 'qb_created';
}

/**
 * Ensures a qb_entity_mappings row exists for a real local customer UUID.
 * Order of resolution:
 *   1. Return existing mapping if present.
 *   2. Search QB by DisplayName; if found, seed mapping → return.
 *   3. Create the customer in QB, seed mapping → return.
 *
 * Returns null (caller should fall back to existing fail-fast behaviour) when:
 *   - localId is a reserved alias
 *   - local customer row doesn't exist
 *   - local customer has no usable name
 *   - org has no active QB connection
 */
export async function ensureCustomerMapping(
  organizationId: string,
  localId: string
): Promise<EnsureCustomerMappingResult | null> {
  if (!localId || RESERVED_CUSTOMER_LOCAL_IDS.has(localId)) return null;

  const existing = await prisma.qBEntityMapping.findFirst({
    where: { organizationId, entityType: 'customer', localId, isActive: true },
    select: { qbId: true },
  });
  if (existing) {
    return { qbId: existing.qbId, source: 'existing_mapping' };
  }

  const customer = await prisma.customer.findFirst({
    where: { id: localId, organizationId },
    select: { id: true, name: true, phone: true, email: true },
  });
  if (!customer || !customer.name || !customer.name.trim()) return null;

  const conn = await prisma.qBConnection.findFirst({
    where: { organizationId, isActive: true },
    select: { realmId: true },
  });
  if (!conn) return null;

  const { accessToken } = await getValidAccessToken(organizationId, prisma);
  const displayName = customer.name.trim();

  const escaped = displayName.replace(/'/g, "''");
  const queryRes = await qbRequest(
    conn.realmId,
    accessToken,
    'GET',
    `/query?query=${encodeURIComponent(`SELECT Id,DisplayName FROM Customer WHERE DisplayName = '${escaped}'`)}&minorversion=65`
  );
  const foundId = queryRes?.QueryResponse?.Customer?.[0]?.Id;
  if (foundId) {
    await EntityMappingService.upsertMapping(organizationId, 'customer', localId, foundId, displayName);
    console.log(`[QB auto-map] Linked "${displayName}" (local ${localId}) → existing QB customer ${foundId}`);
    return { qbId: foundId, source: 'qb_lookup_match' };
  }

  const body: Record<string, unknown> = { DisplayName: displayName };
  if (customer.phone) body.PrimaryPhone = { FreeFormNumber: customer.phone };
  if (customer.email) body.PrimaryEmailAddr = { Address: customer.email };

  const created = await qbRequest(conn.realmId, accessToken, 'POST', '/customer?minorversion=65', body);
  const newQbId = created?.Customer?.Id;
  if (!newQbId) {
    throw new Error(
      `[ensureCustomerMapping] QB customer create returned no Id for "${displayName}": ${JSON.stringify(created)}`
    );
  }

  await EntityMappingService.upsertMapping(organizationId, 'customer', localId, newQbId, displayName);
  console.log(`[QB auto-create] Created QB customer "${displayName}" → Id ${newQbId}`);
  return { qbId: newQbId, source: 'qb_created' };
}

function qbRequest(
  realmId: string,
  accessToken: string,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown
): Promise<any> {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const req = https.request(
      {
        hostname: 'quickbooks.api.intuit.com',
        path: `/v3/company/${realmId}${path}`,
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
          ...(bodyStr
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) }
            : {}),
        },
        timeout: 20000,
      },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          let parsed: any;
          try {
            parsed = JSON.parse(buf);
          } catch {
            parsed = buf;
          }
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`QB API ${method} ${path} → ${res.statusCode}: ${buf}`));
          } else {
            resolve(parsed);
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error(`QB API ${method} ${path} timed out`));
    });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}
