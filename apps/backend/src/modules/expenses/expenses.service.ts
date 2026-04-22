import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { AppError } from '../../middleware/error.middleware';
import { CashLedgerService } from '../cash-ledger/cash-ledger.service';

export interface CreateEntryInput {
  organizationId: string;
  branchId: string;
  businessDate: string; // YYYY-MM-DD
  expenseAccountId: string;
  amount: number;
  memo?: string;
  attachmentPath?: string;
  shiftInstanceId?: string;
  userId: string;
}

export interface ListEntriesInput {
  organizationId: string;
  branchId: string;
  startDate?: string;
  endDate?: string;
  expenseAccountId?: string;
  includeVoided?: boolean;
  limit?: number;
  offset?: number;
}

export class ExpensesService {
  static async listAccounts(organizationId: string, includeInactive: boolean) {
    return prisma.expenseAccount.findMany({
      where: { organizationId, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
    });
  }

  static async createAccount(params: {
    organizationId: string;
    label: string;
    qbAccountName?: string;
    sortOrder?: number;
  }) {
    try {
      return await prisma.expenseAccount.create({
        data: {
          organizationId: params.organizationId,
          label: params.label,
          qbAccountName: params.qbAccountName || null,
          sortOrder: params.sortOrder ?? 100,
        },
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new AppError(409, `Expense account "${params.label}" already exists`);
      }
      throw err;
    }
  }

  static async updateAccount(
    organizationId: string,
    accountId: string,
    patch: Prisma.ExpenseAccountUpdateInput,
  ) {
    const existing = await prisma.expenseAccount.findUnique({ where: { id: accountId } });
    if (!existing || existing.organizationId !== organizationId) {
      throw new AppError(404, 'Expense account not found');
    }
    return prisma.expenseAccount.update({ where: { id: accountId }, data: patch });
  }

  static async createEntry(input: CreateEntryInput) {
    // Verify account belongs to org + is active
    const account = await prisma.expenseAccount.findUnique({
      where: { id: input.expenseAccountId },
    });
    if (!account || account.organizationId !== input.organizationId) {
      throw new AppError(404, 'Expense account not found');
    }
    if (!account.isActive) {
      throw new AppError(400, 'Expense account is inactive');
    }

    // Verify branch belongs to org
    const branch = await prisma.branch.findFirst({
      where: { id: input.branchId, organizationId: input.organizationId },
    });
    if (!branch) throw new AppError(404, 'Branch not found');

    const businessDate = new Date(`${input.businessDate}T00:00:00Z`);

    const entry = await prisma.expenseEntry.create({
      data: {
        organizationId: input.organizationId,
        branchId: input.branchId,
        businessDate,
        shiftInstanceId: input.shiftInstanceId || null,
        expenseAccountId: input.expenseAccountId,
        amount: new Prisma.Decimal(input.amount),
        memo: input.memo || null,
        attachmentPath: input.attachmentPath || null,
        createdBy: input.userId,
      },
    });

    // Cash ledger OUT — source=EXPENSE, paired to this entry for traceability.
    await CashLedgerService.tryPost({
      organizationId: input.organizationId,
      branchId: input.branchId,
      businessDate,
      shiftInstanceId: input.shiftInstanceId || null,
      direction: 'OUT',
      source: 'EXPENSE',
      sourceId: entry.id,
      amount: input.amount,
      memo: `Expense: ${account.label}${input.memo ? ` — ${input.memo}` : ''}`,
      createdBy: input.userId,
    });

    // QB enqueue — create_cash_expense job. The handler will look up the
    // QB account by qbAccountName and post a QB Purchase with
    // AccountBasedExpenseLineDetail paid from the mapped cash account.
    await ExpensesService.enqueueQbCashExpense(entry.id, input.organizationId, account.qbAccountName, account.label, input.amount, businessDate, input.memo);

    return entry;
  }

  static async voidEntry(
    organizationId: string,
    entryId: string,
    userId: string,
    reason: string,
  ) {
    const existing = await prisma.expenseEntry.findUnique({ where: { id: entryId } });
    if (!existing || existing.organizationId !== organizationId) {
      throw new AppError(404, 'Expense entry not found');
    }
    if (existing.voidedAt) {
      throw new AppError(400, 'Expense entry is already voided');
    }

    await prisma.expenseEntry.update({
      where: { id: entryId },
      data: {
        voidedAt: new Date(),
        voidedBy: userId,
        voidReason: reason,
      },
    });

    // Reverse the paired cash ledger entry. Find by (source, sourceId, direction).
    const ledger = await prisma.cashLedgerEntry.findFirst({
      where: { source: 'EXPENSE', sourceId: entryId, direction: 'OUT' },
    });
    if (ledger && !ledger.reversedAt) {
      await CashLedgerService.reverse(ledger.id, userId, `Expense void: ${reason}`);
    }
  }

  static async listEntries(input: ListEntriesInput) {
    const where: Prisma.ExpenseEntryWhereInput = {
      organizationId: input.organizationId,
      branchId: input.branchId,
      ...(input.includeVoided ? {} : { voidedAt: null }),
      ...(input.expenseAccountId ? { expenseAccountId: input.expenseAccountId } : {}),
    };
    if (input.startDate || input.endDate) {
      where.businessDate = {
        ...(input.startDate ? { gte: new Date(`${input.startDate}T00:00:00Z`) } : {}),
        ...(input.endDate ? { lte: new Date(`${input.endDate}T23:59:59Z`) } : {}),
      };
    }
    const [rows, total] = await Promise.all([
      prisma.expenseEntry.findMany({
        where,
        include: {
          expenseAccount: { select: { id: true, label: true, qbAccountName: true } },
          createdByUser: { select: { id: true, fullName: true, username: true } },
          voidedByUser: { select: { id: true, fullName: true, username: true } },
        },
        orderBy: [{ businessDate: 'desc' }, { createdAt: 'desc' }],
        take: input.limit || 100,
        skip: input.offset || 0,
      }),
      prisma.expenseEntry.count({ where }),
    ]);
    return { items: rows, total };
  }

  /**
   * Enqueue a create_cash_expense QB job. Best-effort — failure here must
   * never block the local expense persistence or the cash ledger write.
   * Logic kept private + static so callers see a clean surface.
   */
  private static async enqueueQbCashExpense(
    entryId: string,
    organizationId: string,
    qbAccountName: string | null,
    accountLabel: string,
    amount: number,
    txnDate: Date,
    memo?: string,
  ): Promise<void> {
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
          jobType: 'create_cash_expense',
          entityType: 'expense',
          entityId: entryId,
          priority: 5,
          status: 'pending',
          approvalStatus: 'approved',
          idempotencyKey: `qb-expense-${entryId}`,
          payload: {
            expenseId: entryId,
            organizationId,
            qbAccountName: qbAccountName || null,
            accountLabel,
            amount,
            txnDate: txnDate.toISOString().slice(0, 10),
            memo: memo || null,
          },
        },
      });
    } catch (err: any) {
      console.warn(
        `[QB enqueue][expense ${entryId}] Enqueue failed: ${err?.message || err}. ` +
        `Expense persisted; QB sync will need a manual replay.`
      );
    }
  }
}
