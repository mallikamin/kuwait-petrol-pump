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

  // 1. Load bootstrap rows for this branch.
  //
  // inventory_bootstrap.as_of_date is DATE (midnight UTC) while periodStart
  // is a Timestamptz shifted into Asia/Karachi local time - in UTC that's
  // the previous day's 19:00. Comparing `asOfDate <= periodStart` would
  // therefore reject a bootstrap whose calendar date IS the report's start
  // date (midnight-UTC > previous-day-19:00-UTC). Use a calendar-day cutoff
  // built from the startDate string instead, so we accept any bootstrap
  // whose stored date <= the report's start calendar date.
  const bootstrapCutoff = new Date(`${startDate}T23:59:59.999Z`);
  const bootstraps = await prisma.inventoryBootstrap.findMany({
    where: {
      branchId,
      asOfDate: { lte: bootstrapCutoff },
    },
    include: {
      product: { select: { id: true } },
      fuelType: { select: { code: true } },
    },
  });

  if (bootstraps.length === 0) {
    // No bootstrap rows yet — but the user may still have recorded
    // MonthlyInventoryGainLoss entries for fuel. Surface those so the
    // Gain/Loss column is populated even before the accountant seeds
    // opening stock. Opening/closing stay 0 since we have no anchor;
    // the productMovement row's purchased/sold come from the period
    // query upstream and are unaffected by this branch.
    const startMonth = startDate.slice(0, 7);
    const endMonth = endDate.slice(0, 7);
    const gainLosses = await prisma.monthlyInventoryGainLoss.findMany({
      where: { branchId, month: { lte: endMonth } },
      include: { fuelType: { select: { code: true } } },
    });
    const out: OpeningClosingMap = new Map();
    gainLosses.forEach((gl) => {
      const code = gl.fuelType.code;
      if (!code) return;
      const k = keyOf({ kind: 'fuel', key: code });
      const isPeriod = gl.month >= startMonth && gl.month <= endMonth;
      const row = out.get(k) || {
        openingQty: 0,
        purchasesQtyInPeriod: 0,
        soldQtyInPeriod: 0,
        gainLossQtyInPeriod: 0,
        closingQty: 0,
      };
      const qty = Number(gl.quantity);
      if (isPeriod) row.gainLossQtyInPeriod += qty;
      else row.openingQty += qty;
      row.closingQty = row.openingQty + row.gainLossQtyInPeriod;
      out.set(k, row);
    });
    return out;
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
  //
  //    IMPORTANT: PurchaseOrderItem.quantityReceived is the PO-level cumulative
  //    total across *all* receipts. Summing that once per StockReceipt would
  //    multiply the quantity by the number of receipts on the same PO (the
  //    2026-04 bug: 2 receipts on a 10k PO → 20k counted). We therefore pull
  //    in StockReceiptItem rows (per-receipt quantity, joined to PO item via
  //    poItemId) and attribute by receipt. A legacy receipt with no items
  //    falls back to the PO item's cumulative quantity, but only the first
  //    time we see each PO — preventing the N× duplication.
  const preWindowPurchases = await prisma.stockReceipt.findMany({
    where: {
      purchaseOrder: { branchId },
      receiptDate: { gte: earliestBootstrap, lt: periodStart },
    },
    include: {
      items: true,
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
      items: true,
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
    // Track POs we've already accounted for via the receipt path so the
    // PO-only fallback can't double-add the same quantity.
    const consumedPoIds = new Set<string>();
    receipts.forEach((r) => {
      consumedPoIds.add(r.purchaseOrderId);
      // Build poItemId → (product/fuel) lookup once per receipt.
      const poItemInfo = new Map<string, { key: string | null }>();
      r.purchaseOrder.items.forEach((item) => {
        const k = item.product?.id
          ? keyOf({ kind: 'product', key: item.product.id })
          : item.fuelType?.code
          ? keyOf({ kind: 'fuel', key: item.fuelType.code })
          : null;
        poItemInfo.set(item.id, { key: k });
      });
      if (r.items && r.items.length > 0) {
        // Authoritative path: per-receipt quantity on StockReceiptItem.
        r.items.forEach((sri) => {
          const qty = Number(sri.quantityReceived);
          if (qty <= 0) return;
          const info = poItemInfo.get(sri.poItemId);
          if (!info?.key) return;
          target.set(info.key, (target.get(info.key) || 0) + qty);
        });
      } else {
        // Legacy receipts without StockReceiptItem rows: attribute the PO
        // item's cumulative quantity, but only for the first receipt we see
        // on this PO. Subsequent receipts on the same PO would repeat the
        // same cumulative total, which is the bug we're fixing.
        const firstReceiptForPo =
          receipts.find((x) => x.purchaseOrderId === r.purchaseOrderId)?.id === r.id;
        if (!firstReceiptForPo) return;
        r.purchaseOrder.items.forEach((item) => {
          const qty = Number(item.quantityReceived);
          if (qty <= 0) return;
          const k = poItemInfo.get(item.id)?.key;
          if (!k) return;
          target.set(k, (target.get(k) || 0) + qty);
        });
      }
    });
    // PO-only purchases (no stock receipt yet) — and any PO already consumed
    // via the receipt path is skipped here to avoid cross-source duplication.
    pos
      .filter((po) => po.stockReceipts.length === 0 && !consumedPoIds.has(po.id))
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
