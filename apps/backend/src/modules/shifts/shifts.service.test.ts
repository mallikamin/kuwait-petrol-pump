import { ShiftsService } from './shifts.service';
import { prisma } from '../../config/database';
import { getBusinessDate } from '../../utils/timezone';

// Mock the database and timezone utility
jest.mock('../../config/database', () => ({
  prisma: {
    branch: {
      findFirst: jest.fn(),
    },
    shift: {
      findFirst: jest.fn(),
    },
    shiftInstance: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    organization: {
      findUnique: jest.fn(),
    },
    meterReading: {
      createMany: jest.fn(),
    },
  },
}));

jest.mock('../../utils/timezone');

describe('ShiftsService - Date Rollover Bug Fix', () => {
  let shiftsService: ShiftsService;
  const mockOrganizationId = '123e4567-e89b-12d3-a456-426614174000';
  const mockBranchId = '223e4567-e89b-12d3-a456-426614174000';
  const mockShiftId = '323e4567-e89b-12d3-a456-426614174000';
  const mockUserId = '423e4567-e89b-12d3-a456-426614174000';

  beforeEach(() => {
    shiftsService = new ShiftsService();
    jest.clearAllMocks();
  });

  describe('openShift - Timezone-aware date rollover', () => {
    it('should use business timezone date (Asia/Karachi) not server timezone for shift date', async () => {
      // Scenario: Server in UTC on Apr 3 11pm, business in Asia/Karachi on Apr 4 4am
      // Expected: Shift should be dated Apr 4, not Apr 3

      const apr4BusinessDate = new Date('2026-04-04T00:00:00.000Z'); // Apr 4 midnight UTC (represents business date)

      // Mock timezone utility to return Apr 4
      (getBusinessDate as jest.Mock).mockResolvedValue(apr4BusinessDate);

      // Mock branch exists
      (prisma.branch.findFirst as jest.Mock).mockResolvedValue({
        id: mockBranchId,
        organizationId: mockOrganizationId,
        name: 'Main Branch',
      });

      // Mock shift exists
      (prisma.shift.findFirst as jest.Mock).mockResolvedValue({
        id: mockShiftId,
        branchId: mockBranchId,
        shiftNumber: 1,
        name: 'Morning Shift',
        startTime: new Date('1970-01-01T06:00:00Z'),
        endTime: new Date('1970-01-01T14:00:00Z'),
        isActive: true,
      });

      // No existing open shift
      (prisma.shiftInstance.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.shiftInstance.findUnique as jest.Mock).mockResolvedValue(null);

      // Mock shift instance creation
      (prisma.shiftInstance.upsert as jest.Mock).mockResolvedValue({
        id: 'shift-instance-id',
        shiftId: mockShiftId,
        branchId: mockBranchId,
        date: apr4BusinessDate,
        openedAt: new Date(),
        openedBy: mockUserId,
        status: 'open',
      });

      // Mock meter reading creation
      (prisma.meterReading.createMany as jest.Mock).mockResolvedValue({ count: 0 });

      // Execute
      await shiftsService.openShift(mockBranchId, mockShiftId, mockUserId, mockOrganizationId);

      // Verify getBusinessDate was called with organizationId
      expect(getBusinessDate).toHaveBeenCalledWith(mockOrganizationId);

      // Verify shift instance was created with business date (Apr 4), not system date (Apr 3)
      expect(prisma.shiftInstance.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            shiftId_date: {
              shiftId: mockShiftId,
              date: apr4BusinessDate, // Must be Apr 4!
            },
          },
          create: expect.objectContaining({
            date: apr4BusinessDate, // Must be Apr 4!
          }),
        })
      );
    });

    it('should prevent opening duplicate shift on same business date', async () => {
      const apr4BusinessDate = new Date('2026-04-04T00:00:00.000Z');

      (getBusinessDate as jest.Mock).mockResolvedValue(apr4BusinessDate);

      // Mock branch exists
      (prisma.branch.findFirst as jest.Mock).mockResolvedValue({
        id: mockBranchId,
        organizationId: mockOrganizationId,
      });

      // Mock shift exists
      (prisma.shift.findFirst as jest.Mock).mockResolvedValue({
        id: mockShiftId,
        branchId: mockBranchId,
        shiftNumber: 1,
      });

      // Mock existing open shift for Apr 4 (business date)
      (prisma.shiftInstance.findFirst as jest.Mock).mockResolvedValue({
        id: 'existing-shift-id',
        branchId: mockBranchId,
        date: apr4BusinessDate,
        status: 'open',
      });

      // Execute and expect error
      await expect(
        shiftsService.openShift(mockBranchId, mockShiftId, mockUserId, mockOrganizationId)
      ).rejects.toThrow('There is already an open shift for today');

      // Verify it checked using business date
      expect(prisma.shiftInstance.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            date: apr4BusinessDate,
          }),
        })
      );
    });

    it('should allow opening morning shift after closing all shifts previous day', async () => {
      // Scenario: All shifts closed on Apr 3, now opening Apr 4 morning shift
      const apr3BusinessDate = new Date('2026-04-03T00:00:00.000Z');
      const apr4BusinessDate = new Date('2026-04-04T00:00:00.000Z');

      // Mock timezone returns Apr 4 (next day)
      (getBusinessDate as jest.Mock).mockResolvedValue(apr4BusinessDate);

      // Mock branch and shift exist
      (prisma.branch.findFirst as jest.Mock).mockResolvedValue({
        id: mockBranchId,
        organizationId: mockOrganizationId,
      });

      (prisma.shift.findFirst as jest.Mock).mockResolvedValue({
        id: mockShiftId,
        branchId: mockBranchId,
        shiftNumber: 1,
      });

      // No open shift for Apr 4
      (prisma.shiftInstance.findFirst as jest.Mock).mockResolvedValueOnce(null);
      (prisma.shiftInstance.findUnique as jest.Mock).mockResolvedValue(null);

      // Mock previous shift closed on Apr 3
      (prisma.shiftInstance.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'previous-shift-id',
        branchId: mockBranchId,
        date: apr3BusinessDate,
        status: 'closed',
        meterReadings: [],
      });

      // Mock upsert success
      (prisma.shiftInstance.upsert as jest.Mock).mockResolvedValue({
        id: 'new-shift-id',
        shiftId: mockShiftId,
        branchId: mockBranchId,
        date: apr4BusinessDate, // Apr 4, not Apr 3!
        status: 'open',
      });

      // Mock meter reading creation
      (prisma.meterReading.createMany as jest.Mock).mockResolvedValue({ count: 0 });

      // Execute
      const result = await shiftsService.openShift(
        mockBranchId,
        mockShiftId,
        mockUserId,
        mockOrganizationId
      );

      // Verify shift opened with Apr 4 date
      expect(result.date).toEqual(apr4BusinessDate);
      expect(result.status).toBe('open');

      // Verify it used business date, not system date
      expect(getBusinessDate).toHaveBeenCalledWith(mockOrganizationId);
    });
  });
});
