import { prisma } from '../../config/database';
import { toBranchStartOfDay, toBranchEndOfDay } from '../../utils/timezone';

/**
 * Opening/closing computation for the Inventory Report.
 *
 * Formula (accountant-confirmed 2026-04-18):
 *   opening  = bootstrap_qty(branch, item, bootstrap_date)
 *              + purchases [bootstrap_date, period_start)
 *              - sales     [bootstrap_date, period_start)
 *              + gainLoss  [bootstrap_date, period_start)
 *   closing  = opening
 *              + purchases[period_start, period_end]
 *              - sales    [period_start, period_end]
 *              + gainLoss [period_start, period_end]
 *
 * Bootstrap is a per-branch table (inventory_bootstrap) seeded at 2026-01-01
 * with quantity=0. Accountant replaces those placeholder values via admin
 * path; this helper reads whatever is there and works regardless.
 *
 * Gain/loss is stored monthly (MonthlyInventoryGainLoss.month = 'YYYY-MM').
 * We split gain/loss month-wise: a gain/loss row whose month is strictly
 * before period_start's month counts toward opening; months falling within
 * the period window count toward the period. This is the coarsest
 * defensible split given the monthly granularity of the source.
 */

export interface MovementKey {
  kind: 'product' | 'fuel';
  /** Product UUID for non-fuel, fuel code ('HSD' | 'PMG') for fuel. */
  key: string;
}

export interface OpeningClosingRow {
  openingQty: number;
  purchasesQtyInPeriod: number;
  soldQtyInPeriod: number;
  gainLossQtyInPeriod: number;
  closingQty: number;
}

export type OpeningClosingMap = Map<string, OpeningClosingRow>;

const keyOf = (k: MovementKey): string => `${k.kind}:${k.key}`;

/**
 * Produce a map keyed by "product:{uuid}" / "fuel:{code}" containing
 * opening + in-period deltas + closing per (branch, item). Safe to call
 * even when a branch has no bootstrap rows - missing rows default to 0
 * and the period deltas still compute correctly.
 */
