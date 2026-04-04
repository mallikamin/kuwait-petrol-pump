import { prisma } from '../../config/database';
import { AppError } from '../../middleware/error.middleware';
import { getBusinessDate } from '../../utils/timezone';

export class ShiftsService {
  /**
   * Create a new shift template
   */
  async createShift(
    branchId: string,
    organizationId: string,
    data: {
      shiftNumber: number;
      name?: string;
      startTime: string;
      endTime: string;
    }
  ) {
    // Verify branch belongs to organization
    const branch = await prisma.branch.findFirst({
      where: {
        id: branchId,
        organizationId,
      },
    });

    if (!branch) {
      throw new AppError(404, 'Branch not found');
    }

    // Check if shift number already exists for this branch
    const existingShift = await prisma.shift.findFirst({
      where: {
        branchId,
        shiftNumber: data.shiftNumber,
      },
    });

    if (existingShift) {
      throw new AppError(400, 'Shift number already exists for this branch');
    }

    // Create shift
    const shift = await prisma.shift.create({
      data: {
        branchId,
        shiftNumber: data.shiftNumber,
        name: data.name || `Shift ${data.shiftNumber}`,
        startTime: new Date(`1970-01-01T${data.startTime}`),
        endTime: new Date(`1970-01-01T${data.endTime}`),
        isActive: true,
      },
      include: {
        branch: true,
      },
    });

    return shift;
  }

  /**
   * Get all shifts for a branch
   */
  async getAllShifts(branchId: string, organizationId: string) {
    // Verify branch belongs to organization
    const branch = await prisma.branch.findFirst({
      where: {
        id: branchId,
        organizationId,
      },
    });

    if (!branch) {
      throw new AppError(404, 'Branch not found');
    }

    const shifts = await prisma.shift.findMany({
      where: {
        branchId,
        isActive: true,
      },
      orderBy: { shiftNumber: 'asc' },
    });

    return shifts;
  }

  /**
   * Open a new shift
   */
  async openShift(branchId: string, shiftId: string, userId: string, organizationId: string) {
    // Verify branch belongs to organization
    const branch = await prisma.branch.findFirst({
      where: {
        id: branchId,
        organizationId,
      },
    });

    if (!branch) {
      throw new AppError(404, 'Branch not found');
    }

    // Verify shift exists and belongs to branch
    const shift = await prisma.shift.findFirst({
      where: {
        id: shiftId,
        branchId,
        isActive: true,
      },
    });

    if (!shift) {
      throw new AppError(404, 'Shift not found or inactive');
    }

    // Check if there's already an open shift for this branch today
    // Use business timezone to calculate correct date (not server system timezone)
    const today = await getBusinessDate(organizationId);

    const existingOpenShift = await prisma.shiftInstance.findFirst({
      where: {
        branchId,
        date: today,
        status: 'open',
      },
    });

    if (existingOpenShift) {
      throw new AppError(400, 'There is already an open shift for today. Please close it first.');
    }

    // Check if this specific shift is already open for today
    const existingShiftInstance = await prisma.shiftInstance.findUnique({
      where: {
        shiftId_date: {
          shiftId,
          date: today,
        },
      },
    });

    if (existingShiftInstance && existingShiftInstance.status === 'open') {
      throw new AppError(400, 'This shift is already open for today');
    }

    // Create or update shift instance
    const shiftInstance = await prisma.shiftInstance.upsert({
      where: {
        shiftId_date: {
          shiftId,
          date: today,
        },
      },
      create: {
        shiftId,
        branchId,
        date: today,
        openedAt: new Date(),
        openedBy: userId,
        status: 'open',
      },
      update: {
        openedAt: new Date(),
        openedBy: userId,
        status: 'open',
      },
      include: {
        shift: true,
        openedByUser: {
          select: {
            id: true,
            fullName: true,
            username: true,
          },
        },
      },
    });

    // AUTO-POPULATE OPENING READINGS from previous shift's closing readings
    try {
      // Find the most recent closed shift instance for this branch
      const previousShiftInstance = await prisma.shiftInstance.findFirst({
        where: {
          branchId,
          status: 'closed',
          OR: [
            // Same day, earlier shift
            {
              date: today,
              shift: {
                shiftNumber: { lt: shift.shiftNumber },
              },
            },
            // Previous day, any shift
            {
              date: { lt: today },
            },
          ],
        },
        orderBy: [
          { date: 'desc' },
          { shift: { shiftNumber: 'desc' } },
        ],
        include: {
          meterReadings: {
            where: {
              readingType: 'closing',
            },
            include: {
              nozzle: true,
            },
          },
        },
      });

      if (previousShiftInstance && previousShiftInstance.meterReadings.length > 0) {
        // Create opening readings for all nozzles that had closing readings
        const openingReadingsToCreate = previousShiftInstance.meterReadings.map((closingReading) => ({
          nozzleId: closingReading.nozzleId,
          shiftInstanceId: shiftInstance.id,
          readingType: 'opening' as const,
          meterValue: closingReading.meterValue,
          recordedAt: new Date(),
          recordedBy: userId,
          isManualOverride: false,
          isOcr: false,
        }));

        // Bulk create all opening readings
        await prisma.meterReading.createMany({
          data: openingReadingsToCreate,
          skipDuplicates: true, // Skip if opening already exists
        });

        console.log(`✅ Auto-created ${openingReadingsToCreate.length} opening readings for shift ${shiftInstance.id} from previous shift ${previousShiftInstance.id}`);
      } else {
        console.log(`ℹ️ No previous closing readings found for shift ${shiftInstance.id} - this might be the first shift`);
      }
    } catch (error) {
      // Log but don't fail the shift opening if auto-populate fails
      console.error('Failed to auto-populate opening readings:', error);
    }

    return shiftInstance;
  }

