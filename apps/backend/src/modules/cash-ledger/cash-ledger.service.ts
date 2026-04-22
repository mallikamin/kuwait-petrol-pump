import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { AppError } from '../../middleware/error.middleware';
import type {
  CashDirection,
  CashLedgerDaySummary,
  CashLedgerPostInput,
  CashSource,
} from './cash-ledger.types';

/**
 * CashLedgerService — central writer for the cash_ledger_entries table.
 *
 * Design choices:
 * - `post(...)` is idempotent by (source, sourceId, direction) unique key.
 *   Re-posting the same event is a silent no-op (P2002 caught and ignored).
 * - Never throws on idempotency collisions — callers (sales, credit, etc.)
 *   are already inside their own transactions and a duplicate ledger post
 *   must not roll back the business operation that triggered it.
 * - Real integrity failures (FK violations, amount ≤ 0) still throw.
 * - The accompanying `postMany`, `reverse`, and `getDaySummary` helpers
 *   cover the minimum surface the EOD dashboard needs.
 */
export class CashLedgerService {
  static toBusinessDate(input: Date | string): Date {
    // Normalise to UTC midnight so the DATE column stores a stable day.
    const d = typeof input === 'string' ? new Date(input) : input;
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }

  static async post(input: CashLedgerPostInput): Promise<void> {
    if (!input.amount || input.amount <= 0) {
      throw new AppError(400, `Cash ledger amount must be > 0 (got ${input.amount})`);
    }

    const data: Prisma.CashLedgerEntryCreateInput = {
      organization: { connect: { id: input.organizationId } },
      branch: { connect: { id: input.branchId } },
      businessDate: CashLedgerService.toBusinessDate(input.businessDate),
      shiftInstance: input.shiftInstanceId
        ? { connect: { id: input.shiftInstanceId } }
        : undefined,
      direction: input.direction,
      source: input.source,
      sourceId: input.sourceId || null,
      amount: new Prisma.Decimal(input.amount),
      memo: input.memo || null,
      createdByUser: input.createdBy
        ? { connect: { id: input.createdBy } }
        : undefined,
    };

    try {
      await prisma.cashLedgerEntry.create({ data });
    } catch (err: any) {
      // Idempotent: duplicate (source, sourceId, direction) → already
      // posted, nothing to do.
      if (err?.code === 'P2002') return;
      throw err;
    }
  }

  /**
   * Best-effort post for auto-hooks (sales.createFuelSale etc.). Swallows
   * errors with a warn-log so the business operation isn't blocked by a
   * ledger issue — we'd rather have a correctly-recorded sale than a
   * failed sale with a perfect ledger.
   */
  static async tryPost(input: CashLedgerPostInput): Promise<void> {
    try {
      await CashLedgerService.post(input);
    } catch (err: any) {
      console.warn(
        `[CashLedger] post failed (source=${input.source}, sourceId=${input.sourceId}): ` +
        `${err?.message || err}. Business op continues.`
      );
    }
  }

  static async reverse(
    entryId: string,
    reversedBy: string,
    reason: string,
  ): Promise<void> {
    const existing = await prisma.cashLedgerEntry.findUnique({ where: { id: entryId } });
    if (!existing) throw new AppError(404, `Cash ledger entry ${entryId} not found`);
    if (existing.reversedAt) {
      throw new AppError(400, `Cash ledger entry ${entryId} is already reversed`);
    }
    await prisma.cashLedgerEntry.update({
      where: { id: entryId },
      data: {
        reversedAt: new Date(),
        reversedBy,
        reversalReason: reason,
      },
    });
  }

  static async getDaySummary(
    organizationId: string,
    branchId: string,
    businessDate: Date | string,
  ): Promise<CashLedgerDaySummary> {
    const day = CashLedgerService.toBusinessDate(businessDate);
    const rows = await prisma.cashLedgerEntry.findMany({
      where: {
        organizationId,
        branchId,
        businessDate: day,
        reversedAt: null,
      },
      orderBy: { createdAt: 'asc' },
    });

    const inflowsBySource = new Map<CashSource, { total: number; count: number }>();
    const outflowsBySource = new Map<CashSource, { total: number; count: number }>();
    let inTotal = 0;
    let outTotal = 0;

    for (const r of rows) {
      const amt = Number(r.amount);
      const src = r.source as CashSource;
      if (r.direction === 'IN') {
        inTotal += amt;
        const bucket = inflowsBySource.get(src) || { total: 0, count: 0 };
        inflowsBySource.set(src, { total: bucket.total + amt, count: bucket.count + 1 });
      } else {
        outTotal += amt;
        const bucket = outflowsBySource.get(src) || { total: 0, count: 0 };
        outflowsBySource.set(src, { total: bucket.total + amt, count: bucket.count + 1 });
      }
    }

    const toArr = (m: Map<CashSource, { total: number; count: number }>) =>
      Array.from(m.entries()).map(([source, v]) => ({ source, total: v.total, count: v.count }));

    return {
      businessDate: day.toISOString().slice(0, 10),
      branchId,
      inflows: { total: inTotal, bySource: toArr(inflowsBySource) },
      outflows: { total: outTotal, bySource: toArr(outflowsBySource) },
      net: inTotal - outTotal,
      entries: rows.map((r) => ({
        id: r.id,
        createdAt: r.createdAt,
        direction: r.direction as CashDirection,
        source: r.source as CashSource,
        sourceId: r.sourceId,
        amount: Number(r.amount),
        memo: r.memo,
        createdBy: r.createdBy,
      })),
    };
  }
}