export async function computeInventoryOpeningClosing(params: {
  branchId: string;
  startDate: string; // 'YYYY-MM-DD'
  endDate: string;   // 'YYYY-MM-DD'
}): Promise<OpeningClosingMap> {
  const { branchId, startDate, endDate } = params;

  const periodStart = toBranchStartOfDay(startDate);
  const periodEnd = toBranchEndOfDay(endDate);

  // 1. Load bootstrap rows for this branch. We accept any bootstrap date
  //    <= periodStart (currently only 2026-01-01 exists, but the logic is
  //    future-proof for re-basing).
  const bootstraps = await prisma.inventoryBootstrap.findMany({
    where: {
      branchId,
      asOfDate: { lte: periodStart },
    },
    include: {
      product: { select: { id: true } },
      fuelType: { select: { code: true } },
    },
  });

  if (bootstraps.length === 0) {
    return new Map();
  }

  // For each (product/fuel) pick the most-recent bootstrap row that
  // precedes or equals periodStart. This keeps things correct if the
  // schema ever grows multiple dated anchors.
  const latestBootstrap = new Map<string, { quantity: number; asOfDate: Date }>();
  for (const b of bootstraps) {
    const k: string | null = b.productId
      ? keyOf({ kind: 'product', key: b.productId })
      : b.fuelType?.code
      ? keyOf({ kind: 'fuel', key: b.fuelType.code })
      : null;
    if (!k) continue;
    const prior = latestBootstrap.get(k);
    if (!prior || b.asOfDate > prior.asOfDate) {
      latestBootstrap.set(k, {
        quantity: Number(b.quantity),
        asOfDate: b.asOfDate,
      });
    }
  }

  // The bootstrap date window starts at the earliest bootstrap we'll use.
  // Pre-period activity = [earliestBootstrapDate, periodStart).
  let earliestBootstrap: Date | null = null;
  for (const v of latestBootstrap.values()) {
    if (!earliestBootstrap || v.asOfDate < earliestBootstrap) earliestBootstrap = v.asOfDate;
  }
  if (!earliestBootstrap) return new Map();

  // 2. Purchases since bootstrap (both stock-receipt and received-PO paths
  //    are already the report's canonical purchase sources - mirror them
  //    here to stay consistent with what the report displays in-period).
  const preWindowPurchases = await prisma.stockReceipt.findMany({
    where: {
      purchaseOrder: { branchId },
      receiptDate: { gte: earliestBootstrap, lt: periodStart },
    },
    include: {
      purchaseOrder: {
        include: {
          items: {
            include: {
              product: { select: { id: true } },
              fuelType: { select: { code: true } },
            },
          },
        },
      },
    },
  });
  const periodPurchases = await prisma.stockReceipt.findMany({
    where: {
      purchaseOrder: { branchId },
      receiptDate: { gte: periodStart, lte: periodEnd },
    },
    include: {
      purchaseOrder: {
        include: {
          items: {
            include: {
              product: { select: { id: true } },
              fuelType: { select: { code: true } },
            },
          },
        },
      },
    },
  });

  // Received POs that never got a receipt form - mirror the report's logic
  // so opening stays consistent with what the user sees in-period.
  const preWindowPOs = await prisma.purchaseOrder.findMany({
    where: {
      branchId,
      status: { in: ['received', 'partial_received'] },
      OR: [
        { receivedDate: { gte: earliestBootstrap, lt: periodStart } },
        { receivedDate: null, updatedAt: { gte: earliestBootstrap, lt: periodStart } },
      ],
    },
    include: {
      items: {
        include: {
          product: { select: { id: true } },
          fuelType: { select: { code: true } },
        },
      },
      stockReceipts: { select: { id: true } },
    },
  });
  const periodPOs = await prisma.purchaseOrder.findMany({
    where: {
      branchId,
      status: { in: ['received', 'partial_received'] },
      OR: [
        { receivedDate: { gte: periodStart, lte: periodEnd } },
        { receivedDate: null, updatedAt: { gte: periodStart, lte: periodEnd } },
      ],
    },
    include: {
      items: {
        include: {
          product: { select: { id: true } },
          fuelType: { select: { code: true } },
        },
      },
      stockReceipts: { select: { id: true } },
    },
  });

  const collectPurchases = (
    receipts: typeof preWindowPurchases,
    pos: typeof preWindowPOs,
    target: Map<string, number>,
  ) => {
    receipts.forEach((r) => {
      r.purchaseOrder.items.forEach((item) => {
        const qty = Number(item.quantityReceived);
        if (qty <= 0) return;
        const k = item.product?.id
          ? keyOf({ kind: 'product', key: item.product.id })
          : item.fuelType?.code
          ? keyOf({ kind: 'fuel', key: item.fuelType.code })
          : null;
        if (!k) return;
        target.set(k, (target.get(k) || 0) + qty);
      });
    });
    // Include PO-only purchases (no stock receipt yet) to match the
    // report's in-period purchase counting behavior.
    pos
      .filter((po) => po.stockReceipts.length === 0)
      .forEach((po) => {
        po.items.forEach((item) => {
          const qty = Number(item.quantityReceived);
          if (qty <= 0) return;
          const k = item.product?.id
            ? keyOf({ kind: 'product', key: item.product.id })
            : item.fuelType?.code
            ? keyOf({ kind: 'fuel', key: item.fuelType.code })
            : null;
          if (!k) return;
          target.set(k, (target.get(k) || 0) + qty);
        });
      });
  };

  const preWindowPurchQty = new Map<string, number>();
  const periodPurchQty = new Map<string, number>();
  collectPurchases(preWindowPurchases, preWindowPOs, preWindowPurchQty);
  collectPurchases(periodPurchases, periodPOs, periodPurchQty);

  // 3. Sales split into pre-window and in-period.
  const preWindowSales = await prisma.sale.findMany({
    where: { branchId, saleDate: { gte: earliestBootstrap, lt: periodStart } },
    include: {
      fuelSales: { include: { fuelType: { select: { code: true } } } },
      nonFuelSales: { select: { productId: true, quantity: true } },
    },
  });
  const periodSales = await prisma.sale.findMany({
    where: { branchId, saleDate: { gte: periodStart, lte: periodEnd } },
    include: {
      fuelSales: { include: { fuelType: { select: { code: true } } } },
      nonFuelSales: { select: { productId: true, quantity: true } },
    },
  });

  const collectSales = (sales: typeof preWindowSales, target: Map<string, number>) => {
    sales.forEach((s) => {
      s.fuelSales.forEach((fs) => {
        const code = fs.fuelType.code;
        if (!code) return;
        const k = keyOf({ kind: 'fuel', key: code });
        target.set(k, (target.get(k) || 0) + Number(fs.quantityLiters));
      });
      s.nonFuelSales.forEach((nfs) => {
        const k = keyOf({ kind: 'product', key: nfs.productId });
        target.set(k, (target.get(k) || 0) + Number(nfs.quantity));
      });
    });
  };

  const preWindowSoldQty = new Map<string, number>();
  const periodSoldQty = new Map<string, number>();
  collectSales(preWindowSales, preWindowSoldQty);
  collectSales(periodSales, periodSoldQty);

  // 4. Gain/Loss (fuel only, monthly granularity).
  //    preWindow months: < periodStart's YYYY-MM, >= bootstrap's YYYY-MM.
  //    period months: >= periodStart's YYYY-MM and <= periodEnd's YYYY-MM.
  //
  // The startDate/endDate inputs are already in branch (Asia/Karachi) time;
  // slice their YYYY-MM directly to avoid UTC-offset drift that would bucket
  // a Feb-1 period's opening under Jan in UTC but Feb in local time.
  const ym = (d: Date): string => {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  };
  const startMonth = startDate.slice(0, 7);
  const endMonth = endDate.slice(0, 7);
  const bootstrapMonth = ym(earliestBootstrap);

  const gainLosses = await prisma.monthlyInventoryGainLoss.findMany({
    where: {
      branchId,
      month: { gte: bootstrapMonth, lte: endMonth },
    },
    include: { fuelType: { select: { code: true } } },
  });

  const preWindowGLQty = new Map<string, number>();
  const periodGLQty = new Map<string, number>();
  gainLosses.forEach((gl) => {
    const code = gl.fuelType.code;
    if (!code) return;
    const k = keyOf({ kind: 'fuel', key: code });
    const bucket = gl.month < startMonth ? preWindowGLQty : periodGLQty;
    bucket.set(k, (bucket.get(k) || 0) + Number(gl.quantity));
  });

  // 5. Assemble output. We emit rows for every bootstrap key so the
  //    report can display a line even when there's no activity.
  const out: OpeningClosingMap = new Map();
  for (const [k, boot] of latestBootstrap.entries()) {
    const preP = preWindowPurchQty.get(k) || 0;
    const preS = preWindowSoldQty.get(k) || 0;
    const preGL = preWindowGLQty.get(k) || 0;
    const openingQty = boot.quantity + preP - preS + preGL;

    const perP = periodPurchQty.get(k) || 0;
    const perS = periodSoldQty.get(k) || 0;
    const perGL = periodGLQty.get(k) || 0;
    const closingQty = openingQty + perP - perS + perGL;

    out.set(k, {
      openingQty,
      purchasesQtyInPeriod: perP,
      soldQtyInPeriod: perS,
      gainLossQtyInPeriod: perGL,
      closingQty,
    });
  }

  return out;
}

export const openingClosingKey = keyOf;
