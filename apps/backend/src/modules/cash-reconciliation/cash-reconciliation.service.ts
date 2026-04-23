import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { AppError } from '../../middleware/error.middleware';
import { CashLedgerService } from '../cash-ledger/cash-ledger.service';
import { randomUUID } from 'crypto';

export interface ReconciliationPreview {
  branchId: string;
  businessDate: string; // YYYY-MM-DD
  expectedCash: number;
  inflows: {
    total: number;
    bySource: Array<{ source: string; total: number; count: number }>;
  };
  outflows: {
    total: number;
    bySource: Array<{ source: string; total: number; count: number }>;
  };
  // Every individual ledger row for this branch/day. The UI renders these
  // grouped by source so the accountant can drill from the summary into
  // line-level transactions without leaving the page.
  entries: Array<{
    id: string;
    createdAt: string;
    direction: 'IN' | 'OUT';
    source: string;
    sourceId: string | null;
    amount: number;
    memo: string | null;
    createdBy: string | null;
  }>;
  physicalCash: number | null;
  variance: number | null;
  status: 'open' | 'closed';
  existingId: string | null;
  notes: string | null;
  submittedBy: { id: string; fullName: string | null; username: string } | null;
  submittedAt: string | null;
  closedBy: { id: string; fullName: string | null; username: string } | null;
  closedAt: string | null;
}

export interface SubmitInput {
  organizationId: string;
  userId: string;
  branchId: string;
  businessDate: string; // YYYY-MM-DD
  physicalCash: number;
  notes?: string;
  close?: boolean; // true = close the day (lock)
}

export class CashReconciliationService {
  static async getPreview(
    organizationId: string,
    branchId: string,
    businessDate: string,
  ): Promise<ReconciliationPreview> {
    const summary = await CashLedgerService.getDaySummary(organizationId, branchId, businessDate);
    const existing = await prisma.cashReconciliation.findUnique({
      where: { unique_recon_branch_date: { branchId, businessDate: new Date(`${businessDate}T00:00:00Z`) } },
      include: {
        submittedByUser: { select: { id: true, fullName: true, username: true } },
        closedByUser: { select: { id: true, fullName: true, username: true } },
      },
    });

    const expectedCash = summary.inflows.total - summary.outflows.total;

    return {
      branchId,
      businessDate,
      expectedCash,
      inflows: summary.inflows,
      outflows: summary.outflows,
      entries: summary.entries.map((e) => ({
        id: e.id,
        createdAt: e.createdAt.toISOString(),
        direction: e.direction,
        source: e.source,
        sourceId: e.sourceId,
        amount: e.amount,
        memo: e.memo,
        createdBy: e.createdBy,
      })),
      physicalCash: existing ? Number(existing.physicalCash) : null,
      variance: existing ? Number(existing.variance) : null,
      status: (existing?.status as 'open' | 'closed') || 'open',
      existingId: existing?.id || null,
      notes: existing?.notes || null,
      submittedBy: existing?.submittedByUser || null,
      submittedAt: existing?.submittedAt?.toISOString() || null,
      closedBy: existing?.closedByUser || null,
      closedAt: existing?.closedAt?.toISOString() || null,
    };
  }

