import { prisma } from '../../config/database';
import { Prisma } from '@prisma/client';
import { AppError } from '../../middleware/error.middleware';

/**
 * DailyBackdatedEntriesService
 *
 * Consolidated daily-level API for accountant reconciliation workflow.
 * Operates at day-level rather than per-nozzle level.
 */

interface DailyQueryParams {
  branchId: string;
  businessDate: string; // YYYY-MM-DD
  shiftId?: string;
}

interface DailyTransactionInput {
  customerId?: string;
  nozzleId?: string; // Optional - some slips don't specify nozzle
  vehicleNumber?: string;
  slipNumber?: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  paymentMethod: 'cash' | 'credit_card' | 'bank_card' | 'pso_card' | 'credit_customer';
}

interface DailySaveInput {
  branchId: string;
  businessDate: string; // YYYY-MM-DD
  shiftId?: string;
  transactions: DailyTransactionInput[];
}

interface FinalizeDayInput {
  branchId: string;
  businessDate: string; // YYYY-MM-DD
}

export class DailyBackdatedEntriesService {
  /**
   * GET /api/backdated-entries/daily
   *
   * Returns consolidated day-level summary:
   * - All nozzles for branch with meter readings status
   * - HSD total liters, PMG total liters (meter-based)
   * - All transactions for the day
   * - Posted liters by fuel type (from transactions)
   * - Remaining liters (meter - posted)
   * - Payment breakdown
   * - Back-traced cash calculation
   */
  async getDailySummary(params: DailyQueryParams, organizationId: string) {
    const { branchId, businessDate, shiftId } = params;

    console.log('[BackdatedEntries] getDailySummary called:', {
      branchId,
      businessDate,
      shiftId,
      organizationId,
    });

    // Validate branch belongs to organization
    const branch = await prisma.branch.findFirst({
      where: {
        id: branchId,
        organizationId,
      },
    });

    if (!branch) {
      throw new AppError(404, 'Branch not found or does not belong to organization');
    }

    // Normalize date to midnight UTC for consistent queries
    const businessDateObj = new Date(businessDate);
    businessDateObj.setUTCHours(0, 0, 0, 0);

    console.log('[BackdatedEntries] Querying with normalized date:', businessDateObj.toISOString());

    // Get all nozzles for the branch (with fuel type)
    const allNozzles = await prisma.nozzle.findMany({
      where: {
        dispensingUnit: {
          branchId,
        },
        isActive: true,
      },
      include: {
        fuelType: true,
        dispensingUnit: true,
      },
      orderBy: [
        { dispensingUnit: { unitNumber: 'asc' } },
        { nozzleNumber: 'asc' },
      ],
    });

    // Get all backdated entries for the date
    const entries = await prisma.backdatedEntry.findMany({
      where: {
        branchId,
        businessDate: businessDateObj,
        ...(shiftId ? { shiftId } : {}),
      },
      include: {
        nozzle: {
          include: {
            fuelType: true,
            dispensingUnit: true,
          },
        },
        shift: true,
        transactions: {
          include: {
            customer: true,
            product: true,
            fuelType: true,
          },
          orderBy: {
            transactionDateTime: 'asc',
          },
        },
      },
    });

    console.log('[BackdatedEntries] Found entries:', {
      entriesCount: entries.length,
      totalTransactions: entries.reduce((sum, e) => sum + e.transactions.length, 0),
    });

    // Build nozzle status map
    const entryMap = new Map(entries.map((e) => [e.nozzleId, e]));

    const nozzleStatuses = allNozzles.map((nozzle) => {
      const entry = entryMap.get(nozzle.id);
      return {
        nozzleId: nozzle.id,
        nozzleName: nozzle.name || `D${nozzle.dispensingUnit.unitNumber}N${nozzle.nozzleNumber}`,
        fuelType: nozzle.fuelType.code, // 'HSD' or 'PMG'
        fuelTypeName: nozzle.fuelType.name,
        openingReadingExists: !!entry,
        closingReadingExists: !!entry,
        openingReading: entry ? parseFloat(entry.openingReading.toString()) : null,
        closingReading: entry ? parseFloat(entry.closingReading.toString()) : null,
        meterLiters: entry
          ? parseFloat(entry.closingReading.toString()) - parseFloat(entry.openingReading.toString())
          : null,
        isFinalized: (entry as any)?.isFinalized || false,
      };
    });

    // Calculate HSD and PMG meter totals
    let hsdMeterLiters = 0;
    let pmgMeterLiters = 0;

    nozzleStatuses.forEach((n) => {
      if (n.meterLiters !== null) {
        if (n.fuelType === 'HSD') {
          hsdMeterLiters += n.meterLiters;
        } else if (n.fuelType === 'PMG') {
          pmgMeterLiters += n.meterLiters;
        }
      }
    });

    // Collect all transactions
    const allTransactions = entries.flatMap((entry) =>
      entry.transactions.map((txn) => ({
        id: txn.id,
        entryId: entry.id,
        nozzle: {
          id: entry.nozzle.id,
          name: entry.nozzle.name || `D${entry.nozzle.dispensingUnit.unitNumber}N${entry.nozzle.nozzleNumber}`,
          fuelType: entry.nozzle.fuelType.code,
        },
        customer: txn.customer
          ? {
              id: txn.customer.id,
              name: txn.customer.name,
            }
          : null,
        vehicleNumber: txn.vehicleNumber,
        slipNumber: txn.slipNumber,
        productName: txn.productName,
        quantity: parseFloat(txn.quantity.toString()),
        unitPrice: parseFloat(txn.unitPrice.toString()),
        lineTotal: parseFloat(txn.lineTotal.toString()),
        paymentMethod: txn.paymentMethod,
        transactionDateTime: txn.transactionDateTime,
        qbSyncStatus: (txn as any).qbSyncStatus || 'pending',
        qbId: (txn as any).qbId || null,
        notes: txn.notes,
      }))
    );

    // Calculate posted liters by fuel type
    let hsdPostedLiters = 0;
    let pmgPostedLiters = 0;

    allTransactions.forEach((txn) => {
      if (txn.nozzle.fuelType === 'HSD') {
        hsdPostedLiters += txn.quantity;
      } else if (txn.nozzle.fuelType === 'PMG') {
        pmgPostedLiters += txn.quantity;
      }
    });

    // Calculate remaining liters
    const hsdRemainingLiters = hsdMeterLiters - hsdPostedLiters;
    const pmgRemainingLiters = pmgMeterLiters - pmgPostedLiters;

    // Payment breakdown
    const paymentBreakdown = allTransactions.reduce(
      (acc, txn) => {
        switch (txn.paymentMethod) {
          case 'cash':
            acc.cash += txn.lineTotal;
            break;
          case 'credit_card':
            acc.creditCard += txn.lineTotal;
            break;
          case 'bank_card':
            acc.bankCard += txn.lineTotal;
            break;
          case 'pso_card':
            acc.psoCard += txn.lineTotal;
            break;
          case 'credit_customer':
            acc.creditCustomer += txn.lineTotal;
            break;
        }
        acc.total += txn.lineTotal;
        return acc;
      },
      {
        cash: 0,
        creditCard: 0,
        bankCard: 0,
        psoCard: 0,
        creditCustomer: 0,
        total: 0,
      }
    );

    // Back-traced cash calculation
    // Total meter sales = all meter liters * price
    // Use fallback prices if no transactions exist
    const hsdPrice = allTransactions.find((t) => t.nozzle.fuelType === 'HSD')?.unitPrice || 287.33;
    const pmgPrice = allTransactions.find((t) => t.nozzle.fuelType === 'PMG')?.unitPrice || 290.5;

    const meterSalesPkr = hsdMeterLiters * hsdPrice + pmgMeterLiters * pmgPrice;
    const nonCashTotal =
      paymentBreakdown.creditCard +
      paymentBreakdown.bankCard +
      paymentBreakdown.psoCard +
      paymentBreakdown.creditCustomer;
    const expectedCash = meterSalesPkr - nonCashTotal;
    const postedCash = paymentBreakdown.cash;
    const cashGap = expectedCash - postedCash;

    return {
      branchId,
      businessDate,
      shiftId: shiftId || null,
      nozzleStatuses,
      meterTotals: {
        hsdLiters: hsdMeterLiters,
        pmgLiters: pmgMeterLiters,
        totalLiters: hsdMeterLiters + pmgMeterLiters,
      },
      postedTotals: {
        hsdLiters: hsdPostedLiters,
        pmgLiters: pmgPostedLiters,
        totalLiters: hsdPostedLiters + pmgPostedLiters,
      },
      remainingLiters: {
        hsd: hsdRemainingLiters,
        pmg: pmgRemainingLiters,
        total: hsdRemainingLiters + pmgRemainingLiters,
      },
      transactions: allTransactions,
      paymentBreakdown,
      backTracedCash: {
        meterSalesPkr,
        nonCashTotal,
        expectedCash,
        postedCash,
        cashGap,
      },
    };
  }

