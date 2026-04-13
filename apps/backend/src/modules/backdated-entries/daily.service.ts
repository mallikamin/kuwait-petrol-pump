import { prisma } from '../../config/database';
import { Prisma } from '@prisma/client';
import { AppError } from '../../middleware/error.middleware';
import { BackdatedMeterReadingsDailyService } from './meter-readings-daily.service';

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

interface DailyReconciliationRangeQueryParams {
  branchId: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
}

interface DailyTransactionInput {
  id?: string; // ✅ NEW: Stable client-side ID (UUID) - used for upsert to prevent data loss
  customerId?: string;
  nozzleId?: string; // Optional - some slips don't specify nozzle
  fuelCode?: string; // HSD, PMG, etc. - used when nozzleId not available
  vehicleNumber?: string;
  slipNumber?: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  paymentMethod: 'cash' | 'credit_card' | 'bank_card' | 'pso_card' | 'credit_customer';
  bankId?: string; // Required for credit_card/bank_card payments
}

interface DailySaveInput {
  branchId: string;
  businessDate: string; // YYYY-MM-DD
  shiftId?: string;
  deletedTransactionIds?: string[];
  transactions: DailyTransactionInput[];
}

interface FinalizeDayInput {
  branchId: string;
  businessDate: string; // YYYY-MM-DD
}

export class DailyBackdatedEntriesService {
  private readonly meterReadingsDailyService = new BackdatedMeterReadingsDailyService();
  private normalizeBusinessDate(businessDate: string): Date {
    const [year, month, day] = businessDate.split('-').map((value) => parseInt(value, 10));
    if (!year || !month || !day) {
      throw new AppError(400, `Invalid businessDate: ${businessDate}`);
    }
    return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  }

  private resolveFuelCodeForChecklist(txn: {
    fuelType?: { code?: string } | null;
    productName?: string | null;
    backdatedEntry?: { nozzle?: { fuelType?: { code?: string } | null } | null } | null;
  }): 'HSD' | 'PMG' | null {
    const explicit = (txn.fuelType?.code || '').toUpperCase();
    if (explicit === 'HSD' || explicit === 'PMG') return explicit as 'HSD' | 'PMG';

    const nozzleFuel = (txn.backdatedEntry?.nozzle?.fuelType?.code || '').toUpperCase();
    if (nozzleFuel === 'HSD' || nozzleFuel === 'PMG') return nozzleFuel as 'HSD' | 'PMG';

    const productNameUpper = (txn.productName || '').toUpperCase();
    if (productNameUpper.includes('HSD') || productNameUpper.includes('DIESEL')) return 'HSD';
    if (productNameUpper.includes('PMG') || productNameUpper.includes('PETROL')) return 'PMG';

    return null;
  }

