import { prisma } from '../../config/database';
import { AppError } from '../../middleware/error.middleware';

/**
 * InventoryBootstrap admin service.
 *
 * Drives the accountant-facing editor that lets users replace the
 * placeholder opening values (seeded at 2026-01-01 with quantity=0)
 * with real opening stock. One row per (branch, product|fuel, as_of_date)
 * - exactly one of productId / fuelTypeId is set per row.
 */

export type BootstrapCategory = 'all' | 'total_fuel' | 'HSD' | 'PMG' | 'non_fuel';

export interface BootstrapRowDto {
  id: string;
  branchId: string;
  productId: string | null;
  fuelTypeId: string | null;
  asOfDate: string;
  quantity: number;
  source: string;
  notes: string | null;
  // Display metadata (joined from product / fuelType).
  productName: string;
  productType: 'HSD' | 'PMG' | 'non_fuel';
  unit: 'L' | 'units';
  sku: string | null;
  category: string | null;
  // Audit
  updatedBy: string | null;
  updatedByName: string | null;
  updatedAt: string;
}

export interface UpsertInputRow {
  // Exactly one of these must be present.
  productId?: string | null;
  fuelTypeId?: string | null;
  quantity: number;
  notes?: string | null;
}

export interface UpsertResult {
  updated: number;
  created: number;
}

export class BootstrapService {
  /**
   * List bootstrap rows for a branch on a specific date. The response is
   * shaped for the UI table editor: joined product/fuel labels, audit
   * user, and a stable sort by product type then name.
   */
  async listBootstrap(params: {
    branchId: string;
    asOfDate: string; // YYYY-MM-DD
    category?: BootstrapCategory;
    productId?: string;
  }): Promise<BootstrapRowDto[]> {
    const { branchId, asOfDate, category = 'all', productId } = params;

    // Compare by calendar-day cutoff to be tolerant of DATE vs TZ (same
    // guard that lives in the report's opening-closing service).
    const asOf = new Date(`${asOfDate}T00:00:00.000Z`);

    const rows = await prisma.inventoryBootstrap.findMany({
      where: {
        branchId,
        asOfDate: asOf,
      },
      include: {
        product: { select: { id: true, name: true, sku: true, category: true } },
        fuelType: { select: { id: true, code: true, name: true } },
        updatedByUser: { select: { id: true, username: true, fullName: true } },
      },
    });

    // Apply category + productId filters in memory - the row set per
    // branch per date is bounded by products + fuel types, so this is cheap.
    const mapped: BootstrapRowDto[] = rows.map((r) => {
      const isFuel = !!r.fuelTypeId;
      const productType: BootstrapRowDto['productType'] = isFuel
        ? ((r.fuelType?.code as 'HSD' | 'PMG') || 'HSD')
        : 'non_fuel';
      return {
        id: r.id,
        branchId: r.branchId,
        productId: r.productId,
        fuelTypeId: r.fuelTypeId,
        asOfDate: r.asOfDate.toISOString().slice(0, 10),
        quantity: Number(r.quantity),
        source: r.source,
        notes: r.notes,
        productName: r.product?.name || r.fuelType?.name || 'Unknown',
        productType,
        unit: isFuel ? 'L' : 'units',
        sku: r.product?.sku || null,
        category: r.product?.category || null,
        updatedBy: r.updatedByUser?.id || null,
        updatedByName: r.updatedByUser?.fullName || r.updatedByUser?.username || null,
        updatedAt: r.updatedAt.toISOString(),
      };
    });

    const filtered = mapped.filter((row) => {
      if (category === 'HSD') return row.productType === 'HSD';
      if (category === 'PMG') return row.productType === 'PMG';
      if (category === 'total_fuel') return row.productType === 'HSD' || row.productType === 'PMG';
      if (category === 'non_fuel') return row.productType === 'non_fuel';
      return true;
    }).filter((row) => (productId ? row.productId === productId : true));

    // Stable sort: fuel first (HSD, PMG), then non-fuel by name.
    return filtered.sort((a, b) => {
      if (a.productType !== b.productType) {
        const rank = (t: string) => (t === 'HSD' ? 0 : t === 'PMG' ? 1 : 2);
        return rank(a.productType) - rank(b.productType);
      }
      return a.productName.localeCompare(b.productName);
    });
  }

  /**
   * Bulk upsert bootstrap quantities for a branch + date.
   *
   * Each row must carry exactly one of productId / fuelTypeId. We run
   * all writes inside a single transaction so a partial failure does not
   * leave the cycle in an inconsistent state. Existing rows are updated
   * (source flipped to 'user_entered'); missing rows are created.
   *
   * Returns { updated, created } counters so the UI can toast a precise
   * summary.
   */
  async upsertBootstrap(params: {
    branchId: string;
    asOfDate: string; // YYYY-MM-DD
    rows: UpsertInputRow[];
    updatedBy: string; // userId from req.user
  }): Promise<UpsertResult> {
    const { branchId, asOfDate, rows, updatedBy } = params;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) {
      throw new AppError(400, 'asOfDate must be YYYY-MM-DD');
    }
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new AppError(400, 'rows must be a non-empty array');
    }

    // Validate: one-of product/fuel, numeric quantity (finite, not NaN).
    rows.forEach((r, i) => {
      const hasProduct = !!r.productId;
      const hasFuel = !!r.fuelTypeId;
      if (hasProduct === hasFuel) {
        throw new AppError(
          400,
          `rows[${i}]: exactly one of productId or fuelTypeId is required`,
        );
      }
      if (typeof r.quantity !== 'number' || !Number.isFinite(r.quantity)) {
        throw new AppError(400, `rows[${i}]: quantity must be a finite number`);
      }
    });

    // Guard against duplicate keys in the same request - otherwise the
    // upserts race and the "last write wins" behavior hides user errors.
    const seen = new Set<string>();
    rows.forEach((r, i) => {
      const k = r.productId ? `p:${r.productId}` : `f:${r.fuelTypeId}`;
      if (seen.has(k)) {
        throw new AppError(400, `rows[${i}]: duplicate entry for the same product/fuel`);
      }
      seen.add(k);
    });

    const asOf = new Date(`${asOfDate}T00:00:00.000Z`);

    let updated = 0;
    let created = 0;

    await prisma.$transaction(async (tx) => {
      for (const row of rows) {
        const where = row.productId
          ? {
              branchId,
              productId: row.productId,
              fuelTypeId: null,
              asOfDate: asOf,
            }
          : {
              branchId,
              productId: null,
              fuelTypeId: row.fuelTypeId!,
              asOfDate: asOf,
            };

        const existing = await tx.inventoryBootstrap.findFirst({ where });

        if (existing) {
          await tx.inventoryBootstrap.update({
            where: { id: existing.id },
            data: {
              quantity: row.quantity,
              notes: row.notes ?? existing.notes,
              source: 'user_entered',
              updatedBy,
            },
          });
          updated += 1;
        } else {
          await tx.inventoryBootstrap.create({
            data: {
              branchId,
              productId: row.productId ?? null,
              fuelTypeId: row.fuelTypeId ?? null,
              asOfDate: asOf,
              quantity: row.quantity,
              source: 'user_entered',
              notes: row.notes ?? null,
              updatedBy,
            },
          });
          created += 1;
        }
      }
    });

    return { updated, created };
  }
}

export const bootstrapService = new BootstrapService();
