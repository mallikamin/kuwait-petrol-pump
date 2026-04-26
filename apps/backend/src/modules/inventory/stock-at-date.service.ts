import { prisma } from '../../config/database';

/**
 * Compute the system's book stock for a specific (branch, fuel) at the
 * end of a given calendar date. Drives the new Gain/Loss entry flow:
 * the accountant sees the book stock, enters measured liters, and the
 * delta is the gain (positive) or loss (negative).
 *
 * Formula mirrors the Inventory Report's opening stock cycle:
 *   bookStock(date) = bootstrap_qty(<= date)
 *                   + purchases [bootstrapDate, date]
 *                   - sales     [bootstrapDate, date]
 *                   + gainLoss  [bootstrapDate, date)   (excluding entries
 *                                                         on `date` itself
 *                                                         so we don't fold
 *                                                         a same-day entry
 *                                                         into the basis)
 *
 * Also returns `lastPurchaseRate` — the cost/L of the most recent received
 * purchase line for this fuel at this branch on/before `date`. Used to
 * value the gain/loss entry. Returns null if no purchase has ever been
 * recorded — the UI can then prompt the user to enter a rate manually
 * or fall back to FuelInventory.avgCostPerLiter.
 */
export interface StockAtDateResult {
  branchId: string;
  fuelTypeId: string;
  fuelCode: 'HSD' | 'PMG' | string;
  asOfDate: string;            // YYYY-MM-DD
  bootstrapQty: number;        // raw opening anchor
  purchasesQty: number;        // [bootstrapDate, date]
  soldQty: number;             // [bootstrapDate, date]
  priorGainLossQty: number;    // [bootstrapDate, date) — strict less-than
  bookQty: number;             // computed
  lastPurchaseRate: number | null;
  lastPurchaseDate: string | null;
}

/** YYYY-MM-DD (UTC midnight) -> Date object. */
const dayStart = (s: string): Date => new Date(`${s}T00:00:00.000Z`);
/** YYYY-MM-DD -> end of that day, UTC. */
const dayEnd = (s: string): Date => new Date(`${s}T23:59:59.999Z`);

