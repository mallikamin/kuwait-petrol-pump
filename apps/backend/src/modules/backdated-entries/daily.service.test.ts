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
});
