import path from 'path';
import XLSX from 'xlsx';
import { Prisma, PrismaClient } from '@prisma/client';

const DEFAULT_COLUMN_INDEX = {
  sku: 1,
  category: 2,
  name: 3,
  costPrice: 4,
  unitPrice: 5,
} as const;

export interface ParsedInventoryRow {
  rowNumber: number;
  sku: string;
  skuProvided: boolean;
  name: string;
  normalizedName: string;
  unitPrice: number;
  costPrice: number | null;
  category: string | null;
}

export interface InventoryParserIssue {
  rowNumber: number;
  reason: string;
}

export interface ParsedInventoryData {
  rows: ParsedInventoryRow[];
  skipped: InventoryParserIssue[];
  errors: InventoryParserIssue[];
}

export interface ProductImportSummary {
  filePath: string;
  organizationId: string;
  dryRun: boolean;
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
  details: {
    inserted: Array<{ rowNumber: number; sku: string; name: string }>;
    updated: Array<{ rowNumber: number; sku: string; name: string; productId: string }>;
    skipped: InventoryParserIssue[];
    errors: InventoryParserIssue[];
  };
}

export interface ProductImportOptions {
  organizationId: string;
  filePath: string;
  dryRun?: boolean;
  defaultCategory?: string;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function toOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    if (value === undefined || value === null) {
      return null;
    }
    return normalizeWhitespace(String(value));
  }
  const normalized = normalizeWhitespace(value);
  return normalized.length > 0 ? normalized : null;
}

function parsePrice(value: unknown): number | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? roundMoney(value) : null;
  }

  const cleaned = String(value).replace(/[, ]/g, '').trim();
  if (!cleaned) {
    return null;
  }

  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return roundMoney(parsed);
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function shortHash(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).toUpperCase().padStart(6, '0').slice(0, 6);
}

export function normalizeProductName(name: string): string {
  return normalizeWhitespace(name).toLowerCase();
}

export function normalizeSku(rawSku: string): string {
  const normalized = normalizeWhitespace(rawSku)
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized.slice(0, 100);
}

export function generateDeterministicSku(name: string): string {
  const normalizedName = normalizeProductName(name);
  const slug = normalizedName
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toUpperCase();
  const prefix = slug || 'ITEM';
  const hash = shortHash(normalizedName);
  return `AUTO-${prefix.slice(0, 88)}-${hash}`.slice(0, 100);
}

type HeaderMap = Record<'sku' | 'category' | 'name' | 'costPrice' | 'unitPrice', number>;

function detectHeaderMap(firstRow: unknown[]): HeaderMap {
  const lowered = firstRow.map((cell) => String(cell ?? '').trim().toLowerCase());
  const findIndex = (patterns: string[], fallback: number): number => {
    const index = lowered.findIndex((value) => patterns.some((pattern) => value.includes(pattern)));
    return index >= 0 ? index : fallback;
  };

  return {
    sku: findIndex(['sku', 'item code', 'code'], DEFAULT_COLUMN_INDEX.sku),
    category: findIndex(['category', 'group', 'department'], DEFAULT_COLUMN_INDEX.category),
    name: findIndex(['product name', 'item name', 'description', 'name'], DEFAULT_COLUMN_INDEX.name),
    costPrice: findIndex(['calculated avg', 'cost', 'cost price', 'purchase'], DEFAULT_COLUMN_INDEX.costPrice),
    unitPrice: findIndex(['sales price', 'unit price', 'selling price', 'price'], DEFAULT_COLUMN_INDEX.unitPrice),
  };
}

function looksLikeHeaderRow(firstRow: unknown[]): boolean {
  return firstRow.some((cell) => {
    const value = String(cell ?? '').toLowerCase();
    return value.includes('product') || value.includes('sales price') || value.includes('calculated avg');
  });
}

export function parseInventoryRows(
  matrix: unknown[][],
  options?: { defaultCategory?: string }
): ParsedInventoryData {
  const rows: ParsedInventoryRow[] = [];
  const skipped: InventoryParserIssue[] = [];
  const errors: InventoryParserIssue[] = [];

  if (!matrix.length) {
    return { rows, skipped, errors };
  }

  const headerOffset = looksLikeHeaderRow(matrix[0]) ? 1 : 0;
  const headerMap = detectHeaderMap(matrix[0]);
  const seenKeys = new Set<string>();

  for (let index = headerOffset; index < matrix.length; index += 1) {
    const row = matrix[index] ?? [];
    const rowNumber = index + 1;
    const rowValues = Array.isArray(row) ? row : [];

    const nameRaw = toOptionalString(rowValues[headerMap.name]);
    const hasNonEmptyCell = rowValues.some((value) => toOptionalString(value) !== null);

    if (!hasNonEmptyCell) {
      skipped.push({ rowNumber, reason: 'blank_row' });
      continue;
    }

    if (!nameRaw) {
      errors.push({ rowNumber, reason: 'missing_product_name' });
      continue;
    }

    const normalizedName = normalizeProductName(nameRaw);
    const skuRaw = toOptionalString(rowValues[headerMap.sku]);
    const sku = skuRaw ? normalizeSku(skuRaw) : generateDeterministicSku(nameRaw);
    const skuProvided = Boolean(skuRaw);

    if (!sku) {
      errors.push({ rowNumber, reason: 'invalid_sku' });
      continue;
    }

    const unitPrice = parsePrice(rowValues[headerMap.unitPrice]);
    if (unitPrice === null || unitPrice <= 0) {
      errors.push({ rowNumber, reason: 'missing_or_invalid_unit_price' });
      continue;
    }

    const costPriceParsed = parsePrice(rowValues[headerMap.costPrice]);
    const costPrice =
      costPriceParsed !== null && costPriceParsed > 0 ? costPriceParsed : null;

    const category =
      toOptionalString(rowValues[headerMap.category]) ??
      options?.defaultCategory ??
      null;

    const duplicateKey = `${sku}|${normalizedName}`;
    if (seenKeys.has(duplicateKey)) {
      skipped.push({ rowNumber, reason: 'duplicate_row_in_file' });
      continue;
    }
    seenKeys.add(duplicateKey);

    rows.push({
      rowNumber,
      sku,
      skuProvided,
      name: nameRaw,
      normalizedName,
      unitPrice,
      costPrice,
      category,
    });
  }

  return { rows, skipped, errors };
}

