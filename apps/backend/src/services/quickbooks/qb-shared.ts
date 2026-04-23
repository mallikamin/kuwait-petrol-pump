/**
 * Shared helpers for QuickBooks POS→QB sync.
 *
 * Centralises: QB API URL, payment-method alias normalization, payment-class
 * routing (cash vs AR), and customer resolution for each sale flavour.
 *
 * Mapping `localId` conventions used across handlers (must mirror admin UI):
 *   entityType='customer'        localId='walk-in'                     → QB "walk in customer" (S1..S3)
 *   entityType='customer'        localId='bank-card-receivable'        → QB "Bank Card Receiveable" (S4..S6 card path)
 *   entityType='customer'        localId='pso-card-receivable'         → QB "PSO Card Receivables" (S7)
 *   entityType='customer'        localId='hsd-gain-loss'               → QB "HSD gain/loss" (S11, Phase 2)
 *   entityType='customer'        localId='pmg-gain-loss'               → QB "PMG gain/loss" (S11, Phase 2)
 *   entityType='customer'        localId=<customer.id UUID>            → real credit customer (S4..S6 AR)
 *   entityType='payment_method'  localId='cash' | 'credit_card' | 'bank_card' | 'pso_card' | 'credit_customer'
 *   entityType='item'            localId=<fuelTypeId UUID> or 'HSD'/'PMG' or <product.id>
 *   entityType='item'            localId='tax'
 *   entityType='bank'            localId=<bank.id UUID>                → QB bank account for SalesReceipt.DepositToAccount
 *   entityType='bank_account'    localId='cash' | 'default_checking' | <bank.id> → for BillPayment + ReceivePayment deposit
 *   entityType='vendor'          localId=<supplier.id UUID>
 */

const QB_SANDBOX_API = 'https://sandbox-quickbooks.api.intuit.com';
const QB_PRODUCTION_API = 'https://quickbooks.api.intuit.com';

export function getQuickBooksApiUrl(_realmId: string): string {
  const env = process.env.QUICKBOOKS_ENVIRONMENT || 'sandbox';
  return env === 'production' ? QB_PRODUCTION_API : QB_SANDBOX_API;
}

/**
 * Canonical payment-method codes used everywhere downstream.
 * POS/legacy aliases (e.g. 'CASH', 'card', 'credit', 'pso', 'bank-card')
 * normalize to one of these five values before any mapping lookup.
 */
export type PaymentMethod =
  | 'cash'
  | 'credit_card'
  | 'bank_card'
  | 'pso_card'
  | 'credit_customer';

const ALIAS_MAP: Record<string, PaymentMethod> = {
  // cash
  cash: 'cash',
  // "credit" alone is the legacy sales-form label for the credit-customer
  // (AR) flow — not a credit card. Credit cards use 'credit_card'/'card'.
  credit: 'credit_customer',
  // generic card aliases — conservative default to 'credit_card' for legacy
  card: 'credit_card',
  credit_card: 'credit_card',
  creditcard: 'credit_card',
  'credit-card': 'credit_card',
  debit: 'credit_card',
  // bank / POS debit card
  bank_card: 'bank_card',
  bankcard: 'bank_card',
  'bank-card': 'bank_card',
  // PSO fleet card
  pso: 'pso_card',
  pso_card: 'pso_card',
  psocard: 'pso_card',
  'pso-card': 'pso_card',
  fleet: 'pso_card',
  fleet_card: 'pso_card',
  // credit customer (AR)
  credit_customer: 'credit_customer',
  creditcustomer: 'credit_customer',
  'credit-customer': 'credit_customer',
  ar: 'credit_customer',
  account: 'credit_customer',
};

export function normalizePaymentMethod(raw: string | undefined | null): PaymentMethod {
  const key = (raw || '').trim().toLowerCase();
  const canonical = ALIAS_MAP[key];
  if (!canonical) {
    throw new Error(
      `Unknown paymentMethod "${raw}". Expected one of: cash, credit_card, bank_card, pso_card, credit_customer ` +
      `(or a known alias). Add a canonical entry in qb-shared.ts ALIAS_MAP if a new channel is introduced.`
    );
  }
  return canonical;
}

/**
 * Does this payment method post as a cash SalesReceipt (S1..S3)?
 * Everything else is AR and posts as an Invoice (S4..S7).
 */
export function isCashSale(method: PaymentMethod): boolean {
  return method === 'cash';
}

/**
 * For SalesReceipt deposit routing. Cash deposits to the mapped cash account
 * (cash_in_hand); card deposits route through the mapped bank for the card.
 */
export function isCardSale(method: PaymentMethod): boolean {
  return method === 'credit_card' || method === 'bank_card';
}

