/**
 * Test: Backdated Entries Modal - Previous Reading Display
 *
 * Ensures modal correctly fetches previous reading values based on shift/reading type:
 * - Morning Opening ← previous Night Closing (prior day)
 * - Morning Closing ← Morning Opening (same day)
 * - Night Opening ← Morning Closing (same day)
 * - Night Closing ← Night Opening (same day)
 */

import { prisma } from '../../config/database';
import { MeterReadingsDailyService } from './meter-readings-daily.service';

describe('MeterReadingsDailyService - Modal Previous Reading', () => {
  const service = new MeterReadingsDailyService();

  const testOrganizationId = '11111111-1111-1111-1111-111111111111';
  const testBranchId = '75db4c0b-8050-4e9f-96ae-2a6fc10ff1f6';
  const testDate1 = '2026-04-10';
  const testDate2 = '2026-04-11'; // Next day
  const testUserId = '5f2a213f-e20a-428b-8546-e4e2c251e946';

  let morningShiftId: string;
  let eveningShiftId: string;
  let nozzleId: string;

  beforeAll(async () => {
    // Get morning and evening shifts
    const morning = await prisma.shift.findFirst({
      where: { branchId: testBranchId, shiftNumber: 1, isActive: true },
    });
    const evening = await prisma.shift.findFirst({
      where: { branchId: testBranchId, shiftNumber: 2, isActive: true },
    });

    if (!morning || !evening) {
      throw new Error('Test shifts not found. Ensure shift templates exist.');
    }

    morningShiftId = morning.id;
    eveningShiftId = evening.id;

    // Get a nozzle for testing
    const nozzles = await prisma.nozzle.findMany({
      where: {
        dispensingUnit: { branchId: testBranchId },
        isActive: true,
      },
      take: 1,
    });

    if (nozzles.length === 0) {
      throw new Error('No nozzles found for testing');
    }

    nozzleId = nozzles[0].id;
  });

  afterEach(async () => {
    // Clean up test data
    const date1Obj = new Date(`${testDate1}T00:00:00Z`);
    const date2Obj = new Date(`${testDate2}T00:00:00Z`);

    await prisma.backdatedMeterReading.deleteMany({
      where: {
        branchId: testBranchId,
        businessDate: { in: [date1Obj, date2Obj] },
        nozzleId,
      },
    });
  });

  /**
   * TEST 1: Morning Opening ← Previous Night Closing
   * GIVEN: Day 1 Night Closing = 1000L
   * WHEN: Request Day 2 Morning Opening previous reading
   * THEN: Should return 1000L (Day 1 Night Closing)
   */
  test('morning opening fetches previous day night closing', async () => {
    const date1Obj = new Date(`${testDate1}T00:00:00Z`);
    const date2Obj = new Date(`${testDate2}T00:00:00Z`);

    // Create Day 1 Night Closing = 1000L
    await prisma.backdatedMeterReading.create({
      data: {
        branchId: testBranchId,
        businessDate: date1Obj,
        shiftId: eveningShiftId,
        nozzleId,
        readingType: 'closing',
        meterValue: 1000,
        submittedBy: testUserId,
        submittedAt: new Date(),
      },
    });

    // Request Day 2 Morning Opening previous reading
    const result = await service.getModalPreviousReading(
      testBranchId,
      testDate2,
      morningShiftId,
      nozzleId,
      'opening'
    );

    expect(result).not.toBeNull();
    expect(result?.value).toBe(1000);
    expect(result?.status).toBe('entered');
  });

  /**
   * TEST 2: Morning Closing ← Morning Opening
   * GIVEN: Morning Opening = 1000L on same day
   * WHEN: Request Morning Closing previous reading
   * THEN: Should return 1000L (Morning Opening)
   */
  test('morning closing fetches same-day morning opening', async () => {
    const date1Obj = new Date(`${testDate1}T00:00:00Z`);

    // Create Morning Opening = 1000L
    await prisma.backdatedMeterReading.create({
      data: {
        branchId: testBranchId,
        businessDate: date1Obj,
        shiftId: morningShiftId,
        nozzleId,
        readingType: 'opening',
        meterValue: 1000,
        submittedBy: testUserId,
        submittedAt: new Date(),
      },
    });

    // Request Morning Closing previous reading
    const result = await service.getModalPreviousReading(
      testBranchId,
      testDate1,
      morningShiftId,
      nozzleId,
      'closing'
    );

    expect(result).not.toBeNull();
    expect(result?.value).toBe(1000);
    expect(result?.status).toBe('entered');
  });

  /**
   * TEST 3: Evening Opening ← Morning Closing (same day)
   * GIVEN: Morning Closing = 1050L on same day
   * WHEN: Request Evening Opening previous reading
   * THEN: Should return 1050L (Morning Closing)
   */
  test('evening opening fetches same-day morning closing', async () => {
    const date1Obj = new Date(`${testDate1}T00:00:00Z`);

    // Create Morning Closing = 1050L
    await prisma.backdatedMeterReading.create({
      data: {
        branchId: testBranchId,
        businessDate: date1Obj,
        shiftId: morningShiftId,
        nozzleId,
        readingType: 'closing',
        meterValue: 1050,
        submittedBy: testUserId,
        submittedAt: new Date(),
      },
    });

    // Request Evening Opening previous reading
    const result = await service.getModalPreviousReading(
      testBranchId,
      testDate1,
      eveningShiftId,
      nozzleId,
      'opening'
    );

    expect(result).not.toBeNull();
    expect(result?.value).toBe(1050);
    expect(result?.status).toBe('entered');
  });

  /**
   * TEST 4: Evening Closing ← Evening Opening (same day)
   * GIVEN: Evening Opening = 1050L on same day
   * WHEN: Request Evening Closing previous reading
   * THEN: Should return 1050L (Evening Opening)
   */
  test('evening closing fetches same-day evening opening', async () => {
    const date1Obj = new Date(`${testDate1}T00:00:00Z`);

    // Create Evening Opening = 1050L
    await prisma.backdatedMeterReading.create({
      data: {
        branchId: testBranchId,
        businessDate: date1Obj,
        shiftId: eveningShiftId,
        nozzleId,
        readingType: 'opening',
        meterValue: 1050,
        submittedBy: testUserId,
        submittedAt: new Date(),
      },
    });

    // Request Evening Closing previous reading
    const result = await service.getModalPreviousReading(
      testBranchId,
      testDate1,
      eveningShiftId,
      nozzleId,
      'closing'
    );

    expect(result).not.toBeNull();
    expect(result?.value).toBe(1050);
    expect(result?.status).toBe('entered');
  });

  /**
   * TEST 5: Missing Previous Reading
   * GIVEN: No previous reading exists
   * WHEN: Request previous reading for opening
   * THEN: Should return null status, not hardcoded 0
   */
  test('returns not_found when previous reading missing', async () => {
    // Request without creating any prior readings
    const result = await service.getModalPreviousReading(
      testBranchId,
      testDate1,
      morningShiftId,
      nozzleId,
      'opening'
    );

    expect(result).not.toBeNull();
    expect(result?.value).toBeNull();
    expect(result?.status).toBe('not_found');
  });

  /**
   * TEST 6: Edge Case - Morning Opening on Day 1
   * GIVEN: No previous day data exists
   * WHEN: Request Day 1 Morning Opening previous reading
   * THEN: Should safely return null, not hardcoded 0
   */
  test('handles morning opening with no prior day data', async () => {
    // Request without creating Day 0 data
    const result = await service.getModalPreviousReading(
      testBranchId,
      testDate1,
      morningShiftId,
      nozzleId,
      'opening'
    );

    expect(result).not.toBeNull();
    expect(result?.value).toBeNull();
    expect(result?.status).toBe('not_found');
  });
});
