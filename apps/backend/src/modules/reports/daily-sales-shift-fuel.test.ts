/**
 * Test: Daily Sales Report - Shift-wise Fuel Type Breakdown
 *
 * Verifies that fuel type breakdown is correctly calculated per shift,
 * fixing the issue where all sales were attributed to a single shift
 * and fuel type breakdown wasn't visible by shift.
 */

import { prisma } from '../../config/database';
import { ReportsService } from './reports.service';

describe('ReportsService - Daily Sales Shift Fuel Breakdown', () => {
  const service = new ReportsService();

  const testOrganizationId = '11111111-1111-1111-1111-111111111111';
  const testBranchId = '75db4c0b-8050-4e9f-96ae-2a6fc10ff1f6';
  const testDate = '2026-01-01'; // Jan 1 test date from requirements

  let hsdFuelTypeId: string;
  let pmgFuelTypeId: string;
  let morningShiftInstanceId: string;
  let eveningShiftInstanceId: string;

  beforeAll(async () => {
    // Get fuel types
    const hsd = await prisma.fuelType.findUnique({ where: { code: 'HSD' } });
    const pmg = await prisma.fuelType.findUnique({ where: { code: 'PMG' } });

    if (!hsd || !pmg) {
      throw new Error('Fuel types not found');
    }

    hsdFuelTypeId = hsd.id;
    pmgFuelTypeId = pmg.id;

    // Get or create shift instances for test date
    const shifts = await prisma.shift.findMany({
      where: { branchId: testBranchId, isActive: true },
      orderBy: { shiftNumber: 'asc' },
    });

    if (shifts.length < 2) {
      throw new Error('Need at least 2 shift templates for testing');
    }

    const testDateObj = new Date(`${testDate}T00:00:00Z`);

    // Get or create morning and evening shift instances
    const morningShift = await prisma.shiftInstance.findFirst({
      where: {
        shiftId: shifts[0].id,
        date: testDateObj,
      },
    });

    const eveningShift = await prisma.shiftInstance.findFirst({
      where: {
        shiftId: shifts[1].id,
        date: testDateObj,
      },
    });

    if (!morningShift || !eveningShift) {
      throw new Error('Shift instances not found - ensure shift data exists');
    }

    morningShiftInstanceId = morningShift.id;
    eveningShiftInstanceId = eveningShift.id;
  });

  afterEach(async () => {
    // Clean up test sales
    const testDateObj = new Date(`${testDate}T00:00:00Z`);
    const endOfDay = new Date(testDateObj);
    endOfDay.setHours(23, 59, 59, 999);

    await prisma.fuelSale.deleteMany({
      where: {
        sale: {
          branchId: testBranchId,
          saleDate: { gte: testDateObj, lte: endOfDay },
        },
      },
    });

    await prisma.sale.deleteMany({
      where: {
        branchId: testBranchId,
        saleDate: { gte: testDateObj, lte: endOfDay },
      },
    });
  });

  /**
   * TEST 1: Multiple shifts in one day - fuel split correctly
   *
   * GIVEN:
   * - Morning shift: 500L HSD + 300L PMG
   * - Evening shift: 400L HSD + 600L PMG
   *
   * WHEN: Request daily sales report
   *
   * THEN: shiftFuelBreakdown should show:
   * - Morning | HSD: 500L
   * - Morning | PMG: 300L
   * - Evening | HSD: 400L
   * - Evening | PMG: 600L
   */
  test('correctly breaks down fuel by shift', async () => {
    const testDateObj = new Date(`${testDate}T00:00:00Z`);

    // Morning shift: HSD 500L
    await prisma.sale.create({
      data: {
        branchId: testBranchId,
        saleType: 'fuel',
        paymentMethod: 'cash',
        saleDate: testDateObj,
        totalAmount: 175000, // 500L × 350/L
        shiftInstanceId: morningShiftInstanceId,
        fuelSales: {
          create: {
            fuelTypeId: hsdFuelTypeId,
            quantityLiters: 500,
            totalAmount: 175000,
          },
        },
      },
      include: { fuelSales: true },
    });

    // Morning shift: PMG 300L
    await prisma.sale.create({
      data: {
        branchId: testBranchId,
        saleType: 'fuel',
        paymentMethod: 'card',
        saleDate: testDateObj,
        totalAmount: 138000, // 300L × 460/L
        shiftInstanceId: morningShiftInstanceId,
        fuelSales: {
          create: {
            fuelTypeId: pmgFuelTypeId,
            quantityLiters: 300,
            totalAmount: 138000,
          },
        },
      },
      include: { fuelSales: true },
    });

    // Evening shift: HSD 400L
    await prisma.sale.create({
      data: {
        branchId: testBranchId,
        saleType: 'fuel',
        paymentMethod: 'cash',
        saleDate: testDateObj,
        totalAmount: 140000, // 400L × 350/L
        shiftInstanceId: eveningShiftInstanceId,
        fuelSales: {
          create: {
            fuelTypeId: hsdFuelTypeId,
            quantityLiters: 400,
            totalAmount: 140000,
          },
        },
      },
      include: { fuelSales: true },
    });

    // Evening shift: PMG 600L
    await prisma.sale.create({
      data: {
        branchId: testBranchId,
        saleType: 'fuel',
        paymentMethod: 'card',
        saleDate: testDateObj,
        totalAmount: 276000, // 600L × 460/L
        shiftInstanceId: eveningShiftInstanceId,
        fuelSales: {
          create: {
            fuelTypeId: pmgFuelTypeId,
            quantityLiters: 600,
            totalAmount: 276000,
          },
        },
      },
      include: { fuelSales: true },
    });

    // Request report
    const report = await service.getDailySalesReport(
      testBranchId,
      testDateObj,
      new Date(testDateObj.getTime() + 86399999),
      testOrganizationId
    );

    // Verify shift fuel breakdown
    expect(report.shiftFuelBreakdown).toBeDefined();
    expect(report.shiftFuelBreakdown.length).toBe(4);

    // Find and verify each entry
    const hsdMorning = report.shiftFuelBreakdown.find(
      (sf: any) => sf.shiftName.includes('Morning') && sf.fuelType === 'High Speed Diesel'
    );
    const pmgMorning = report.shiftFuelBreakdown.find(
      (sf: any) => sf.shiftName.includes('Morning') && sf.fuelType === 'Premium Gasoline'
    );
    const hsdEvening = report.shiftFuelBreakdown.find(
      (sf: any) => sf.shiftName.includes('Evening') && sf.fuelType === 'High Speed Diesel'
    );
    const pmgEvening = report.shiftFuelBreakdown.find(
      (sf: any) => sf.shiftName.includes('Evening') && sf.fuelType === 'Premium Gasoline'
    );

    expect(hsdMorning?.liters).toBe(500);
    expect(pmgMorning?.liters).toBe(300);
    expect(hsdEvening?.liters).toBe(400);
    expect(pmgEvening?.liters).toBe(600);

    expect(hsdMorning?.count).toBe(1);
    expect(pmgMorning?.count).toBe(1);
    expect(hsdEvening?.count).toBe(1);
    expect(pmgEvening?.count).toBe(1);

    // Verify totals
    expect(report.summary.fuel.byType['High Speed Diesel']?.liters).toBe(900); // 500 + 400
    expect(report.summary.fuel.byType['Premium Gasoline']?.liters).toBe(900); // 300 + 600
  });

  /**
   * TEST 2: Single shift day - fuel breakdown shows correct shift name
   *
   * GIVEN: Only morning shift with HSD 1000L
   * WHEN: Request daily sales report
   * THEN: shiftFuelBreakdown should show Morning | HSD: 1000L
   */
  test('handles single shift day correctly', async () => {
    const testDateObj = new Date(`${testDate}T00:00:00Z`);

    // Only morning shift: HSD 1000L
    await prisma.sale.create({
      data: {
        branchId: testBranchId,
        saleType: 'fuel',
        paymentMethod: 'cash',
        saleDate: testDateObj,
        totalAmount: 350000, // 1000L × 350/L
        shiftInstanceId: morningShiftInstanceId,
        fuelSales: {
          create: {
            fuelTypeId: hsdFuelTypeId,
            quantityLiters: 1000,
            totalAmount: 350000,
          },
        },
      },
      include: { fuelSales: true },
    });

    const report = await service.getDailySalesReport(
      testBranchId,
      testDateObj,
      new Date(testDateObj.getTime() + 86399999),
      testOrganizationId
    );

    expect(report.shiftFuelBreakdown.length).toBe(1);
    expect(report.shiftFuelBreakdown[0].shiftName).toContain('Morning');
    expect(report.shiftFuelBreakdown[0].fuelType).toBe('High Speed Diesel');
    expect(report.shiftFuelBreakdown[0].liters).toBe(1000);
  });

  /**
   * TEST 3: Date range filtering
   *
   * GIVEN:
   * - Jan 1: Morning 500L HSD, Evening 400L PMG
   * - Jan 2: Morning 300L HSD
   *
   * WHEN: Request report for Jan 1 only
   * THEN: Should only show Jan 1 sales
   */
  test('date range filtering works correctly', async () => {
    const jan1 = new Date('2026-01-01T00:00:00Z');
    const jan2 = new Date('2026-01-02T00:00:00Z');

    // Jan 1: HSD
    await prisma.sale.create({
      data: {
        branchId: testBranchId,
        saleType: 'fuel',
        paymentMethod: 'cash',
        saleDate: jan1,
        totalAmount: 175000,
        shiftInstanceId: morningShiftInstanceId,
        fuelSales: {
          create: {
            fuelTypeId: hsdFuelTypeId,
            quantityLiters: 500,
            totalAmount: 175000,
          },
        },
      },
      include: { fuelSales: true },
    });

    // Jan 2: HSD (should not be included when filtering for Jan 1 only)
    // Note: Need to create shift instances for Jan 2 first
    const jan2Morning = await prisma.shiftInstance.findFirst({
      where: {
        shiftId: (await prisma.shift.findFirst({ where: { branchId: testBranchId, shiftNumber: 1 } }))?.id,
        date: jan2,
      },
    });

    if (jan2Morning) {
      await prisma.sale.create({
        data: {
          branchId: testBranchId,
          saleType: 'fuel',
          paymentMethod: 'cash',
          saleDate: jan2,
          totalAmount: 105000,
          shiftInstanceId: jan2Morning.id,
          fuelSales: {
            create: {
              fuelTypeId: hsdFuelTypeId,
              quantityLiters: 300,
              totalAmount: 105000,
            },
          },
        },
        include: { fuelSales: true },
      });
    }

    // Request Jan 1 only
    const report = await service.getDailySalesReport(
      testBranchId,
      jan1,
      new Date(jan1.getTime() + 86399999),
      testOrganizationId
    );

    // Should only see Jan 1 sales
    expect(report.summary.fuel.byType['High Speed Diesel']?.liters).toBe(500);
  });
});
