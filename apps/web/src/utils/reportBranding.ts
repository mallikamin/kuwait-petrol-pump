/**
 * Shared branding helpers applied to every CSV / print export on the Reports
 * page. Centralizing this lets us change the company header in one place and
 * guarantees consistent metadata across reports (branch, range, timestamp).
 *
 * Multi-tenant note (2026-04-26): the brand is now sourced at runtime from
 * the logged-in user's organization (via setReportBrandProvider, registered
 * once at app boot). The DEFAULT_BRAND constants below act as a fallback
 * when no provider is registered yet (e.g. on the login page) and preserve
 * the exact original output for the demo/Absormax org.
 */

interface ReportBrand {
  companyName: string;
  companyAddress: string;
  systemLabel: string;
  reportFooter?: string | null;
}

const DEFAULT_BRAND: ReportBrand = {
  companyName: 'Absormax Hygiene Products (Pvt) LTD',
  companyAddress: 'Sundar Industrial Estate, Lahore',
  systemLabel: 'Kuwait Petrol Pump POS',
};

let brandProvider: (() => ReportBrand) | null = null;

/// Registered once during app boot. The provider closure should read from
/// the auth store so it always reflects the currently logged-in org.
export function setReportBrandProvider(provider: () => ReportBrand): void {
  brandProvider = provider;
}

function getBrand(): ReportBrand {
  if (!brandProvider) return DEFAULT_BRAND;
  try {
    return brandProvider();
  } catch {
    return DEFAULT_BRAND;
  }
}

/// Kept for any legacy import sites; resolves at access time, not at module
/// init, so it always reflects the current org.
export const REPORT_BRAND = new Proxy({} as ReportBrand, {
  get(_target, prop) {
    const b = getBrand();
    return (b as unknown as Record<string, unknown>)[prop as string];
  },
});

const csvEscape = (v: string | number): string => {
  if (typeof v === 'number') return String(v);
  return `"${String(v ?? '').replace(/"/g, '""')}"`;
};

export interface ReportMeta {
  /** Human-readable report name e.g. "Inventory - Product-Wise Movement". */
  reportName: string;
  branchName?: string;
  /** YYYY-MM-DD strings. Range may be omitted for single-date reports. */
  startDate?: string;
  endDate?: string;
  /** Free-form "filters applied" lines rendered after the date range. */
  extra?: Array<{ label: string; value: string }>;
  generatedAt?: Date;
}

const fmtTimestamp = (d: Date): string => {
  // en-PK gives "18/04/2026, 11:55:01 AM" - readable for Pakistani accountants.
  try {
    return d.toLocaleString('en-PK', { hour12: true });
  } catch {
    return d.toISOString();
  }
};

/**
 * Build a multi-line CSV preamble block to prepend to any report export.
 * Produces rows ending in newline, no trailing blank line - callers append
 * the data header + rows after this.
 */
export function buildCsvMetaBlock(meta: ReportMeta): string {
  const generated = meta.generatedAt || new Date();
  const rows: string[] = [];

  rows.push([csvEscape(REPORT_BRAND.companyName)].join(','));
  rows.push([csvEscape(REPORT_BRAND.companyAddress)].join(','));
  rows.push([csvEscape(meta.reportName)].join(','));
  if (meta.branchName) {
    rows.push([csvEscape('Branch'), csvEscape(meta.branchName)].join(','));
  }
  if (meta.startDate && meta.endDate) {
    rows.push(
      [csvEscape('Date Range'), csvEscape(meta.startDate), csvEscape('to'), csvEscape(meta.endDate)].join(','),
    );
  } else if (meta.startDate) {
    rows.push([csvEscape('Date'), csvEscape(meta.startDate)].join(','));
  }
  (meta.extra || []).forEach((e) => {
    rows.push([csvEscape(e.label), csvEscape(e.value)].join(','));
  });
  rows.push([csvEscape('Generated At'), csvEscape(fmtTimestamp(generated))].join(','));
  rows.push(''); // blank separator before data

  return rows.join('\n') + '\n';
}

/**
 * Build an HTML header block for printed/PDF output. Paired with the print
 * stylesheet in Reports.tsx - same class names are used there for layout.
 */
export function buildPrintHeaderHtml(meta: ReportMeta): string {
  const generated = meta.generatedAt || new Date();
  const rangeLine =
    meta.startDate && meta.endDate
      ? `${meta.startDate} to ${meta.endDate}`
      : meta.startDate
      ? meta.startDate
      : '';

  const extraLines = (meta.extra || [])
    .map((e) => `<div class="meta-line"><b>${e.label}:</b> ${escapeHtml(e.value)}</div>`)
    .join('');

  return `
    <div class="report-brand">
      <div class="brand-company">${escapeHtml(REPORT_BRAND.companyName)}</div>
      <div class="brand-address">${escapeHtml(REPORT_BRAND.companyAddress)}</div>
    </div>
    <div class="report-title">${escapeHtml(meta.reportName)}</div>
    ${meta.branchName ? `<div class="meta-line">Branch: ${escapeHtml(meta.branchName)}</div>` : ''}
    ${rangeLine ? `<div class="meta-line">Period: ${escapeHtml(rangeLine)}</div>` : ''}
    ${extraLines}
    <div class="meta-line meta-generated">Generated: ${escapeHtml(fmtTimestamp(generated))}</div>
    <hr class="report-sep" />
  `;
}

/** Consistent print stylesheet shared across every printed report. */
export const PRINT_STYLES = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; padding: 24px; color: #111; }
  .report-brand { text-align: center; margin-bottom: 6px; }
  .brand-company { font-size: 18px; font-weight: 700; letter-spacing: 0.3px; }
  .brand-address { font-size: 11px; color: #555; margin-top: 2px; }
  .report-title { font-size: 15px; font-weight: 600; text-align: center; margin: 10px 0 6px; }
  .meta-line { font-size: 11px; color: #444; text-align: center; margin-top: 2px; }
  .meta-generated { color: #666; }
  .report-sep { border: none; border-top: 1px solid #ccc; margin: 12px 0 10px; }
  h1 { font-size: 16px; margin: 14px 0 6px; }
  h2 { font-size: 13px; margin: 14px 0 6px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 14px; table-layout: auto; }
  th, td { border: 1px solid #ddd; padding: 5px 7px; text-align: left; font-size: 11px; }
  th { background: #f5f5f5; font-weight: 700; }
  .right { text-align: right; }
  .bold { font-weight: 700; }
  .summary { display: flex; gap: 24px; margin-bottom: 14px; flex-wrap: wrap; }
  .summary-item { min-width: 140px; }
  .summary-label { color: #666; font-size: 10px; }
  .summary-value { font-size: 15px; font-weight: 700; }
  .foot { text-align: center; color: #777; font-size: 10px; margin-top: 14px; border-top: 1px solid #eee; padding-top: 6px; }
  @media print {
    body { padding: 12mm; }
    .report-sep { margin: 10px 0 8px; }
    tr { page-break-inside: avoid; }
    thead { display: table-header-group; }
  }
`;

function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
