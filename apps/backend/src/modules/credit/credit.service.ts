import { prisma } from '../../config/database';
import { Prisma } from '@prisma/client';
import { AppError } from '../../middleware/error.middleware';

// ============================================================
// DTOs and Interfaces
// ============================================================

export interface CreateReceiptInput {
  customerId: string;
  branchId: string;
  receiptDatetime: Date;
  amount: number;
  paymentMethod: 'cash' | 'cheque' | 'bank_transfer' | 'online';
  bankId?: string;
  referenceNumber?: string;
  notes?: string;
  attachmentPath?: string;
  allocationMode: 'FIFO' | 'MANUAL';
  allocations?: Array<{
    sourceType: 'BACKDATED_TRANSACTION' | 'SALE';
    sourceId: string;
    amount: number;
  }>;
}

export interface UpdateReceiptInput {
  branchId?: string;
  receiptDatetime?: Date;
  amount?: number;
  paymentMethod?: 'cash' | 'cheque' | 'bank_transfer' | 'online';
  bankId?: string | null;
  referenceNumber?: string | null;
  notes?: string | null;
  attachmentPath?: string | null;
  allocationMode?: 'FIFO' | 'MANUAL';
  allocations?: Array<{
    sourceType: 'BACKDATED_TRANSACTION' | 'SALE';
    sourceId: string;
    amount: number;
  }>;
}

export interface CustomerBalanceDto {
  customerId: string;
  currentBalance: number;
  driftCorrected: boolean;
  driftAmount: number;
  creditLimit: number | null;
  branchLimit: number | null;
  utilizationPct: number;
}

export interface CreditCheckResult {
  allowed: boolean;
  warning: boolean;
  currentBalance: number;
  creditLimit: number | null;
  proposedAmount: number;
  newBalance: number;
  utilizationPct: number;
  message: string;
}

export interface LedgerEntry {
  id: string;
  date: Date;
  type: 'INVOICE' | 'RECEIPT';
  sourceType: string;
  description: string;
  vehicleNumber: string | null;
  slipNumber: string | null;
  receiptNumber: string | null;
  debit: number;
  credit: number;
  balance: number;
  createdBy: string | null;
}

export interface LedgerResponse {
  customer: {
    id: string;
    name: string;
    phone: string | null;
    creditLimit: number | null;
    currentBalance: number;
    branchLimit: number | null;
  };
  entries: LedgerEntry[];
  summary: {
    openingBalance: number;
    totalDebit: number;
    totalCredit: number;
    closingBalance: number;
  };
  vehicleBreakdown: Array<{
    vehicleNumber: string;
    totalAmount: number;
    transactionCount: number;
  }>;
  pagination: {
    total: number;
    limit: number;
    offset: number;
  };
}

export interface OpenInvoice {
  id: string;
  sourceType: 'BACKDATED_TRANSACTION' | 'SALE';
  date: Date;
  vehicleNumber: string | null;
  slipNumber: string | null;
  description: string;
  totalAmount: number;
  allocatedAmount: number;
  openAmount: number;
}

// ============================================================
// Credit Service
// ============================================================

export class CreditService {
  /**
   * Generate next receipt number for the organization
   * Format: RCP-YYYYMMDD-NNN
   */
  private async generateReceiptNumber(
    organizationId: string,
    receiptDate: Date,
    tx: Prisma.TransactionClient
  ): Promise<string> {
    const dateStr = receiptDate.toISOString().slice(0, 10).replace(/-/g, '');
    const prefix = `RCP-${dateStr}-`;

    const lastReceipt = await tx.customerReceipt.findFirst({
      where: {
        organizationId,
        receiptNumber: {
          startsWith: prefix,
        },
      },
      orderBy: {
        receiptNumber: 'desc',
      },
    });

    let sequence = 1;
    if (lastReceipt) {
      const lastSeq = parseInt(lastReceipt.receiptNumber.split('-')[2], 10);
      sequence = lastSeq + 1;
    }

    return `${prefix}${sequence.toString().padStart(3, '0')}`;
  }

  /**
   * Full recalculation of customer balance from ALL sources
   * Returns live balance (always authoritative)
   */
  private async recalculateBalance(
    customerId: string,
    tx?: Prisma.TransactionClient
  ): Promise<number> {
    const client = tx || prisma;

    // Source A: BackdatedTransactions (credit_customer)
    const backdatedDebits = await client.$queryRaw<Array<{ total: string }>>`
      SELECT COALESCE(SUM(line_total), 0) as total
      FROM backdated_transactions
      WHERE customer_id = ${customerId}::uuid
        AND payment_method = 'credit_customer'
        AND deleted_at IS NULL
    `;

    // Source B: Sales (real-time POS credit, excluding backdated-originated)
    const salesDebits = await client.$queryRaw<Array<{ total: string }>>`
      SELECT COALESCE(SUM(total_amount), 0) as total
      FROM sales
      WHERE customer_id = ${customerId}::uuid
        AND payment_method IN ('credit', 'credit_customer')
        AND (offline_queue_id IS NULL OR offline_queue_id NOT LIKE 'backdated-%')
    `;

    // Source C: CustomerReceipts
    const receiptCredits = await client.$queryRaw<Array<{ total: string }>>`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM customer_receipts
      WHERE customer_id = ${customerId}::uuid
        AND deleted_at IS NULL
    `;

    const totalDebits = parseFloat(backdatedDebits[0].total) + parseFloat(salesDebits[0].total);
    const totalCredits = parseFloat(receiptCredits[0].total);

    return totalDebits - totalCredits;
  }