  static async submit(input: SubmitInput) {
    const businessDateUtc = new Date(`${input.businessDate}T00:00:00Z`);

    // Fresh compute of expected cash at submission time — don't rely on the
    // client's snapshot; the supervisor may have booked a late expense.
    const summary = await CashLedgerService.getDaySummary(
      input.organizationId,
      input.branchId,
      input.businessDate,
    );
    const expectedCash = summary.inflows.total - summary.outflows.total;
    const variance = input.physicalCash - expectedCash;

    const existing = await prisma.cashReconciliation.findUnique({
      where: { unique_recon_branch_date: { branchId: input.branchId, businessDate: businessDateUtc } },
    });

    if (existing?.status === 'closed') {
      throw new AppError(400, 'Reconciliation for this day is closed. Reopen before editing.');
    }

    const recon = existing
      ? await prisma.cashReconciliation.update({
          where: { id: existing.id },
          data: {
            expectedCash: new Prisma.Decimal(expectedCash),
            physicalCash: new Prisma.Decimal(input.physicalCash),
            variance: new Prisma.Decimal(variance),
            notes: input.notes ?? existing.notes,
            submittedBy: input.userId,
            submittedAt: new Date(),
            status: input.close ? 'closed' : 'open',
            closedBy: input.close ? input.userId : null,
            closedAt: input.close ? new Date() : null,
          },
        })
      : await prisma.cashReconciliation.create({
          data: {
            organizationId: input.organizationId,
            branchId: input.branchId,
            businessDate: businessDateUtc,
            expectedCash: new Prisma.Decimal(expectedCash),
            physicalCash: new Prisma.Decimal(input.physicalCash),
            variance: new Prisma.Decimal(variance),
            notes: input.notes || null,
            submittedBy: input.userId,
            submittedAt: new Date(),
            status: input.close ? 'closed' : 'open',
            closedBy: input.close ? input.userId : null,
            closedAt: input.close ? new Date() : null,
          },
        });

    // On close: post variance to the cash ledger as COUNTER_VARIANCE so
    // subsequent day summaries reflect the true count. If a prior variance
    // post exists (re-close), reverse it first.
    if (input.close && Math.abs(variance) > 0.005) {
      // Reverse any existing variance post.
      const priorLedger = await prisma.cashLedgerEntry.findFirst({
        where: { source: 'COUNTER_VARIANCE', sourceId: recon.id },
      });
      if (priorLedger && !priorLedger.reversedAt) {
        await CashLedgerService.reverse(priorLedger.id, input.userId, 'Re-close recon — replaced');
      }
      // Post fresh variance: positive → IN (over), negative → OUT (short).
      const direction = variance > 0 ? 'IN' : 'OUT';
      const newVarianceId = randomUUID();
      await CashLedgerService.tryPost({
        organizationId: input.organizationId,
        branchId: input.branchId,
        businessDate: businessDateUtc,
        direction,
        source: 'COUNTER_VARIANCE',
        sourceId: newVarianceId,
        amount: Math.abs(variance),
        memo: `EOD variance: physical=${input.physicalCash.toFixed(2)} expected=${expectedCash.toFixed(2)}`,
        createdBy: input.userId,
      });
      await prisma.cashReconciliation.update({
        where: { id: recon.id },
        data: { varianceLedgerId: newVarianceId },
      });
    }

    return recon;
  }

  static async reopen(
    organizationId: string,
    reconId: string,
    userId: string,
    reason: string,
  ) {
    const existing = await prisma.cashReconciliation.findUnique({ where: { id: reconId } });
    if (!existing || existing.organizationId !== organizationId) {
      throw new AppError(404, 'Reconciliation not found');
    }
    if (existing.status !== 'closed') {
      throw new AppError(400, 'Reconciliation is already open');
    }

    // Reverse the variance ledger post if any
    const ledger = existing.varianceLedgerId
      ? await prisma.cashLedgerEntry.findFirst({
          where: { source: 'COUNTER_VARIANCE', sourceId: existing.varianceLedgerId },
        })
      : null;
    if (ledger && !ledger.reversedAt) {
      await CashLedgerService.reverse(ledger.id, userId, `Recon reopened: ${reason}`);
    }

    await prisma.cashReconciliation.update({
      where: { id: reconId },
      data: {
        status: 'open',
        closedBy: null,
        closedAt: null,
        notes: existing.notes
          ? `${existing.notes}\n[Reopened ${new Date().toISOString()} by ${userId}: ${reason}]`
          : `[Reopened ${new Date().toISOString()} by ${userId}: ${reason}]`,
      },
    });
  }
}