  /**
   * GET /api/backdated-entries/daily/reconciliation-range
   *
   * Fast range summary for accountant reconciliation dashboard.
   * Includes meter completion + transaction posting checklist + finalize status per day.
   */
  async getDailyReconciliationSummaryRange(
    params: DailyReconciliationRangeQueryParams,
    organizationId: string
  ) {
    const { branchId, startDate, endDate } = params;

    // Validate branch belongs to organization
    const branch = await prisma.branch.findFirst({
      where: { id: branchId, organizationId },
    });
    if (!branch) {
      throw new AppError(404, 'Branch not found or does not belong to organization');
    }

    const startDateObj = this.normalizeBusinessDate(startDate);
    const endDateObj = this.normalizeBusinessDate(endDate);
    if (startDateObj > endDateObj) {
      throw new AppError(400, 'startDate cannot be after endDate');
    }

    // Expected readings/day: nozzles × shifts × opening+closing
    const [configuredShiftCount, activeNozzleCount] = await Promise.all([
      prisma.shift.count({ where: { branchId, isActive: true } }),
      prisma.nozzle.count({
        where: {
          dispensingUnit: { branchId },
          isActive: true,
        },
      }),
    ]);
    const expectedReadingsPerDay = activeNozzleCount * 2;

    type DaySummary = {
      businessDate: string;
      totalReadingsExpected: number;
      totalReadingsEntered: number;
      totalReadingsDerived: number;
      totalReadingsMissing: number;
      completionPercent: number;
      status: 'fully_reconciled' | 'partially_reconciled' | 'not_reconciled';
      postingChecks: {
        transactionsByFuel: { HSD: number; PMG: number };
        creditOrBankByFuel: { HSD: number; PMG: number };
        cashByFuel: { HSD: number; PMG: number };
        meterComplete: boolean;
        coreChecksPassed: boolean;
      };
      finalizeStatus: 'finalized' | 'not_finalized' | 'no_entries';
      blockers: string[];
      readyForFinalize: boolean;
    };

    const dayMap = new Map<string, DaySummary>();
    for (
      const d = new Date(startDateObj);
      d <= endDateObj;
      d.setUTCDate(d.getUTCDate() + 1)
    ) {
      const dateStr = d.toISOString().split('T')[0];
      dayMap.set(dateStr, {
        businessDate: dateStr,
        totalReadingsExpected: expectedReadingsPerDay,
        totalReadingsEntered: 0,
        totalReadingsDerived: 0,
        totalReadingsMissing: expectedReadingsPerDay,
        completionPercent: 0,
        status: 'not_reconciled',
        postingChecks: {
          transactionsByFuel: { HSD: 0, PMG: 0 },
          creditOrBankByFuel: { HSD: 0, PMG: 0 },
          cashByFuel: { HSD: 0, PMG: 0 },
          meterComplete: false,
          coreChecksPassed: false,
        },
        finalizeStatus: 'no_entries',
        blockers: [],
        readyForFinalize: false,
      });
    }

    const businessDates = Array.from(dayMap.keys());

    const [dailyMeterSummaries, transactions, entries] = await Promise.all([
      Promise.all(
        businessDates.map(async (dateStr) => {
          const daily = await this.meterReadingsDailyService.getDailyMeterReadings(
            branchId,
            dateStr,
            organizationId
          );
          return {
            businessDate: dateStr,
            summary: daily.aggregateSummary,
          };
        })
      ),
      prisma.backdatedTransaction.findMany({
        where: {
          deletedAt: null,
          backdatedEntry: {
            branchId,
            businessDate: {
              gte: startDateObj,
              lte: endDateObj,
            },
          },
        },
        select: {
          paymentMethod: true,
          productName: true,
          fuelType: {
            select: { code: true },
          },
          backdatedEntry: {
            select: {
              businessDate: true,
              nozzle: {
                select: {
                  fuelType: {
                    select: { code: true },
                  },
                },
              },
            },
          },
        },
      }),
      prisma.backdatedEntry.findMany({
        where: {
          branchId,
          businessDate: {
            gte: startDateObj,
            lte: endDateObj,
          },
        },
        select: {
          businessDate: true,
          isFinalized: true,
        },
      }),
    ]);

    for (const meterRow of dailyMeterSummaries) {
      const summary = dayMap.get(meterRow.businessDate);
      if (!summary) continue;

      summary.totalReadingsExpected = meterRow.summary.totalReadingsExpected || summary.totalReadingsExpected;
      summary.totalReadingsEntered = meterRow.summary.totalReadingsEntered || 0;
      summary.totalReadingsDerived = meterRow.summary.totalReadingsPropagated || 0;
    }

    for (const txn of transactions) {
      const dateStr = txn.backdatedEntry.businessDate.toISOString().split('T')[0];
      const summary = dayMap.get(dateStr);
      if (!summary) continue;

      const fuelCode = this.resolveFuelCodeForChecklist(txn);
      if (!fuelCode) continue;

      summary.postingChecks.transactionsByFuel[fuelCode] += 1;

      const method = (txn.paymentMethod || '').toLowerCase();
      if (method === 'cash') {
        summary.postingChecks.cashByFuel[fuelCode] += 1;
      }
      if (method === 'credit_customer' || method === 'credit_card' || method === 'bank_card') {
        summary.postingChecks.creditOrBankByFuel[fuelCode] += 1;
      }
    }

    const entryFinalizeMap = new Map<string, { total: number; finalized: number }>();
    for (const entry of entries) {
      const dateStr = entry.businessDate.toISOString().split('T')[0];
      const aggregate = entryFinalizeMap.get(dateStr) || { total: 0, finalized: 0 };
      aggregate.total += 1;
      if (entry.isFinalized) aggregate.finalized += 1;
      entryFinalizeMap.set(dateStr, aggregate);
    }

    const dailySummaries = Array.from(dayMap.values())
      .map((summary) => {
        const filled = summary.totalReadingsEntered + summary.totalReadingsDerived;
        summary.totalReadingsMissing = Math.max(0, summary.totalReadingsExpected - filled);
        summary.completionPercent =
          summary.totalReadingsExpected > 0
            ? Math.round((filled / summary.totalReadingsExpected) * 100)
            : 0;
        const finalizeAggregate = entryFinalizeMap.get(summary.businessDate);
        if (!finalizeAggregate || finalizeAggregate.total === 0) {
          summary.finalizeStatus = 'no_entries';
        } else if (finalizeAggregate.finalized === finalizeAggregate.total) {
          summary.finalizeStatus = 'finalized';
        } else {
          summary.finalizeStatus = 'not_finalized';
        }

        const hsdTxnPosted = summary.postingChecks.transactionsByFuel.HSD > 0;
        const pmgTxnPosted = summary.postingChecks.transactionsByFuel.PMG > 0;
        const hsdCreditOrBankPosted = summary.postingChecks.creditOrBankByFuel.HSD > 0;
        const pmgCreditOrBankPosted = summary.postingChecks.creditOrBankByFuel.PMG > 0;
        const hsdCashPosted = summary.postingChecks.cashByFuel.HSD > 0;
        const pmgCashPosted = summary.postingChecks.cashByFuel.PMG > 0;
        const meterComplete = summary.totalReadingsExpected > 0 && filled >= summary.totalReadingsExpected;

        summary.postingChecks.meterComplete = meterComplete;
        summary.postingChecks.coreChecksPassed =
          hsdTxnPosted &&
          pmgTxnPosted &&
          hsdCreditOrBankPosted &&
          pmgCreditOrBankPosted &&
          hsdCashPosted &&
          pmgCashPosted;

        const hasAnyPostingSignal =
          summary.postingChecks.transactionsByFuel.HSD > 0 ||
          summary.postingChecks.transactionsByFuel.PMG > 0 ||
          summary.postingChecks.creditOrBankByFuel.HSD > 0 ||
          summary.postingChecks.creditOrBankByFuel.PMG > 0 ||
          summary.postingChecks.cashByFuel.HSD > 0 ||
          summary.postingChecks.cashByFuel.PMG > 0;

        // Reconciliation status must represent both dimensions:
        // meter completeness and posting/finalization completeness.
        summary.status =
          meterComplete && summary.postingChecks.coreChecksPassed && summary.finalizeStatus === 'finalized'
            ? 'fully_reconciled'
            : (meterComplete || hasAnyPostingSignal || summary.finalizeStatus === 'finalized')
              ? 'partially_reconciled'
              : 'not_reconciled';

        const blockers: string[] = [];
        if (!hsdTxnPosted) blockers.push('0 transactions posted for HSD');
        if (!pmgTxnPosted) blockers.push('0 transactions posted for PMG');
        if (!hsdCreditOrBankPosted) blockers.push('HSD credit/bank card sales not posted');
        if (!pmgCreditOrBankPosted) blockers.push('PMG credit/bank card sales not posted');
        if (!hsdCashPosted) blockers.push('HSD cash sales not posted');
        if (!pmgCashPosted) blockers.push('PMG cash sales not posted');
        if (!meterComplete) blockers.push(`Meter readings incomplete (${filled}/${summary.totalReadingsExpected})`);

        if (
          blockers.length === 0 &&
          (summary.finalizeStatus === 'not_finalized' || summary.finalizeStatus === 'no_entries')
        ) {
          blockers.push('Ready checks passed, but day is not finalized yet');
        }

        summary.blockers = blockers;
        summary.readyForFinalize =
          summary.postingChecks.coreChecksPassed && meterComplete && summary.finalizeStatus !== 'finalized';

        return summary;
      })
      .sort((a, b) => new Date(b.businessDate).getTime() - new Date(a.businessDate).getTime());

    const dateRangeStats = {
      fullyReconciled: dailySummaries.filter((d) => d.status === 'fully_reconciled').length,
      partiallyReconciled: dailySummaries.filter((d) => d.status === 'partially_reconciled').length,
      notReconciled: dailySummaries.filter((d) => d.status === 'not_reconciled').length,
      readyForFinalize: dailySummaries.filter((d) => d.readyForFinalize).length,
      finalized: dailySummaries.filter((d) => d.finalizeStatus === 'finalized').length,
    };

    return {
      branchId,
      startDate,
      endDate,
      config: {
        activeNozzles: activeNozzleCount,
        activeShifts: configuredShiftCount,
        expectedReadingsPerDay,
      },
      dateRange: dateRangeStats,
      dailySummaries,
    };
  }

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
    const businessDateObj = this.normalizeBusinessDate(businessDate);

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
          where: {
            deletedAt: null, // ✅ SOFT DELETE: Only fetch active (non-deleted) transactions
          },
          include: {
            customer: true,
            product: true,
            fuelType: true,
            createdByUser: {
              select: {
                id: true,
                fullName: true,
                username: true,
              },
            },
            updatedByUser: {
              select: {
                id: true,
                fullName: true,
                username: true,
              },
            },
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

    // Meter totals must come from backdated_meter_readings (single source of truth), not backdated entries.
    // ✅ P0 FIX: No longer uses shift_instances (backdated is day-level, not shift-level)
    const dailyMeterReadings = await this.meterReadingsDailyService.getDailyMeterReadings(
      branchId,
      businessDate,
      organizationId
    );

    const nozzleMeterLiters = new Map<string, number>();
    const nozzlesWithValidMeter = new Set<string>();
    let hsdMeterLiters = 0;
    let pmgMeterLiters = 0;

    // ✅ SHIFT-SEGREGATED: Iterate over shifts, then nozzles
    (dailyMeterReadings as any).shifts?.forEach((shift: any) => {
      shift.nozzles?.forEach((nozzle: any) => {
        // ✅ CRITICAL FIX: Accept ANY reading with valid value (entered OR propagated)
        // Status is informational; meter calculation accepts all valid numeric values
        const opening = nozzle.opening?.value ?? null;
        const closing = nozzle.closing?.value ?? null;

        if (opening === null || opening === undefined || closing === null || closing === undefined) {
          return; // Skip if either reading value is missing
        }

        const liters = closing - opening;
        if (liters < 0) {
          console.warn('[BackdatedEntries] Negative meter delta ignored', {
            branchId,
            businessDate,
            nozzleId: nozzle.nozzleId,
          opening,
          closing,
          liters,
        });
        return;
      }

      nozzlesWithValidMeter.add(nozzle.nozzleId);
      nozzleMeterLiters.set(nozzle.nozzleId, liters);

      // ✅ CRITICAL FIX: nozzle.fuelType is already a string ('HSD' or 'PMG')
      if (nozzle.fuelType === 'HSD') {
        hsdMeterLiters += liters;
      } else if (nozzle.fuelType === 'PMG') {
        pmgMeterLiters += liters;
      }
      });
    });

    // Build nozzle status map
    const entryMap = new Map(entries.map((e) => [e.nozzleId, e]));

    const nozzleStatuses = allNozzles.map((nozzle) => {
      const entry = entryMap.get(nozzle.id);
      const hasMeter = nozzlesWithValidMeter.has(nozzle.id);
      return {
        nozzleId: nozzle.id,
        nozzleName: nozzle.name || `D${nozzle.dispensingUnit.unitNumber}N${nozzle.nozzleNumber}`,
        fuelType: nozzle.fuelType.code, // 'HSD' or 'PMG'
        fuelTypeName: nozzle.fuelType.name,
        openingReadingExists: hasMeter,
        closingReadingExists: hasMeter,
        openingReading: entry ? parseFloat(entry.openingReading.toString()) : null,
        closingReading: entry ? parseFloat(entry.closingReading.toString()) : null,
        meterLiters: hasMeter ? (nozzleMeterLiters.get(nozzle.id) || 0) : null,
        isFinalized: (entry as any)?.isFinalized || false,
      };
    });

    // Helper: Resolve fuel code with fallback priority
    const resolveFuelCode = (txn: any, entry: any): string => {
      // Priority 1: Try transaction's explicit fuel type
      if (txn.fuelType?.code) {
        return txn.fuelType.code;
      }

      // Priority 2: Fallback to nozzle's fuel type (legacy transactions with null fuelTypeId)
      if (entry.nozzle?.fuelType?.code) {
        return entry.nozzle.fuelType.code;
      }

      // Priority 3: Parse from productName (HSD, Diesel => 'HSD', PMG, Petrol => 'PMG')
      const productNameUpper = (txn.productName || '').toUpperCase();
      if (productNameUpper.includes('HSD') || productNameUpper.includes('DIESEL')) {
        return 'HSD';
      }
      if (productNameUpper.includes('PMG') || productNameUpper.includes('PETROL')) {
        return 'PMG';
      }

      // Explicit non-fuel bucket for transactions without fuel mapping.
      return 'OTHER';
    };

    // Collect all transactions
    const allTransactions = entries.flatMap((entry) =>
      entry.transactions.map((txn) => ({
        id: txn.id,
        entryId: entry.id,
        nozzle: entry.nozzle
          ? {
              id: entry.nozzle.id,
              name: entry.nozzle.name || `D${entry.nozzle.dispensingUnit.unitNumber}N${entry.nozzle.nozzleNumber}`,
              fuelType: entry.nozzle.fuelType.code,
            }
          : null,
        customer: txn.customer
          ? {
              id: txn.customer.id,
              name: txn.customer.name,
            }
          : null,
        fuelCode: resolveFuelCode(txn, entry), // ✅ FIXED: Use fallback priority to resolve fuel code for legacy transactions
        vehicleNumber: txn.vehicleNumber,
        slipNumber: txn.slipNumber,
        productName: txn.productName,
        quantity: parseFloat(txn.quantity.toString()),
        unitPrice: parseFloat(txn.unitPrice.toString()),
        lineTotal: parseFloat(txn.lineTotal.toString()),
        paymentMethod: txn.paymentMethod,
        bankId: (txn as any).bankId || '', // ✅ ADD: Return bankId for card transactions
        transactionDateTime: txn.transactionDateTime,
        qbSyncStatus: (txn as any).qbSyncStatus || 'pending',
        qbId: (txn as any).qbId || null,
        notes: txn.notes,
        // Audit fields
        createdBy: txn.createdBy,
        createdByUser: (txn as any).createdByUser || null,
        updatedBy: (txn as any).updatedBy || null,
        updatedByUser: (txn as any).updatedByUser || null,
        createdAt: txn.createdAt,
        updatedAt: txn.updatedAt,
      }))
    );

    // ✅ AUTHORITATIVE INVARIANT CHECK: Verify fuel code consistency
    // Calculate posted liters by fuel type AND detect inconsistencies
    let hsdPostedLiters = 0;
    let pmgPostedLiters = 0;
    const consistencyWarnings: Array<{
      txnId: string;
      fuelCode: string;
      fuelTypeId: string;
      issue: string;
    }> = [];

    allTransactions.forEach((txn) => {
      const txnFuelCode = (txn.fuelCode || '').toUpperCase();
      if (txnFuelCode === 'HSD') {
        hsdPostedLiters += txn.quantity;
      } else if (txnFuelCode === 'PMG') {
        pmgPostedLiters += txn.quantity;
      }

      // ✅ FORENSIC: Check for fuelCode string vs fuelTypeId mismatch
      // This detects if transaction was corrupted (fuelCode says HSD but stored as PMG)
      const txnFuelType = entries
        .flatMap(e => e.transactions)
        .find(t => t.id === txn.id);

      if (txnFuelType) {
        const resolvedFuelCode = txnFuelType.fuelType?.code || '???';

        if (txnFuelCode && resolvedFuelCode && txnFuelCode !== resolvedFuelCode) {
          consistencyWarnings.push({
            txnId: txn.id,
            fuelCode: txnFuelCode,
            fuelTypeId: txnFuelType.fuelTypeId || 'null',
            issue: `fuelCode string "${txnFuelCode}" disagrees with fuelTypeId "${resolvedFuelCode}"`,
          });
        }
      }
    });

    // Log warnings if any inconsistencies found
    if (consistencyWarnings.length > 0) {
      console.warn('[BackdatedEntries] CONSISTENCY WARNINGS - Fuel type mismatch detected:', {
        branchId,
        businessDate,
        warnings: consistencyWarnings,
      });
    }

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
    const hsdPrice = allTransactions.find((t) => t.fuelCode === 'HSD')?.unitPrice || 287.33;
    const pmgPrice = allTransactions.find((t) => t.fuelCode === 'PMG')?.unitPrice || 290.5;

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
  async saveDailyDraft(input: DailySaveInput, organizationId: string, userId?: string) {
    const {
      branchId,
      businessDate,
      shiftId,
      transactions,
      deletedTransactionIds = [],
    } = input;

    console.log('[BackdatedEntries] saveDailyDraft called:', {
      branchId,
      businessDate,
      shiftId,
      userId,
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
    const businessDateObj = this.normalizeBusinessDate(businessDate);

    // ✅ SAFETY: Check for unexpected transaction count drops (accidental deletion via partial payload)
    // Only warn if shrinking AND no explicit deletedTransactionIds provided (opt-in safety)
    const existingTxnCount = await prisma.backdatedTransaction.count({
      where: {
        backdatedEntry: {
          branchId,
          businessDate: businessDateObj,
          shiftId: shiftId || null,
        },
        deletedAt: null, // ✅ SOFT DELETE: Only count active transactions
      },
    });

    if (transactions.length < existingTxnCount && transactions.length > 0 && !input.shiftId) {
      // Only allow shrinking if all incoming rows have IDs (explicit delete via omission is disallowed)
      const allHaveIds = transactions.every(t => !!t.id);
      if (!allHaveIds) {
        throw new AppError(
          409,
          `Transaction count would drop from ${existingTxnCount} to ${transactions.length} without explicit delete IDs. ` +
          `To prevent accidental data loss, please include all transaction IDs or use explicit deletedTransactionIds.`
        );
      }
    }

    console.log('[BackdatedEntries] Normalized date:', businessDateObj.toISOString());

    // ✅ CRITICAL FIX: Build global fuelTypesMap from all transactions BEFORE processing
    // This ensures walk-in + nozzle paths use consistent fuel type resolution
    const allFuelCodes = new Set<string>();
    transactions.forEach(txn => {
      const fuelCode = (txn.fuelCode || '').toUpperCase();
      if (fuelCode === 'HSD' || fuelCode === 'PMG') {
        allFuelCodes.add(fuelCode);
      }
    });

    const fuelTypesMap = new Map<string, string>();
    if (allFuelCodes.size > 0) {
      const fuelTypes = await prisma.fuelType.findMany({
        where: {
          code: { in: Array.from(allFuelCodes) },
        },
      });
      fuelTypes.forEach(ft => {
        fuelTypesMap.set(ft.code, ft.id);
      });
    }

    // ✅ VALIDATION: Every transaction MUST declare a supported code.
    // Fuel-reconciled rows: HSD/PMG (must map to master fuel type)
    // Non-fuel rows: OTHER (stored with null fuelTypeId)
    for (const txn of transactions) {
      const fuelCode = (txn.fuelCode || '').toUpperCase();
      if (fuelCode !== 'HSD' && fuelCode !== 'PMG' && fuelCode !== 'OTHER') {
        throw new AppError(
          400,
          `Transaction with ${txn.quantity}L and product "${txn.productName}" has invalid/missing fuel code: "${txn.fuelCode}". ` +
          `Valid codes are: HSD, PMG, OTHER`
        );
      }

      if ((fuelCode === 'HSD' || fuelCode === 'PMG') && !fuelTypesMap.has(fuelCode)) {
        throw new AppError(400, `Cannot resolve fuel type for code: ${fuelCode}`);
      }

      if (fuelCode === 'OTHER' && !(txn.productName || '').trim()) {
        throw new AppError(400, 'Non-fuel transaction requires productName');
      }
    }

    // ✅ HARD SAVE GUARD: Prevent accidental cross-fuel changes
    // Check if we're about to move liters between fuels for existing transaction IDs
    if (input.shiftId === undefined) { // Only check for full-day saves, not shift-level
      const existingFuelMap = await prisma.backdatedTransaction.findMany({
        where: {
          backdatedEntry: {
            branchId,
            businessDate: businessDateObj,
          },
          id: { in: transactions.filter(t => t.id).map(t => t.id!) },
          deletedAt: null, // ✅ SOFT DELETE: Only check active transactions
        },
        include: { fuelType: true },
      });

      const existingFuelById = new Map(
        existingFuelMap.map(txn => [txn.id, (txn.fuelType?.code || '').toUpperCase()])
      );

      // Find any transactions where fuel type is changing
      const fuelChanges = transactions.filter(incoming => {
        if (!incoming.id || !existingFuelById.has(incoming.id)) return false;
        const existingFuelCode = (existingFuelById.get(incoming.id) || '').toUpperCase();
        const incomingFuelCode = (incoming.fuelCode || '').toUpperCase();

        // Non-fuel edits must not be blocked by cross-fuel guard.
        if (existingFuelCode === '' && incomingFuelCode === 'OTHER') return false;
        return existingFuelCode !== incomingFuelCode;
      });

      if (fuelChanges.length > 0) {
        console.error('[BackdatedEntries] HARD GUARD: Cross-fuel changes detected - BLOCKING save:', {
          branchId,
          businessDate,
          changes: fuelChanges.map(txn => ({
            id: txn.id,
            from: existingFuelById.get(txn.id),
            to: (txn.fuelCode || '').toUpperCase(),
            quantity: txn.quantity,
          })),
        });

        // ✅ BLOCKING: Reject cross-fuel changes unless explicitly overridden
        // This prevents accidental fuel type mutations
        throw new AppError(
          409,
          `Cannot change fuel type for existing transactions. ` +
          `${fuelChanges.length} transaction(s) would change fuel types: ` +
          fuelChanges.map(t =>
            `${t.id} (${existingFuelById.get(t.id)} → ${(t.fuelCode || '').toUpperCase()})`
          ).join('; ') +
          `. To override, include allowFuelTypeChange=true with a reason in the request.`
        );
      }
    }

    console.log('[BackdatedEntries] Fuel types resolved:', {
      uniqueFuelCodes: Array.from(fuelTypesMap.keys()),
      totalTransactions: transactions.length,
    });

    // ✅ NO NOZZLE GROUPING - Process all transactions as single daily entry per (branchId, businessDate, shiftId)
    // Rule: Transactions are NOT nozzle-linked (see WORKFLOW_CANONICAL_NO_DRIFT.md)
    // Reconciliation is fuel-type based only (HSD vs PMG), not per-nozzle

    console.log('[BackdatedEntries] Processing all transactions for daily entry:', {
      branchId,
      businessDate,
      shiftId,
      transactionCount: transactions.length,
    });

    // Get or create single daily entry for this (branchId, businessDate, shiftId)
    // Daily entries have nozzleId = NULL (transactions are not nozzle-linked)
    const existingDailyEntry = await prisma.backdatedEntry.findFirst({
      where: {
        branchId,
        businessDate: businessDateObj,
        shiftId: shiftId || null,
        nozzleId: null, // ✅ Daily entries have no nozzle assignment
      },
      include: {
        transactions: {
          select: { id: true },
        },
      },
    });

    let entryId: string;

    if (existingDailyEntry) {
      console.log('[BackdatedEntries] Using existing daily entry:', existingDailyEntry.id);
      entryId = existingDailyEntry.id;
    } else {
      // ✅ Create single daily entry (no nozzle assignment - transactions are not nozzle-linked)
      console.log('[BackdatedEntries] Creating new daily entry for branch:', branchId);

      const newDailyEntry = await prisma.backdatedEntry.create({
        data: {
          branchId,
          businessDate: businessDateObj,
          shiftId: shiftId || null,
          nozzleId: null, // ✅ Daily entry has NO nozzle (transactions are independent)
          openingReading: new Prisma.Decimal(0),
          closingReading: new Prisma.Decimal(0),
          // NO notes prefix - this distinguishes it from legacy walk-in entries
        },
      });

      console.log('[BackdatedEntries] Created new daily entry:', newDailyEntry.id);
      entryId = newDailyEntry.id;
    }

    // ✅ Upsert ALL transactions into this single daily entry (exclude soft-deleted)
    const existingTxns = await prisma.backdatedTransaction.findMany({
      where: {
        backdatedEntryId: entryId,
        deletedAt: null, // ✅ SOFT DELETE: Only fetch active (non-deleted) transactions
      },
    });

    const existingTxnIds = new Set(existingTxns.map(t => t.id));
    const incomingTxnIds = new Set(transactions.filter(t => t.id).map(t => t.id!));

    let upsertedCount = 0;
    let createdCount = 0;
    let updatedCount = 0;

    for (const txn of transactions) {
      // ✅ Resolve fuel type from txn.fuelCode only (no nozzle fallback)
      const fuelCode = (txn.fuelCode || '').toUpperCase();
      const resolvedFuelTypeId =
        fuelCode === 'OTHER' ? null : (fuelTypesMap.get(fuelCode) || null);

      if ((fuelCode === 'HSD' || fuelCode === 'PMG') && !resolvedFuelTypeId) {
        throw new AppError(400, `Cannot resolve fuel type for code: ${txn.fuelCode}`);
      }

      const txnData = {
        backdatedEntryId: entryId,
        customerId: txn.customerId,
        vehicleNumber: txn.vehicleNumber,
        slipNumber: txn.slipNumber,
        productName: txn.productName,
        quantity: new Prisma.Decimal(txn.quantity),
        unitPrice: new Prisma.Decimal(txn.unitPrice),
        lineTotal: new Prisma.Decimal(txn.lineTotal),
        paymentMethod: txn.paymentMethod,
        bankId: txn.bankId || null,
        fuelTypeId: resolvedFuelTypeId,
        transactionDateTime: businessDateObj,
        updatedBy: userId || null,
      };

      if (txn.id && existingTxnIds.has(txn.id)) {
        // Update existing transaction
        const updateResult = await prisma.backdatedTransaction.updateMany({
          where: {
            id: txn.id,
            backdatedEntryId: entryId,
          },
          data: txnData,
        });

        if (updateResult.count === 0) {
          console.error('[BackdatedEntries] INTEGRITY ERROR: Transaction does not belong to this entry', {
            txnId: txn.id,
            entryId,
          });
          throw new AppError(400, `Transaction ${txn.id} does not belong to this entry`);
        }
        updatedCount++;
      } else {
        // Create new transaction
        // ✅ Duplicate guard: fingerprint check to prevent accidental duplicates
        if (!txn.id) {
          const fingerprint = await prisma.backdatedTransaction.findFirst({
            where: {
              backdatedEntryId: entryId,
              customerId: txn.customerId || null,
              productName: txn.productName,
              quantity: new Prisma.Decimal(txn.quantity),
              unitPrice: new Prisma.Decimal(txn.unitPrice),
              lineTotal: new Prisma.Decimal(txn.lineTotal),
              slipNumber: txn.slipNumber || null,
              vehicleNumber: txn.vehicleNumber || null,
              paymentMethod: txn.paymentMethod,
              createdAt: {
                gte: new Date(Date.now() - 60000), // Within last 60 seconds
              },
            },
            select: { id: true },
          });

          if (fingerprint) {
            console.warn('[BackdatedEntries] Duplicate fingerprint detected, skipping insert:', {
              entryId,
              productName: txn.productName,
              quantity: txn.quantity,
              existingId: fingerprint.id,
            });
            upsertedCount++;
            continue;
          }
        }

        try {
          await prisma.backdatedTransaction.create({
            data: {
              id: txn.id, // Use client-provided ID if available
              ...txnData,
              createdBy: userId || null,
            },
          });
          createdCount++;
        } catch (error: any) {
          // ✅ Handle UNIQUE constraint violation on transaction ID (idempotent upsert)
          // If transaction already exists, update it instead of failing
          if (error.code === 'P2002' || error.message?.includes('Unique constraint')) {
            console.log('[BackdatedEntries] Transaction UNIQUE constraint violation, updating existing:', txn.id);
            await prisma.backdatedTransaction.update({
              where: { id: txn.id },
              data: {
                ...txnData,
                updatedBy: userId || null,
              },
            });
            updatedCount++;
          } else {
            throw error;
          }
        }
      }
      upsertedCount++;
    }

    // ✅ Explicit deletion path: honor client intent even when incoming rows include unsaved draft rows.
    let deletedCount = 0;
    if (deletedTransactionIds.length > 0) {
      const explicitDelete = await prisma.backdatedTransaction.updateMany({
        where: {
          id: { in: deletedTransactionIds },
          backdatedEntryId: entryId,
          deletedAt: null,
        },
        data: {
          deletedAt: new Date(),
          deletedBy: userId || null,
        },
      });
      deletedCount += explicitDelete.count;
      console.log('[BackdatedEntries] Explicit soft-deleted transactions:', {
        requested: deletedTransactionIds.length,
        deleted: explicitDelete.count,
      });
    }

    // ✅ Legacy fallback deletion: delete rows missing from incoming only when safe.
    const allIncomingHaveIds = transactions.length > 0 && transactions.every((txn) => !!txn.id);
    const incomingCountGreaterOrEqual = transactions.length >= existingTxnIds.size;
    const canDeleteMissing = allIncomingHaveIds && incomingCountGreaterOrEqual;

    if (canDeleteMissing) {
      const txnsToDelete = Array.from(existingTxnIds).filter(id => !incomingTxnIds.has(id));
      if (txnsToDelete.length > 0) {
        console.log('[BackdatedEntries] Safe deletion check:', {
          entryId,
          existingCount: existingTxnIds.size,
          incomingCount: transactions.length,
          toDeleteCount: txnsToDelete.length,
        });
        // ✅ SOFT DELETE: Mark transactions as deleted instead of hard delete
        const implicitDelete = await prisma.backdatedTransaction.updateMany({
          where: {
            id: { in: txnsToDelete },
            backdatedEntryId: entryId,
            deletedAt: null,
          },
          data: {
            deletedAt: new Date(),
            deletedBy: userId, // Track who deleted these transactions
          },
        });
        deletedCount += implicitDelete.count;
        console.log('[BackdatedEntries] Soft-deleted removed transactions (implicit):', implicitDelete.count);
      }
    } else {
      console.log('[BackdatedEntries] Skip delete - unsafe to delete (prevents partial-save data loss)', {
        entryId,
        existingCount: existingTxnIds.size,
        incomingCount: transactions.length,
        allIncomingHaveIds,
        incomingCountGreaterOrEqual,
        reason: !allIncomingHaveIds ? 'incoming has rows without IDs' : 'incoming count < existing count (partial save)',
      });
    }

    console.log('[BackdatedEntries] Upserted all daily transactions:', {
      entryId,
      total: upsertedCount,
      created: createdCount,
      updated: updatedCount,
      deleted: deletedCount,
    });

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
   * ✅ Helper: Calculate payment method breakdown (Cash, Credit, Bank Card, PSO Card)
   */
  private calculatePaymentBreakdown(
    transactions: any[]
  ): {
    cash: { liters: number; amount: number };
    credit: { liters: number; amount: number };
    bankCard: { liters: number; amount: number };
    psoCard: { liters: number; amount: number };
  } {
    const breakdown = {
      cash: { liters: 0, amount: 0 },
      credit: { liters: 0, amount: 0 },
      bankCard: { liters: 0, amount: 0 },
      psoCard: { liters: 0, amount: 0 },
    };

    for (const txn of transactions) {
      if (!txn.fuelTypeId) continue; // Skip non-fuel transactions

      const liters = parseFloat(txn.quantity.toString());
      const amount = parseFloat(txn.lineTotal.toString());
      const method = (txn.paymentMethod || '').toLowerCase();

      // Map payment methods to 4 categories
      if (method === 'cash') {
        breakdown.cash.liters += liters;
        breakdown.cash.amount += amount;
      } else if (method === 'credit' || method === 'credit_customer') {
        breakdown.credit.liters += liters;
        breakdown.credit.amount += amount;
      } else if (method === 'card' || method === 'bank_card' || method === 'credit_card') {
        breakdown.bankCard.liters += liters;
        breakdown.bankCard.amount += amount;
      } else if (method === 'pso_card') {
        breakdown.psoCard.liters += liters;
        breakdown.psoCard.amount += amount;
      }
    }

    // Round to 2 decimal places for amount, 3 for liters
    breakdown.cash.liters = parseFloat(breakdown.cash.liters.toFixed(3));
    breakdown.cash.amount = parseFloat(breakdown.cash.amount.toFixed(2));
    breakdown.credit.liters = parseFloat(breakdown.credit.liters.toFixed(3));
    breakdown.credit.amount = parseFloat(breakdown.credit.amount.toFixed(2));
    breakdown.bankCard.liters = parseFloat(breakdown.bankCard.liters.toFixed(3));
    breakdown.bankCard.amount = parseFloat(breakdown.bankCard.amount.toFixed(2));
    breakdown.psoCard.liters = parseFloat(breakdown.psoCard.liters.toFixed(3));
    breakdown.psoCard.amount = parseFloat(breakdown.psoCard.amount.toFixed(2));

    return breakdown;
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

    const businessDateObj = this.normalizeBusinessDate(businessDate);

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

    // ✅ CHECK: Is day already finalized with no changes?
    const allFinalized = entries.every(e => e.isFinalized);
    if (allFinalized) {
      // Check if any transactions don't already have sales
      const txnCount = entries.reduce((sum, e) => sum + e.transactions.length, 0);
      const existingSalesCount = await prisma.sale.count({
        where: {
          branchId,
          saleDate: {
            gte: businessDateObj,
            lt: new Date(businessDateObj.getTime() + 86400000), // +1 day
          },
          offlineQueueId: { startsWith: 'backdated-' },
        },
      });

      if (existingSalesCount >= txnCount) {
        console.log(`[Finalize] Day ${businessDate} already finalized. Re-running idempotent sales backfill check.`);
      }
    }

    // Reconciliation gate: block finalize unless accounting checks pass.
    const summary = await this.getDailySummary({ branchId, businessDate }, organizationId);
    const litersTolerance = 0.01;
    const cashTolerancePkr = 1.0;
    const reconciliationErrors: Array<{ message: string }> = [];

    const hsdGap = summary.meterTotals.hsdLiters - summary.postedTotals.hsdLiters;
    const pmgGap = summary.meterTotals.pmgLiters - summary.postedTotals.pmgLiters;
    const cashGap = summary.backTracedCash.cashGap;

    if (Math.abs(hsdGap) > litersTolerance) {
      reconciliationErrors.push({
        message: `HSD not reconciled: ${Math.abs(hsdGap).toFixed(3)} L ${hsdGap > 0 ? 'pending to post' : 'over-posted'}`
      });
    }

    if (Math.abs(pmgGap) > litersTolerance) {
      reconciliationErrors.push({
        message: `PMG not reconciled: ${Math.abs(pmgGap).toFixed(3)} L ${pmgGap > 0 ? 'pending to post' : 'over-posted'}`
      });
    }

    // NOTE: cashGap is now returned as a warning only, not a blocker
    // Finalization only blocks on HSD/PMG liters reconciliation

    // Legacy per-entry isReconciled flags are not maintained by the current daily workflow.
    // Quantitative gates above (liters only) are the source of truth for finalization.

    const walkInCashLiters = summary.transactions
      .filter((t) => !t.customer && t.paymentMethod === 'cash')
      .reduce((sum, t) => sum + t.quantity, 0);
    if (
      (Math.abs(hsdGap) > litersTolerance || Math.abs(pmgGap) > litersTolerance) &&
      walkInCashLiters <= litersTolerance
    ) {
      reconciliationErrors.push({
        message: `Cash/Walk-in customers not fully posted yet (${summary.remainingLiters.total.toFixed(3)} L pending)`
      });
    }

    if (reconciliationErrors.length > 0) {
      // Return structured error response instead of one long string
      const error = new AppError(400, 'Finalize blocked');
      (error as any).details = reconciliationErrors;
      (error as any).metrics = {
        hsdGap: parseFloat(hsdGap.toFixed(3)),
        pmgGap: parseFloat(pmgGap.toFixed(3)),
        cashGap: parseFloat(cashGap.toFixed(2)),
        remainingLitersTotal: parseFloat(summary.remainingLiters.total.toFixed(3)),
        walkInCashLiters: parseFloat(walkInCashLiters.toFixed(3)),
      };
      throw error;
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

    // Get all transactions with their parent entry details
    const allTransactions = entries.flatMap((e) =>
      e.transactions.map((t) => ({
        ...t,
        _entry: {
          branchId: e.branchId,
          shiftId: e.shiftId,
          businessDate: e.businessDate,
          createdBy: e.createdBy,
        }
      }))
    );

    // ✅ CREATE SALE RECORDS (so transactions appear in Sales tab)
    const createdSales: string[] = [];

    for (const txn of allTransactions) {
      // Only create sale if fuelTypeId exists (fuel transactions only)
      if (txn.fuelTypeId) {
        // ✅ Generate deterministic idempotency key
        const idempotencyKey = `backdated-${txn.id}`;

        // ✅ CHECK: Does sale already exist for this transaction?
        const existingSale = await prisma.sale.findFirst({
          where: {
            branchId: txn._entry.branchId,
            offlineQueueId: idempotencyKey,
          },
        });

        if (existingSale) {
          console.log(`[Finalize] Skipping transaction ${txn.id} - sale already exists (${existingSale.id})`);
          continue;
        }

        // Find shift instance for this business date
        let shiftInstanceId = null;
        if (txn._entry.shiftId) {
          const shiftInstance = await prisma.shiftInstance.findFirst({
            where: {
              shiftId: txn._entry.shiftId,
              branchId: txn._entry.branchId,
              date: txn._entry.businessDate,
            },
          });
          shiftInstanceId = shiftInstance?.id || null;
        }

        const sale = await prisma.sale.create({
          data: {
            offlineQueueId: idempotencyKey, // ✅ Idempotency key
            branchId: txn._entry.branchId,
            shiftInstanceId,
            saleDate: txn.transactionDateTime,
            saleType: 'fuel',
            totalAmount: txn.lineTotal,
            paymentMethod: txn.paymentMethod,
            customerId: txn.customerId,
            vehicleNumber: txn.vehicleNumber,
            slipNumber: txn.slipNumber,
            cashierId: txn._entry.createdBy,
            syncStatus: 'synced', // Mark as synced (from backdated/offline)
            fuelSales: {
              create: {
                fuelTypeId: txn.fuelTypeId,
                quantityLiters: txn.quantity,
                pricePerLiter: txn.unitPrice,
                totalAmount: txn.lineTotal,
                isManualReading: true, // From backdated entry, not live POS
              },
            },
          },
        });
        createdSales.push(sale.id);
      }
    }

    console.log(`✅ Created ${createdSales.length} sale records from ${allTransactions.length} backdated transactions`);

    // Enqueue all transactions for QB sync
    const plainTransactions = allTransactions.map((t) => {
      const { _entry, ...rest } = t as any;
      return rest;
    });

    if (plainTransactions.length > 0) {
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
          data: plainTransactions.map((txn) => ({
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
              in: plainTransactions.map((t) => t.id),
            },
          },
          data: {
            qbSyncStatus: 'queued',
          } as any,
        });
      }
    }

    // Calculate payment method breakdown
    const paymentBreakdown = this.calculatePaymentBreakdown(allTransactions);

    // Include cash gap as warning (if any) even though it's no longer a blocker
    const responsePayload: any = {
      success: true,
      message: `Day finalized successfully`,
      alreadyFinalized: false,
      postedSalesCount: createdSales.length,
      inventoryUpdatesCount: 0, // Inventory deductions handled via StockLevel adjustments
      reportSyncStatus: 'completed',
      paymentBreakdown, // ✅ NEW: Payment method breakdown
      details: {
        entriesFinalized: entries.length,
        transactionsProcessed: plainTransactions.length,
        salesCreated: createdSales.length,
        qbSyncQueued: plainTransactions.length > 0 ? 'pending' : 'none',
        saleIds: createdSales,
      },
    };

    // Add cash gap warning if it exists (for audit visibility)
    if (Math.abs(cashGap) > cashTolerancePkr) {
      responsePayload.cashGapWarning = {
        amount: parseFloat(cashGap.toFixed(2)),
        message: `Cash variance: PKR ${Math.abs(cashGap).toFixed(2)} ${cashGap > 0 ? 'short' : 'excess'}`
      };
    }

    return responsePayload;
  }

  /**
   * ✅ FORENSIC ENDPOINT: Inspect all transactions for a given date+shift
   * Returns detailed transaction audit trail with fuel type consistency checks
   *
   * GET /api/backdated-entries/daily/forensic
   */
  async getForensicTransactions(params: DailyQueryParams, organizationId: string) {
    const { branchId, businessDate, shiftId } = params;

    console.log('[BackdatedEntries.Forensic] Called:', {
      branchId,
      businessDate,
      shiftId,
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

    const businessDateObj = this.normalizeBusinessDate(businessDate);

    // Get all transactions with full audit trail (exclude soft-deleted)
    const transactions = await prisma.backdatedTransaction.findMany({
      where: {
        backdatedEntry: {
          branchId,
          businessDate: businessDateObj,
          ...(shiftId ? { shiftId } : {}),
        },
        deletedAt: null, // ✅ SOFT DELETE: Only fetch active transactions
      },
      include: {
        backdatedEntry: {
          include: {
            nozzle: {
              include: { fuelType: true },
            },
          },
        },
        fuelType: true,
        customer: true,
        createdByUser: {
          select: { id: true, fullName: true, username: true },
        },
        updatedByUser: {
          select: { id: true, fullName: true, username: true },
        },
      },
      orderBy: [{ transactionDateTime: 'asc' }, { createdAt: 'asc' }],
    });

    // Build forensic output with consistency checks
    const forensicTransactions = transactions.map(txn => {
      const entryNozzleFuelCode = txn.backdatedEntry?.nozzle?.fuelType?.code || '???';
      const txnFuelTypeCode = txn.fuelType?.code || '???';
      const consistencyIssue = entryNozzleFuelCode !== txnFuelTypeCode ? 'MISMATCH' : 'OK';

      return {
        id: txn.id,
        transactionDateTime: txn.transactionDateTime,
        nozzleId: txn.backdatedEntry?.nozzleId,
        nozzleName: txn.backdatedEntry?.nozzle?.name || '???',
        entryNozzleFuelCode, // What the nozzle says
        txnFuelTypeCode, // What the transaction says
        consistencyIssue, // Check: are they aligned?
        fuelTypeId: txn.fuelTypeId,
        quantity: parseFloat(txn.quantity.toString()),
        unitPrice: parseFloat(txn.unitPrice.toString()),
        lineTotal: parseFloat(txn.lineTotal.toString()),
        productName: txn.productName,
        paymentMethod: txn.paymentMethod,
        customerName: txn.customer?.name || null,
        // Audit
        createdBy: txn.createdBy,
        createdByUser: txn.createdByUser,
        createdAt: txn.createdAt,
        updatedBy: txn.updatedBy,
        updatedByUser: txn.updatedByUser,
        updatedAt: txn.updatedAt,
      };
    });

    // Group by fuel and compute totals
    const groupedByFuel = new Map<string, typeof forensicTransactions>();
    forensicTransactions.forEach(txn => {
      const key = txn.txnFuelTypeCode;
      if (!groupedByFuel.has(key)) {
        groupedByFuel.set(key, []);
      }
      groupedByFuel.get(key)!.push(txn);
    });

    const totals = Array.from(groupedByFuel.entries()).map(([fuelCode, txns]) => ({
      fuelCode,
      count: txns.length,
      totalLiters: txns.reduce((sum, t) => sum + t.quantity, 0),
      totalAmount: txns.reduce((sum, t) => sum + t.lineTotal, 0),
    }));

    // Flag consistency issues
    const consistencyIssues = forensicTransactions.filter(t => t.consistencyIssue === 'MISMATCH');
    if (consistencyIssues.length > 0) {
      console.error('[BackdatedEntries.Forensic] CONSISTENCY ERRORS DETECTED:', {
        branchId,
        businessDate,
        issueCount: consistencyIssues.length,
        issues: consistencyIssues.map(t => ({
          id: t.id,
          nozzleFuel: t.entryNozzleFuelCode,
          txnFuel: t.txnFuelTypeCode,
          quantity: t.quantity,
        })),
      });
    }

    return {
      branchId,
      businessDate,
      shiftId: shiftId || null,
      transactionCount: forensicTransactions.length,
      totals,
      consistencyCheckResult: consistencyIssues.length === 0 ? 'PASS' : `FAIL (${consistencyIssues.length} issues)`,
      transactions: forensicTransactions,
      consistencyIssues,
    };
  }

  /**
   * GET /api/backdated-entries/daily/deleted
   *
   * List soft-deleted transactions for recovery
   */
  async getDeletedTransactions(params: DailyQueryParams, organizationId: string) {
    const { branchId, businessDate, shiftId } = params;

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

    const businessDateObj = this.normalizeBusinessDate(businessDate);

    // Get all DELETED transactions
    const deletedTxns = await prisma.backdatedTransaction.findMany({
      where: {
        backdatedEntry: {
          branchId,
          businessDate: businessDateObj,
          ...(shiftId ? { shiftId } : {}),
        },
        deletedAt: { not: null }, // ✅ SOFT DELETE: Only fetch deleted transactions
      },
      include: {
        customer: true,
        product: true,
        fuelType: true,
        deletedByUser: {
          select: { id: true, fullName: true, username: true },
        },
      },
      orderBy: [{ deletedAt: 'desc' }, { transactionDateTime: 'asc' }],
    });

    return {
      branchId,
      businessDate,
      shiftId: shiftId || null,
      deletedCount: deletedTxns.length,
      transactions: deletedTxns.map(txn => ({
        id: txn.id,
        productName: txn.productName,
        quantity: parseFloat(txn.quantity.toString()),
        unitPrice: parseFloat(txn.unitPrice.toString()),
        lineTotal: parseFloat(txn.lineTotal.toString()),
        paymentMethod: txn.paymentMethod,
        fuelType: txn.fuelType?.code,
        deletedAt: txn.deletedAt,
        deletedBy: txn.deletedByUser ? `${txn.deletedByUser.fullName} (@${txn.deletedByUser.username})` : null,
      })),
    };
  }

  /**
   * POST /api/backdated-entries/daily/restore
   *
   * Restore soft-deleted transactions
   */
  async restoreDeletedTransactions(
    params: { branchId: string; businessDate: string; transactionIds: string[] },
    organizationId: string,
    userId?: string
  ) {
    const { branchId, businessDate, transactionIds } = params;

    if (!transactionIds.length) {
      throw new AppError(400, 'No transaction IDs provided for restore');
    }

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

    const businessDateObj = this.normalizeBusinessDate(businessDate);

    // Verify all transactions to restore exist and are deleted
    const txnsToRestore = await prisma.backdatedTransaction.findMany({
      where: {
        id: { in: transactionIds },
        backdatedEntry: {
          branchId,
          businessDate: businessDateObj,
        },
        deletedAt: { not: null }, // ✅ Can only restore deleted transactions
      },
    });

    if (txnsToRestore.length !== transactionIds.length) {
      throw new AppError(
        400,
        `Only ${txnsToRestore.length} of ${transactionIds.length} transactions found and deleted`
      );
    }

    // Restore transactions
    const restored = await prisma.backdatedTransaction.updateMany({
      where: {
        id: { in: transactionIds },
      },
      data: {
        deletedAt: null, // ✅ SOFT DELETE: Clear deletion marker
        deletedBy: null, // Clear who deleted it
      },
    });

    console.log('[BackdatedEntries] Restored deleted transactions:', {
      branchId,
      businessDate,
      restoreCount: restored.count,
      restoredBy: userId,
    });

    return {
      branchId,
      businessDate,
      restoredCount: restored.count,
      transactions: txnsToRestore.map(txn => ({
        id: txn.id,
        productName: txn.productName,
        quantity: parseFloat(txn.quantity.toString()),
      })),
    };
  }
}
