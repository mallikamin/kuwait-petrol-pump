import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { AppError } from '../../middleware/error.middleware';
import { CashLedgerService } from '../cash-ledger/cash-ledger.service';

export type DepositMethod = 'cash' | 'ibft' | 'bank_card' | 'pso_card';

const DEPOSIT_KIND: Record<DepositMethod, string> = {
  cash: 'DEPOSIT_CASH',
  ibft: 'DEPOSIT_IBFT',
  bank_card: 'DEPOSIT_BANK_CARD',
  pso_card: 'DEPOSIT_PSO_CARD',
};

export interface DepositInput {
  organizationId: string;
  userId: string;
  customerId: string;
  branchId: string;
  businessDate: string;
  method: DepositMethod;
  amount: number;
  bankId?: string;
  referenceNumber?: string;
  memo?: string;
  shiftInstanceId?: string;
}

export interface CashHandoutInput {
  organizationId: string;
  userId: string;
  customerId: string;
  branchId: string;
  businessDate: string;
  amount: number;
  memo?: string;
  shiftInstanceId?: string;
}

export class CustomerAdvanceService {
  /**
   * Current advance balance for a customer. Positive = pump holds their
   * advance; zero means fully utilised; negative is technically impossible
   * (caller should have rejected the usage) but we surface the raw number
   * so audit tooling can spot corruption.
   */
  static async getBalance(
    organizationId: string,
    customerId: string,
  ): Promise<{ customerId: string; balance: number; inTotal: number; outTotal: number }> {
    const rows = await prisma.customerAdvanceMovement.findMany({
      where: { organizationId, customerId, voidedAt: null },
      select: { direction: true, amount: true },
    });
    let inT = 0;
    let outT = 0;
    for (const r of rows) {
      const n = Number(r.amount);
      if (r.direction === 'IN') inT += n;
      else outT += n;
    }
    return { customerId, balance: inT - outT, inTotal: inT, outTotal: outT };
  }