  /**
   * Close a shift
   */
  async closeShift(shiftInstanceId: string, userId: string, organizationId: string, notes?: string) {
    // Verify shift instance exists and belongs to organization
    const shiftInstance = await prisma.shiftInstance.findFirst({
      where: {
        id: shiftInstanceId,
        branch: {
          organizationId,
        },
      },
      include: {
        shift: true,
      },
    });

    if (!shiftInstance) {
      throw new AppError(404, 'Shift instance not found');
    }

    if (shiftInstance.status === 'closed') {
      throw new AppError(400, 'Shift is already closed');
    }

    if (shiftInstance.status !== 'open') {
      throw new AppError(400, 'Cannot close a shift that is not open');
    }

    // Update shift instance
    const closedShift = await prisma.shiftInstance.update({
      where: { id: shiftInstanceId },
      data: {
        closedAt: new Date(),
        closedBy: userId,
        status: 'closed',
        ...(notes && { notes }),
      },
      include: {
        shift: true,
        openedByUser: {
          select: {
            id: true,
            fullName: true,
            username: true,
          },
        },
        closedByUser: {
          select: {
            id: true,
            fullName: true,
            username: true,
          },
        },
        meterReadings: {
          include: {
            nozzle: {
              include: {
                fuelType: true,
                dispensingUnit: true,
              },
            },
          },
        },
        sales: true,
      },
    });

    return closedShift;
  }

  /**
   * Get current active shift for a branch
   */
  async getCurrentShift(branchId: string, organizationId: string) {
    // Verify branch belongs to organization
    const branch = await prisma.branch.findFirst({
      where: {
        id: branchId,
        organizationId,
      },
    });

    if (!branch) {
      throw new AppError(404, 'Branch not found');
    }

    const currentShift = await prisma.shiftInstance.findFirst({
      where: {
        branchId,
        status: 'open',
      },
      include: {
        shift: true,
        openedByUser: {
          select: {
            id: true,
            fullName: true,
            username: true,
          },
        },
        meterReadings: {
          include: {
            nozzle: {
              include: {
                fuelType: true,
                dispensingUnit: true,
              },
            },
          },
        },
      },
      orderBy: { openedAt: 'desc' },
    });

    return currentShift;
  }

