// Pure helpers for the Inventory Report's Product-Wise Movement section.
// Extracted so the CSV builder can be unit-tested without React.

import { buildCsvMetaBlock } from '@/utils/reportBranding';

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
  // Opening-stock cycle fields (additive - older backends without the
  // migration may omit them; callers should default to 0/'assumed').
  openingQty?: number;
  gainLossQty?: number;
  closingQty?: number;
  openingSource?: 'bootstrap' | 'assumed';
}

export interface ProductMovementCSVMeta {
  branchName: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  category: 'all' | 'total_fuel' | 'HSD' | 'PMG' | 'non_fuel';
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
  if (c === 'total_fuel') return 'Total Fuel';
  if (c === 'non_fuel') return 'Non-Fuel';
  return 'All';
};

const labelForType = (t: ProductMovementRow['productType']): string => {
  if (t === 'HSD') return 'HSD';
  if (t === 'PMG') return 'PMG';
  return 'Non-Fuel';
};

/**
 * Builds a CSV with the shared branded metadata block, report-specific
 * filters, and the product-wise movement rows. Adds opening-stock columns
 * (Opening, Gain/Loss, Quantity in Hand) so the sheet matches the accountant
 * cycle: Opening + Purchased - Sold +/- Gain/Loss = Quantity in Hand.
 *
 * Rows whose opening came from a bootstrap row are output directly; rows
 * where the backend had no bootstrap are marked "(assumed 0)" in an
 * Opening Source column so the reader can tell the difference.
 */
export function buildProductMovementCSV(
  rows: ProductMovementRow[],
  meta: ProductMovementCSVMeta,
): string {
  const generated = meta.generatedAt || new Date();

  const brandBlock = buildCsvMetaBlock({
    reportName: 'Inventory - Product-Wise Movement',
    branchName: meta.branchName,
    startDate: meta.startDate,
    endDate: meta.endDate,
    generatedAt: generated,
    extra: [
      { label: 'Category', value: labelForCategory(meta.category) },
      { label: 'Product', value: meta.productLabel },
    ],
  });

  const headers = [
    'Product',
    'Type',
    'Unit',
    'Opening',
    'Purchased',
    'Sold',
    'Gain/Loss',
    'Quantity in Hand (Net Movement)',
    'Opening Source',
    'Purchased Value',
    'Sold Value',
  ].map(csvEscape);

  const dataRows = rows.map((r) => {
    const opening = Number(r.openingQty ?? 0);
    const gainLoss = Number(r.gainLossQty ?? 0);
    // Prefer explicit closingQty from the backend; fall back to the old
    // purchase-minus-sold definition if an older backend doesn't send it.
    const closing =
      typeof r.closingQty === 'number'
        ? r.closingQty
        : opening + r.purchasedQty - r.soldQty + gainLoss;
    // Missing openingSource means the backend response pre-dates the
    // opening cycle - treat it as assumed so the reader can tell it apart
    // from a confirmed-zero bootstrap.
    const openingSource =
      r.openingSource === 'bootstrap' ? 'bootstrap' : 'assumed (not provided)';

    return [
      csvEscape(r.productName),
      csvEscape(labelForType(r.productType)),
      csvEscape(r.unit),
      opening,
      r.purchasedQty,
      r.soldQty,
      gainLoss,
      closing,
      csvEscape(openingSource),
      r.purchasedValue,
      r.soldValue,
    ].join(',');
  });

  return brandBlock + [headers.join(','), ...dataRows].join('\n') + '\n';
}
