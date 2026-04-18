// Pure helpers for BackdatedEntries2. Extracted so post-save hydration and GET
// hydration use the same mapping (prevents group-merge corruption where the save
// response uses `customer.id`/`nozzle.id` but onSuccess was reading flat fields).

export interface BackdatedTxn {
  id?: string;
  nozzleId?: string;
  customerId?: string;
  customerName?: string;
  fuelCode: 'HSD' | 'PMG' | 'OTHER' | '';
  vehicleNumber?: string;
  slipNumber?: string;
  productName: string;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
  paymentMethod: 'cash' | 'credit_card' | 'bank_card' | 'pso_card' | 'credit_customer';
  bankId?: string;
  _localStatus?: 'draft' | 'saved';
  createdBy?: string;
  createdByUser?: { id: string; fullName: string; username: string } | null;
  updatedBy?: string;
  updatedByUser?: { id: string; fullName: string; username: string } | null;
  createdAt?: string;
  updatedAt?: string;
}

const toNum = (v: unknown): number => {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') { const p = parseFloat(v); return Number.isFinite(p) ? p : 0; }
  return 0;
};

// Accepts both shapes: the GET daily-summary response (nested `customer`/`nozzle`)
// and the legacy/flat shape. Always produces the local Transaction shape used by
// the grouping logic.
export function mapApiTxnToLocal(txn: any): BackdatedTxn {
  return {
    id: txn.id,
    nozzleId: txn.nozzle?.id ?? txn.nozzleId ?? '',
    customerId: txn.customer?.id ?? txn.customerId ?? '',
    customerName: txn.customer?.name ?? txn.customerName ?? '',
    fuelCode: (txn.fuelCode || '') as BackdatedTxn['fuelCode'],
    vehicleNumber: txn.vehicleNumber || '',
    slipNumber: txn.slipNumber || '',
    productName: txn.productName || '',
    quantity: toNum(txn.quantity).toString(),
    unitPrice: toNum(txn.unitPrice).toFixed(2),
    lineTotal: toNum(txn.lineTotal).toFixed(2),
    paymentMethod: txn.paymentMethod,
    bankId: txn.bankId || '',
    createdBy: txn.createdBy,
    createdByUser: txn.createdByUser ?? null,
    updatedBy: txn.updatedBy,
    updatedByUser: txn.updatedByUser ?? null,
    createdAt: txn.createdAt,
    updatedAt: txn.updatedAt,
  };
}

export interface CustomerGroup {
  customerId: string;
  customerName: string;
  indices: number[];
  transactions: BackdatedTxn[];
  totalLiters: number;
  totalAmount: number;
  firstIndex: number;
}

// Format "YYYY-MM-DD" as "14th January 2026 Successfully Reconciled!" for the
// finalize success dialog header.
export function formatReconciledDateHeader(businessDate: string | null | undefined): string | null {
  if (!businessDate) return null;
  const d = new Date(`${businessDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.getDate();
  const month = d.toLocaleDateString('en-US', { month: 'long' });
  const year = d.getFullYear();
  const suffix =
    day % 100 >= 11 && day % 100 <= 13 ? 'th' :
    day % 10 === 1 ? 'st' :
    day % 10 === 2 ? 'nd' :
    day % 10 === 3 ? 'rd' : 'th';
  return `${day}${suffix} ${month} ${year} Successfully Reconciled!`;
}

// Payments totals for the right-side summary panel. `total` is the grand total
// of all posted rows; `nonFuel` is the subset without a fuel code (or fuelCode
// === 'OTHER'); `fuel` is the remainder (the actual fuel sale for the day).
export function computePaymentSummary(transactions: BackdatedTxn[]): {
  total: number;
  nonFuel: number;
  fuel: number;
} {
  let total = 0;
  let nonFuel = 0;
  for (const t of transactions) {
    const amt = toNum(t.lineTotal);
    total += amt;
    if (!t.fuelCode || t.fuelCode === 'OTHER') nonFuel += amt;
  }
  const round2 = (n: number) => Math.round(n * 100) / 100;
  return {
    total: round2(total),
    nonFuel: round2(nonFuel),
    fuel: round2(total - nonFuel),
  };
}

export function buildCustomerGroups(transactions: BackdatedTxn[]): CustomerGroup[] {
  const grouped = new Map<string, { indices: number[]; txns: BackdatedTxn[] }>();
  transactions.forEach((txn, idx) => {
    const key = txn.customerId || '__walkin__';
    if (!grouped.has(key)) grouped.set(key, { indices: [], txns: [] });
    grouped.get(key)!.indices.push(idx);
    grouped.get(key)!.txns.push(txn);
  });
  return Array.from(grouped.entries())
    .map(([customerId, { indices, txns }]) => ({
      customerId,
      customerName: customerId === '__walkin__' ? 'Walk-in Sales' : (txns[0].customerName || 'Unknown'),
      indices,
      transactions: txns,
      totalLiters: txns.reduce((s, t) => s + toNum(t.quantity), 0),
      totalAmount: txns.reduce((s, t) => s + toNum(t.lineTotal), 0),
      firstIndex: indices[0],
    }))
    .sort((a, b) => b.firstIndex - a.firstIndex);
}