interface ExistingProduct {
  id: string;
  sku: string;
  name: string;
  unitPrice: Prisma.Decimal;
  costPrice: Prisma.Decimal | null;
  category: string | null;
}

function toNumber(decimal: Prisma.Decimal | null): number | null {
  if (decimal === null) {
    return null;
  }
  return Number(decimal.toString());
}

function hasMeaningfulChanges(
  existing: ExistingProduct,
  candidate: ParsedInventoryRow,
  nextSku: string
): boolean {
  const existingUnitPrice = toNumber(existing.unitPrice);
  const existingCostPrice = toNumber(existing.costPrice);

  return (
    existing.name !== candidate.name ||
    existing.category !== candidate.category ||
    normalizeSku(existing.sku) !== normalizeSku(nextSku) ||
    existingUnitPrice !== candidate.unitPrice ||
    existingCostPrice !== candidate.costPrice
  );
}

export async function importProductsFromXlsx(
  prisma: PrismaClient,
  options: ProductImportOptions
): Promise<ProductImportSummary> {
  const dryRun = options.dryRun ?? true;
  const resolvedPath = path.resolve(options.filePath);
  const workbook = XLSX.readFile(resolvedPath);
  const firstSheetName = workbook.SheetNames[0];

  if (!firstSheetName) {
    throw new Error('No worksheet found in the provided XLSX file');
  }

  const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], {
    header: 1,
    raw: false,
    defval: '',
  }) as unknown[][];

  const parsed = parseInventoryRows(matrix, {
    defaultCategory: options.defaultCategory,
  });

  const summary: ProductImportSummary = {
    filePath: resolvedPath,
    organizationId: options.organizationId,
    dryRun,
    inserted: 0,
    updated: 0,
    skipped: parsed.skipped.length,
    errors: parsed.errors.length,
    details: {
      inserted: [],
      updated: [],
      skipped: [...parsed.skipped],
      errors: [...parsed.errors],
    },
  };

  const existingProducts = await prisma.product.findMany({
    where: { organizationId: options.organizationId },
    select: {
      id: true,
      sku: true,
      name: true,
      unitPrice: true,
      costPrice: true,
      category: true,
    },
  });

  const bySku = new Map<string, ExistingProduct>();
  const byName = new Map<string, ExistingProduct>();
  for (const product of existingProducts) {
    bySku.set(normalizeSku(product.sku), product);
    byName.set(normalizeProductName(product.name), product);
  }

  for (const row of parsed.rows) {
    try {
      const normalizedSku = normalizeSku(row.sku);
      let matched = bySku.get(normalizedSku);
      let matchedByName = false;

      if (!matched) {
        matched = byName.get(row.normalizedName);
        matchedByName = Boolean(matched);
      }

      if (!matched) {
        summary.inserted += 1;
        summary.details.inserted.push({
          rowNumber: row.rowNumber,
          sku: row.sku,
          name: row.name,
        });

        if (!dryRun) {
          const created = await prisma.product.create({
            data: {
              organizationId: options.organizationId,
              sku: row.sku,
              name: row.name,
              category: row.category,
              unitPrice: new Prisma.Decimal(row.unitPrice),
              costPrice:
                row.costPrice !== null ? new Prisma.Decimal(row.costPrice) : null,
            },
            select: {
              id: true,
              sku: true,
              name: true,
              unitPrice: true,
              costPrice: true,
              category: true,
            },
          });
          bySku.set(normalizeSku(created.sku), created);
          byName.set(normalizeProductName(created.name), created);
        }
        continue;
      }

      let targetSku = matched.sku;
      if (!matchedByName || (matchedByName && row.skuProvided)) {
        const skuTaken = bySku.get(normalizedSku);
        if (!skuTaken || skuTaken.id === matched.id) {
          targetSku = row.sku;
        }
      }

      if (!hasMeaningfulChanges(matched, row, targetSku)) {
        summary.skipped += 1;
        summary.details.skipped.push({
          rowNumber: row.rowNumber,
          reason: 'unchanged_existing_product',
        });
        continue;
      }

      summary.updated += 1;
      summary.details.updated.push({
        rowNumber: row.rowNumber,
        sku: targetSku,
        name: row.name,
        productId: matched.id,
      });

      if (!dryRun) {
        const updated = await prisma.product.update({
          where: { id: matched.id },
          data: {
            sku: targetSku,
            name: row.name,
            category: row.category,
            unitPrice: new Prisma.Decimal(row.unitPrice),
            costPrice:
              row.costPrice !== null ? new Prisma.Decimal(row.costPrice) : null,
          },
          select: {
            id: true,
            sku: true,
            name: true,
            unitPrice: true,
            costPrice: true,
            category: true,
          },
        });
        bySku.set(normalizeSku(updated.sku), updated);
        byName.set(normalizeProductName(updated.name), updated);
      }
    } catch (error) {
      summary.errors += 1;
      summary.details.errors.push({
        rowNumber: row.rowNumber,
        reason:
          error instanceof Error ? `db_error:${error.message}` : 'db_error:unknown',
      });
    }
  }

  return summary;
}