/**
 * Returns the canonical localId for the QB PaymentMethodRef lookup.
 *
 * QB's PaymentMethod is a single entity describing "how the money moves"
 * (Cash / Credit Card / Cheque). POS-side distinctions between
 * `credit_card`, `bank_card`, and `pso_card` exist for AR customer routing
 * (different receivable sub-ledgers) but collapse to "Credit Card" (QB id 4)
 * at the QB PaymentMethod layer per workbook S1–S8.
 *
 * Keeping this as a code-level collapse — rather than three DB rows all
 * pointing at qb_id 4 — respects the `(org, entity_type, qb_id)` uniqueness
 * constraint on qb_entity_mappings, which is required for reverse lookups
 * (`EntityMappingService.getLocalId` / `checkIfMapped`).
 */
export function paymentMethodLocalId(method: PaymentMethod): string {
  if (method === 'bank_card' || method === 'pso_card') return 'credit_card';
  return method;
}

/**
 * For Invoice customer routing:
 *   - credit_customer → real customer UUID (payload.customerId)
 *   - bank_card / credit_card → 'bank-card-receivable' (S4..S6 "bank becomes the customer")
 *   - pso_card            → 'pso-card-receivable' (S7)
 *
 * The caller must supply the POS customerId for credit_customer; returning
 * the resolved localId keeps the customer-mapping lookup consistent.
 */
export function invoiceCustomerLocalId(
  method: PaymentMethod,
  customerId: string | undefined,
): string {
  if (method === 'credit_customer') {
    if (!customerId) {
      throw new Error(
        'credit_customer sale requires customerId on the payload (cannot route AR to walk-in).'
      );
    }
    return customerId;
  }
  if (method === 'bank_card' || method === 'credit_card') return 'bank-card-receivable';
  if (method === 'pso_card') return 'pso-card-receivable';
  throw new Error(`invoiceCustomerLocalId called with non-AR method: ${method}`);
}

/**
 * Resolve the QB Item id for a sale / purchase line.
 *
 * Three resolution paths in priority order:
 *   1. rawLocalId is a non-fuel product UUID AND that product has a
 *      qb_item_id set → return that QB id DIRECTLY (skipping the mapping
 *      service). This keeps QB's Product/Service column aligned with the
 *      local product name. Added 2026-04-23 after the "Oil Filter 333"
 *      bug where every non-fuel sale collapsed to QB item 82.
 *   2. rawLocalId is a non-fuel product UUID WITHOUT qb_item_id → fall
 *      back to the 'non-fuel-item' alias via the mapping service (legacy
 *      behaviour from the 2026-04-19 "one bucket" decision).
 *   3. Anything else (fuel-type UUIDs, 'tax', etc.) → resolve via the
 *      mapping service using rawLocalId as the localId.
 *
 * Returns `{ qbItemId }` when the item is already resolved to a concrete
 * QB id; `{ localId }` when the handler still has to call
 * EntityMappingService.getQbId().
 *
 * Shared between fuel-sale (S1..S7) and purchase (S10) handlers.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function resolveItemMapping(
  prismaClient: { product: { findFirst: (args: any) => Promise<{ id: string; qbItemId: string | null } | null> } },
  rawLocalId: string,
): Promise<{ qbItemId: string } | { localId: string }> {
  // Static aliases ('non-fuel-item', 'tax', etc.) and fuel-type UUIDs that
  // won't exist in `products` skip the product lookup entirely. Without this
  // guard, Prisma rejects non-UUID strings against the UUID-typed product.id
  // column ("Error creating UUID, invalid character") — the failure mode
  // that took down the PSO-card credit-receipt path on 2026-04-23.
  if (!UUID_RE.test(rawLocalId)) return { localId: rawLocalId };
  const product = await prismaClient.product.findFirst({
    where: { id: rawLocalId },
    select: { id: true, qbItemId: true },
  });
  if (product?.qbItemId) return { qbItemId: product.qbItemId };
  if (product) return { localId: 'non-fuel-item' };
  return { localId: rawLocalId };
}

/**
 * Legacy wrapper — returns the localId that would have been produced by the
 * old single-bucket logic. Kept for callers that haven't been migrated to
 * resolveItemMapping yet. Do NOT use on new code; prefer resolveItemMapping.
 */
export async function resolveItemLocalId(
  prismaClient: { product: { findFirst: (args: any) => Promise<{ id: string } | null> } },
  rawLocalId: string,
): Promise<string> {
  const product = await prismaClient.product.findFirst({
    where: { id: rawLocalId },
    select: { id: true },
  });
  return product ? 'non-fuel-item' : rawLocalId;
}
