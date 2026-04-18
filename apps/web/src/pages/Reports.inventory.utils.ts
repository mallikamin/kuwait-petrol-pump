// Pure helpers for the Inventory Report's Product-Wise Movement section.
// Extracted so the CSV builder can be unit-tested without React.

export interface ProductMovementRow {
  productId: string;
  productName: string;
  productType: 'HSD' | 'PMG' | 'non_fuel';
  unit: 'L' | 'units';
  purchasedQty: number;
  soldQty: number;
  netMovement: number;
  purchasedValue: number;
  soldValue: number;
}

export interface ProductMovementCSVMeta {
  branchName: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  category: 'all' | 'HSD' | 'PMG' | 'non_fuel';
  productLabel: string; // "All products" or specific product name
  generatedAt?: Date;
}

const csvEscape = (v: string | number): string => {
  if (typeof v === 'number') return String(v);
  return `"${String(v ?? '').replace(/"/g, '""')}"`;
};

const labelForCategory = (c: ProductMovementCSVMeta['category']): string => {
  if (c === 'HSD') return 'HSD';
  if (c === 'PMG') return 'PMG';
  if (c === 'non_fuel') return 'Non-Fuel';
  return 'All';
};

const labelForType = (t: ProductMovementRow['productType']): string => {
  if (t === 'HSD') return 'HSD';
  if (t === 'PMG') return 'PMG';
  return 'Non-Fuel';
};

/**
 * Builds a CSV with an audit-friendly metadata block at the top followed by
 * the visible product-wise movement rows. Metadata mirrors the filters that
 * were applied to produce the row set so a printed report stays self-contained.
 */
export function buildProductMovementCSV(
  rows: ProductMovementRow[],
  meta: ProductMovementCSVMeta,
): string {
  const generated = (meta.generatedAt || new Date()).toISOString();

  const metaLines = [
    [csvEscape('Inventory — Product-Wise Movement')],
    [csvEscape('Branch'), csvEscape(meta.branchName)],
    [csvEscape('Date Range'), csvEscape(meta.startDate), csvEscape('to'), csvEscape(meta.endDate)],
    [csvEscape('Category'), csvEscape(labelForCategory(meta.category))],
    [csvEscape('Product'), csvEscape(meta.productLabel)],
    [csvEscape('Generated At'), csvEscape(generated)],
    [], // blank separator row
  ];

  const headers = [
    'Product',
    'Type',
    'Unit',
    'Purchased',
    'Sold',
    'Net Movement',
    'Purchased Value',
    'Sold Value',
  ].map(csvEscape);

  const dataRows = rows.map((r) =>
    [
      csvEscape(r.productName),
      csvEscape(labelForType(r.productType)),
      csvEscape(r.unit),
      r.purchasedQty,
      r.soldQty,
      r.netMovement,
      r.purchasedValue,
      r.soldValue,
    ].join(','),
  );

  return [
    ...metaLines.map((cells) => cells.join(',')),
    headers.join(','),
    ...dataRows,
  ].join('\n');
}
