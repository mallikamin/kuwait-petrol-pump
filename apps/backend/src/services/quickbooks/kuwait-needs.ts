/**
 * Petrol Pump POS Accounting Needs Catalog
 * Fixed list of accounting concepts the POS requires mapped to QuickBooks
 */

export interface AccountingNeed {
  key: string;
  label: string;
  description: string;
  expectedQBTypes: string[];
  expectedQBSubType?: string;
  required: boolean;
  searchHints: string[];
}

/**
 * Master list - every accounting concept the POS needs
 */
export const FUEL_STATION_NEEDS: AccountingNeed[] = [
  // ── INCOME ──────────────────────────────────────────────
  {
    key: 'fuel_income_pmg',
    label: 'PMG Fuel Sales',
    description: 'Premium Motor Gasoline (petrol) sales revenue',
    expectedQBTypes: ['Income', 'Other Income'],
    expectedQBSubType: 'SalesOfProductIncome',
    required: true,
    searchHints: ['pmg', 'premium', 'gasoline', 'petrol', 'fuel sales', 'fuel income'],
  },
  {
    key: 'fuel_income_hsd',
    label: 'HSD Fuel Sales',
    description: 'High Speed Diesel sales revenue',
    expectedQBTypes: ['Income', 'Other Income'],
    expectedQBSubType: 'SalesOfProductIncome',
    required: true,
    searchHints: ['hsd', 'diesel', 'high speed diesel', 'fuel sales', 'fuel income'],
  },
  {
    key: 'nonfuel_income',
    label: 'Non-Fuel Product Sales',
    description: 'Retail products, shop items, accessories',
    expectedQBTypes: ['Income', 'Other Income'],
    expectedQBSubType: 'SalesOfProductIncome',
    required: false,
    searchHints: ['retail', 'shop', 'products', 'merchandise', 'store sales'],
  },

  // ── ASSETS ──────────────────────────────────────────────
  {
    key: 'cash',
    label: 'Cash Account',
    description: 'Physical cash from sales',
    expectedQBTypes: ['Bank', 'Other Current Asset'],
    expectedQBSubType: 'CashOnHand',
    required: true,
    searchHints: ['cash', 'cash on hand', 'petty cash', 'cash drawer', 'till'],
  },
  {
    key: 'bank_card_settlement',
    label: 'Bank Card Settlement',
    description: 'Credit/debit card payment deposits',
    expectedQBTypes: ['Bank'],
    expectedQBSubType: 'Checking',
    required: true,
    searchHints: ['bank', 'card', 'credit card', 'debit card', 'checking', 'current account'],
  },
  {
    key: 'pso_card_settlement',
    label: 'PSO Fleet Card Settlement',
    description: 'PSO fleet/loyalty card settlements',
    expectedQBTypes: ['Bank', 'Other Current Asset'],
    required: false,
    searchHints: ['pso', 'fleet card', 'loyalty card', 'pso card'],
  },
  {
    key: 'credit_customer_receivable',
    label: 'Credit Customer Receivables',
    description: 'Outstanding balances from credit customers',
    expectedQBTypes: ['Accounts Receivable'],
    expectedQBSubType: 'AccountsReceivable',
    required: true,
    searchHints: ['receivable', 'accounts receivable', 'credit', 'ar', 'customer credit'],
  },
  {
    key: 'inventory_asset',
    label: 'Fuel Inventory Asset',
    description: 'Value of fuel stock on hand',
    expectedQBTypes: ['Other Current Assets', 'Other Asset'],
    expectedQBSubType: 'Inventory',
    required: true,
    searchHints: ['inventory', 'fuel stock', 'fuel inventory', 'stock', 'supplies'],
  },

  // ── EXPENSES ────────────────────────────────────────────
  {
    key: 'cogs_fuel',
    label: 'Fuel Cost of Goods Sold',
    description: 'Direct cost of fuel sold',
    expectedQBTypes: ['Cost of Goods Sold'],
    expectedQBSubType: 'SuppliesMaterialsCogs',
    required: true,
    searchHints: ['cogs', 'cost of goods', 'fuel cost', 'cost of sales', 'fuel cogs'],
  },
  {
    key: 'purchases_expense',
    label: 'Fuel Purchases',
    description: 'Fuel purchase from suppliers',
    expectedQBTypes: ['Expense', 'Cost of Goods Sold'],
    required: false,
    searchHints: ['purchases', 'fuel purchase', 'buying', 'procurement'],
  },
  {
    key: 'ap_vendor_control',
    label: 'Accounts Payable',
    description: 'Amounts owed to fuel suppliers',
    expectedQBTypes: ['Accounts Payable'],
    expectedQBSubType: 'AccountsPayable',
    required: false,
    searchHints: ['payable', 'accounts payable', 'vendor', 'ap', 'supplier credit'],
  },

  // ── ADJUSTMENTS ─────────────────────────────────────────
  {
    key: 'fuel_shortage',
    label: 'Fuel Shortage/Overage',
    description: 'Meter reading discrepancies',
    expectedQBTypes: ['Expense', 'Other Expense'],
    expectedQBSubType: 'OtherMiscellaneousExpense',
    required: true,
    searchHints: ['shortage', 'overage', 'variance', 'discrepancy', 'fuel variance'],
  },
];

/**
 * Quick lookup helpers
 */
export const NEEDS_BY_KEY: Record<string, AccountingNeed> = FUEL_STATION_NEEDS.reduce(
  (acc, need) => {
    acc[need.key] = need;
    return acc;
  },
  {} as Record<string, AccountingNeed>
);

export const REQUIRED_NEEDS: AccountingNeed[] = FUEL_STATION_NEEDS.filter((n) => n.required);

export const OPTIONAL_NEEDS: AccountingNeed[] = FUEL_STATION_NEEDS.filter((n) => !n.required);

/**
 * Get all needs as plain objects for API responses
 */
export function getAllNeedsAsDicts(): AccountingNeed[] {
  return FUEL_STATION_NEEDS;
}
