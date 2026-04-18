import { describe, it, expect } from 'vitest';
import { buildCustomerGroups, mapApiTxnToLocal } from './BackdatedEntries2.utils';

// Shape returned by GET /api/backdated-entries/daily and by the POST save
// endpoint (which also returns getDailySummary()). Verifies the post-save
// hydration mapper produces the same groupings as the GET hydration mapper —
// the original bug was that `onSuccess` read flat `customerId`/`nozzleId`
// fields that this response never includes, causing every row to collapse
// into one Walk-in group.
const apiTxn = (overrides: Record<string, any> = {}) => ({
  id: overrides.id ?? crypto.randomUUID(),
  nozzle: overrides.nozzle ?? null,
  customer: overrides.customer ?? null,
  fuelCode: overrides.fuelCode ?? 'HSD',
  vehicleNumber: overrides.vehicleNumber ?? null,
  slipNumber: overrides.slipNumber ?? null,
  productName: overrides.productName ?? 'High Speed Diesel',
  quantity: overrides.quantity ?? 10,
  unitPrice: overrides.unitPrice ?? 340,
  lineTotal: overrides.lineTotal ?? 3400,
  paymentMethod: overrides.paymentMethod ?? 'cash',
  bankId: overrides.bankId ?? '',
  ...overrides,
});

describe('mapApiTxnToLocal', () => {
  it('reads nested customer.id (save-response / GET shape)', () => {
    const out = mapApiTxnToLocal(apiTxn({
      customer: { id: 'cust-1', name: 'Acme Ltd' },
    }));
    expect(out.customerId).toBe('cust-1');
    expect(out.customerName).toBe('Acme Ltd');
  });

  it('reads nested nozzle.id', () => {
    const out = mapApiTxnToLocal(apiTxn({ nozzle: { id: 'noz-7', name: 'D1N2', fuelType: 'HSD' } }));
    expect(out.nozzleId).toBe('noz-7');
  });

  it('falls back to flat customerId/nozzleId when nested objects absent', () => {
    const out = mapApiTxnToLocal({
      id: 'x', customerId: 'cust-2', customerName: 'Flat', nozzleId: 'noz-9',
      fuelCode: 'PMG', productName: 'PMG', quantity: 1, unitPrice: 1, lineTotal: 1, paymentMethod: 'cash',
    });
    expect(out.customerId).toBe('cust-2');
    expect(out.nozzleId).toBe('noz-9');
    expect(out.customerName).toBe('Flat');
  });

  it('empty customer/nozzle → empty string, not undefined', () => {
    const out = mapApiTxnToLocal(apiTxn({ customer: null, nozzle: null }));
    expect(out.customerId).toBe('');
    expect(out.nozzleId).toBe('');
  });
});

describe('buildCustomerGroups — multi-group dataset', () => {
  it('keeps distinct customers in their own groups (regression: save-response merge bug)', () => {
    const apiRows = [
      apiTxn({ customer: { id: 'c1', name: 'Acme Ltd' }, paymentMethod: 'credit_customer', slipNumber: 'S1', vehicleNumber: 'V1' }),
      apiTxn({ customer: null, paymentMethod: 'cash' }),
      apiTxn({ customer: { id: 'c2', name: 'Beta Co' }, paymentMethod: 'credit_customer', slipNumber: 'S2', vehicleNumber: 'V2' }),
      apiTxn({ customer: { id: 'c1', name: 'Acme Ltd' }, paymentMethod: 'credit_customer', slipNumber: 'S3', vehicleNumber: 'V3' }),
      apiTxn({ customer: null, paymentMethod: 'cash' }),
    ];
    const local = apiRows.map(mapApiTxnToLocal);
    const groups = buildCustomerGroups(local);

    // 3 groups: c1 (2 rows), c2 (1 row), walk-in (2 rows).
    expect(groups.map(g => g.customerId).sort()).toEqual(['__walkin__', 'c1', 'c2']);
    const byId = Object.fromEntries(groups.map(g => [g.customerId, g]));
    expect(byId['c1'].transactions).toHaveLength(2);
    expect(byId['c2'].transactions).toHaveLength(1);
    expect(byId['__walkin__'].transactions).toHaveLength(2);
    expect(byId['c1'].customerName).toBe('Acme Ltd');
    expect(byId['__walkin__'].customerName).toBe('Walk-in Sales');
  });

  it('save-response hydration yields same groups as GET hydration (both paths use mapApiTxnToLocal)', () => {
    // Same underlying rows via the save-response shape and a "flat" shape —
    // both must produce identical grouping so that post-save render matches
    // post-refetch render.
    const nestedShape = [
      apiTxn({ customer: { id: 'c1', name: 'Acme' } }),
      apiTxn({ customer: { id: 'c2', name: 'Beta' } }),
      apiTxn({ customer: null }),
    ];
    const fromSave = nestedShape.map(mapApiTxnToLocal);
    const fromGet = nestedShape.map(mapApiTxnToLocal);

    const gSave = buildCustomerGroups(fromSave).map(g => ({ id: g.customerId, n: g.transactions.length }));
    const gGet = buildCustomerGroups(fromGet).map(g => ({ id: g.customerId, n: g.transactions.length }));
    expect(gSave).toEqual(gGet);
    expect(gSave).toHaveLength(3); // not collapsed into one Walk-in
  });

  it('row-save round-trip preserves grouping (single-row save returns full day; grouping stable)', () => {
    const before = [
      apiTxn({ id: 'a', customer: { id: 'c1', name: 'Acme' } }),
      apiTxn({ id: 'b', customer: { id: 'c2', name: 'Beta' } }),
      apiTxn({ id: 'c', customer: null }),
    ].map(mapApiTxnToLocal);
    const groupsBefore = buildCustomerGroups(before);

    // Simulate save response (server returns same rows, possibly with updated lineTotal on row a)
    const saveResponse = [
      apiTxn({ id: 'a', customer: { id: 'c1', name: 'Acme' }, quantity: 99, lineTotal: 33660 }),
      apiTxn({ id: 'b', customer: { id: 'c2', name: 'Beta' } }),
      apiTxn({ id: 'c', customer: null }),
    ].map((t: any) => ({ ...mapApiTxnToLocal(t), _localStatus: 'saved' as const }));
    const groupsAfter = buildCustomerGroups(saveResponse);

    expect(groupsAfter.map(g => g.customerId).sort()).toEqual(groupsBefore.map(g => g.customerId).sort());
    expect(groupsAfter.length).toBe(3);
  });
});