export async function computeStockAtDate(params: {
  organizationId?: string; // Optional for legacy in-process callers; HTTP entry must pass it.
  branchId: string;
  fuelTypeId: string;
  asOfDate: string; // YYYY-MM-DD
}): Promise<StockAtDateResult> {
  const { branchId, fuelTypeId, asOfDate, organizationId } = params;

  // When an org context is supplied, verify the branch belongs to it before
  // doing any reads. This is the active-org gate for the HTTP-facing
  // /stock-at-date endpoint; in-process callers (createByDate) have already
  // verified branch ownership upstream.
  if (organizationId) {
    const branch = await prisma.branch.findFirst({
      where: { id: branchId, organizationId },
      select: { id: true },
    });
    if (!branch) {
      throw new Error('Branch not found');
    }
  }

  const fuel = await prisma.fuelType.findUnique({
    where: { id: fuelTypeId },
    select: { id: true, code: true, name: true },
  });
  if (!fuel) {
    throw new Error('Fuel type not found');
  }

  const cutoffEnd = dayEnd(asOfDate);
  const cutoffStart = dayStart(asOfDate);

  // 1. Most recent bootstrap row for this branch+fuel at or before asOfDate.
  const bootstrap = await prisma.inventoryBootstrap.findFirst({
    where: {
      branchId,
      fuelTypeId,
      asOfDate: { lte: cutoffEnd },
    },
    orderBy: { asOfDate: 'desc' },
  });

  const bootstrapQty = bootstrap ? Number(bootstrap.quantity) : 0;
  const bootstrapDate = bootstrap ? bootstrap.asOfDate : new Date('1970-01-01T00:00:00.000Z');

  // 2. Purchases [bootstrapDate, asOfDate] — mirror the report's logic.
  //    StockReceiptItem.quantityReceived is per-receipt (correct);
  //    PurchaseOrderItem.quantityReceived is cumulative (would double-count).
  //    Use receipts as the authoritative source; fall back to PO-only when
  //    a PO has no receipt yet.
  const receipts = await prisma.stockReceipt.findMany({
    where: {
      purchaseOrder: { branchId },
      receiptDate: { gte: bootstrapDate, lte: cutoffEnd },
    },
    include: {
      items: true,
      purchaseOrder: {
        include: {
          items: { include: { fuelType: { select: { code: true } } } },
        },
      },
    },
  });

  let purchasesQty = 0;
  const consumedPoIds = new Set<string>();
  for (const r of receipts) {
    consumedPoIds.add(r.purchaseOrderId);
    const poItemFuel = new Map<string, string | null>();
    r.purchaseOrder.items.forEach((it) =>
      poItemFuel.set(it.id, it.fuelType?.code || null),
    );
    if (r.items && r.items.length > 0) {
      r.items.forEach((sri) => {
        const code = poItemFuel.get(sri.poItemId);
        if (code !== fuel.code) return;
        const q = Number(sri.quantityReceived);
        if (q > 0) purchasesQty += q;
      });
    } else {
      // Legacy receipts without item rows: only the first receipt for that PO
      // attributes the cumulative PO quantity (avoids N× duplication).
      const firstForPo =
        receipts.find((x) => x.purchaseOrderId === r.purchaseOrderId)?.id === r.id;
      if (!firstForPo) continue;
      r.purchaseOrder.items.forEach((it) => {
        if (it.fuelType?.code !== fuel.code) return;
        const q = Number(it.quantityReceived);
        if (q > 0) purchasesQty += q;
      });
    }
  }

  const poOnlyPOs = await prisma.purchaseOrder.findMany({
    where: {
      branchId,
      status: { in: ['received', 'partial_received'] },
      OR: [
        { receivedDate: { gte: bootstrapDate, lte: cutoffEnd } },
        { receivedDate: null, updatedAt: { gte: bootstrapDate, lte: cutoffEnd } },
      ],
    },
    include: {
      items: { include: { fuelType: { select: { code: true } } } },
      stockReceipts: { select: { id: true } },
    },
  });
  poOnlyPOs
    .filter((po) => po.stockReceipts.length === 0 && !consumedPoIds.has(po.id))
    .forEach((po) => {
      po.items.forEach((it) => {
        if (it.fuelType?.code !== fuel.code) return;
        const q = Number(it.quantityReceived);
        if (q > 0) purchasesQty += q;
      });
    });

  // 3. Sales [bootstrapDate, asOfDate].
  const fuelSales = await prisma.fuelSale.findMany({
    where: {
      fuelTypeId,
      sale: {
        branchId,
        saleDate: { gte: bootstrapDate, lte: cutoffEnd },
      },
    },
    select: { quantityLiters: true },
  });
  const soldQty = fuelSales.reduce((sum, fs) => sum + Number(fs.quantityLiters), 0);

  // 4. Prior gain/loss [bootstrapDate, asOfDate). Strict less-than on
  //    asOfDate so a same-day entry doesn't fold into the basis used to
  //    compute the new entry's gain/loss.
  const priorGL = await prisma.monthlyInventoryGainLoss.findMany({
    where: {
      branchId,
      fuelTypeId,
      businessDate: { gte: bootstrapDate, lt: cutoffStart },
    },
    select: { quantity: true },
  });
  const priorGainLossQty = priorGL.reduce((sum, g) => sum + Number(g.quantity), 0);

  const bookQty = bootstrapQty + purchasesQty - soldQty + priorGainLossQty;

  // 5. Last purchase rate — most recent received line on/before asOfDate
  //    that has unitPrice set. Walk receipts back-to-front; if none has a
  //    rate, fall back to the most recent PO item's unitPrice.
  let lastPurchaseRate: number | null = null;
  let lastPurchaseDate: string | null = null;

  const allReceipts = await prisma.stockReceipt.findMany({
    where: {
      purchaseOrder: { branchId },
      receiptDate: { lte: cutoffEnd },
    },
    include: {
      items: true,
      purchaseOrder: {
        include: {
          items: {
            include: { fuelType: { select: { code: true } } },
          },
        },
      },
    },
    orderBy: { receiptDate: 'desc' },
    take: 25,
  });

  outer: for (const r of allReceipts) {
    const poItemRate = new Map<string, { code: string | null; rate: number | null }>();
    r.purchaseOrder.items.forEach((it) => {
      poItemRate.set(it.id, {
        code: it.fuelType?.code || null,
        rate: Number(it.costPerUnit) || null,
      });
    });
    for (const sri of r.items) {
      const info = poItemRate.get(sri.poItemId);
      if (info?.code !== fuel.code) continue;
      const rate = info.rate;
      if (rate && rate > 0) {
        lastPurchaseRate = rate;
        lastPurchaseDate = r.receiptDate.toISOString().slice(0, 10);
        break outer;
      }
    }
  }

  if (lastPurchaseRate == null) {
    // Fallback: last PO item's unitPrice for this fuel at this branch.
    const lastPoItem = await prisma.purchaseOrderItem.findFirst({
      where: {
        fuelTypeId,
        purchaseOrder: {
          branchId,
          OR: [
            { receivedDate: { lte: cutoffEnd } },
            { receivedDate: null, updatedAt: { lte: cutoffEnd } },
          ],
        },
      },
      include: { purchaseOrder: { select: { receivedDate: true, updatedAt: true } } },
      orderBy: { createdAt: 'desc' },
    });
    if (lastPoItem && Number(lastPoItem.costPerUnit) > 0) {
      lastPurchaseRate = Number(lastPoItem.costPerUnit);
      const refDate = lastPoItem.purchaseOrder.receivedDate || lastPoItem.purchaseOrder.updatedAt;
      lastPurchaseDate = refDate.toISOString().slice(0, 10);
    }
  }

  return {
    branchId,
    fuelTypeId,
    fuelCode: fuel.code,
    asOfDate,
    bootstrapQty,
    purchasesQty,
    soldQty,
    priorGainLossQty,
    bookQty,
    lastPurchaseRate,
    lastPurchaseDate,
  };
}
