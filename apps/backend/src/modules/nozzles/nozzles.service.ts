import { prisma } from '../../config/database';
import { AppError } from '../../middleware/error.middleware';

interface GetNozzlesFilters {
  branchId?: string;
  dispensingUnitId?: string;
  fuelTypeId?: string;
  isActive?: boolean;
}

export class NozzlesService {
  /**
   * Get all nozzles with optional filters
   */
  async getAllNozzles(organizationId: string, filters: GetNozzlesFilters) {
    const { branchId, dispensingUnitId, fuelTypeId, isActive } = filters;

    const nozzles = await prisma.nozzle.findMany({
      where: {
        ...(dispensingUnitId && { dispensingUnitId }),
        ...(fuelTypeId && { fuelTypeId }),
        ...(isActive !== undefined && { isActive }),
        dispensingUnit: {
          ...(branchId && { branchId }),
          branch: {
            organizationId,
          },
        },
      },
      include: {
        fuelType: true,
        dispensingUnit: {
          include: {
            branch: true,
          },
        },
      },
      orderBy: [
        { dispensingUnit: { unitNumber: 'asc' } },
        { nozzleNumber: 'asc' },
      ],
    });

    return nozzles;
  }

  /**
   * Get a single nozzle by ID
   */
  async getNozzleById(nozzleId: string, organizationId: string) {
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
        dispensingUnit: {
          include: {
            branch: true,
          },
        },
        meterReadings: {
          orderBy: { recordedAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!nozzle) {
      throw new AppError(404, 'Nozzle not found');
    }

    return nozzle;
  }

  /**
   * Update nozzle status
   */
  async updateNozzleStatus(nozzleId: string, organizationId: string, isActive: boolean) {
    // Verify nozzle belongs to organization
    const nozzle = await prisma.nozzle.findFirst({
      where: {
        id: nozzleId,
        dispensingUnit: {
          branch: {
            organizationId,
          },
        },
      },
    });

    if (!nozzle) {
      throw new AppError(404, 'Nozzle not found');
    }

    const updatedNozzle = await prisma.nozzle.update({
      where: { id: nozzleId },
      data: { isActive },
      include: {
        fuelType: true,
        dispensingUnit: {
          include: {
            branch: true,
          },
        },
      },
    });

    return updatedNozzle;
  }

  /**
   * Get latest meter reading for a nozzle
   */
  async getLatestReading(nozzleId: string, organizationId: string) {
    // Verify nozzle belongs to organization
    const nozzle = await prisma.nozzle.findFirst({
      where: {
        id: nozzleId,
        dispensingUnit: {
          branch: {
            organizationId,
          },
        },
      },
    });

    if (!nozzle) {
      throw new AppError(404, 'Nozzle not found');
    }

    const latestReading = await prisma.meterReading.findFirst({
      where: { nozzleId },
      orderBy: { recordedAt: 'desc' },
      include: {
        shiftInstance: true,
        recordedByUser: {
          select: {
            id: true,
            fullName: true,
            username: true,
          },
        },
      },
    });

    return latestReading;
  }
}
