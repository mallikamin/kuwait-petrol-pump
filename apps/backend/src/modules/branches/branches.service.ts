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

  /**
   * Create a new branch under the given organization.
   * Code (if supplied) must be unique within the org.
   */
  async createBranch(
    organizationId: string,
    data: { name: string; code?: string | null; location?: string | null }
  ) {
    const code = data.code?.trim().toLowerCase() || null;

    if (code) {
      const existing = await prisma.branch.findFirst({
        where: { organizationId, code },
      });
      if (existing) {
        throw new AppError(409, `Branch code "${code}" already exists in this organization`);
      }
    }

    const branch = await prisma.branch.create({
      data: {
        organizationId,
        name: data.name.trim(),
        code,
        location: data.location?.trim() || null,
      },
    });

    return branch;
  }

  /**
   * Create a new dispensing unit
   */
  async createDispensingUnit(branchId: string, organizationId: string, data: { name: string; unitNumber: number }) {
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

    const unit = await prisma.dispensingUnit.create({
      data: {
        branchId,
        name: data.name,
        unitNumber: data.unitNumber,
      },
      include: {
        nozzles: {
          include: {
            fuelType: true,
          },
        },
      },
    });

    return unit;
  }

  /**
   * Create a new nozzle
   */
  async createNozzle(unitId: string, organizationId: string, data: { nozzleNumber: number; fuelTypeId: string; meterType?: string }) {
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

    const nozzle = await prisma.nozzle.create({
      data: {
        dispensingUnitId: unitId,
        nozzleNumber: data.nozzleNumber,
        fuelTypeId: data.fuelTypeId,
        meterType: data.meterType || 'digital',
      },
      include: {
        fuelType: true,
        dispensingUnit: true,
      },
    });

    return nozzle;
  }
}
