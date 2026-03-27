import { prisma } from '../../config/database';
import { AppError } from '../../middleware/error.middleware';

export class ShiftsService {
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
    const today = new Date();
    today.setHours(0, 0, 0, 0);

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
}
