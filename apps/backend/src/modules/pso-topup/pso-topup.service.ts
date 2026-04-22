import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { AppError } from '../../middleware/error.middleware';
import { CashLedgerService } from '../cash-ledger/cash-ledger.service';

export interface CreateInput {
  organizationId: string;
  userId: string;
  branchId: string;
  businessDate: string;
  customerId?: string;
  psoCardLast4?: string;
  amount: number;
  memo?: string;
  shiftInstanceId?: string;
}

export class PsoTopupService {
  static async list(params: {
    organizationId: string;
    branchId: string;
    startDate?: string;
    endDate?: string;
    includeVoided?: boolean;
    limit?: number;
    offset?: number;
  }) {
    const where: Prisma.PsoTopupWhereInput = {
      organizationId: params.organizationId,
      branchId: params.branchId,
      ...(params.includeVoided ? {} : { voidedAt: null }),
    };
    if (params.startDate || params.endDate) {
      where.businessDate = {
        ...(params.startDate ? { gte: new Date(`${params.startDate}T00:00:00Z`) } : {}),
        ...(params.endDate ? { lte: new Date(`${params.endDate}T23:59:59Z`) } : {}),
      };
    }
    const [items, total] = await Promise.all([
      prisma.psoTopup.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          createdByUser: { select: { id: true, fullName: true, username: true } },
          voidedByUser: { select: { id: true, fullName: true, username: true } },
        },
        orderBy: [{ businessDate: 'desc' }, { createdAt: 'desc' }],
        take: params.limit || 100,
        skip: params.offset || 0,
      }),
      prisma.psoTopup.count({ where }),
    ]);
    return { items, total };
  }

  static async create(input: CreateInput) {
    if (input.amount <= 0) throw new AppError(400, 'Amount must be > 0');

    const branch = await prisma.branch.findFirst({
      where: { id: input.branchId, organizationId: input.organizationId },
    });
    if (!branch) throw new AppError(404, 'Branch not found');

    if (input.customerId) {
      const customer = await prisma.customer.findFirst({
        where: { id: input.customerId, organizationId: input.organizationId },
      });
      if (!customer) throw new AppError(404, 'Customer not found');
    }

    const businessDate = new Date(`${input.businessDate}T00:00:00Z`);

    const topup = await prisma.psoTopup.create({
      data: {
        organizationId: input.organizationId,
        branchId: input.branchId,
        businessDate,
        shiftInstanceId: input.shiftInstanceId || null,
        customerId: input.customerId || null,
        psoCardLast4: input.psoCardLast4 || null,
        amount: new Prisma.Decimal(input.amount),
        memo: input.memo || null,
        createdBy: input.userId,
      },
    });

    // Cash ledger IN — the customer actually handed over cash.
    await CashLedgerService.tryPost({
      organizationId: input.organizationId,
      branchId: input.branchId,
      businessDate,
      shiftInstanceId: input.shiftInstanceId || null,
      direction: 'IN',
      source: 'PSO_TOPUP',
      sourceId: topup.id,
      amount: input.amount,
      memo: `PSO Card top-up${input.psoCardLast4 ? ` (****${input.psoCardLast4})` : ''}${input.memo ? ` — ${input.memo}` : ''}`,
      createdBy: input.userId,
    });

    // QB enqueue — JournalEntry DR Cash / CR A/P (EntityRef = PSO vendor).
    await PsoTopupService.enqueueQbJournalEntry(topup.id, input.organizationId, input.amount, businessDate, input.memo);

    return topup;
  }

  static async voidEntry(
    organizationId: string,
    topupId: string,
    userId: string,
    reason: string,
  ) {
    const existing = await prisma.psoTopup.findUnique({ where: { id: topupId } });
    if (!existing || existing.organizationId !== organizationId) {
      throw new AppError(404, 'Top-up not found');
    }
    if (existing.voidedAt) throw new AppError(400, 'Top-up already voided');

    await prisma.psoTopup.update({
      where: { id: topupId },
      data: { voidedAt: new Date(), voidedBy: userId, voidReason: reason },
    });

    const ledger = await prisma.cashLedgerEntry.findFirst({
      where: { source: 'PSO_TOPUP', sourceId: topupId, direction: 'IN' },
    });
    if (ledger && !ledger.reversedAt) {
      await CashLedgerService.reverse(ledger.id, userId, `PSO top-up void: ${reason}`);
    }
  }

  private static async enqueueQbJournalEntry(
    topupId: string,
    organizationId: string,
    amount: number,
    txnDate: Date,
    memo?: string,
  ) {
    try {
      const connection = await prisma.qBConnection.findFirst({
        where: { organizationId, isActive: true },
        select: { id: true },
      });
      if (!connection) return;

      await prisma.qBSyncQueue.create({
        data: {
          connectionId: connection.id,
          organizationId,
          jobType: 'create_pso_topup_journal',
          entityType: 'pso_topup',
          entityId: topupId,
          priority: 5,
          status: 'pending',
          approvalStatus: 'approved',
          idempotencyKey: `qb-pso-topup-${topupId}`,
          payload: {
            topupId,
            organizationId,
            amount,
            txnDate: txnDate.toISOString().slice(0, 10),
            memo: memo || null,
          },
        },
      });
    } catch (err: any) {
      console.warn(
        `[QB enqueue][pso-topup ${topupId}] Enqueue failed: ${err?.message || err}. ` +
        `Top-up persisted; QB sync will need a manual replay.`
      );
    }
  }
}
