/**
 * QB Mapping Manifest — single source of truth for the canonical
 * (entity_type, local_id) → QB entity contract used across all orgs.
 *
 * This was extracted from the live kpc Demo QB realm (post-2026-04-27
 * loss-account restructure) so it reflects the current production
 * baseline. New tenants (SE next) get the SAME local_ids; the QB IDs
 * are auto-discovered against their realm by qb-seed-discover.ts and
 * the entries are upserted into qb_entity_mappings.
 *
 * Adding a new mapping:
 *   1. Add a static entry below with at least one strong name pattern.
 *   2. Run qb-seed-discover --org <code> --apply to upsert.
 *   3. If the discovery fails with "no match", confirm the QB COA has
 *      the entity and adjust the namePatterns regex.
 *
 * Patterns are CASE-INSENSITIVE substring matches against:
 *   Account/Item        → Name
 *   Customer/Vendor     → DisplayName
 *   PaymentMethod       → Name
 *   bank_account        → Account.Name (filtered to AccountType='Bank')
 */

export type ManifestEntityType =
  | 'customer'
  | 'account'
  | 'bank_account'
  | 'payment_method'
  | 'vendor';

export interface StaticManifestEntry {
  entityType: ManifestEntityType;
  localId: string;
  /** QB entity name. For bank_account this is still 'Account' (filtered downstream). */
  qbEntity: 'Customer' | 'Account' | 'PaymentMethod' | 'Vendor';
  /**
   * Case-insensitive substring patterns. Matched against:
   *   Customer/Vendor → DisplayName
   *   Account/PaymentMethod → Name
   * The first single-result pattern wins. Order from most specific to
   * most permissive so we don't false-match on a generic word.
   */
  namePatterns: string[];
  /** Optional QBO AccountType filter — used for bank_account.cash and similar. */
  accountTypeFilter?: string;
  /** Optional human note for ops. */
  notes?: string;
}

/**
 * Static mappings — same local_id across every org.
 * QB IDs intentionally NOT stored here; they're discovered per-realm.
 */