  /**
   * POST /api/backdated-entries/daily
   *
   * Upsert/save draft:
   * - Create or update entries per nozzle based on transactions
   * - Save all transactions
   * - Return updated daily summary
   */
  async saveDailyDraft(input: DailySaveInput, organizationId: string) {
    const { branchId, businessDate, shiftId, transactions } = input;

    console.log('[BackdatedEntries] saveDailyDraft called:', {
      branchId,
      businessDate,
      shiftId,
      transactionCount: transactions.length,
      organizationId,
    });

    // Validate branch
    const branch = await prisma.branch.findFirst({
      where: {
        id: branchId,
        organizationId,
      },
    });

    if (!branch) {
      throw new AppError(404, 'Branch not found or does not belong to organization');
    }

    // Normalize date to midnight UTC for consistent queries
    const businessDateObj = new Date(businessDate);
    businessDateObj.setUTCHours(0, 0, 0, 0);

    console.log('[BackdatedEntries] Normalized date:', businessDateObj.toISOString());

    // Group transactions by nozzle (skip those without nozzleId)
    const txnsByNozzle = new Map<string, DailyTransactionInput[]>();
    const txnsWithoutNozzle: DailyTransactionInput[] = [];

    transactions.forEach((txn) => {
      if (!txn.nozzleId) {
        console.warn('[BackdatedEntries] Transaction without nozzleId:', txn);
        txnsWithoutNozzle.push(txn);
        return;
      }

      const list = txnsByNozzle.get(txn.nozzleId) || [];
      list.push(txn);
      txnsByNozzle.set(txn.nozzleId, list);
    });

    console.log('[BackdatedEntries] Grouped transactions:', {
      nozzleCount: txnsByNozzle.size,
      withoutNozzleCount: txnsWithoutNozzle.length,
    });

    // For each nozzle, create/update entry and transactions
    const results = await Promise.all(
      Array.from(txnsByNozzle.entries()).map(async ([nozzleId, nozzleTxns]) => {
        console.log('[BackdatedEntries] Processing nozzle:', {
          nozzleId,
          transactionCount: nozzleTxns.length,
        });

        // Fetch nozzle with fuel type to determine meter readings
        const nozzle = await prisma.nozzle.findFirst({
          where: {
            id: nozzleId,
            dispensingUnit: {
              branch: {
                organizationId,
              },
            },
          },
          include: {
            fuelType: true,
          },
        });

        if (!nozzle) {
          console.error('[BackdatedEntries] Nozzle not found:', nozzleId);
          throw new AppError(404, `Nozzle ${nozzleId} not found`);
        }

        // Calculate total liters for this nozzle from transactions
        const totalLiters = nozzleTxns.reduce((sum, t) => sum + t.quantity, 0);

        // Check if entry already exists
        const existingEntry = await prisma.backdatedEntry.findFirst({
          where: {
            nozzleId,
            businessDate: businessDateObj,
            shiftId: shiftId || null,
          },
        });

        let entryId: string;

        if (existingEntry) {
          console.log('[BackdatedEntries] Updating existing entry:', existingEntry.id);

          // Update closing reading to match total liters (opening + totalLiters)
          const opening = parseFloat(existingEntry.openingReading.toString());
          const closing = opening + totalLiters;

          await prisma.backdatedEntry.update({
            where: { id: existingEntry.id },
            data: {
              closingReading: new Prisma.Decimal(closing),
            },
          });

          entryId = existingEntry.id;

          // Delete existing transactions for this entry (will be replaced)
          const deletedCount = await prisma.backdatedTransaction.deleteMany({
            where: { backdatedEntryId: existingEntry.id },
          });

          console.log('[BackdatedEntries] Deleted existing transactions:', deletedCount.count);
        } else {
          console.log('[BackdatedEntries] Creating new entry for nozzle:', nozzleId);

          // Create new entry
          // Opening reading: assume 0 for new entries (accountant can manually adjust if needed)
          const opening = 0;
          const closing = opening + totalLiters;

          const newEntry = await prisma.backdatedEntry.create({
            data: {
              branchId,
              businessDate: businessDateObj,
              nozzleId,
              shiftId: shiftId || null,
              openingReading: new Prisma.Decimal(opening),
              closingReading: new Prisma.Decimal(closing),
            },
          });

          console.log('[BackdatedEntries] Created new entry:', newEntry.id);

          entryId = newEntry.id;
        }

        // Create all transactions for this entry
        const createdTxns = await prisma.backdatedTransaction.createMany({
          data: nozzleTxns.map((txn) => ({
            backdatedEntryId: entryId,
            customerId: txn.customerId,
            vehicleNumber: txn.vehicleNumber,
            slipNumber: txn.slipNumber,
            productName: txn.productName,
            quantity: new Prisma.Decimal(txn.quantity),
            unitPrice: new Prisma.Decimal(txn.unitPrice),
            lineTotal: new Prisma.Decimal(txn.lineTotal),
            paymentMethod: txn.paymentMethod,
            fuelTypeId: nozzle.fuelTypeId,
            transactionDateTime: businessDateObj, // Use business date as transaction time
          })),
        });

        console.log('[BackdatedEntries] Created transactions:', {
          entryId,
          nozzleId,
          count: createdTxns.count,
        });

        return { nozzleId, entryId };
      })
    );

    console.log('[BackdatedEntries] Saved all entries:', results.length);

    // Return updated summary
    return this.getDailySummary(
      {
        branchId,
        businessDate,
        shiftId,
      },
      organizationId
    );
  }