  static async listMovements(params: {
    organizationId: string;
    customerId?: string;
    branchId?: string;
    startDate?: string;
    endDate?: string;
    includeVoided?: boolean;
    limit?: number;
    offset?: number;
  }) {
    const where: Prisma.CustomerAdvanceMovementWhereInput = {
      organizationId: params.organizationId,
      ...(params.customerId ? { customerId: params.customerId } : {}),
      ...(params.branchId ? { branchId: params.branchId } : {}),
      ...(params.includeVoided ? {} : { voidedAt: null }),
    };
    if (params.startDate || params.endDate) {
      where.businessDate = {
        ...(params.startDate ? { gte: new Date(`${params.startDate}T00:00:00Z`) } : {}),
        ...(params.endDate ? { lte: new Date(`${params.endDate}T23:59:59Z`) } : {}),
      };
    }
    const [items, total] = await Promise.all([
      prisma.customerAdvanceMovement.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          bank: { select: { id: true, name: true } },
          createdByUser: { select: { id: true, fullName: true, username: true } },
          voidedByUser: { select: { id: true, fullName: true, username: true } },
        },
        orderBy: [{ createdAt: 'desc' }],
        take: params.limit || 100,
        skip: params.offset || 0,
      }),
      prisma.customerAdvanceMovement.count({ where }),
    ]);
    return { items, total };
  }

  static async deposit(input: DepositInput) {
    if (input.amount <= 0) throw new AppError(400, 'Amount must be > 0');

    const [branch, customer] = await Promise.all([
      prisma.branch.findFirst({ where: { id: input.branchId, organizationId: input.organizationId } }),
      prisma.customer.findFirst({ where: { id: input.customerId, organizationId: input.organizationId } }),
    ]);
    if (!branch) throw new AppError(404, 'Branch not found');
    if (!customer) throw new AppError(404, 'Customer not found');

    // Bank required for IBFT and bank_card deposits
    if ((input.method === 'ibft' || input.method === 'bank_card') && !input.bankId) {
      throw new AppError(400, `${input.method} deposit requires a bankId`);
    }
    if (input.bankId) {
      const bank = await prisma.bank.findFirst({
        where: { id: input.bankId, organizationId: input.organizationId },
      });
      if (!bank) throw new AppError(404, 'Bank not found');
    }

    const businessDate = new Date(`${input.businessDate}T00:00:00Z`);

    const movement = await prisma.customerAdvanceMovement.create({
      data: {
        organizationId: input.organizationId,
        branchId: input.branchId,
        businessDate,
        shiftInstanceId: input.shiftInstanceId || null,
        customerId: input.customerId,
        direction: 'IN',
        kind: DEPOSIT_KIND[input.method],
        amount: new Prisma.Decimal(input.amount),
        bankId: input.bankId || null,
        referenceNumber: input.referenceNumber || null,
        memo: input.memo || null,
        createdBy: input.userId,
      },
    });

    // Cash ledger IN ONLY for cash deposits. IBFT, bank_card, pso_card do
    // not hit the physical drawer.
    if (input.method === 'cash') {
      await CashLedgerService.tryPost({
        organizationId: input.organizationId,
        branchId: input.branchId,
        businessDate,
        shiftInstanceId: input.shiftInstanceId || null,
        direction: 'IN',
        source: 'ADVANCE_DEPOSIT',
        sourceId: movement.id,
        amount: input.amount,
        memo: `Advance deposit (cash) — ${customer.name}`,
        createdBy: input.userId,
      });
    }

    // QB enqueue — one JE per deposit. Handler selects DR/CR pair based
    // on method.
    await CustomerAdvanceService.enqueueQbDepositJournal(movement.id, input.organizationId, input.method, input.amount, businessDate, input.customerId, input.bankId || null, input.memo);

    return movement;
  }

  static async cashHandout(input: CashHandoutInput) {
    if (input.amount <= 0) throw new AppError(400, 'Amount must be > 0');

    const [branch, customer] = await Promise.all([
      prisma.branch.findFirst({ where: { id: input.branchId, organizationId: input.organizationId } }),
      prisma.customer.findFirst({ where: { id: input.customerId, organizationId: input.organizationId } }),
    ]);
    if (!branch) throw new AppError(404, 'Branch not found');
    if (!customer) throw new AppError(404, 'Customer not found');

    // Validate sufficient advance balance — drivers can only be handed
    // what the customer has on account.
    const balance = await CustomerAdvanceService.getBalance(input.organizationId, input.customerId);
    if (balance.balance < input.amount) {
      throw new AppError(
        400,
        `Insufficient advance balance: customer has ${balance.balance.toFixed(2)} PKR, requested ${input.amount.toFixed(2)} PKR`,
      );
    }

    const businessDate = new Date(`${input.businessDate}T00:00:00Z`);

    const movement = await prisma.customerAdvanceMovement.create({
      data: {
        organizationId: input.organizationId,
        branchId: input.branchId,
        businessDate,
        shiftInstanceId: input.shiftInstanceId || null,
        customerId: input.customerId,
        direction: 'OUT',
        kind: 'CASH_HANDOUT',
        amount: new Prisma.Decimal(input.amount),
        memo: input.memo || null,
        createdBy: input.userId,
      },
    });

    // Cash ledger OUT — money leaves the drawer.
    await CashLedgerService.tryPost({
      organizationId: input.organizationId,
      branchId: input.branchId,
      businessDate,
      shiftInstanceId: input.shiftInstanceId || null,
      direction: 'OUT',
      source: 'DRIVER_HANDOUT',
      sourceId: movement.id,
      amount: input.amount,
      memo: `Driver cash handout — ${customer.name}${input.memo ? ` (${input.memo})` : ''}`,
      createdBy: input.userId,
    });

    // QB JE: DR Customer Advance (EntityRef = customer) / CR Cash.
    await CustomerAdvanceService.enqueueQbHandoutJournal(movement.id, input.organizationId, input.amount, businessDate, input.customerId, input.memo);

    return movement;
  }

  static async voidMovement(
    organizationId: string,
    movementId: string,
    userId: string,
    reason: string,
  ) {
    const existing = await prisma.customerAdvanceMovement.findUnique({ where: { id: movementId } });
    if (!existing || existing.organizationId !== organizationId) {
      throw new AppError(404, 'Movement not found');
    }
    if (existing.voidedAt) throw new AppError(400, 'Movement already voided');

    // If voiding an OUT (handout), verify the customer's balance after
    // void won't go negative from ANOTHER outstanding movement. Actually
    // — voiding an OUT ADDS back to balance; voiding an IN SUBTRACTS.
    // Only the second case can push balance negative.
    if (existing.direction === 'IN') {
      const bal = await CustomerAdvanceService.getBalance(organizationId, existing.customerId);
      const afterVoid = bal.balance - Number(existing.amount);
      if (afterVoid < 0) {
        throw new AppError(
          400,
          `Cannot void this deposit — customer would have a negative advance balance (${afterVoid.toFixed(2)} PKR). ` +
          `Reverse the usage movements first.`,
        );
      }
    }

    await prisma.customerAdvanceMovement.update({
      where: { id: movementId },
      data: { voidedAt: new Date(), voidedBy: userId, voidReason: reason },
    });

    // Reverse paired cash ledger post, if any.
    // Cash deposits post source=ADVANCE_DEPOSIT; handouts post source=DRIVER_HANDOUT.
    const source = existing.direction === 'IN' ? 'ADVANCE_DEPOSIT' : 'DRIVER_HANDOUT';
    const ledger = await prisma.cashLedgerEntry.findFirst({
      where: { source, sourceId: movementId },
    });
    if (ledger && !ledger.reversedAt) {
      await CashLedgerService.reverse(ledger.id, userId, `Advance movement void: ${reason}`);
    }
  }

  // ───────────────────────────────────────────────────────────────────
  // QB enqueue helpers. Private + static — same shape as expense module.
  // Best-effort; failure does not roll back the movement.
  // ───────────────────────────────────────────────────────────────────

  private static async enqueueQbDepositJournal(
    movementId: string,
    organizationId: string,
    method: DepositMethod,
    amount: number,
    txnDate: Date,
    customerId: string,
    bankId: string | null,
    memo?: string | null,
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
          jobType: 'create_advance_deposit_journal',
          entityType: 'customer_advance',
          entityId: movementId,
          priority: 5,
          status: 'pending',
          approvalStatus: 'approved',
          idempotencyKey: `qb-adv-deposit-${movementId}`,
          payload: {
            movementId,
            organizationId,
            method,
            amount,
            txnDate: txnDate.toISOString().slice(0, 10),
            customerId,
            bankId,
            memo: memo || null,
          },
        },
      });
    } catch (err: any) {
      console.warn(
        `[QB enqueue][adv deposit ${movementId}] Enqueue failed: ${err?.message || err}.`
      );
    }
  }

  private static async enqueueQbHandoutJournal(
    movementId: string,
    organizationId: string,
    amount: number,
    txnDate: Date,
    customerId: string,
    memo?: string | null,
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
          jobType: 'create_advance_handout_journal',
          entityType: 'customer_advance',
          entityId: movementId,
          priority: 5,
          status: 'pending',
          approvalStatus: 'approved',
          idempotencyKey: `qb-adv-handout-${movementId}`,
          payload: {
            movementId,
            organizationId,
            amount,
            txnDate: txnDate.toISOString().slice(0, 10),
            customerId,
            memo: memo || null,
          },
        },
      });
    } catch (err: any) {
      console.warn(
        `[QB enqueue][adv handout ${movementId}] Enqueue failed: ${err?.message || err}.`
      );
    }
  }
}