  /**
   * Validate organization isolation for receipt operations
   * Throws 403 if org mismatch detected (tenant boundary violation)
   */
  private async validateOrgIsolation(
    organizationId: string,
    customerId: string,
    branchId: string,
    bankId?: string,
    tx?: Prisma.TransactionClient
  ): Promise<void> {
    const client = tx || prisma;

    // Verify customer belongs to organization
    const customer = await client.customer.findUnique({
      where: { id: customerId },
      select: { organizationId: true },
    });

    if (!customer || customer.organizationId !== organizationId) {
      throw new AppError(403, 'Customer does not belong to this organization');
    }

    // Verify branch belongs to organization
    const branch = await client.branch.findUnique({
      where: { id: branchId },
      select: { organizationId: true },
    });

    if (!branch || branch.organizationId !== organizationId) {
      throw new AppError(403, 'Branch does not belong to this organization');
    }

    // If bank provided, verify it belongs to organization
    if (bankId) {
      const bank = await client.bank.findUnique({
        where: { id: bankId },
        select: { organizationId: true },
      });

      if (!bank || bank.organizationId !== organizationId) {
        throw new AppError(403, 'Bank does not belong to this organization');
      }
    }
  }

  /**
   * Validate allocations against business rules
   * Rule 1: SUM(allocations) <= receipt.amount
   * Rule 2: Each allocation.amount > 0
   * Rule 3: Target belongs to same customer
   * Rule 4: Target is open invoice
   * Rule 5: No over-allocation (concurrency-safe with FOR UPDATE)
   */
  private async validateAllocations(
    tx: Prisma.TransactionClient,
    customerId: string,
    allocations: Array<{ sourceType: string; sourceId: string; amount: number }>,
    receiptAmount: number,
    excludeReceiptId?: string
  ): Promise<void> {
    // Rule 1: sum <= receipt amount
    const allocTotal = allocations.reduce((s, a) => s + a.amount, 0);
    if (allocTotal > receiptAmount) {
      throw new AppError(
        400,
        `Allocation total ${allocTotal.toFixed(2)} exceeds receipt amount ${receiptAmount.toFixed(2)}`
      );
    }

    // Rule 2: each > 0 (enforced by Zod, but double-check)
    if (allocations.some((a) => a.amount <= 0)) {
      throw new AppError(400, 'All allocation amounts must be positive');
    }

    for (const alloc of allocations) {
      // Rule 3 + 5: target belongs to same customer + get lock
      let invoiceAmount: number;
      if (alloc.sourceType === 'BACKDATED_TRANSACTION') {
        const rows = await tx.$queryRaw<Array<{ line_total: string; customer_id: string }>>`
          SELECT line_total, customer_id FROM backdated_transactions
          WHERE id = ${alloc.sourceId}::uuid AND deleted_at IS NULL
          FOR UPDATE
        `;

        if (!rows.length || rows[0].customer_id !== customerId) {
          throw new AppError(400, `Invoice ${alloc.sourceId} not found or wrong customer`);
        }
        invoiceAmount = parseFloat(rows[0].line_total);
      } else if (alloc.sourceType === 'SALE') {
        const rows = await tx.$queryRaw<Array<{ total_amount: string; customer_id: string }>>`
          SELECT total_amount, customer_id FROM sales
          WHERE id = ${alloc.sourceId}::uuid
          FOR UPDATE
        `;

        if (!rows.length || rows[0].customer_id !== customerId) {
          throw new AppError(400, `Sale ${alloc.sourceId} not found or wrong customer`);
        }
        invoiceAmount = parseFloat(rows[0].total_amount);
      } else {
        throw new AppError(400, `Invalid source type: ${alloc.sourceType}`);
      }

      // Rule 4+5: no over-allocation (with row lock from FOR UPDATE above)
      const existing = await tx.$queryRaw<Array<{ total: string }>>`
        SELECT COALESCE(SUM(allocated_amount), 0) as total
        FROM customer_receipt_allocations cra
        JOIN customer_receipts cr ON cra.receipt_id = cr.id
        WHERE cra.source_type = ${alloc.sourceType}
          AND cra.source_id = ${alloc.sourceId}::uuid
          AND cr.deleted_at IS NULL
          ${excludeReceiptId ? Prisma.sql`AND cr.id != ${excludeReceiptId}::uuid` : Prisma.empty}
      `;

      const alreadyAllocated = parseFloat(existing[0].total);
      const remainingOpen = invoiceAmount - alreadyAllocated;

      if (alloc.amount > remainingOpen + 0.01) {
        // 0.01 tolerance for rounding
        throw new AppError(
          400,
          `Cannot allocate ${alloc.amount.toFixed(2)} to invoice ${alloc.sourceId}: ` +
            `only ${remainingOpen.toFixed(2)} remaining (${invoiceAmount.toFixed(2)} total, ${alreadyAllocated.toFixed(2)} already allocated)`
        );
      }
    }
  }

  /**
   * Auto-allocate receipt to open invoices using FIFO (oldest first)
   */
  private async autoAllocateFIFO(
    tx: Prisma.TransactionClient,
    customerId: string,
    receiptAmount: number,
    receiptId: string
  ): Promise<void> {
    let remaining = receiptAmount;

    // Get all open invoices ordered by date (oldest first)
    const openInvoices = await tx.$queryRaw<
      Array<{
        id: string;
        source_type: string;
        amount: string;
        entry_date: Date;
      }>
    >`
      SELECT
        id, 'BACKDATED_TRANSACTION' as source_type, line_total as amount,
        transaction_datetime as entry_date
      FROM backdated_transactions
      WHERE customer_id = ${customerId}::uuid
        AND payment_method = 'credit_customer'
        AND deleted_at IS NULL

      UNION ALL

      SELECT
        id, 'SALE' as source_type, total_amount as amount,
        sale_date as entry_date
      FROM sales
      WHERE customer_id = ${customerId}::uuid
        AND payment_method IN ('credit', 'credit_customer')
        AND (offline_queue_id IS NULL OR offline_queue_id NOT LIKE 'backdated-%')

      ORDER BY entry_date ASC
    `;

    for (const invoice of openInvoices) {
      if (remaining <= 0) break;

      // How much is already allocated to this invoice?
      const existing = await tx.$queryRaw<Array<{ total: string }>>`
        SELECT COALESCE(SUM(allocated_amount), 0) as total
        FROM customer_receipt_allocations cra
        JOIN customer_receipts cr ON cra.receipt_id = cr.id
        WHERE cra.source_type = ${invoice.source_type}
          AND cra.source_id = ${invoice.id}::uuid
          AND cr.deleted_at IS NULL
      `;

      const alreadyAllocated = parseFloat(existing[0].total);
      const invoiceAmount = parseFloat(invoice.amount);
      const openAmount = invoiceAmount - alreadyAllocated;

      if (openAmount <= 0) continue; // Fully paid

      const allocateNow = Math.min(remaining, openAmount);

      await tx.customerReceiptAllocation.create({
        data: {
          receiptId,
          sourceType: invoice.source_type,
          sourceId: invoice.id,
          allocatedAmount: allocateNow,
        },
      });

      remaining -= allocateNow;
    }

    // Any remaining amount = overpayment/advance — no allocation needed, balance goes negative
  }