  /**
   * Get shift history with filters
   */
  async getShiftHistory(
    branchId: string,
    organizationId: string,
    filters: {
      startDate?: Date;
      endDate?: Date;
      status?: string;
      limit?: number;
      offset?: number;
    }
  ) {
    // Verify branch belongs to organization
    const branch = await prisma.branch.findFirst({
      where: {
        id: branchId,
        organizationId,
      },
    });

    if (!branch) {
      throw new AppError(404, 'Branch not found');
    }

    const { startDate, endDate, status, limit = 50, offset = 0 } = filters;

    const where: Record<string, unknown> = {
      branchId,
    };

    if (startDate || endDate) {
      where.date = {} as Record<string, Date>;
      if (startDate) (where.date as Record<string, Date>).gte = startDate;
      if (endDate) (where.date as Record<string, Date>).lte = endDate;
    }

    if (status) {
      where.status = status;
    }

    const [shifts, total] = await Promise.all([
      prisma.shiftInstance.findMany({
        where,
        include: {
          shift: true,
          openedByUser: {
            select: {
              id: true,
              fullName: true,
              username: true,
            },
          },
          closedByUser: {
            select: {
              id: true,
              fullName: true,
              username: true,
            },
          },
        },
        orderBy: { date: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.shiftInstance.count({ where }),
    ]);

    return {
      shifts,
      pagination: {
        total,
        limit,
        offset,
        pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get shift by ID
   */
  async getShiftById(shiftInstanceId: string, organizationId: string) {
    const shiftInstance = await prisma.shiftInstance.findFirst({
      where: {
        id: shiftInstanceId,
        branch: {
          organizationId,
        },
      },
      include: {
        shift: true,
        branch: true,
        openedByUser: {
          select: {
            id: true,
            fullName: true,
            username: true,
          },
        },
        closedByUser: {
          select: {
            id: true,
            fullName: true,
            username: true,
          },
        },
        meterReadings: {
          include: {
            nozzle: {
              include: {
                fuelType: true,
                dispensingUnit: true,
              },
            },
            recordedByUser: {
              select: {
                id: true,
                fullName: true,
                username: true,
              },
            },
          },
        },
        sales: {
          include: {
            fuelSales: {
              include: {
                fuelType: true,
              },
            },
            nonFuelSales: {
              include: {
                product: true,
              },
            },
          },
        },
      },
    });

    if (!shiftInstance) {
      throw new AppError(404, 'Shift instance not found');
    }

    return shiftInstance;
  }

  /**
   * Get or create shift instances for a specific business date
   * Used for backdated entries - auto-creates shift instances from templates if they don't exist
   */
  async getOrCreateShiftInstancesForDate(
    branchId: string,
    businessDate: string,
    userId: string,
    organizationId: string
  ) {
    // Verify branch belongs to organization
    const branch = await prisma.branch.findFirst({
      where: {
        id: branchId,
        organizationId,
      },
    });

    if (!branch) {
      throw new AppError(404, 'Branch not found');
    }

    // Get all shift templates for this branch
    const shiftTemplates = await prisma.shift.findMany({
      where: {
        branchId,
        isActive: true,
      },
      orderBy: { shiftNumber: 'asc' },
    });

    if (shiftTemplates.length === 0) {
      throw new AppError(
        400,
        'No shift templates configured for this branch. Please configure shifts in Shift Management first.'
      );
    }

    // Parse business date and normalize
    const targetDate = new Date(businessDate);
    targetDate.setUTCHours(0, 0, 0, 0);

    // Get or create shift instances for each template
    const shiftInstances = await Promise.all(
      shiftTemplates.map(async (shiftTemplate) => {
        let instance = await prisma.shiftInstance.findUnique({
          where: {
            shiftId_date: {
              shiftId: shiftTemplate.id,
              date: targetDate,
            },
          },
          include: {
            shift: true,
          },
        });

        if (!instance) {
          // Auto-create shift instance for this date
          instance = await prisma.shiftInstance.create({
            data: {
              shiftId: shiftTemplate.id,
              branchId,
              date: targetDate,
              openedAt: new Date(targetDate), // Use business date as opened time
              openedBy: userId,
              status: 'open', // Will be closed manually later
            },
            include: {
              shift: true,
            },
          });
          console.log(
            `✅ Auto-created shift instance for ${shiftTemplate.name} on ${targetDate.toISOString().split('T')[0]}`
          );
        }

        return instance;
      })
    );

    return shiftInstances;
  }
}