  /**
   * POST /api/backdated-entries/daily/finalize
   *
   * Mark all entries for the day as finalized and enqueue QB sync
   */
  async finalizeDay(input: FinalizeDayInput, organizationId: string) {
    const { branchId, businessDate } = input;

    // Validate branch
    const branch = await prisma.branch.findFirst({
      where: {
        id: branchId,
        organizationId,
      },
    });

    if (!branch) {
      throw new AppError(404, 'Branch not found or does not belong to organization');
    }

    const businessDateObj = new Date(businessDate);

    // Get all entries for the date
    const entries = await prisma.backdatedEntry.findMany({
      where: {
        branchId,
        businessDate: businessDateObj,
      },
      include: {
        transactions: true,
      },
    });

    if (entries.length === 0) {
      throw new AppError(400, 'No entries found for this date to finalize');
    }

    // Mark all entries as finalized
    await prisma.backdatedEntry.updateMany({
      where: {
        branchId,
        businessDate: businessDateObj,
      },
      data: {
        isFinalized: true,
      } as any,
    });

    // Enqueue all transactions for QB sync
    const allTransactions = entries.flatMap((e) => e.transactions);

    if (allTransactions.length > 0) {
      // Get QB connection for the organization
      const qbConnection = await prisma.qBConnection.findFirst({
        where: {
          organizationId,
          isActive: true,
        },
      });

      if (qbConnection) {
        // Create sync queue jobs for each transaction
        await prisma.qBSyncQueue.createMany({
          data: allTransactions.map((txn) => ({
            connectionId: qbConnection.id,
            organizationId,
            jobType: 'create_backdated_sale',
            entityType: 'backdated_transaction',
            entityId: txn.id,
            priority: 5,
            status: 'pending',
            payload: {
              transactionId: txn.id,
              backdatedEntryId: txn.backdatedEntryId,
              customerId: txn.customerId,
              productName: txn.productName,
              quantity: txn.quantity.toString(),
              unitPrice: txn.unitPrice.toString(),
              lineTotal: txn.lineTotal.toString(),
              paymentMethod: txn.paymentMethod,
              transactionDateTime: txn.transactionDateTime.toISOString(),
            },
          })),
        });

        // Update transaction QB sync status
        await prisma.backdatedTransaction.updateMany({
          where: {
            id: {
              in: allTransactions.map((t) => t.id),
            },
          },
          data: {
            qbSyncStatus: 'queued',
          } as any,
        });
      }
    }

    return {
      success: true,
      message: `Day finalized. ${entries.length} entries and ${allTransactions.length} transactions marked as finalized.`,
      entriesCount: entries.length,
      transactionsCount: allTransactions.length,
      qbSyncQueued: allTransactions.length,
    };
  }
}