export const STATIC_MANIFEST: StaticManifestEntry[] = [
  // ── Customers (sub-ledgers used by sales / receipts / settlements) ──────
  {
    entityType: 'customer',
    localId: 'walk-in',
    qbEntity: 'Customer',
    namePatterns: ['walk in customer', 'walk-in customer', 'walk in', 'walk-in', 'cash customer'],
    notes: 'Walk-in/cash sales SalesReceipt customer (S1-S3)',
  },
  {
    entityType: 'customer',
    localId: 'bank-card-receivable',
    qbEntity: 'Customer',
    namePatterns: ['bank card receivable', 'bank card receiveable'],
    notes: 'AR sub-ledger for credit/debit card swipes pending bank payout (S4 card / S6)',
  },
  {
    entityType: 'customer',
    localId: 'pso-card-receivable',
    qbEntity: 'Customer',
    namePatterns: ['pso card receivables', 'pso card receivable', 'pso card'],
    notes: 'AR sub-ledger for PSO fleet card swipes (S7); also used by S8C JE settlement',
  },
  {
    entityType: 'customer',
    localId: 'hsd-gain-loss',
    qbEntity: 'Customer',
    namePatterns: ['hsd gain/loss', 'hsd gain loss'],
    notes: 'Reserved sub-ledger for HSD dip variance (S11) — currently unused; JE handler uses Account legs',
  },
  {
    entityType: 'customer',
    localId: 'pmg-gain-loss',
    qbEntity: 'Customer',
    namePatterns: ['pmg gain/loss', 'pmg gain loss'],
    notes: 'Reserved sub-ledger for PMG dip variance (S11) — currently unused; JE handler uses Account legs',
  },

  // ── Accounts (S11 dip-variance JE legs) ─────────────────────────────────
  {
    entityType: 'account',
    localId: 'inventory-asset',
    qbEntity: 'Account',
    namePatterns: ['inventory asset'],
    notes: 'Shared between HSD/PMG; dip-variance JE Dr (gain) / Cr (loss)',
  },
  {
    entityType: 'account',
    localId: 'hsd-gain-income',
    qbEntity: 'Account',
    namePatterns: ['hsd normal volume gain', 'hsd gain'],
    notes: 'Other Income / OtherMiscellaneousIncome',
  },
  {
    entityType: 'account',
    localId: 'pmg-gain-income',
    qbEntity: 'Account',
    namePatterns: ['pmg normal volume gain', 'pmg gain'],
    notes: 'Other Income / OtherMiscellaneousIncome',
  },
  {
    entityType: 'account',
    localId: 'hsd-loss-expense',
    qbEntity: 'Account',
    namePatterns: ['hsd normal volume loss', 'hsd volume normal loss', 'hsd loss'],
    notes: 'Other Expense / OtherMiscellaneousExpense (kpc moved here from COGS on 2026-04-24)',
  },
  {
    entityType: 'account',
    localId: 'pmg-loss-expense',
    qbEntity: 'Account',
    namePatterns: ['pmg normal volume loss', 'pmg volume normal loss', 'pmg loss'],
    notes: 'Other Expense / OtherMiscellaneousExpense (kpc moved here from COGS on 2026-04-24)',
  },

  // ── Bank accounts (deposit routing for sales receipts + AR payments) ────
  {
    entityType: 'bank_account',
    localId: 'cash',
    qbEntity: 'Account',
    accountTypeFilter: 'Bank',
    namePatterns: ['cash in hand', 'cash on hand', 'petty cash', 'cash'],
    notes: 'Cash drawer; targets the QB Bank-typed Cash account',
  },

  // ── Payment methods ─────────────────────────────────────────────────────
  // PSO is intentionally NOT a PaymentMethod — it's a Customer sub-ledger
  // (see customer.pso-card-receivable above). The POS-side `pso_card`
  // payment type collapses to credit_card via paymentMethodLocalId() in
  // qb-shared.ts, so the runtime never resolves a `pso_card` PaymentMethod.
  {
    entityType: 'payment_method',
    localId: 'cash',
    qbEntity: 'PaymentMethod',
    namePatterns: ['cash'],
  },
  {
    entityType: 'payment_method',
    localId: 'credit_card',
    qbEntity: 'PaymentMethod',
    namePatterns: ['credit card', 'card'],
    notes: 'All card swipes (bank_card / pso_card) collapse here at lookup time',
  },
  {
    entityType: 'payment_method',
    localId: 'credit_customer',
    qbEntity: 'PaymentMethod',
    namePatterns: ['cheque', 'check'],
    notes: 'AR / credit-customer settlement fallback PaymentMethod',
  },
];

/**
 * Dynamic mapping descriptors — these aren't static local_ids; they're
 * one-mapping-per-row from the local DB tables (banks, customers,
 * fuel_types). Discovery walks each row and matches its name against
 * QB entities. Listed here for documentation; the discovery script
 * special-cases each.
 */
export const DYNAMIC_MAPPING_DESCRIPTORS = [
  {
    sourceTable: 'fuel_types',
    entityType: 'item' as const,
    qbEntity: 'Item' as const,
    matchField: 'code', // HSD / PMG → QB Item Name
    notes: 'POS handlers pass FuelType.id as item localId; QB Item Name typically matches code',
  },
  {
    sourceTable: 'banks',
    entityType: 'bank_account' as const,
    qbEntity: 'Account' as const,
    accountTypeFilter: 'Bank',
    matchField: 'name',
    notes: 'One mapping per local bank row; bank_account local_id = bank.id',
  },
  {
    sourceTable: 'customers',
    entityType: 'customer' as const,
    qbEntity: 'Customer' as const,
    matchField: 'name',
    filter: { creditLimitNotNull: true },
    notes: 'One mapping per credit customer (creditLimit IS NOT NULL); customer.local_id = customer.id',
  },
];
