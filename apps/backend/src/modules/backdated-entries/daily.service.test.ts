/**
 * Regression Test: Fuel Type Corruption Fix (P0)
 *
 * CODEX: April 2, 2026 reconciled at 100% with HSD 1100L + PMG 1250L.
 * After finalize + tab navigation, transactions corrupted:
 * - HSD jumped to 3700L
 * - PMG dropped to 0L
 *
 * ROOT CAUSE: Backend ignored txn.fuelCode, always used nozzle.fuelTypeId.
 * For walk-in with placeholder HSD nozzle, ALL txns (HSD+PMG) became HSD.
 *
 * FIX: Resolve fuelTypeId from txn.fuelCode, not nozzle.fuelTypeId.
 * This test verifies mixed-fuel save preserves fuel split across navigation/refetch/finalize.
 */

import { prisma } from '../../config/database';
import { DailyBackdatedEntriesService } from './daily.service';
import { AppError } from '../../middleware/error.middleware';

describe('DailyBackdatedEntriesService - Fuel Type Corruption Regression', () => {
  const service = new DailyBackdatedEntriesService();

  const testOrganizationId = '11111111-1111-1111-1111-111111111111';
  const testBranchId = '75db4c0b-8050-4e9f-96ae-2a6fc10ff1f6';
  const testDate = '2026-04-10'; // Fresh test date (not April 2, which has old corrupted data)
  const testUserId = '5f2a213f-e20a-428b-8546-e4e2c251e946';

  let hsdFuelTypeId: string;
  let pmgFuelTypeId: string;
  let hsdNozzleId: string;

  // Setup: Get HSD/PMG fuel type IDs and a nozzle
  beforeAll(async () => {
    const hsd = await prisma.fuelType.findUnique({ where: { code: 'HSD' } });
    const pmg = await prisma.fuelType.findUnique({ where: { code: 'PMG' } });
    const nozzles = await prisma.nozzle.findMany({
      where: {
        dispensingUnit: { branchId: testBranchId },
        isActive: true,
      },
      take: 1,
    });

    if (!hsd || !pmg || nozzles.length === 0) {
      throw new Error('Test data missing: fuel types or nozzles');
    }

    hsdFuelTypeId = hsd.id;
    pmgFuelTypeId = pmg.id;
    hsdNozzleId = nozzles[0].id;
  });

  // Cleanup: Remove test data after each test
  afterEach(async () => {
    await prisma.backdatedTransaction.deleteMany({
      where: {
        backdatedEntry: {
          branchId: testBranchId,
          businessDate: new Date(`${testDate}T00:00:00Z`),
        },
      },
    });

    await prisma.backdatedEntry.deleteMany({
      where: {
        branchId: testBranchId,
        businessDate: new Date(`${testDate}T00:00:00Z`),
      },
    });
  });

  /**
   * TEST 1: Mixed fuel split preserved across save
   *
   * GIVEN: 2 HSD + 2 PMG transactions
   * WHEN: Save via API with explicit fuelCodes
   * THEN: Database should show 2 HSD + 2 PMG (not all HSD)
   */
  test('preserves HSD+PMG split in single save', async () => {
    const payload = {
      branchId: testBranchId,
      businessDate: testDate,
      transactions: [
        {
          id: 'txn-hsd-1',
          nozzleId: hsdNozzleId,
          fuelCode: 'HSD',
          productName: 'High Speed Diesel',
          quantity: 500,
          unitPrice: 350,
          lineTotal: 175000,
          paymentMethod: 'cash' as const,
        },
        {
          id: 'txn-pmg-1',
          nozzleId: hsdNozzleId, // ⚠️ Walk-in using placeholder nozzle
          fuelCode: 'PMG', // ✅ But fuelCode says PMG
          productName: 'Premium Gasoline',
          quantity: 600,
          unitPrice: 460,
          lineTotal: 276000,
          paymentMethod: 'cash' as const,
        },
        {
          id: 'txn-hsd-2',
          nozzleId: hsdNozzleId,
          fuelCode: 'HSD',
          productName: 'High Speed Diesel',
          quantity: 550,
          unitPrice: 350,
          lineTotal: 192500,
          paymentMethod: 'cash' as const,
        },
        {
          id: 'txn-pmg-2',
          nozzleId: hsdNozzleId,
          fuelCode: 'PMG',
          productName: 'Premium Gasoline',
          quantity: 650,
          unitPrice: 460,
          lineTotal: 299000,
          paymentMethod: 'cash' as const,
        },
      ],
    };

    // Save
    await service.saveDailyDraft(payload, testUserId, testOrganizationId);

    // Verify in database
    const hsdTxns = await prisma.backdatedTransaction.count({
      where: {
        backdatedEntry: {
          branchId: testBranchId,
          businessDate: new Date(`${testDate}T00:00:00Z`),
        },
        fuelTypeId: hsdFuelTypeId,
      },
    });

    const pmgTxns = await prisma.backdatedTransaction.count({
      where: {
        backdatedEntry: {
          branchId: testBranchId,
          businessDate: new Date(`${testDate}T00:00:00Z`),
        },
        fuelTypeId: pmgFuelTypeId,
      },
    });

    expect(hsdTxns).toBe(2); // ✅ Not all 4
    expect(pmgTxns).toBe(2);

    // Verify liters
    const hsdLiters = await prisma.backdatedTransaction.aggregate({
      where: {
        backdatedEntry: {
          branchId: testBranchId,
          businessDate: new Date(`${testDate}T00:00:00Z`),
        },
        fuelTypeId: hsdFuelTypeId,
      },
      _sum: { quantity: true },
    });

    const pmgLiters = await prisma.backdatedTransaction.aggregate({
      where: {
        backdatedEntry: {
          branchId: testBranchId,
          businessDate: new Date(`${testDate}T00:00:00Z`),
        },
        fuelTypeId: pmgFuelTypeId,
      },
      _sum: { quantity: true },
    });

    expect(hsdLiters._sum.quantity?.toNumber()).toBe(1050); // 500 + 550
    expect(pmgLiters._sum.quantity?.toNumber()).toBe(1250); // 600 + 650
  });

  /**
   * TEST 2: Validation rejects invalid fuel code
   *
   * GIVEN: Transaction with missing fuelCode
   * WHEN: Save via API
   * THEN: Reject with 400 error
   */
  test('rejects transaction with missing fuelCode', async () => {
    const payload = {
      branchId: testBranchId,
      businessDate: testDate,
      transactions: [
        {
          id: 'txn-invalid',
          nozzleId: hsdNozzleId,
          fuelCode: '', // ❌ Empty
          productName: 'Unknown Fuel',
          quantity: 100,
          unitPrice: 350,
          lineTotal: 35000,
          paymentMethod: 'cash' as const,
        },
      ],
    };

    await expect(service.saveDailyDraft(payload, testUserId, testOrganizationId)).rejects.toThrow(
      AppError
    );
  });

  /**
   * TEST 3: API response returns correct fuelCode (not nozzle fuel type)
   *
   * GIVEN: Saved mixed transactions
   * WHEN: Fetch via getDailySummary
   * THEN: Response should show txn.fuelCode, not txn.nozzle.fuelType
   */
  test('getDailySummary returns correct fuelCode in transactions', async () => {
    // Save first
    await service.saveDailyDraft(
      {
        branchId: testBranchId,
        businessDate: testDate,
        transactions: [
          {
            id: 'txn-hsd-test',
            nozzleId: hsdNozzleId,
            fuelCode: 'HSD',
            productName: 'HSD',
            quantity: 500,
            unitPrice: 350,
            lineTotal: 175000,
            paymentMethod: 'cash' as const,
          },
          {
            id: 'txn-pmg-test',
            nozzleId: hsdNozzleId, // ⚠️ Placeholder nozzle is HSD
            fuelCode: 'PMG', // ✅ But txn is PMG
            productName: 'PMG',
            quantity: 600,
            unitPrice: 460,
            lineTotal: 276000,
            paymentMethod: 'cash' as const,
          },
        ],
      },
      testUserId,
      testOrganizationId
    );

    // Fetch
    const summary = await service.getDailySummary(
      { branchId: testBranchId, businessDate: testDate },
      testOrganizationId
    );

    // Verify fuelCode in response
    const hsdTxn = summary.transactions.find((t: any) => t.id === 'txn-hsd-test');
    const pmgTxn = summary.transactions.find((t: any) => t.id === 'txn-pmg-test');

    expect(hsdTxn.fuelCode).toBe('HSD'); // ✅ Correct
    expect(pmgTxn.fuelCode).toBe('PMG'); // ✅ Not 'HSD' (nozzle type)

    // Verify posted totals
    expect(summary.postedTotals.hsdLiters).toBe(500);
    expect(summary.postedTotals.pmgLiters).toBe(600);
  });

  /**
   * TEST 4: Re-save same day multiple times preserves fuel split
   *
   * CODEX SCENARIO: User saves batch 1 (HSD), then batch 2 (PMG), then batch 3 (more HSD).
   * Each save should NOT delete previous saves or flip fuel types.
   *
   * GIVEN: 3 sequential saves with different fuel mixes
   * WHEN: Save batch 1 (HSD), then batch 2 (PMG), then batch 3 (HSD+PMG)
   * THEN: All 6 transactions should persist with correct fuel split
   */
  test('multiple re-saves preserve fuel split (batching scenario)', async () => {
    const batchDate = testDate;
    const batchBranchId = testBranchId;

    // Batch 1: 2 HSD
    await service.saveDailyDraft(
      {
        branchId: batchBranchId,
        businessDate: batchDate,
        transactions: [
          {
            id: 'batch1-hsd-1',
            nozzleId: hsdNozzleId,
            fuelCode: 'HSD',
            productName: 'HSD',
            quantity: 500,
            unitPrice: 350,
            lineTotal: 175000,
            paymentMethod: 'cash' as const,
          },
          {
            id: 'batch1-hsd-2',
            nozzleId: hsdNozzleId,
            fuelCode: 'HSD',
            productName: 'HSD',
            quantity: 500,
            unitPrice: 350,
            lineTotal: 175000,
            paymentMethod: 'cash' as const,
          },
        ],
      },
      testUserId,
      testOrganizationId
    );

    // Verify batch 1
    let summary = await service.getDailySummary(
      { branchId: batchBranchId, businessDate: batchDate },
      testOrganizationId
    );
    expect(summary.transactions.length).toBe(2);
    expect(summary.postedTotals.hsdLiters).toBe(1000);
    expect(summary.postedTotals.pmgLiters).toBe(0);

    // Batch 2: Add 2 PMG (with previous HSD batch still in payload)
    await service.saveDailyDraft(
      {
        branchId: batchBranchId,
        businessDate: batchDate,
        transactions: [
          {
            id: 'batch1-hsd-1',
            nozzleId: hsdNozzleId,
            fuelCode: 'HSD',
            productName: 'HSD',
            quantity: 500,
            unitPrice: 350,
            lineTotal: 175000,
            paymentMethod: 'cash' as const,
          },
          {
            id: 'batch1-hsd-2',
            nozzleId: hsdNozzleId,
            fuelCode: 'HSD',
            productName: 'HSD',
            quantity: 500,
            unitPrice: 350,
            lineTotal: 175000,
            paymentMethod: 'cash' as const,
          },
          {
            id: 'batch2-pmg-1',
            nozzleId: hsdNozzleId,
            fuelCode: 'PMG',
            productName: 'PMG',
            quantity: 600,
            unitPrice: 460,
            lineTotal: 276000,
            paymentMethod: 'cash' as const,
          },
          {
            id: 'batch2-pmg-2',
            nozzleId: hsdNozzleId,
            fuelCode: 'PMG',
            productName: 'PMG',
            quantity: 600,
            unitPrice: 460,
            lineTotal: 276000,
            paymentMethod: 'cash' as const,
          },
        ],
      },
      testUserId,
      testOrganizationId
    );

    // Verify batch 2 (should NOT delete batch 1)
    summary = await service.getDailySummary(
      { branchId: batchBranchId, businessDate: batchDate },
      testOrganizationId
    );
    expect(summary.transactions.length).toBe(4); // ✅ All 4, not deleted
    expect(summary.postedTotals.hsdLiters).toBe(1000);
    expect(summary.postedTotals.pmgLiters).toBe(1200);

    // Batch 3: Add 1 HSD + 1 PMG (completing the set)
    await service.saveDailyDraft(
      {
        branchId: batchBranchId,
        businessDate: batchDate,
        transactions: [
          {
            id: 'batch1-hsd-1',
            nozzleId: hsdNozzleId,
            fuelCode: 'HSD',
            productName: 'HSD',
            quantity: 500,
            unitPrice: 350,
            lineTotal: 175000,
            paymentMethod: 'cash' as const,
          },
          {
            id: 'batch1-hsd-2',
            nozzleId: hsdNozzleId,
            fuelCode: 'HSD',
            productName: 'HSD',
            quantity: 500,
            unitPrice: 350,
            lineTotal: 175000,
            paymentMethod: 'cash' as const,
          },
          {
            id: 'batch2-pmg-1',
            nozzleId: hsdNozzleId,
            fuelCode: 'PMG',
            productName: 'PMG',
            quantity: 600,
            unitPrice: 460,
            lineTotal: 276000,
            paymentMethod: 'cash' as const,
          },
          {
            id: 'batch2-pmg-2',
            nozzleId: hsdNozzleId,
            fuelCode: 'PMG',
            productName: 'PMG',
            quantity: 600,
            unitPrice: 460,
            lineTotal: 276000,
            paymentMethod: 'cash' as const,
          },
          {
            id: 'batch3-hsd-1',
            nozzleId: hsdNozzleId,
            fuelCode: 'HSD',
            productName: 'HSD',
            quantity: 100,
            unitPrice: 350,
            lineTotal: 35000,
            paymentMethod: 'cash' as const,
          },
          {
            id: 'batch3-pmg-1',
            nozzleId: hsdNozzleId,
            fuelCode: 'PMG',
            productName: 'PMG',
            quantity: 50,
            unitPrice: 460,
            lineTotal: 23000,
            paymentMethod: 'cash' as const,
          },
        ],
      },
      testUserId,
      testOrganizationId
    );

    // Final verification
    summary = await service.getDailySummary(
      { branchId: batchBranchId, businessDate: batchDate },
      testOrganizationId
    );

    expect(summary.transactions.length).toBe(6); // ✅ All 6
    expect(summary.postedTotals.hsdLiters).toBe(1100); // 500 + 500 + 100
    expect(summary.postedTotals.pmgLiters).toBe(1250); // 600 + 600 + 50

    // ✅ CRITICAL: Verify each transaction has correct fuel code
    const txnFuelCodes = summary.transactions.map((t: any) => ({
      id: t.id,
      fuelCode: t.fuelCode,
    }));

    const pmgTxns = txnFuelCodes.filter((t: any) => t.fuelCode === 'PMG');
    expect(pmgTxns.length).toBe(3); // ✅ Not corrupted to HSD
  });

  /**
   * TEST 5: CRITICAL - Navigation corruption test
   *
   * CODEX BUG SCENARIO: User saves mixed HSD+PMG on April 2.
   * After finalize, user navigates to another screen.
   * Then navigates back to BackdatedEntries and loads the same date.
   * EXPECTED: HSD and PMG split should be unchanged
   * ACTUAL BUG (pre-fix): HSD jumps to 3700L, PMG drops to 0L (all txns become HSD)
   *
   * GIVEN: Mixed HSD+PMG saved and finalized
   * WHEN: Refetch via getDailySummary (simulating navigation back)
   * THEN: Fuel split should remain unchanged (no corruption)
   */
  test('navigation away and back preserves fuel split (P0 corruption scenario)', async () => {
    const navDate = '2026-04-02'; // Real date from bug report
    const navBranchId = testBranchId;

    // Step 1: Save mixed HSD + PMG (April 2, 100% reconciled: 1100L HSD + 1250L PMG)
    const initialSave = await service.saveDailyDraft(
      {
        branchId: navBranchId,
        businessDate: navDate,
        transactions: [
          {
            id: 'nav-hsd-1',
            nozzleId: hsdNozzleId,
            fuelCode: 'HSD',
            productName: 'High Speed Diesel',
            quantity: 550,
            unitPrice: 350,
            lineTotal: 192500,
            paymentMethod: 'cash' as const,
          },
          {
            id: 'nav-hsd-2',
            nozzleId: hsdNozzleId,
            fuelCode: 'HSD',
            productName: 'High Speed Diesel',
            quantity: 550,
            unitPrice: 350,
            lineTotal: 192500,
            paymentMethod: 'cash' as const,
          },
          {
            id: 'nav-pmg-1',
            nozzleId: hsdNozzleId, // ⚠️ Walk-in with placeholder HSD nozzle
            fuelCode: 'PMG', // ✅ But PMG
            productName: 'Premium Gasoline',
            quantity: 625,
            unitPrice: 460,
            lineTotal: 287500,
            paymentMethod: 'cash' as const,
          },
          {
            id: 'nav-pmg-2',
            nozzleId: hsdNozzleId,
            fuelCode: 'PMG', // ✅ But PMG
            productName: 'Premium Gasoline',
            quantity: 625,
            unitPrice: 460,
            lineTotal: 287500,
            paymentMethod: 'cash' as const,
          },
        ],
      },
      testUserId,
      testOrganizationId
    );

    // Verify initial save
    expect(initialSave.postedTotals.hsdLiters).toBe(1100);
    expect(initialSave.postedTotals.pmgLiters).toBe(1250);
    console.log('[NAV TEST] Step 1 - Initial save:', {
      hsd: initialSave.postedTotals.hsdLiters,
      pmg: initialSave.postedTotals.pmgLiters,
      txnCount: initialSave.transactions.length,
    });

    // Step 2: Simulate user navigating away and back by fetching again (multiple times)
    // This is the real-world pattern that triggers the bug
    for (let refetchAttempt = 1; refetchAttempt <= 3; refetchAttempt++) {
      const refetch = await service.getDailySummary(
        { branchId: navBranchId, businessDate: navDate },
        testOrganizationId
      );

      console.log(`[NAV TEST] Step 2.${refetchAttempt} - After navigation refetch:`, {
        hsd: refetch.postedTotals.hsdLiters,
        pmg: refetch.postedTotals.pmgLiters,
        txnCount: refetch.transactions.length,
        sampleFuelCodes: refetch.transactions.map(t => ({ id: t.id, fuelCode: t.fuelCode })),
      });

      // ✅ CRITICAL ASSERTION: Fuel split must not flip
      expect(refetch.postedTotals.hsdLiters).toBe(1100); // NOT 3700!
      expect(refetch.postedTotals.pmgLiters).toBe(1250); // NOT 0!
      expect(refetch.transactions.length).toBe(4); // All 4 txns still there

      // ✅ CRITICAL: Verify each transaction has correct fuelCode
      const hsdTxns = refetch.transactions.filter(t => t.fuelCode === 'HSD');
      const pmgTxns = refetch.transactions.filter(t => t.fuelCode === 'PMG');
      expect(hsdTxns.length).toBe(2); // 2 HSD, NOT 4
      expect(pmgTxns.length).toBe(2); // 2 PMG, NOT 0
    }

    // Step 3: Verify forensic endpoint also shows correct split
    const forensic = await service.getForensicTransactions(
      { branchId: navBranchId, businessDate: navDate },
      testOrganizationId
    );

    console.log('[NAV TEST] Step 3 - Forensic check:', {
      checkResult: forensic.consistencyCheckResult,
      issueCount: forensic.consistencyIssues.length,
      totals: forensic.totals,
    });

    // ✅ CRITICAL: Forensic should show PASS (no consistency issues)
    expect(forensic.consistencyCheckResult).toBe('PASS');
    expect(forensic.consistencyIssues.length).toBe(0);

    // ✅ Fuel totals must match
    const hsdTotal = forensic.totals.find(t => t.fuelCode === 'HSD');
    const pmgTotal = forensic.totals.find(t => t.fuelCode === 'PMG');
    expect(hsdTotal?.totalLiters).toBe(1100);
    expect(pmgTotal?.totalLiters).toBe(1250);
  });

  /**
   * TEST 6: HOTFIX REGRESSION - Finalize Blocker Formatting
   *
   * SCENARIO: Liters show 100% but backend validation blockers exist
   * (cash gap, walk-in pending, etc.)
   *
   * ISSUE: Frontend was doing client-side validation and returning early
   * with "Array(3)" error (raw array.toString()), never calling backend.
   * Backend was returning structured error with details[], but frontend
   * never saw it.
   *
   * FIX: Frontend removed client-side hard validation, always calls backend.
   * Backend returns proper structured error with details[] array.
   *
   * This test verifies finalize returns 400 with details[] (not raw array).
   */
  it('TEST 6: finalize returns structured error with details[] on blocker', async () => {
    const blockDate = '2026-04-15';
    const blockBranchId = testBranchId;

    console.log('[HOTFIX TEST] Creating test scenario with partial reconciliation...');

    // Step 1: Save transactions with unfilled cash gap
    // (HSD & PMG at 100% liters, but cash reconciliation will fail)
    await service.saveDailyDraft({
      branchId: blockBranchId,
      businessDate: blockDate,
      transactions: [
        {
          customerId: undefined,
          nozzleId: hsdNozzleId,
          fuelCode: 'HSD',
          vehicleNumber: 'TEST-001',
          slipNumber: 'SLIP-001',
          productName: 'HSD',
          quantity: 50,
          unitPrice: 250,
          lineTotal: 12500,
          paymentMethod: 'cash',
        },
      ],
    }, testOrganizationId);

    // Step 2: Attempt finalize - should return structured error, not Array(3)
    console.log('[HOTFIX TEST] Calling finalizeDay (expect blocker error)...');
    let error: any = null;

    try {
      await service.finalizeDay(
        { branchId: blockBranchId, businessDate: blockDate },
        testOrganizationId
      );
    } catch (e) {
      error = e as any;
    }

    // ✅ CRITICAL: Error should be AppError with statusCode 400
    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(400);

    // ✅ CRITICAL: Error MUST have details[] array (not raw string/array.toString())
    console.log('[HOTFIX TEST] Checking error structure:', {
      message: error.message,
      hasDetails: !!error.details,
      detailsIsArray: Array.isArray(error.details),
      detailsLength: error.details?.length,
      detailsSample: error.details?.[0],
    });

    expect(error.details).toBeDefined();
    expect(Array.isArray(error.details)).toBe(true);
    expect(error.details.length).toBeGreaterThan(0);

    // ✅ Each detail must have message property (no raw Array(3))
    for (const detail of error.details) {
      expect(detail.message).toBeDefined();
      expect(typeof detail.message).toBe('string');
      expect(detail.message.length).toBeGreaterThan(0);
    }

    // ✅ Metrics should be populated for frontend to show gaps
    expect(error.metrics).toBeDefined();
    expect(error.metrics.hsdGap).toBeDefined();
    expect(error.metrics.pmgGap).toBeDefined();
    expect(error.metrics.cashGap).toBeDefined();

    console.log('[HOTFIX TEST] ✅ Finalize properly returns structured blockers:', {
      detailsCount: error.details.length,
      detailsMessages: error.details.map((d: any) => d.message),
      metrics: error.metrics,
    });
  });

  it('TEST 7: finalize succeeds with liters OK but cashGap warning (not blocker)', async () => {
    const testDate = '2026-04-20';
    const testBranchIdLocal = testBranchId;

    console.log('[CASH VARIANCE TEST] Creating scenario: liters 0 gap + cash variance...');

    // Step 1: Save transactions totaling exact meter readings (no liter gap)
    // HSD: 100L, PMG: 50L
    await service.saveDailyDraft({
      branchId: testBranchIdLocal,
      businessDate: testDate,
      transactions: [
        {
          customerId: undefined,
          nozzleId: hsdNozzleId,
          fuelCode: 'HSD',
          vehicleNumber: 'TEST-HSD-100',
          slipNumber: 'HSD-001',
          productName: 'HSD',
          quantity: 100, // Matches meter reading
          unitPrice: 250,
          lineTotal: 25000,
          paymentMethod: 'cash',
        },
        {
          customerId: undefined,
          nozzleId: pmgNozzleId,
          fuelCode: 'PMG',
          vehicleNumber: 'TEST-PMG-050',
          slipNumber: 'PMG-001',
          productName: 'PMG',
          quantity: 50, // Matches meter reading
          unitPrice: 200,
          lineTotal: 10000,
          paymentMethod: 'cash',
        },
      ],
    }, testOrganizationId);

    // Step 2: Finalize - should succeed (liters reconciled) despite any cash variance
    console.log('[CASH VARIANCE TEST] Calling finalizeDay (expect SUCCESS with warning)...');

    const result = await service.finalizeDay(
      { branchId: testBranchIdLocal, businessDate: testDate },
      testOrganizationId
    );

    // ✅ CRITICAL: Should succeed (200), not throw error
    expect(result).toBeDefined();
    expect(result.success).toBe(true);
    console.log('[CASH VARIANCE TEST] Finalize succeeded:', {
      success: result.success,
      message: result.message,
      hasCashGapWarning: !!result.cashGapWarning,
      cashGapWarning: result.cashGapWarning,
    });

    // ✅ If there is a cash gap, it should be in the response as warning (not blocker)
    if (result.cashGapWarning) {
      expect(result.cashGapWarning.amount).toBeDefined();
      expect(result.cashGapWarning.message).toBeDefined();
      expect(typeof result.cashGapWarning.amount).toBe('number');
      console.log('[CASH VARIANCE TEST] ✅ Cash variance returned as warning:', result.cashGapWarning);
    }

    // ✅ Verify entries are marked as finalized despite cash variance
    const entries = await prisma.backdatedEntry.findMany({
      where: {
        branchId: testBranchIdLocal,
        businessDate: new Date(testDate),
      },
    });

    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect((entry as any).isFinalized).toBe(true);
    }

    console.log('[CASH VARIANCE TEST] ✅ Finalize succeeded with liters OK, cash gap as warning only');
  });

  /**
   * TEST 7B: Cash gap warning suppressed for already-finalized days
   *
   * BACKGROUND: Cash gap is informational only (not a blocker) per TEST 7.
   * ISSUE: Cash warning was appearing even when re-finalizing already-finalized days.
   * FIX: Suppress cashGapWarning when wasAlreadyFinalized = true.
   *
   * GIVEN: A day with cash variance that was already finalized
   * WHEN: Call finalizeDay again (idempotent re-finalize)
   * THEN: Should return alreadyFinalized=true, message="Day already finalized", NO cashGapWarning
   */
  it('TEST 7B: cash gap warning suppressed for already-finalized days', async () => {
    const testDateForReFinalize = '2026-04-15'; // Different date to avoid conflicts

    // Step 1: Create backdated meter readings (same as TEST 7)
    await service.saveDailyMeterReadings({
      branchId: testBranchIdLocal,
      businessDate: testDateForReFinalize,
      nozzles: [
        { nozzleId: hsdNozzleId, shiftId: morningShiftId, readingType: 'opening', meterValue: 1000 },
        { nozzleId: hsdNozzleId, shiftId: morningShiftId, readingType: 'closing', meterValue: 1050 }, // +50L
      ],
    }, testOrganizationId);

    // Step 2: Save transactions (50L HSD at 340 PKR/L = 17000 PKR expected)
    await service.saveDailyDraft({
      branchId: testBranchIdLocal,
      businessDate: testDateForReFinalize,
      transactions: [
        {
          id: 'txn-hsd-cash-1',
          nozzleId: hsdNozzleId,
          fuelCode: 'HSD',
          productName: 'High Speed Diesel',
          quantity: 50,
          unitPrice: 200, // ❌ Intentionally wrong price (200 vs 340) → creates cash gap
          lineTotal: 10000, // 50L × 200 = 10000 (should be 17000)
          paymentMethod: 'cash',
        },
      ],
    }, testOrganizationId);

    // Step 3: First finalize - should succeed with cash warning
    const firstResult = await service.finalizeDay(
      { branchId: testBranchIdLocal, businessDate: testDateForReFinalize },
      testOrganizationId
    );

    expect(firstResult.success).toBe(true);
    expect(firstResult.alreadyFinalized).toBe(false); // Fresh finalization
    expect(firstResult.message).toContain('finalized successfully');

    // ✅ First finalize should include cash warning (fresh finalization)
    if (Math.abs(17000 - 10000) > 1.0) { // 7000 PKR gap > tolerance
      expect(firstResult.cashGapWarning).toBeDefined();
      expect(firstResult.cashGapWarning.amount).toBe(7000);
    }

    console.log('[RE-FINALIZE TEST] First finalize:', {
      alreadyFinalized: firstResult.alreadyFinalized,
      hasCashWarning: !!firstResult.cashGapWarning,
    });

    // Step 4: Second finalize (re-finalize already-finalized day)
    const secondResult = await service.finalizeDay(
      { branchId: testBranchIdLocal, businessDate: testDateForReFinalize },
      testOrganizationId
    );

    expect(secondResult.success).toBe(true);
    expect(secondResult.alreadyFinalized).toBe(true); // Already finalized
    expect(secondResult.message).toContain('already finalized'); // Message should reflect this

    // ✅ CRITICAL: Second finalize should NOT include cash warning (already finalized)
    expect(secondResult.cashGapWarning).toBeUndefined();

    console.log('[RE-FINALIZE TEST] Second finalize:', {
      alreadyFinalized: secondResult.alreadyFinalized,
      hasCashWarning: !!secondResult.cashGapWarning,
      message: secondResult.message,
    });

    console.log('[RE-FINALIZE TEST] ✅ Cash warning suppressed for already-finalized day');
  });

  /**
   * TEST 8: Legacy transactions with null fuelTypeId still counted in postedTotals
   *
   * SYMPTOM: Transactions are visible for April dates, but postedTotals HSD/PMG show 0.
   * ROOT CAUSE: Legacy transactions have null fuelTypeId, so fuelCode resolves to empty string.
   * FIX: Implement fallback priority in resolveFuelCode():
   *   1. Try txn.fuelType?.code
   *   2. Fallback to entry.nozzle.fuelType.code
   *   3. Parse from productName as last resort
   *
   * GIVEN: A mix of transactions:
   *   - 2 transactions with explicit fuelTypeId (modern)
   *   - 2 transactions with null fuelTypeId but nozzle has fuel type (legacy)
   * WHEN: Fetch via getDailySummary
   * THEN: postedTotals should count ALL 4 transactions via nozzle fallback
   */
  test('legacy transactions with null fuelTypeId counted via nozzle fallback', async () => {
    const legacyDate = testDate;
    const legacyBranchId = testBranchId;

    // First, save modern transactions with explicit fuelTypeId
    await service.saveDailyDraft(
      {
        branchId: legacyBranchId,
        businessDate: legacyDate,
        transactions: [
          {
            id: 'modern-hsd-1',
            nozzleId: hsdNozzleId,
            fuelCode: 'HSD',
            productName: 'High Speed Diesel',
            quantity: 300,
            unitPrice: 350,
            lineTotal: 105000,
            paymentMethod: 'cash' as const,
          },
          {
            id: 'modern-pmg-1',
            nozzleId: hsdNozzleId,
            fuelCode: 'PMG',
            productName: 'Premium Gasoline',
            quantity: 400,
            unitPrice: 460,
            lineTotal: 184000,
            paymentMethod: 'cash' as const,
          },
        ],
      },
      testUserId,
      testOrganizationId
    );

    // Now manually insert legacy transactions with NULL fuelTypeId
    // (simulating old data that predates the fuelTypeId field)
    const entry = await prisma.backdatedEntry.findFirst({
      where: {
        branchId: legacyBranchId,
        businessDate: new Date(`${legacyDate}T00:00:00Z`),
        nozzleId: hsdNozzleId,
      },
    });

    if (entry) {
      // Insert legacy transaction with null fuelTypeId, but nozzle is HSD
      await prisma.backdatedTransaction.create({
        data: {
          id: 'legacy-hsd-null',
          backdatedEntryId: entry.id,
          fuelTypeId: null as any, // ⚠️ Explicitly NULL
          productName: 'Diesel',
          quantity: 200,
          unitPrice: 350,
          lineTotal: 70000,
          paymentMethod: 'cash',
          vehicleNumber: 'LEGACY-HSD-001',
          transactionDateTime: new Date(`${legacyDate}T10:00:00Z`),
          createdBy: testUserId,
        },
      });

      // Insert another legacy transaction with null fuelTypeId, productName says PMG
      await prisma.backdatedTransaction.create({
        data: {
          id: 'legacy-pmg-null',
          backdatedEntryId: entry.id,
          fuelTypeId: null as any, // ⚠️ Explicitly NULL
          productName: 'Petrol',
          quantity: 150,
          unitPrice: 460,
          lineTotal: 69000,
          paymentMethod: 'cash',
          vehicleNumber: 'LEGACY-PMG-001',
          transactionDateTime: new Date(`${legacyDate}T11:00:00Z`),
          createdBy: testUserId,
        },
      });
    }

    // Fetch summary - should count all 4 transactions
    const summary = await service.getDailySummary(
      { branchId: legacyBranchId, businessDate: legacyDate },
      testOrganizationId
    );

    console.log('[TEST 6] Summary for legacy transactions:', {
      transactionCount: summary.transactions.length,
      postedTotals: summary.postedTotals,
      transactions: summary.transactions.map((t: any) => ({
        id: t.id,
        fuelCode: t.fuelCode,
        quantity: t.quantity,
      })),
    });

    // ✅ CRITICAL: All 4 transactions should be counted
    expect(summary.transactions.length).toBe(4); // 2 modern + 2 legacy

    // ✅ CRITICAL: postedTotals should reflect all transactions
    // HSD: 300 (modern) + 200 (legacy via nozzle fallback) = 500
    // PMG: 400 (modern) + 150 (legacy via productName fallback) = 550
    expect(summary.postedTotals.hsdLiters).toBe(500);
    expect(summary.postedTotals.pmgLiters).toBe(550);

    // ✅ Verify each legacy transaction resolved fuel type correctly
    const legacyHsd = summary.transactions.find((t: any) => t.id === 'legacy-hsd-null');
    const legacyPmg = summary.transactions.find((t: any) => t.id === 'legacy-pmg-null');

    expect(legacyHsd).toBeDefined();
    expect(legacyHsd?.fuelCode).toBe('HSD'); // ✅ Resolved via nozzle fallback
    expect(legacyPmg).toBeDefined();
    expect(legacyPmg?.fuelCode).toBe('PMG'); // ✅ Resolved via productName fallback
  });

  /**
   * TEST 9: Finalize response includes reconciliation totals
   *
   * GIVEN: Backdated entries with HSD, PMG, and non-fuel transactions
   * WHEN: Call finalizeDay
   * THEN: Response should include:
   *   - reconciliationTotals (HSD, PMG, non-fuel, total)
   *   - branchName
   *   - finalizedBy (user info)
   *   - finalizedAt (timestamp)
   */
  it('TEST 9: finalize response includes reconciliation totals', async () => {
    const testDateReconciliation = '2026-04-18';
    const testBranchIdReconciliation = testBranchIdLocal;

    // Setup meter readings
    await service.saveDailyMeterReadings({
      branchId: testBranchIdReconciliation,
      businessDate: testDateReconciliation,
      nozzles: [
        { nozzleId: hsdNozzleId, shiftId: morningShiftId, readingType: 'opening', meterValue: 1000 },
        { nozzleId: hsdNozzleId, shiftId: morningShiftId, readingType: 'closing', meterValue: 1500 }, // +500L HSD
        { nozzleId: pmgNozzleId, shiftId: morningShiftId, readingType: 'opening', meterValue: 2000 },
        { nozzleId: pmgNozzleId, shiftId: morningShiftId, readingType: 'closing', meterValue: 2300 }, // +300L PMG
      ],
    }, testOrganizationId);

    // Get a non-fuel product for testing
    const nonFuelProduct = await prisma.product.findFirst({
      where: { organizationId: testOrganizationId, isActive: true },
    });

    if (!nonFuelProduct) {
      console.warn('[TEST 9] No non-fuel product found, skipping non-fuel test');
    }

    // Save transactions: HSD, PMG, and non-fuel
    const transactions = [
      {
        id: 'txn-hsd-test9',
        nozzleId: hsdNozzleId,
        fuelCode: 'HSD',
        productName: 'High Speed Diesel',
        quantity: 500,
        unitPrice: 340,
        lineTotal: 170000, // 500L × 340 = 170,000
        paymentMethod: 'cash' as const,
      },
      {
        id: 'txn-pmg-test9',
        nozzleId: pmgNozzleId,
        fuelCode: 'PMG',
        productName: 'Premium Gasoline',
        quantity: 300,
        unitPrice: 460,
        lineTotal: 138000, // 300L × 460 = 138,000
        paymentMethod: 'cash' as const,
      },
    ];

    if (nonFuelProduct) {
      transactions.push({
        id: 'txn-nonfuel-test9',
        nozzleId: hsdNozzleId,
        fuelCode: '',
        productName: nonFuelProduct.name,
        quantity: 5,
        unitPrice: 100,
        lineTotal: 500, // 5 × 100 = 500
        paymentMethod: 'cash' as const,
      });
    }

    await service.saveDailyDraft({
      branchId: testBranchIdReconciliation,
      businessDate: testDateReconciliation,
      transactions,
    }, testOrganizationId);

    // Finalize with userId
    const result = await service.finalizeDay(
      { branchId: testBranchIdReconciliation, businessDate: testDateReconciliation },
      testOrganizationId,
      testUserId // Pass userId for finalizer info
    );

    console.log('[TEST 9] Finalize result:', {
      reconciliationTotals: result.reconciliationTotals,
      branchName: result.branchName,
      finalizedBy: result.finalizedBy,
      finalizedAt: result.finalizedAt,
    });

    // ✅ Verify reconciliation totals
    expect(result.reconciliationTotals).toBeDefined();
    expect(result.reconciliationTotals.hsd.liters).toBe(500);
    expect(result.reconciliationTotals.hsd.amount).toBe(170000);
    expect(result.reconciliationTotals.pmg.liters).toBe(300);
    expect(result.reconciliationTotals.pmg.amount).toBe(138000);

    if (nonFuelProduct) {
      expect(result.reconciliationTotals.nonFuel.amount).toBe(500);
      expect(result.reconciliationTotals.total.amount).toBe(308500); // 170000 + 138000 + 500
    } else {
      expect(result.reconciliationTotals.total.amount).toBe(308000); // 170000 + 138000
    }

    // ✅ Verify branch name is included
    expect(result.branchName).toBeDefined();
    expect(typeof result.branchName).toBe('string');

    // ✅ Verify finalizer info is included
    expect(result.finalizedBy).toBeDefined();
    expect(result.finalizedBy.username).toBeDefined();
    expect(result.finalizedBy.fullName).toBeDefined();

    // ✅ Verify finalized timestamp is included
    expect(result.finalizedAt).toBeDefined();
    expect(new Date(result.finalizedAt).getTime()).toBeGreaterThan(0);

    console.log('[TEST 9] ✅ Finalize response includes all reconciliation fields');
  });

  /**
   * TEST 10: Non-fuel products with "DIESEL" in name remain OTHER
   *
   * REGRESSION FIX: Products like "RIVO DALA DIESEL FILTER 070" were being
   * misclassified as HSD fuel due to substring matching in productName.
   *
   * GIVEN: Transaction with productId (non-fuel), productName contains "DIESEL"
   * WHEN: Calculate reconciliation totals
   * THEN: Should classify as OTHER (non-fuel), not HSD
   */
  it('TEST 10: non-fuel products with DIESEL in name remain OTHER', async () => {
    const testDateNonFuel = '2026-04-19';

    // Setup meter readings
    await service.saveDailyMeterReadings({
      branchId: testBranchId,
      businessDate: testDateNonFuel,
      nozzles: [
        { nozzleId: hsdNozzleId, shiftId: morningShiftId, readingType: 'opening', meterValue: 1000 },
        { nozzleId: hsdNozzleId, shiftId: morningShiftId, readingType: 'closing', meterValue: 1100 }, // +100L HSD
      ],
    }, testOrganizationId);

    // Create transactions:
    // 1. HSD fuel (100L @ 340 = 34,000)
    // 2. Non-fuel product with "DIESEL" in name (10 units @ 800 = 8,000)
    const nonFuelProduct = await prisma.product.findFirst({
      where: { organizationId: testOrganizationId },
    });

    const entries = await prisma.backdatedEntry.findMany({
      where: {
        branchId: testBranchId,
        businessDate: new Date(`${testDateNonFuel}T00:00:00Z`),
      },
    });

    await service.saveDailyTransactions({
      branchId: testBranchId,
      businessDate: testDateNonFuel,
      transactions: [
        // HSD fuel transaction
        {
          id: '00000000-0000-0000-0000-000000000010',
          nozzleId: hsdNozzleId,
          fuelCode: 'HSD',
          productName: 'HSD',
          quantity: 100,
          unitPrice: 340,
          lineTotal: 34000,
          paymentMethod: 'cash',
          transactionDateTime: new Date().toISOString(),
        },
        // Non-fuel product with "DIESEL" in name
        {
          id: '00000000-0000-0000-0000-000000000011',
          productId: nonFuelProduct?.id || undefined,
          productName: 'RIVO DALA DIESEL FILTER 070', // Contains "DIESEL" but is non-fuel
          quantity: 10,
          unitPrice: 800,
          lineTotal: 8000,
          paymentMethod: 'cash',
          transactionDateTime: new Date().toISOString(),
        },
      ],
    }, testOrganizationId);

    // Get summary
    const summary = await service.getDailySummary({
      branchId: testBranchId,
      businessDate: testDateNonFuel,
    }, testOrganizationId);

    // ✅ Verify classification:
    // - HSD fuel: 100L posted
    // - Non-fuel (DIESEL FILTER): NOT counted in HSD, should be in nonFuelBreakdown
    expect(summary.postedTotals.hsdLiters).toBe(100);
    expect(summary.postedTotals.pmgLiters).toBe(0);

    // ✅ Verify non-fuel breakdown includes the diesel filter
    const dieselFilterTxn = summary.transactions.find(t => t.productName?.includes('DIESEL FILTER'));
    expect(dieselFilterTxn).toBeDefined();
    expect(dieselFilterTxn?.fuelCode).toBe('OTHER'); // ✅ Must be OTHER, not HSD

    console.log('[TEST 10] ✅ Non-fuel products with DIESEL in name remain OTHER');
  });

  /**
   * TEST 11: Cash variance excludes non-fuel transactions
   *
   * REGRESSION FIX: Non-fuel cash transactions were inflating postedCash,
   * causing incorrect cash variance calculations.
   *
   * GIVEN: Fuel cash (HSD 80L @ 300 = 24,000) + Non-fuel cash (filter 10 @ 800 = 8,000)
   * WHEN: Calculate cash variance
   * THEN: Only fuel cash (24,000) should be counted, non-fuel excluded
   */
  it('TEST 11: cash variance calculation excludes non-fuel', async () => {
    const testDateCashVariance = '2026-04-20';

    // Setup meter readings: HSD 100L @ 300 = 30,000
    await service.saveDailyMeterReadings({
      branchId: testBranchId,
      businessDate: testDateCashVariance,
      nozzles: [
        { nozzleId: hsdNozzleId, shiftId: morningShiftId, readingType: 'opening', meterValue: 1000 },
        { nozzleId: hsdNozzleId, shiftId: morningShiftId, readingType: 'closing', meterValue: 1100 }, // +100L HSD
      ],
    }, testOrganizationId);

    const nonFuelProduct = await prisma.product.findFirst({
      where: { organizationId: testOrganizationId },
    });

    // Post transactions:
    // - HSD cash: 80L @ 300 = 24,000
    // - HSD credit: 20L @ 300 = 6,000
    // - Non-fuel cash: 10 @ 800 = 8,000 (should NOT affect cash variance)
    await service.saveDailyTransactions({
      branchId: testBranchId,
      businessDate: testDateCashVariance,
      transactions: [
        // HSD fuel cash
        {
          id: '00000000-0000-0000-0000-000000000020',
          nozzleId: hsdNozzleId,
          fuelCode: 'HSD',
          productName: 'HSD',
          quantity: 80,
          unitPrice: 300,
          lineTotal: 24000,
          paymentMethod: 'cash',
          transactionDateTime: new Date().toISOString(),
        },
        // HSD fuel credit
        {
          id: '00000000-0000-0000-0000-000000000021',
          nozzleId: hsdNozzleId,
          fuelCode: 'HSD',
          productName: 'HSD',
          quantity: 20,
          unitPrice: 300,
          lineTotal: 6000,
          paymentMethod: 'credit_customer',
          transactionDateTime: new Date().toISOString(),
        },
        // Non-fuel cash (should NOT affect fuel cash variance)
        {
          id: '00000000-0000-0000-0000-000000000022',
          productId: nonFuelProduct?.id || undefined,
          productName: 'DIESEL FILTER',
          quantity: 10,
          unitPrice: 800,
          lineTotal: 8000,
          paymentMethod: 'cash',
          transactionDateTime: new Date().toISOString(),
        },
      ],
    }, testOrganizationId);

    // Get summary
    const summary = await service.getDailySummary({
      branchId: testBranchId,
      businessDate: testDateCashVariance,
    }, testOrganizationId);

    // ✅ Verify cash variance calculation:
    // Meter sales = 100L * 300 = 30,000
    // Non-cash total = 6,000 (credit only, excludes non-fuel)
    // Expected cash = 30,000 - 6,000 = 24,000
    // Posted cash = 24,000 (fuel only, excludes non-fuel 8,000)
    // Cash gap = 24,000 - 24,000 = 0
    expect(summary.backTracedCash.meterSalesPkr).toBe(30000);
    expect(summary.backTracedCash.nonCashTotal).toBe(6000);
    expect(summary.backTracedCash.expectedCash).toBe(24000);
    expect(summary.backTracedCash.postedCash).toBe(24000); // ✅ Must be 24,000, not 32,000 (excludes non-fuel cash)
    expect(summary.backTracedCash.cashGap).toBe(0);

    console.log('[TEST 11] ✅ Cash variance excludes non-fuel transactions');
  });

  /**
   * TEST 12: Finalize response includes business date
   *
   * GIVEN: Finalize a day
   * WHEN: Check finalize response
   * THEN: Response includes businessDate field for UI context
   */
  it('TEST 12: finalize response includes business date', async () => {
    const testDateBusinessDate = '2026-04-21';

    // Setup minimal data
    await service.saveDailyMeterReadings({
      branchId: testBranchId,
      businessDate: testDateBusinessDate,
      nozzles: [
        { nozzleId: hsdNozzleId, shiftId: morningShiftId, readingType: 'opening', meterValue: 1000 },
        { nozzleId: hsdNozzleId, shiftId: morningShiftId, readingType: 'closing', meterValue: 1100 },
      ],
    }, testOrganizationId);

    await service.saveDailyTransactions({
      branchId: testBranchId,
      businessDate: testDateBusinessDate,
      transactions: [
        {
          id: '00000000-0000-0000-0000-000000000030',
          nozzleId: hsdNozzleId,
          fuelCode: 'HSD',
          quantity: 100,
          unitPrice: 300,
          lineTotal: 30000,
          paymentMethod: 'cash',
          transactionDateTime: new Date().toISOString(),
        },
      ],
    }, testOrganizationId);

    // Finalize
    const result = await service.finalizeDay({
      branchId: testBranchId,
      businessDate: testDateBusinessDate,
    }, testOrganizationId, testUserId);

    // ✅ Verify business date is included
    expect(result.businessDate).toBe(testDateBusinessDate);

    console.log('[TEST 12] ✅ Finalize response includes business date');
  });

  /**
   * TEST 13: Jan 10 Production Scenario - Mixed Fuel/Non-Fuel Classification
   *
   * Reproduces 2026-01-10 production bug where finalize showed:
   * - HSD = 0 L, PMG = 0 L, Non-fuel = full total
   *
   * GIVEN: Mixed transactions (HSD cash/credit, PMG cash/credit, MOTOR OIL non-fuel)
   * WHEN: Finalize day
   * THEN: Reconciliation totals must correctly segregate HSD/PMG/non-fuel
   */
  it('TEST 13: Jan 10 mixed fuel/non-fuel finalize totals', async () => {
    const testDateJan10 = '2026-04-22';

    // Setup meter readings to match posted fuel
    const pmgNozzle = await prisma.nozzle.findFirst({
      where: {
        dispensingUnit: { branchId: testBranchId },
        fuelType: { code: 'PMG' },
        isActive: true,
      },
    });

    if (!pmgNozzle) {
      throw new Error('PMG nozzle not found for test');
    }

    const pmgNozzleId = pmgNozzle.id;

    await service.saveDailyMeterReadings({
      branchId: testBranchId,
      businessDate: testDateJan10,
      nozzles: [
        // HSD meter
        { nozzleId: hsdNozzleId, shiftId: morningShiftId, readingType: 'opening', meterValue: 1000 },
        { nozzleId: hsdNozzleId, shiftId: morningShiftId, readingType: 'closing', meterValue: 1127.48 }, // +127.48L
        // PMG meter
        { nozzleId: pmgNozzleId, shiftId: morningShiftId, readingType: 'opening', meterValue: 2000 },
        { nozzleId: pmgNozzleId, shiftId: morningShiftId, readingType: 'closing', meterValue: 2262.322 }, // +262.322L
      ],
    }, testOrganizationId);

    const nonFuelProduct = await prisma.product.findFirst({
      where: { organizationId: testOrganizationId },
    });

    // Create Jan 10 transactions:
    // 1) HSD cash: 27 L @ 300 = 8,100
    // 2) PMG cash: 1.322 L @ 280 = 370.16
    // 3) OTHER cash: PREMIER MOTOR OIL 4 LTR, 10 @ 960 = 9,600
    // 4) HSD credit: 100.48 L @ 300 = 30,144
    // 5) PMG credit: 261 L @ 280 = 73,080
    await service.saveDailyTransactions({
      branchId: testBranchId,
      businessDate: testDateJan10,
      transactions: [
        // HSD cash
        {
          id: '00000000-0000-0000-0000-000000000040',
          nozzleId: hsdNozzleId,
          fuelCode: 'HSD',
          productName: 'HSD',
          quantity: 27,
          unitPrice: 300,
          lineTotal: 8100,
          paymentMethod: 'cash',
          transactionDateTime: new Date().toISOString(),
        },
        // PMG cash
        {
          id: '00000000-0000-0000-0000-000000000041',
          nozzleId: pmgNozzleId,
          fuelCode: 'PMG',
          productName: 'PMG',
          quantity: 1.322,
          unitPrice: 280,
          lineTotal: 370.16,
          paymentMethod: 'cash',
          transactionDateTime: new Date().toISOString(),
        },
        // Non-fuel cash (MOTOR OIL)
        {
          id: '00000000-0000-0000-0000-000000000042',
          productId: nonFuelProduct?.id || undefined,
          productName: 'PREMIER MOTOR OIL 4 LTR',
          quantity: 10,
          unitPrice: 960,
          lineTotal: 9600,
          paymentMethod: 'cash',
          transactionDateTime: new Date().toISOString(),
        },
        // HSD credit
        {
          id: '00000000-0000-0000-0000-000000000043',
          nozzleId: hsdNozzleId,
          fuelCode: 'HSD',
          productName: 'HSD',
          quantity: 100.48,
          unitPrice: 300,
          lineTotal: 30144,
          paymentMethod: 'credit_customer',
          transactionDateTime: new Date().toISOString(),
        },
        // PMG credit
        {
          id: '00000000-0000-0000-0000-000000000044',
          nozzleId: pmgNozzleId,
          fuelCode: 'PMG',
          productName: 'PMG',
          quantity: 261,
          unitPrice: 280,
          lineTotal: 73080,
          paymentMethod: 'credit_customer',
          transactionDateTime: new Date().toISOString(),
        },
      ],
    }, testOrganizationId);

    // Finalize
    const result = await service.finalizeDay({
      branchId: testBranchId,
      businessDate: testDateJan10,
    }, testOrganizationId, testUserId);

    // ✅ Verify reconciliation totals match Jan 10 expected values
    expect(result.reconciliationTotals).toBeDefined();

    // HSD: 27 + 100.48 = 127.48 L @ 300 = 38,244
    expect(result.reconciliationTotals.hsd.liters).toBeCloseTo(127.48, 2);
    expect(result.reconciliationTotals.hsd.amount).toBeCloseTo(38244, 1);

    // PMG: 1.322 + 261 = 262.322 L @ 280 = 73,450.16
    expect(result.reconciliationTotals.pmg.liters).toBeCloseTo(262.322, 2);
    expect(result.reconciliationTotals.pmg.amount).toBeCloseTo(73450.16, 1);

    // Non-fuel: MOTOR OIL 10 @ 960 = 9,600
    expect(result.reconciliationTotals.nonFuel.amount).toBeCloseTo(9600, 1);

    // Total: 38,244 + 73,450.16 + 9,600 = 121,294.16
    expect(result.reconciliationTotals.total.amount).toBeCloseTo(121294.16, 1);

    // ✅ Verify finalizer info is populated (not Unknown)
    expect(result.finalizedBy).toBeDefined();
    expect(result.finalizedBy.username).toBeDefined();
    expect(result.finalizedBy.fullName).toBeDefined();

    console.log('[TEST 13] ✅ Jan 10 mixed fuel/non-fuel finalize totals correct');
  });
});