  /**
   * Create a new receipt with allocations
   */
  async createReceipt(
    organizationId: string,
    userId: string,
    data: CreateReceiptInput
  ): Promise<any> {
    return await prisma.$transaction(async (tx) => {
      // 1. Validate org isolation (403 on mismatch)
      await this.validateOrgIsolation(
        organizationId,
        data.customerId,
        data.branchId,
        data.bankId,
        tx
      );

      // 2. Lock customer row to prevent concurrent balance updates
      await tx.$queryRaw`
        SELECT id FROM customers
        WHERE id = ${data.customerId}::uuid
        FOR UPDATE
      `;

      // 3. Generate receipt number
      const receiptNumber = await this.generateReceiptNumber(
        organizationId,
        data.receiptDatetime,
        tx
      );

      // 4. Create receipt
      const receipt = await tx.customerReceipt.create({
        data: {
          organizationId,
          branchId: data.branchId,
          customerId: data.customerId,
          receiptNumber,
          receiptDatetime: data.receiptDatetime,
          amount: data.amount,
          paymentMethod: data.paymentMethod,
          bankId: data.bankId,
          referenceNumber: data.referenceNumber,
          notes: data.notes,
          attachmentPath: data.attachmentPath,
          allocationMode: data.allocationMode,
          createdBy: userId,
        },
      });

      // 5. Handle allocations
      if (data.allocationMode === 'MANUAL') {
        if (!data.allocations || data.allocations.length === 0) {
          throw new AppError(400, 'Manual allocation mode requires allocations array');
        }
        await this.validateAllocations(tx, data.customerId, data.allocations, data.amount);

        for (const alloc of data.allocations) {
          await tx.customerReceiptAllocation.create({
            data: {
              receiptId: receipt.id,
              sourceType: alloc.sourceType,
              sourceId: alloc.sourceId,
              allocatedAmount: alloc.amount,
            },
          });
        }
      } else {
        // FIFO auto-allocation
        await this.autoAllocateFIFO(tx, data.customerId, data.amount, receipt.id);
      }

      // 6. Full recalculation of balance
      const newBalance = await this.recalculateBalance(data.customerId, tx);

      await tx.customer.update({
        where: { id: data.customerId },
        data: { currentBalance: newBalance },
      });

      // 7. Audit log
      await tx.auditLog.create({
        data: {
          userId,
          action: 'RECEIPT_CREATED',
          entityType: 'CUSTOMER_RECEIPT',
          entityId: receipt.id,
          changes: {
            after: {
              receiptNumber: receipt.receiptNumber,
              amount: data.amount,
              paymentMethod: data.paymentMethod,
              allocationMode: data.allocationMode,
              allocations: data.allocations || [],
            },
          },
          ipAddress: null, // Will be set by controller
        },
      });

      return receipt;
    });
  }

  /**
   * Update an existing receipt (replace allocations)
   */
  async updateReceipt(
    receiptId: string,
    organizationId: string,
    userId: string,
    data: UpdateReceiptInput
  ): Promise<any> {
    return await prisma.$transaction(async (tx) => {
      // 1. Get existing receipt
      const existing = await tx.customerReceipt.findUnique({
        where: { id: receiptId },
        include: { allocations: true },
      });

      if (!existing || existing.deletedAt) {
        throw new AppError(404, 'Receipt not found');
      }

      if (existing.organizationId !== organizationId) {
        throw new AppError(403, 'Receipt does not belong to this organization');
      }

      // 2. Validate org isolation if branch/bank changed
      if (data.branchId || data.bankId !== undefined) {
        await this.validateOrgIsolation(
          organizationId,
          existing.customerId,
          data.branchId || existing.branchId,
          data.bankId ?? existing.bankId ?? undefined,
          tx
        );
      }

      // 3. Lock customer row
      await tx.$queryRaw`
        SELECT id FROM customers
        WHERE id = ${existing.customerId}::uuid
        FOR UPDATE
      `;

      // 4. Snapshot before state
      const beforeSnapshot = {
        receiptNumber: existing.receiptNumber,
        amount: existing.amount.toNumber(),
        paymentMethod: existing.paymentMethod,
        allocationMode: existing.allocationMode,
        allocations: existing.allocations,
      };

      // 5. Delete existing allocations
      await tx.customerReceiptAllocation.deleteMany({
        where: { receiptId },
      });

      // 6. Update receipt
      const finalAmount = data.amount ?? existing.amount.toNumber();
      const finalAllocationMode = data.allocationMode ?? existing.allocationMode;

      const updated = await tx.customerReceipt.update({
        where: { id: receiptId },
        data: {
          receiptDatetime: data.receiptDatetime,
          amount: data.amount,
          paymentMethod: data.paymentMethod,
          bankId: data.bankId,
          referenceNumber: data.referenceNumber,
          notes: data.notes,
          attachmentPath: data.attachmentPath,
          allocationMode: data.allocationMode,
          updatedBy: userId,
        },
      });

      // 7. Re-allocate
      if (finalAllocationMode === 'MANUAL') {
        if (!data.allocations || data.allocations.length === 0) {
          throw new AppError(400, 'Manual allocation mode requires allocations array');
        }
        await this.validateAllocations(
          tx,
          existing.customerId,
          data.allocations,
          finalAmount,
          receiptId
        );

        for (const alloc of data.allocations) {
          await tx.customerReceiptAllocation.create({
            data: {
              receiptId: updated.id,
              sourceType: alloc.sourceType,
              sourceId: alloc.sourceId,
              allocatedAmount: alloc.amount,
            },
          });
        }
      } else {
        await this.autoAllocateFIFO(tx, existing.customerId, finalAmount, updated.id);
      }

      // 8. Recalculate balance
      const newBalance = await this.recalculateBalance(existing.customerId, tx);

      await tx.customer.update({
        where: { id: existing.customerId },
        data: { currentBalance: newBalance },
      });

      // 9. Audit log
      await tx.auditLog.create({
        data: {
          userId,
          action: 'RECEIPT_UPDATED',
          entityType: 'CUSTOMER_RECEIPT',
          entityId: receiptId,
          changes: {
            before: beforeSnapshot,
            after: {
              receiptNumber: updated.receiptNumber,
              amount: finalAmount,
              paymentMethod: updated.paymentMethod,
              allocationMode: updated.allocationMode,
              allocations: data.allocations || [],
            },
          },
          ipAddress: null,
        },
      });

      return updated;
    });
  }

