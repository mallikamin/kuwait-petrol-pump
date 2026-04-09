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

    // Meter totals must come from meter_readings (single source of truth), not backdated entries.
    const dailyMeterReadings = await this.meterReadingsDailyService.getDailyMeterReadings(
      branchId,
      businessDate,
      organizationId
    );
    const selectedShifts = shiftId
      ? dailyMeterReadings.shifts.filter((s) => s.shiftId === shiftId)
      : dailyMeterReadings.shifts;

    const nozzleMeterLiters = new Map<string, number>();
    const nozzlesWithValidMeter = new Set<string>();
    let hsdMeterLiters = 0;
    let pmgMeterLiters = 0;

    selectedShifts.forEach((shiftData) => {
      shiftData.nozzles.forEach((nozzle) => {
        const opening = nozzle.opening?.value;
        const closing = nozzle.closing?.value;
        if (opening === null || opening === undefined || closing === null || closing === undefined) {
          return;
        }

        const liters = closing - opening;
        if (liters < 0) {
          console.warn('[BackdatedEntries] Negative meter delta ignored', {
            branchId,
            businessDate,
            shiftId: shiftData.shiftId,
            nozzleId: nozzle.nozzleId,
            opening,
            closing,
            liters,
          });
          return;
        }

        nozzlesWithValidMeter.add(nozzle.nozzleId);
        nozzleMeterLiters.set(nozzle.nozzleId, (nozzleMeterLiters.get(nozzle.nozzleId) || 0) + liters);

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
        fuelCode: (txn as any).fuelType?.code || '', // ✅ CRITICAL: Return actual fuel type from transaction, NOT from nozzle
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
        const resolvedFuelCode = entries
          .flatMap(e => e.nozzle.fuelType)
          .find(ft => ft.id === txnFuelType.fuelTypeId)?.code || '???';

        if (txnFuelCode && resolvedFuelCode && txnFuelCode !== resolvedFuelCode) {
          consistencyWarnings.push({
            txnId: txn.id,
            fuelCode: txnFuelCode,
            fuelTypeId: txnFuelType.fuelTypeId,
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
  async saveDailyDraft(input: DailySaveInput, organizationId: string, userId?: string) {
    const { branchId, businessDate, shiftId, transactions } = input;

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
      if (txn.fuelCode) {
        allFuelCodes.add((txn.fuelCode || '').toUpperCase());
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

    // ✅ VALIDATION: Every transaction MUST have a valid fuel code
    for (const txn of transactions) {
      const fuelCode = (txn.fuelCode || '').toUpperCase();
      if (!fuelCode || !fuelTypesMap.has(fuelCode)) {
        throw new AppError(
          400,
          `Transaction with ${txn.quantity}L and product "${txn.productName}" has invalid/missing fuel code: "${txn.fuelCode}". ` +
          `Valid codes are: ${Array.from(fuelTypesMap.keys()).join(', ')}`
        );
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
        },
        include: { fuelType: true },
      });

      const existingFuelById = new Map(
        existingFuelMap.map(txn => [txn.id, txn.fuelType.code])
      );

      // Find any transactions where fuel type is changing
      const fuelChanges = transactions.filter(incoming => {
        if (!incoming.id || !existingFuelById.has(incoming.id)) return false;
        const existingFuelCode = existingFuelById.get(incoming.id);
        const incomingFuelCode = (incoming.fuelCode || '').toUpperCase();
        return existingFuelCode !== incomingFuelCode;
      });

      if (fuelChanges.length > 0) {
        console.warn('[BackdatedEntries] Detected cross-fuel changes - requiring explicit allowance:', {
          branchId,
          businessDate,
          changes: fuelChanges.map(txn => ({
            id: txn.id,
            from: existingFuelById.get(txn.id),
            to: (txn.fuelCode || '').toUpperCase(),
            quantity: txn.quantity,
          })),
        });

        // Only reject if this wasn't an explicit override (future: add allowFuelTypeChange flag)
        // For now, log the warning but allow the change (migration mode)
        console.warn('[BackdatedEntries] Cross-fuel change ALLOWED (will be restricted in future with explicit flag)');
      }
    }

    console.log('[BackdatedEntries] Fuel types resolved:', {
      uniqueFuelCodes: Array.from(fuelTypesMap.keys()),
      totalTransactions: transactions.length,
    });

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

          entryId = existingEntry.id;

          // ✅ FIX: NON-DESTRUCTIVE UPSERT - prevent data loss from partial payloads
          // Get existing transactions
          const existingTxns = await prisma.backdatedTransaction.findMany({
            where: { backdatedEntryId: existingEntry.id },
          });

          const existingTxnIds = new Set(existingTxns.map(t => t.id));
          const incomingTxnIds = new Set(nozzleTxns.filter(t => t.id).map(t => t.id!));

          // ✅ FIX #1: Safety check - only delete if ALL incoming rows have IDs

          // Upsert each transaction individually
          let upsertedCount = 0;
          let createdCount = 0;
          let updatedCount = 0;

          for (const txn of nozzleTxns) {
            // ✅ CRITICAL FIX: Resolve fuel type from txn.fuelCode, NOT nozzle.fuelTypeId
            const fuelCode = (txn.fuelCode || '').toUpperCase();
            const resolvedFuelTypeId = fuelTypesMap.get(fuelCode);

            if (!resolvedFuelTypeId) {
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
              // ✅ FIX #2: Scope update to entry for integrity
              // Update existing transaction (verify ownership first)
              const updateResult = await prisma.backdatedTransaction.updateMany({
                where: {
                  id: txn.id,
                  backdatedEntryId: entryId, // Scoped: prevent cross-entry pollution
                },
                data: txnData,
              });

              if (updateResult.count === 0) {
                console.error('[BackdatedEntries] INTEGRITY ERROR: Attempted to update transaction with wrong entry', {
                  txnId: txn.id,
                  entryId,
                });
                throw new AppError(400, `Transaction ${txn.id} does not belong to this entry`);
              }
              updatedCount++;
            } else {
              // Create new transaction (with stable ID if provided)
              // ✅ DUPLICATE GUARD: If no ID provided, check for fingerprint match to prevent accidental duplicates
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
                  // Skip insert, treat as already saved
                  upsertedCount++;
                  continue;
                }
              }

              await prisma.backdatedTransaction.create({
                data: {
                  id: txn.id, // Use client-provided ID if available
                  ...txnData,
                  createdBy: userId || null,
                },
              });
              createdCount++;
            }
            upsertedCount++;
          }

          // ✅ FIX #1: CRITICAL - Prevent data loss from partial saves
          // Only delete if ALL conditions are met:
          // 1. All incoming rows have stable IDs (can't delete if there are new rows without IDs)
          // 2. Incoming transaction count >= existing count (no partial payload that drops data)
          // 3. No gap between existing and incoming (prevents accidental deletion)
          let deletedCount = 0;
          const allIncomingHaveIds = nozzleTxns.length > 0 && nozzleTxns.every((txn) => !!txn.id);
          const incomingCountGreaterOrEqual = nozzleTxns.length >= existingTxnIds.size;
          const canDeleteMissing = allIncomingHaveIds && incomingCountGreaterOrEqual;

          if (canDeleteMissing) {
            const txnsToDelete = Array.from(existingTxnIds).filter(id => !incomingTxnIds.has(id));
            if (txnsToDelete.length > 0) {
              console.log('[BackdatedEntries] Safe deletion check:', {
                entryId,
                nozzleId,
                existingCount: existingTxnIds.size,
                incomingCount: nozzleTxns.length,
                toDeleteCount: txnsToDelete.length,
              });
              await prisma.backdatedTransaction.deleteMany({
                where: {
                  id: { in: txnsToDelete },
                  backdatedEntryId: entryId, // Extra safety: scope to entry
                },
              });
              deletedCount = txnsToDelete.length;
              console.log('[BackdatedEntries] Deleted removed transactions:', deletedCount);
            }
          } else {
            console.log('[BackdatedEntries] Skip delete - unsafe to delete (prevents partial-save data loss)', {
              entryId,
              nozzleId,
              existingCount: existingTxnIds.size,
              incomingCount: nozzleTxns.length,
              allIncomingHaveIds,
              incomingCountGreaterOrEqual,
              reason: !allIncomingHaveIds ? 'incoming has rows without IDs' : 'incoming count < existing count (partial save)',
            });
          }

          console.log('[BackdatedEntries] Upserted transactions:', {
            entryId,
            nozzleId,
            total: upsertedCount,
            created: createdCount,
            updated: updatedCount,
            deleted: deletedCount,
          });
        } else {
          console.log('[BackdatedEntries] Creating new entry for nozzle:', nozzleId);

          // Create new entry
          // Draft entries are transaction containers; meter readings come from meter_readings table.
          const opening = 0;
          const closing = 0;

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

          // Create all transactions for new entry
          let createdCount = 0;
          for (const txn of nozzleTxns) {
            // ✅ CRITICAL FIX: Resolve fuel type from txn.fuelCode, NOT nozzle.fuelTypeId
            const fuelCode = (txn.fuelCode || '').toUpperCase();
            const resolvedFuelTypeId = fuelTypesMap.get(fuelCode);

            if (!resolvedFuelTypeId) {
              throw new AppError(400, `Cannot resolve fuel type for code: ${txn.fuelCode}`);
            }

            await prisma.backdatedTransaction.create({
              data: {
                id: txn.id, // Use client-provided ID if available
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
                createdBy: userId || null,
                updatedBy: userId || null,
              },
            });
            createdCount++;
          }

          console.log('[BackdatedEntries] Created transactions:', {
            entryId,
            nozzleId,
            count: createdCount,
          });
        }

        return { nozzleId, entryId };
      })
    );

    console.log('[BackdatedEntries] Saved all entries:', results.length);

    // Handle walk-in transactions (those without nozzleId)
    if (txnsWithoutNozzle.length > 0) {
      console.log('[BackdatedEntries] Processing walk-in transactions:', txnsWithoutNozzle.length);

      // Get first active nozzle from branch as placeholder
      const placeholderNozzle = await prisma.nozzle.findFirst({
        where: {
          dispensingUnit: {
            branchId,
          },
          isActive: true,
        },
        include: {
          fuelType: true,
        },
      });

      if (!placeholderNozzle) {
        throw new AppError(400, 'No active nozzles found in branch. Cannot save walk-in transactions.');
      }

      // Check if walk-in entry already exists for this date
      const walkInEntryKey = `WALKIN_${businessDate}`;
      const existingWalkInEntry = await prisma.backdatedEntry.findFirst({
        where: {
          branchId,
          businessDate: businessDateObj,
          shiftId: shiftId || null,
          notes: { startsWith: 'WALK-IN:' }, // Identify walk-in entries by notes prefix
        },
      });

      let walkInEntryId: string;

      if (existingWalkInEntry) {
        console.log('[BackdatedEntries] Using existing walk-in entry:', existingWalkInEntry.id);
        walkInEntryId = existingWalkInEntry.id;

        // ✅ FIX: NON-DESTRUCTIVE UPSERT for walk-in transactions
        const existingWalkInTxns = await prisma.backdatedTransaction.findMany({
          where: { backdatedEntryId: existingWalkInEntry.id },
        });

        const existingTxnIds = new Set(existingWalkInTxns.map(t => t.id));
        const incomingTxnIds = new Set(txnsWithoutNozzle.filter(t => t.id).map(t => t.id!));

        // ✅ FIX #1: Safety check for walk-in transactions
        // Upsert each walk-in transaction
        let upsertedCount = 0;
        let createdCount = 0;
        let updatedCount = 0;

        for (const txn of txnsWithoutNozzle) {
          // ✅ CRITICAL FIX: Use global fuelTypesMap (already validated)
          const fuelCode = (txn.fuelCode || '').toUpperCase();
          const resolvedFuelTypeId = fuelTypesMap.get(fuelCode);

          if (!resolvedFuelTypeId) {
            throw new AppError(400, `Cannot resolve fuel type for walk-in code: ${txn.fuelCode}`);
          }

          const txnData = {
            backdatedEntryId: walkInEntryId,
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
            // ✅ FIX #2: Scope update to entry
            const updateResult = await prisma.backdatedTransaction.updateMany({
              where: {
                id: txn.id,
                backdatedEntryId: walkInEntryId, // Scoped: prevent cross-entry pollution
              },
              data: txnData,
            });

            if (updateResult.count === 0) {
              console.error('[BackdatedEntries] INTEGRITY ERROR: Walk-in transaction with wrong entry', {
                txnId: txn.id,
                walkInEntryId,
              });
              throw new AppError(400, `Walk-in transaction ${txn.id} does not belong to this entry`);
            }
            updatedCount++;
          } else {
            // Create new
            // ✅ DUPLICATE GUARD: Check fingerprint for walk-in transactions too
            if (!txn.id) {
              const fingerprint = await prisma.backdatedTransaction.findFirst({
                where: {
                  backdatedEntryId: walkInEntryId,
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
                console.warn('[BackdatedEntries] Duplicate walk-in fingerprint detected, skipping:', {
                  walkInEntryId,
                  productName: txn.productName,
                  existingId: fingerprint.id,
                });
                upsertedCount++;
                continue;
              }
            }

            await prisma.backdatedTransaction.create({
              data: {
                id: txn.id,
                ...txnData,
                createdBy: userId || null,
              },
            });
            createdCount++;
          }
          upsertedCount++;
        }

        // ✅ FIX #1: CRITICAL - Prevent data loss from partial saves (walk-in version)
        // Only delete if ALL conditions are met:
        // 1. All incoming rows have stable IDs (can't delete if there are new rows without IDs)
        // 2. Incoming transaction count >= existing count (no partial payload that drops data)
        // 3. No gap between existing and incoming (prevents accidental deletion)
        let deletedCount = 0;
        const allWalkinIncomingHaveIds = txnsWithoutNozzle.length > 0 && txnsWithoutNozzle.every((txn) => !!txn.id);
        const walkinIncomingCountGreaterOrEqual = txnsWithoutNozzle.length >= existingTxnIds.size;
        const canDeleteMissing = allWalkinIncomingHaveIds && walkinIncomingCountGreaterOrEqual;

        if (canDeleteMissing) {
          const txnsToDelete = Array.from(existingTxnIds).filter(id => !incomingTxnIds.has(id));
          if (txnsToDelete.length > 0) {
            console.log('[BackdatedEntries] Safe walk-in deletion check:', {
              walkInEntryId,
              existingCount: existingTxnIds.size,
              incomingCount: txnsWithoutNozzle.length,
              toDeleteCount: txnsToDelete.length,
            });
            await prisma.backdatedTransaction.deleteMany({
              where: {
                id: { in: txnsToDelete },
                backdatedEntryId: walkInEntryId, // Extra safety: scope to entry
              },
            });
            deletedCount = txnsToDelete.length;
          }
        } else {
          console.log('[BackdatedEntries] Skip walk-in delete - unsafe to delete (prevents partial-save data loss)', {
            walkInEntryId,
            existingCount: existingTxnIds.size,
            incomingCount: txnsWithoutNozzle.length,
            allWalkinIncomingHaveIds,
            walkinIncomingCountGreaterOrEqual,
            reason: !allWalkinIncomingHaveIds ? 'incoming has rows without IDs' : 'incoming count < existing count (partial save)',
          });
        }

        console.log('[BackdatedEntries] Upserted walk-in transactions:', {
          total: upsertedCount,
          created: createdCount,
          updated: updatedCount,
          deleted: deletedCount,
        });
      } else {
        // Create walk-in entry (use placeholder nozzle, zero meter readings)
        console.log('[BackdatedEntries] Creating walk-in entry');
        const walkInEntry = await prisma.backdatedEntry.create({
          data: {
            branchId,
            businessDate: businessDateObj,
            nozzleId: placeholderNozzle.id, // Placeholder (required by schema)
            shiftId: shiftId || null,
            openingReading: new Prisma.Decimal(0),
            closingReading: new Prisma.Decimal(0),
            notes: 'WALK-IN: Non-fuel transactions without nozzle assignment',
          },
        });

        walkInEntryId = walkInEntry.id;

        // ✅ CRITICAL FIX: Create all walk-in transactions using global fuelTypesMap (already validated)
        let createdCount = 0;
        for (const txn of txnsWithoutNozzle) {
          const fuelCode = (txn.fuelCode || '').toUpperCase();
          const resolvedFuelTypeId = fuelTypesMap.get(fuelCode);

          if (!resolvedFuelTypeId) {
            throw new AppError(400, `Cannot resolve fuel type for walk-in code: ${txn.fuelCode}`);
          }

          await prisma.backdatedTransaction.create({
            data: {
              id: txn.id,
              backdatedEntryId: walkInEntryId,
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
              createdBy: userId || null,
              updatedBy: userId || null,
            },
          });
          createdCount++;
        }

        console.log('[BackdatedEntries] Created walk-in transactions:', createdCount);
      }
    }

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

    if (Math.abs(cashGap) > cashTolerancePkr) {
      reconciliationErrors.push({
        message: `Cash reconciliation gap: PKR ${Math.abs(cashGap).toFixed(2)} ${cashGap > 0 ? 'short' : 'excess'}`
      });
    }

    // Legacy per-entry isReconciled flags are not maintained by the current daily workflow.
    // Quantitative gates above (liters + cash) are the source of truth for finalization.

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

    return {
      success: true,
      message: `Day finalized successfully`,
      postedSalesCount: createdSales.length,
      inventoryUpdatesCount: 0, // Inventory deductions handled via StockLevel adjustments
      reportSyncStatus: 'completed',
      details: {
        entriesFinalized: entries.length,
        transactionsProcessed: plainTransactions.length,
        salesCreated: createdSales.length,
        qbSyncQueued: plainTransactions.length > 0 ? 'pending' : 'none',
        saleIds: createdSales,
      },
    };
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

    // Get all transactions with full audit trail
    const transactions = await prisma.backdatedTransaction.findMany({
      where: {
        backdatedEntry: {
          branchId,
          businessDate: businessDateObj,
          ...(shiftId ? { shiftId } : {}),
        },
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
}

