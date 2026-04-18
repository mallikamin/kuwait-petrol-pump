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
  openingQty: 0,
  gainLossQty: 0,
  closingQty: 0,
  openingSource: 'bootstrap',
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
  it('emits branded company block, report filters, header, then rows', () => {
    const csv = buildProductMovementCSV(
      [
        makeRow({
          productName: 'Filter A',
          openingQty: 5,
          purchasedQty: 50,
          soldQty: 10,
          gainLossQty: 0,
          closingQty: 45,
          netMovement: 40,
          purchasedValue: 5000,
          soldValue: 1500,
        }),
      ],
      baseMeta(),
    );
    // Brand block is always first - company identity before per-report meta.
    expect(csv).toContain('"Absormax Hygiene Products (Pvt) LTD"');
    expect(csv).toContain('"Sundar Industrial Estate, Lahore"');
    expect(csv).toContain('"Inventory - Product-Wise Movement"');
    // Per-report meta
    expect(csv).toContain('"Branch","Main Branch"');
    expect(csv).toContain('"Date Range","2026-01-01","to","2026-04-18"');
    expect(csv).toContain('"Category","All"');
    expect(csv).toContain('"Product","All products"');
    // New opening-cycle columns in the data header
    expect(csv).toContain(
      '"Product","Type","Unit","Opening","Purchased","Sold","Gain/Loss","Quantity in Hand (Net Movement)","Opening Source","Purchased Value","Sold Value"',
    );
    // Row values in new column order
    expect(csv).toContain('"Filter A","Non-Fuel","units",5,50,10,0,45,"bootstrap",5000,1500');
  });

  it('marks rows with no bootstrap as assumed in the Opening Source column', () => {
    const csv = buildProductMovementCSV(
      [
        makeRow({
          productName: 'Filter B',
          openingQty: 0,
          purchasedQty: 10,
          soldQty: 3,
          closingQty: 7,
          openingSource: 'assumed',
        }),
      ],
      baseMeta(),
    );
    expect(csv).toContain('"Filter B","Non-Fuel","units",0,10,3,0,7,"assumed (not provided)"');
  });

  it('falls back to purchased-minus-sold when backend omits closingQty (legacy response)', () => {
    const csv = buildProductMovementCSV(
      [
        {
          productId: 'old-1',
          productName: 'Legacy',
          productType: 'non_fuel',
          unit: 'units',
          purchasedQty: 12,
          soldQty: 4,
          netMovement: 8,
          purchasedValue: 0,
          soldValue: 0,
          // intentionally no opening/closing/source fields - older backend
        },
      ],
      baseMeta(),
    );
    // Closing column must be populated even when backend skipped the field.
    expect(csv).toContain('"Legacy","Non-Fuel","units",0,12,4,0,8,"assumed (not provided)"');
  });

  it('reflects applied filters in per-report metadata', () => {
    const csv = buildProductMovementCSV(
      [
        makeRow({
          productType: 'HSD',
          productName: 'High Speed Diesel',
          unit: 'L',
          openingQty: 500,
          purchasedQty: 1000,
          soldQty: 200,
          gainLossQty: -5,
          closingQty: 1295,
          netMovement: 800,
        }),
      ],
      baseMeta({ category: 'HSD', productLabel: 'High Speed Diesel' }),
    );
    expect(csv).toContain('"Category","HSD"');
    expect(csv).toContain('"Product","High Speed Diesel"');
    expect(csv).toContain('"High Speed Diesel","HSD","L",500,1000,200,-5,1295,"bootstrap"');
  });

  it('escapes commas and quotes inside product names', () => {
    const csv = buildProductMovementCSV(
      [makeRow({ productName: 'Filter "A", premium' })],
      baseMeta(),
    );
    expect(csv).toContain('"Filter ""A"", premium"');
  });

  it('handles empty row set (header still present)', () => {
    const csv = buildProductMovementCSV([], baseMeta());
    expect(csv).toContain(
      '"Product","Type","Unit","Opening","Purchased","Sold","Gain/Loss","Quantity in Hand (Net Movement)","Opening Source","Purchased Value","Sold Value"',
    );
    // No data rows beyond the header
    const afterHeader = csv.split(
      '"Product","Type","Unit","Opening","Purchased","Sold","Gain/Loss","Quantity in Hand (Net Movement)","Opening Source","Purchased Value","Sold Value"',
    )[1];
    // Allow a trailing newline but nothing resembling a data row.
    expect(afterHeader.trim()).toBe('');
  });

  it('renders Non-Fuel category label as "Non-Fuel" not "non_fuel"', () => {
    const csv = buildProductMovementCSV([], baseMeta({ category: 'non_fuel' }));
    expect(csv).toContain('"Category","Non-Fuel"');
  });

  it('renders Total Fuel category label as "Total Fuel" not "total_fuel"', () => {
    const csv = buildProductMovementCSV(
      [
        makeRow({
          productType: 'HSD',
          productName: 'High Speed Diesel',
          unit: 'L',
          purchasedQty: 1000,
          soldQty: 200,
          closingQty: 800,
          netMovement: 800,
        }),
        makeRow({
          productType: 'PMG',
          productName: 'Premium Motor Gasoline',
          unit: 'L',
          purchasedQty: 500,
          soldQty: 50,
          closingQty: 450,
          netMovement: 450,
          productId: 'PMG',
        }),
      ],
      baseMeta({ category: 'total_fuel', productLabel: 'All products' }),
    );
    expect(csv).toContain('"Category","Total Fuel"');
    expect(csv).toContain('"High Speed Diesel","HSD","L",0,1000,200,0,800,"bootstrap"');
    expect(csv).toContain('"Premium Motor Gasoline","PMG","L",0,500,50,0,450,"bootstrap"');
  });
});