  /**
   * Soft delete a receipt (restore balance)
   */
  async deleteReceipt(
    receiptId: string,
    organizationId: string,
    userId: string
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      // 1. Get existing receipt
      const existing = await tx.customerReceipt.findUnique({
        where: { id: receiptId },
        include: { allocations: true },
      });

      if (!existing || existing.deletedAt) {
        throw new AppError(404, 'Receipt not found');
      }

      if (existing.organizationId !== organizationId) {
        throw new AppError(403, 'Receipt does not belong to this organization');
      }

      // 2. Lock customer row
      await tx.$queryRaw`
        SELECT id FROM customers
        WHERE id = ${existing.customerId}::uuid
        FOR UPDATE
      `;

      // 3. Soft delete receipt
      await tx.customerReceipt.update({
        where: { id: receiptId },
        data: {
          deletedAt: new Date(),
          deletedBy: userId,
        },
      });

      // 4. Recalculate balance (receipt amount restored to balance)
      const newBalance = await this.recalculateBalance(existing.customerId, tx);

      await tx.customer.update({
        where: { id: existing.customerId },
        data: { currentBalance: newBalance },
      });

      // 5. Audit log
      await tx.auditLog.create({
        data: {
          userId,
          action: 'RECEIPT_DELETED',
          entityType: 'CUSTOMER_RECEIPT',
          entityId: receiptId,
          changes: {
            before: {
              receiptNumber: existing.receiptNumber,
              amount: existing.amount.toNumber(),
              allocations: existing.allocations,
            },
            after: null,
          },
          ipAddress: null,
        },
      });
    });
  }

  /**
   * Get customer balance with drift auto-correction
   */
  async getCustomerBalance(customerId: string, branchId?: string): Promise<CustomerBalanceDto> {
    // Always compute live balance from sources
    const liveBalance = await this.recalculateBalance(customerId);

    // Get cached balance
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        currentBalance: true,
        creditLimit: true,
        organizationId: true,
      },
    });

    if (!customer) {
      throw new AppError(404, 'Customer not found');
    }

    const cachedBalance = customer.currentBalance.toNumber();

    let driftCorrected = false;
    let driftAmount = 0;

    // Auto-correct if drift detected
    if (Math.abs(liveBalance - cachedBalance) > 0.01) {
      driftAmount = liveBalance - cachedBalance;
      await prisma.customer.update({
        where: { id: customerId },
        data: { currentBalance: liveBalance },
      });

      // Log drift event for monitoring
      await prisma.auditLog.create({
        data: {
          userId: null,
          action: 'BALANCE_DRIFT_CORRECTED',
          entityType: 'CUSTOMER',
          entityId: customerId,
          changes: { cached: cachedBalance, live: liveBalance, drift: driftAmount },
          ipAddress: null,
        },
      });

      driftCorrected = true;
    }

    // Get branch-specific limit if requested
    let branchLimit: number | null = null;
    if (branchId) {
      const limit = await this.getCreditLimit(customerId, branchId);
      branchLimit = limit;
    }

    const creditLimit = customer.creditLimit?.toNumber() ?? null;
    const effectiveLimit = branchLimit ?? creditLimit;

    return {
      customerId,
      currentBalance: liveBalance,
      driftCorrected,
      driftAmount,
      creditLimit,
      branchLimit,
      utilizationPct: effectiveLimit ? (liveBalance / effectiveLimit) * 100 : 0,
    };
  }

  /**
   * Get credit limit for customer at branch (resolution order: branch → org → null)
   */
  async getCreditLimit(customerId: string, branchId: string): Promise<number | null> {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { organizationId: true, creditLimit: true },
    });

    if (!customer) {
      throw new AppError(404, 'Customer not found');
    }

    // 1. Branch-specific limit
    const branchLimit = await prisma.customerBranchLimit.findFirst({
      where: {
        organizationId: customer.organizationId,
        customerId,
        branchId,
        isActive: true,
      },
    });

    if (branchLimit?.isActive) {
      return branchLimit.creditLimit.toNumber();
    }

    // 2. Org-wide fallback
    return customer.creditLimit?.toNumber() ?? null;
  }

  /**
   * Check credit limit (soft warning only, never blocks)
   */
  async checkCreditLimit(
    customerId: string,
    branchId: string,
    proposedAmount: number
  ): Promise<CreditCheckResult> {
    const balanceInfo = await this.getCustomerBalance(customerId, branchId);
    const limit = await this.getCreditLimit(customerId, branchId);
    const newBalance = balanceInfo.currentBalance + proposedAmount;

    return {
      allowed: true, // SOFT WARNING ONLY — never block
      warning: limit !== null && newBalance > limit,
      currentBalance: balanceInfo.currentBalance,
      creditLimit: limit,
      proposedAmount,
      newBalance,
      utilizationPct: limit ? (newBalance / limit) * 100 : 0,
      message:
        limit !== null && newBalance > limit
          ? `Warning: Balance ${newBalance.toFixed(2)} PKR exceeds limit ${limit.toFixed(2)} PKR`
          : 'Within credit limit',
    };
  }

  /**
   * Get customer ledger with running balance
   */
  async getCustomerLedger(
    customerId: string,
    filters?: {
      startDate?: Date;
      endDate?: Date;
      limit?: number;
      offset?: number;
      vehicleNumber?: string;
      entryType?: 'INVOICE' | 'RECEIPT';
      branchId?: string;
    }
  ): Promise<LedgerResponse> {
    const limit = filters?.limit ?? 100;
    const offset = filters?.offset ?? 0;

    // Get customer info
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        name: true,
        phone: true,
        creditLimit: true,
        currentBalance: true,
      },
    });

    if (!customer) {
      throw new AppError(404, 'Customer not found');
    }

    // Auto-reconcile balance on read
    const liveBalance = await this.recalculateBalance(customerId);
    const cachedBalance = customer.currentBalance.toNumber();

    if (Math.abs(liveBalance - cachedBalance) > 0.01) {
      await prisma.customer.update({
        where: { id: customerId },
        data: { currentBalance: liveBalance },
      });

      await prisma.auditLog.create({
        data: {
          userId: null,
          action: 'BALANCE_DRIFT_CORRECTED',
          entityType: 'CUSTOMER',
          entityId: customerId,
          changes: { cached: cachedBalance, live: liveBalance, drift: liveBalance - cachedBalance },
          ipAddress: null,
        },
      });
    }

    // Build ledger query
    let openingBalance = 0;

    if (filters?.startDate) {
      // Calculate opening balance (all entries before startDate)
      const openingRows = await prisma.$queryRaw<Array<{ balance: string }>>`
        SELECT COALESCE(SUM(debit_amount - credit_amount), 0) AS balance
        FROM (
          -- BackdatedTransactions before startDate
          SELECT bt.transaction_datetime AS entry_date, bt.line_total AS debit_amount, 0 AS credit_amount
          FROM backdated_transactions bt
          WHERE bt.customer_id = ${customerId}::uuid
            AND bt.payment_method = 'credit_customer'
            AND bt.deleted_at IS NULL
            AND bt.transaction_datetime < ${filters.startDate}

          UNION ALL

          -- Sales before startDate
          SELECT s.sale_date AS entry_date, s.total_amount AS debit_amount, 0 AS credit_amount
          FROM sales s
          WHERE s.customer_id = ${customerId}::uuid
            AND s.payment_method IN ('credit', 'credit_customer')
            AND (s.offline_queue_id IS NULL OR s.offline_queue_id NOT LIKE 'backdated-%')
            AND s.sale_date < ${filters.startDate}

          UNION ALL

          -- CustomerReceipts before startDate
          SELECT cr.receipt_datetime AS entry_date, 0 AS debit_amount, cr.amount AS credit_amount
          FROM customer_receipts cr
          WHERE cr.customer_id = ${customerId}::uuid
            AND cr.deleted_at IS NULL
            AND cr.receipt_datetime < ${filters.startDate}
        ) AS prior_entries
      `;

      openingBalance = parseFloat(openingRows[0].balance);
    }

    // Query ledger entries with deterministic ordering
    const whereConditions: string[] = [`bt.customer_id = '${customerId}'::uuid`];
    if (filters?.startDate) whereConditions.push(`bt.transaction_datetime >= '${filters.startDate.toISOString()}'`);
    if (filters?.endDate) whereConditions.push(`bt.transaction_datetime <= '${filters.endDate.toISOString()}'`);
    if (filters?.vehicleNumber) whereConditions.push(`bt.vehicle_number = '${filters.vehicleNumber}'`);

    const rawEntries = await prisma.$queryRaw<
      Array<{
        id: string;
        entry_date: Date;
        entry_type: string;
        source_type: string;
        debit_amount: string;
        credit_amount: string;
        vehicle_number: string | null;
        slip_number: string | null;
        receipt_number: string | null;
        description: string;
        created_by: string | null;
        created_at: Date;
      }>
    >`
      SELECT *
      FROM (
        -- Source A: BackdatedTransactions
        SELECT
          bt.id::text,
          bt.transaction_datetime AS entry_date,
          'INVOICE' AS entry_type,
          'BACKDATED_TRANSACTION' AS source_type,
          bt.line_total AS debit_amount,
          0 AS credit_amount,
          bt.vehicle_number,
          bt.slip_number,
          NULL AS receipt_number,
          bt.product_name || ' ' || bt.quantity || 'L @ ' || bt.unit_price || '/L' AS description,
          bt.created_by::text,
          bt.created_at
        FROM backdated_transactions bt
        WHERE bt.customer_id = ${customerId}::uuid
          AND bt.payment_method = 'credit_customer'
          AND bt.deleted_at IS NULL
          ${filters?.startDate ? Prisma.sql`AND bt.transaction_datetime >= ${filters.startDate}` : Prisma.empty}
          ${filters?.endDate ? Prisma.sql`AND bt.transaction_datetime <= ${filters.endDate}` : Prisma.empty}
          ${filters?.vehicleNumber ? Prisma.sql`AND bt.vehicle_number = ${filters.vehicleNumber}` : Prisma.empty}

        UNION ALL

        -- Source B: Sales (non-backdated credit)
        SELECT
          s.id::text,
          s.sale_date AS entry_date,
          'INVOICE' AS entry_type,
          'SALE' AS source_type,
          s.total_amount AS debit_amount,
          0 AS credit_amount,
          s.vehicle_number,
          s.slip_number,
          NULL AS receipt_number,
          COALESCE(
            (SELECT ft.code || ' ' || fs.quantity_liters || 'L'
             FROM fuel_sales fs JOIN fuel_types ft ON fs.fuel_type_id = ft.id
             WHERE fs.sale_id = s.id LIMIT 1),
            'Non-fuel sale'
          ) AS description,
          s.cashier_id::text AS created_by,
          s.created_at
        FROM sales s
        WHERE s.customer_id = ${customerId}::uuid
          AND s.payment_method IN ('credit', 'credit_customer')
          AND (s.offline_queue_id IS NULL OR s.offline_queue_id NOT LIKE 'backdated-%')
          ${filters?.startDate ? Prisma.sql`AND s.sale_date >= ${filters.startDate}` : Prisma.empty}
          ${filters?.endDate ? Prisma.sql`AND s.sale_date <= ${filters.endDate}` : Prisma.empty}
          ${filters?.vehicleNumber ? Prisma.sql`AND s.vehicle_number = ${filters.vehicleNumber}` : Prisma.empty}

        UNION ALL

        -- Source C: CustomerReceipts
        SELECT
          cr.id::text,
          cr.receipt_datetime AS entry_date,
          'RECEIPT' AS entry_type,
          'CUSTOMER_RECEIPT' AS source_type,
          0 AS debit_amount,
          cr.amount AS credit_amount,
          NULL AS vehicle_number,
          cr.reference_number AS slip_number,
          cr.receipt_number,
          cr.payment_method || ' receipt' AS description,
          cr.created_by::text,
          cr.created_at
        FROM customer_receipts cr
        WHERE cr.customer_id = ${customerId}::uuid
          AND cr.deleted_at IS NULL
          ${filters?.startDate ? Prisma.sql`AND cr.receipt_datetime >= ${filters.startDate}` : Prisma.empty}
          ${filters?.endDate ? Prisma.sql`AND cr.receipt_datetime <= ${filters.endDate}` : Prisma.empty}
      ) AS ledger
      ${filters?.entryType ? Prisma.sql`WHERE entry_type = ${filters.entryType}` : Prisma.empty}
      ORDER BY entry_date ASC, created_at ASC, source_type ASC, id ASC
      LIMIT ${limit} OFFSET ${offset}
    `;

    // Calculate running balances
    let runningBalance = openingBalance;
    const entries: LedgerEntry[] = rawEntries.map((row) => {
      const debit = parseFloat(row.debit_amount);
      const credit = parseFloat(row.credit_amount);
      runningBalance += debit - credit;

      return {
        id: row.id,
        date: row.entry_date,
        type: row.entry_type as 'INVOICE' | 'RECEIPT',
        sourceType: row.source_type,
        description: row.description,
        vehicleNumber: row.vehicle_number,
        slipNumber: row.slip_number,
        receiptNumber: row.receipt_number,
        debit,
        credit,
        balance: runningBalance,
        createdBy: row.created_by,
      };
    });

    // Summary
    const totalDebit = entries.reduce((sum, e) => sum + e.debit, 0);
    const totalCredit = entries.reduce((sum, e) => sum + e.credit, 0);
    const closingBalance = openingBalance + totalDebit - totalCredit;

    // Vehicle breakdown
    const vehicleBreakdown = await prisma.$queryRaw<
      Array<{
        vehicle_number: string;
        total_amount: string;
        transaction_count: string;
      }>
    >`
      SELECT
        vehicle_number,
        COUNT(*)::text as transaction_count,
        SUM(line_total)::text as total_amount
      FROM backdated_transactions
      WHERE customer_id = ${customerId}::uuid
        AND payment_method = 'credit_customer'
        AND deleted_at IS NULL
        AND vehicle_number IS NOT NULL
      GROUP BY vehicle_number
      ORDER BY SUM(line_total) DESC
    `;

    // Get branch limit if branchId provided
    let branchLimit: number | null = null;
    if (filters?.branchId) {
      branchLimit = await this.getCreditLimit(customerId, filters.branchId);
    }

    return {
      customer: {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        creditLimit: customer.creditLimit?.toNumber() ?? null,
        currentBalance: liveBalance,
        branchLimit,
      },
      entries,
      summary: {
        openingBalance,
        totalDebit,
        totalCredit,
        closingBalance,
      },
      vehicleBreakdown: vehicleBreakdown.map((v) => ({
        vehicleNumber: v.vehicle_number,
        totalAmount: parseFloat(v.total_amount),
        transactionCount: parseInt(v.transaction_count, 10),
      })),
      pagination: {
        total: entries.length,
        limit,
        offset,
      },
    };
  }

  /**
   * Get open invoices for a customer (for manual allocation)
   */
  async getOpenInvoices(customerId: string): Promise<OpenInvoice[]> {
    // Get all invoices with allocated amounts
    const rawInvoices = await prisma.$queryRaw<
      Array<{
        id: string;
        source_type: string;
        entry_date: Date;
        vehicle_number: string | null;
        slip_number: string | null;
        description: string;
        total_amount: string;
        allocated_amount: string;
      }>
    >`
      WITH allocations AS (
        SELECT
          cra.source_type,
          cra.source_id,
          COALESCE(SUM(cra.allocated_amount), 0) as allocated
        FROM customer_receipt_allocations cra
        JOIN customer_receipts cr ON cra.receipt_id = cr.id
        WHERE cr.deleted_at IS NULL
        GROUP BY cra.source_type, cra.source_id
      )
      SELECT
        bt.id::text,
        'BACKDATED_TRANSACTION' as source_type,
        bt.transaction_datetime as entry_date,
        bt.vehicle_number,
        bt.slip_number,
        bt.product_name || ' ' || bt.quantity || 'L @ ' || bt.unit_price || '/L' as description,
        bt.line_total::text as total_amount,
        COALESCE(a.allocated, 0)::text as allocated_amount
      FROM backdated_transactions bt
      LEFT JOIN allocations a ON a.source_type = 'BACKDATED_TRANSACTION' AND a.source_id = bt.id
      WHERE bt.customer_id = ${customerId}::uuid
        AND bt.payment_method = 'credit_customer'
        AND bt.deleted_at IS NULL
        AND (bt.line_total - COALESCE(a.allocated, 0)) > 0.01

      UNION ALL

      SELECT
        s.id::text,
        'SALE' as source_type,
        s.sale_date as entry_date,
        s.vehicle_number,
        s.slip_number,
        COALESCE(
          (SELECT ft.code || ' ' || fs.quantity_liters || 'L'
           FROM fuel_sales fs JOIN fuel_types ft ON fs.fuel_type_id = ft.id
           WHERE fs.sale_id = s.id LIMIT 1),
          'Non-fuel sale'
        ) as description,
        s.total_amount::text as total_amount,
        COALESCE(a.allocated, 0)::text as allocated_amount
      FROM sales s
      LEFT JOIN allocations a ON a.source_type = 'SALE' AND a.source_id = s.id
      WHERE s.customer_id = ${customerId}::uuid
        AND s.payment_method IN ('credit', 'credit_customer')
        AND (s.offline_queue_id IS NULL OR s.offline_queue_id NOT LIKE 'backdated-%')
        AND (s.total_amount - COALESCE(a.allocated, 0)) > 0.01

      ORDER BY entry_date ASC
    `;

    return rawInvoices.map((row) => ({
      id: row.id,
      sourceType: row.source_type as 'BACKDATED_TRANSACTION' | 'SALE',
      date: row.entry_date,
      vehicleNumber: row.vehicle_number,
      slipNumber: row.slip_number,
      description: row.description,
      totalAmount: parseFloat(row.total_amount),
      allocatedAmount: parseFloat(row.allocated_amount),
      openAmount: parseFloat(row.total_amount) - parseFloat(row.allocated_amount),
    }));
  }

  /**
   * Get party position report (all customers with balances)
   */
  async getPartyPositionReport(
    organizationId: string,
    filters?: {
      hideZeroBalance?: boolean;
      customerId?: string;
    }
  ): Promise<any> {
    const whereConditions: string[] = [`c.organization_id = '${organizationId}'::uuid`];
    if (filters?.hideZeroBalance) whereConditions.push('c.current_balance != 0');
    if (filters?.customerId) whereConditions.push(`c.id = '${filters.customerId}'::uuid`);

    const rawCustomers = await prisma.$queryRaw<
      Array<{
        id: string;
        name: string;
        phone: string | null;
        credit_limit: string | null;
        current_balance: string;
        last_transaction_date: Date | null;
        last_receipt_date: Date | null;
        total_debit: string;
        total_credit: string;
        vehicle_count: string;
      }>
    >`
      SELECT
        c.id::text,
        c.name,
        c.phone,
        c.credit_limit::text,
        c.current_balance::text,
        (
          SELECT MAX(transaction_datetime)
          FROM backdated_transactions bt
          WHERE bt.customer_id = c.id AND bt.deleted_at IS NULL
        ) as last_transaction_date,
        (
          SELECT MAX(receipt_datetime)
          FROM customer_receipts cr
          WHERE cr.customer_id = c.id AND cr.deleted_at IS NULL
        ) as last_receipt_date,
        COALESCE((
          SELECT SUM(line_total)
          FROM backdated_transactions bt
          WHERE bt.customer_id = c.id
            AND bt.payment_method = 'credit_customer'
            AND bt.deleted_at IS NULL
        ), 0)::text +
        COALESCE((
          SELECT SUM(total_amount)
          FROM sales s
          WHERE s.customer_id = c.id
            AND s.payment_method IN ('credit', 'credit_customer')
            AND (s.offline_queue_id IS NULL OR s.offline_queue_id NOT LIKE 'backdated-%')
        ), 0)::text as total_debit,
        COALESCE((
          SELECT SUM(amount)
          FROM customer_receipts cr
          WHERE cr.customer_id = c.id AND cr.deleted_at IS NULL
        ), 0)::text as total_credit,
        (
          SELECT COUNT(DISTINCT vehicle_number)
          FROM backdated_transactions bt
          WHERE bt.customer_id = c.id
            AND bt.vehicle_number IS NOT NULL
            AND bt.deleted_at IS NULL
        )::text as vehicle_count
      FROM customers c
      WHERE ${Prisma.raw(whereConditions.join(' AND '))}
      ORDER BY c.current_balance DESC
    `;

    const customers = rawCustomers.map((row) => {
      const creditLimit = row.credit_limit ? parseFloat(row.credit_limit) : null;
      const currentBalance = parseFloat(row.current_balance);

      return {
        id: row.id,
        name: row.name,
        phone: row.phone,
        creditLimit,
        currentBalance,
        utilizationPct: creditLimit ? (currentBalance / creditLimit) * 100 : 0,
        lastTransactionDate: row.last_transaction_date,
        lastReceiptDate: row.last_receipt_date,
        totalDebit: parseFloat(row.total_debit),
        totalCredit: parseFloat(row.total_credit),
        vehicleCount: parseInt(row.vehicle_count, 10),
        overLimit: creditLimit !== null && currentBalance > creditLimit,
      };
    });

    // Get organization info
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true },
    });

    // Totals
    const totals = {
      totalOutstanding: customers.reduce((sum, c) => sum + c.currentBalance, 0),
      totalCreditLimit: customers.reduce((sum, c) => sum + (c.creditLimit ?? 0), 0),
      overLimitCount: customers.filter((c) => c.overLimit).length,
      customerCount: customers.length,
    };

    return {
      header: {
        title: org?.name ?? 'Organization',
        subtitle: 'Party Position Report',
        date: new Date().toISOString().slice(0, 10),
        branch: 'All Branches', // v1: org-wide only
      },
      customers,
      totals,
    };
  }

  /**
   * Set or update branch-specific credit limit
   */
  async setBranchLimit(
    organizationId: string,
    customerId: string,
    branchId: string,
    creditLimit: number,
    creditDays?: number
  ): Promise<any> {
    // Validate org isolation
    await this.validateOrgIsolation(organizationId, customerId, branchId);

    // Find existing limit
    const existing = await prisma.customerBranchLimit.findFirst({
      where: {
        organizationId,
        customerId,
        branchId,
      },
    });

    if (existing) {
      return await prisma.customerBranchLimit.update({
        where: { id: existing.id },
        data: {
          creditLimit,
          creditDays,
          isActive: true,
        },
      });
    }

    return await prisma.customerBranchLimit.create({
      data: {
        organizationId,
        customerId,
        branchId,
        creditLimit,
        creditDays,
        isActive: true,
      },
    });
  }

  /**
   * Get all branch limits for a customer
   */
  async getBranchLimits(customerId: string): Promise<any[]> {
    return await prisma.customerBranchLimit.findMany({
      where: { customerId, isActive: true },
      include: {
        branch: {
          select: { id: true, name: true },
        },
      },
      orderBy: { creditLimit: 'desc' },
    });
  }

  /**
   * Get receipts with filters (pagination, date range, customer/branch)
   */
  async getReceipts(
    organizationId: string,
    filters?: {
      customerId?: string;
      branchId?: string;
      startDate?: Date;
      endDate?: Date;
      limit?: number;
      offset?: number;
    }
  ): Promise<any> {
    const limit = filters?.limit ?? 100;
    const offset = filters?.offset ?? 0;

    // Build WHERE conditions
    const where: any = {
      organizationId,
      deletedAt: null, // Exclude soft-deleted
    };

    if (filters?.customerId) {
      where.customerId = filters.customerId;
    }
    if (filters?.branchId) {
      where.branchId = filters.branchId;
    }

    // Add date filtering to WHERE clause (not post-fetch)
    if (filters?.startDate) {
      where.receiptDatetime = { ...where.receiptDatetime, gte: filters.startDate };
    }
    if (filters?.endDate) {
      where.receiptDatetime = { ...where.receiptDatetime, lte: filters.endDate };
    }

    // Get total count
    const total = await prisma.customerReceipt.count({ where });

    // Get paginated receipts with allocations
    const receipts = await prisma.customerReceipt.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
        bank: { select: { id: true, name: true } },
        allocations: {
          select: {
            id: true,
            sourceType: true,
            sourceId: true,
            allocatedAmount: true,
          },
        },
      },
      orderBy: { receiptDatetime: 'desc' },
      take: limit,
      skip: offset,
    });

    // Date filtering now in WHERE clause (no post-fetch filter needed)
    return {
      receipts: receipts.map((r) => ({
        id: r.id,
        receiptNumber: r.receiptNumber,
        receiptDatetime: r.receiptDatetime,
        amount: r.amount.toNumber(),
        paymentMethod: r.paymentMethod,
        referenceNumber: r.referenceNumber,
        customerId: r.customerId,
        branchId: r.branchId,
        customer: r.customer,
        branch: r.branch,
        bank: r.bank,
        allocationMode: r.allocationMode,
        allocations: r.allocations.map((a) => ({
          ...a,
          allocatedAmount: a.allocatedAmount.toNumber(),
        })),
        createdAt: r.createdAt,
        createdBy: r.createdBy,
      })),
      pagination: {
        total,
        limit,
        offset,
      },
    };
  }

  /**
   * Get receipt detail with allocations
   */
  async getReceiptById(receiptId: string, organizationId: string): Promise<any> {
    const receipt = await prisma.customerReceipt.findUnique({
      where: { id: receiptId },
      include: {
        customer: true,
        branch: true,
        bank: true,
        createdByUser: true,
        updatedByUser: true,
        deletedByUser: true,
        allocations: true,
      },
    });

    if (!receipt || receipt.deletedAt) {
      throw new AppError(404, 'Receipt not found');
    }

    if (receipt.organizationId !== organizationId) {
      throw new AppError(403, 'Receipt does not belong to this organization');
    }

    return {
      id: receipt.id,
      receiptNumber: receipt.receiptNumber,
      receiptDatetime: receipt.receiptDatetime,
      amount: receipt.amount.toNumber(),
      paymentMethod: receipt.paymentMethod,
      bankId: receipt.bankId,
      referenceNumber: receipt.referenceNumber,
      notes: receipt.notes,
      attachmentPath: receipt.attachmentPath,
      allocationMode: receipt.allocationMode,
      customer: receipt.customer,
      branch: receipt.branch,
      bank: receipt.bank,
      allocations: receipt.allocations.map((a) => ({
        id: a.id,
        sourceType: a.sourceType as 'BACKDATED_TRANSACTION' | 'SALE',
        sourceId: a.sourceId,
        allocatedAmount: a.allocatedAmount.toNumber(),
      })),
      createdAt: receipt.createdAt,
      createdBy: receipt.createdBy,
      createdByUser: receipt.createdByUser
        ? {
            id: receipt.createdByUser.id,
            fullName: receipt.createdByUser.fullName,
            email: receipt.createdByUser.email,
          }
        : null,
      updatedAt: receipt.updatedAt,
      updatedBy: receipt.updatedBy,
      updatedByUser: receipt.updatedByUser
        ? {
            id: receipt.updatedByUser.id,
            fullName: receipt.updatedByUser.fullName,
            email: receipt.updatedByUser.email,
          }
        : null,
      deletedByUser: receipt.deletedByUser
        ? {
            id: receipt.deletedByUser.id,
            fullName: receipt.deletedByUser.fullName,
            email: receipt.deletedByUser.email,
          }
        : null,
    };
  }
}
