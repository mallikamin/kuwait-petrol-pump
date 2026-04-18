import { describe, it, expect } from 'vitest';
import { buildProductMovementCSV, type ProductMovementRow, type ProductMovementCSVMeta } from './Reports.inventory.utils';

const makeRow = (over: Partial<ProductMovementRow> = {}): ProductMovementRow => ({
  productId: 'prod-1',
  productName: 'Filter A',
  productType: 'non_fuel',
  unit: 'units',
  purchasedQty: 0,
  soldQty: 0,
  netMovement: 0,
  purchasedValue: 0,
  soldValue: 0,
  ...over,
});

const baseMeta = (over: Partial<ProductMovementCSVMeta> = {}): ProductMovementCSVMeta => ({
  branchName: 'Main Branch',
  startDate: '2026-01-01',
  endDate: '2026-04-18',
  category: 'all',
  productLabel: 'All products',
  generatedAt: new Date('2026-04-18T01:00:00.000Z'),
  ...over,
});

describe('buildProductMovementCSV', () => {
  it('emits metadata block then header then rows', () => {
    const csv = buildProductMovementCSV(
      [makeRow({ productName: 'Filter A', purchasedQty: 50, soldQty: 10, netMovement: 40, purchasedValue: 5000, soldValue: 1500 })],
      baseMeta(),
    );
    const lines = csv.split('\n');
    expect(lines[0]).toBe('"Inventory — Product-Wise Movement"');
    expect(lines[1]).toBe('"Branch","Main Branch"');
    expect(lines[2]).toBe('"Date Range","2026-01-01","to","2026-04-18"');
    expect(lines[3]).toBe('"Category","All"');
    expect(lines[4]).toBe('"Product","All products"');
    expect(lines[5]).toBe('"Generated At","2026-04-18T01:00:00.000Z"');
    expect(lines[6]).toBe(''); // blank separator
    expect(lines[7]).toBe('"Product","Type","Unit","Purchased","Sold","Net Movement","Purchased Value","Sold Value"');
    expect(lines[8]).toBe('"Filter A","Non-Fuel","units",50,10,40,5000,1500');
  });

  it('reflects applied filters in metadata block', () => {
    const csv = buildProductMovementCSV(
      [makeRow({ productType: 'HSD', productName: 'High Speed Diesel', unit: 'L', purchasedQty: 1000, soldQty: 200, netMovement: 800 })],
      baseMeta({ category: 'HSD', productLabel: 'High Speed Diesel' }),
    );
    expect(csv).toContain('"Category","HSD"');
    expect(csv).toContain('"Product","High Speed Diesel"');
    expect(csv).toContain('"High Speed Diesel","HSD","L",1000,200,800');
  });

  it('escapes commas and quotes inside product names', () => {
    const csv = buildProductMovementCSV(
      [makeRow({ productName: 'Filter "A", premium' })],
      baseMeta(),
    );
    // " inside the value must be doubled (CSV standard) and the whole field quoted.
    expect(csv).toContain('"Filter ""A"", premium"');
  });

  it('handles empty row set (header still present)', () => {
    const csv = buildProductMovementCSV([], baseMeta());
    const lines = csv.split('\n');
    // 6 metadata lines + 1 blank + 1 header = 8 lines, no data rows
    expect(lines).toHaveLength(8);
    expect(lines[7]).toBe('"Product","Type","Unit","Purchased","Sold","Net Movement","Purchased Value","Sold Value"');
  });

  it('renders Non-Fuel category label as "Non-Fuel" not "non_fuel"', () => {
    const csv = buildProductMovementCSV([], baseMeta({ category: 'non_fuel' }));
    expect(csv).toContain('"Category","Non-Fuel"');
  });

  it('renders Total Fuel category label as "Total Fuel" not "total_fuel"', () => {
    const csv = buildProductMovementCSV(
      [
        makeRow({ productType: 'HSD', productName: 'High Speed Diesel', unit: 'L', purchasedQty: 1000, soldQty: 200, netMovement: 800 }),
        makeRow({ productType: 'PMG', productName: 'Premium Motor Gasoline', unit: 'L', purchasedQty: 500, soldQty: 50, netMovement: 450, productId: 'PMG' }),
      ],
      baseMeta({ category: 'total_fuel', productLabel: 'All products' }),
    );
    expect(csv).toContain('"Category","Total Fuel"');
    expect(csv).toContain('"High Speed Diesel","HSD","L",1000,200,800');
    expect(csv).toContain('"Premium Motor Gasoline","PMG","L",500,50,450');
  });
});
