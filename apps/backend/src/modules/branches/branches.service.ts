import { prisma } from '../../config/database';
import { AppError } from '../../middleware/error.middleware';

export class BranchesService {
  /**
   * Get all branches for an organization
   */
  async getAllBranches(organizationId: string) {
    const branches = await prisma.branch.findMany({
      where: { organizationId },
      include: {
        dispensingUnits: {
          include: {
            nozzles: {
              include: {
                fuelType: true,
              },
            },
          },
          orderBy: { unitNumber: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    });

    return branches;
  }

  /**
   * Get a single branch by ID
   */
  async getBranchById(branchId: string, organizationId: string) {
    const branch = await prisma.branch.findFirst({
      where: {
        id: branchId,
        organizationId,
      },
      include: {
        dispensingUnits: {
          include: {
            nozzles: {
              include: {
                fuelType: true,
              },
            },
          },
          orderBy: { unitNumber: 'asc' },
        },
      },
    });

    if (!branch) {
      throw new AppError(404, 'Branch not found');
    }

    return branch;
  }

  /**
   * Get dispensing units for a branch
   */
  async getDispensingUnits(branchId: string, organizationId: string) {
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

    const units = await prisma.dispensingUnit.findMany({
      where: { branchId },
      include: {
        nozzles: {
          include: {
            fuelType: true,
          },
          orderBy: { nozzleNumber: 'asc' },
        },
      },
      orderBy: { unitNumber: 'asc' },
    });

    return units;
  }

  /**
   * Get a single dispensing unit by ID
   */
  async getDispensingUnitById(unitId: string, organizationId: string) {
    const unit = await prisma.dispensingUnit.findFirst({
      where: {
        id: unitId,
        branch: {
          organizationId,
        },
      },
      include: {
        branch: true,
        nozzles: {
          include: {
            fuelType: true,
          },
          orderBy: { nozzleNumber: 'asc' },
        },
      },
    });

    if (!unit) {
      throw new AppError(404, 'Dispensing unit not found');
    }

    return unit;
  }

  /**
   * Get nozzles for a dispensing unit
   */
  async getNozzlesByUnit(unitId: string, organizationId: string) {
    // Verify unit belongs to organization
    const unit = await prisma.dispensingUnit.findFirst({
      where: {
        id: unitId,
        branch: {
          organizationId,
        },
      },
    });

    if (!unit) {
      throw new AppError(404, 'Dispensing unit not found');
    }

    const nozzles = await prisma.nozzle.findMany({
      where: { dispensingUnitId: unitId },
      include: {
        fuelType: true,
        dispensingUnit: {
          include: {
            branch: true,
          },
        },
      },
      orderBy: { nozzleNumber: 'asc' },
    });

    return nozzles;
  }
}
