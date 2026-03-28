/**
 * Tenant Validation Utilities
 * Pre-Deployment Hardening - Multi-Tenant Safety
 *
 * Validates that all foreign key references belong to the authenticated user's organization.
 * ⚠️ CRITICAL: Prevents cross-tenant data access.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export class TenantValidator {
  /**
   * Validate that a branch belongs to the specified organization
   *
   * @param branchId Branch UUID
   * @param organizationId Organization UUID (from JWT)
   * @throws Error if branch not found or belongs to different organization
   */
  static async validateBranch(
    branchId: string,
    organizationId: string
  ): Promise<void> {
    const branch = await prisma.branch.findUnique({
      where: { id: branchId },
      select: { organizationId: true },
    });

    if (!branch) {
      throw new Error(`Branch ${branchId} not found`);
    }

    if (branch.organizationId !== organizationId) {
      throw new Error('Access denied: Branch belongs to different organization');
    }
  }

  /**
   * Validate that a customer belongs to the specified organization
   *
   * @param customerId Customer UUID (can be null/undefined)
   * @param organizationId Organization UUID (from JWT)
   * @throws Error if customer not found or belongs to different organization
   */
  static async validateCustomer(
    customerId: string | null | undefined,
    organizationId: string
  ): Promise<void> {
    if (!customerId) return; // Optional field

    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { organizationId: true },
    });

    if (!customer) {
      throw new Error(`Customer ${customerId} not found`);
    }

    if (customer.organizationId !== organizationId) {
      throw new Error('Access denied: Customer belongs to different organization');
    }
  }

  /**
   * Validate that a nozzle belongs to a branch in the specified organization
   *
   * @param nozzleId Nozzle UUID
   * @param organizationId Organization UUID (from JWT)
   * @throws Error if nozzle not found or belongs to different organization
   */
  static async validateNozzle(
    nozzleId: string,
    organizationId: string
  ): Promise<void> {
    const nozzle = await prisma.nozzle.findUnique({
      where: { id: nozzleId },
      include: {
        dispensingUnit: {
          include: {
            branch: {
              select: { organizationId: true },
            },
          },
        },
      },
    });

    if (!nozzle) {
      throw new Error(`Nozzle ${nozzleId} not found`);
    }

    if (nozzle.dispensingUnit.branch.organizationId !== organizationId) {
      throw new Error('Access denied: Nozzle belongs to different organization');
    }
  }

  /**
   * Validate that a shift instance belongs to a branch in the specified organization
   *
   * @param shiftInstanceId Shift instance UUID (can be null/undefined)
   * @param organizationId Organization UUID (from JWT)
   * @throws Error if shift instance not found or belongs to different organization
   */
  static async validateShiftInstance(
    shiftInstanceId: string | null | undefined,
    organizationId: string
  ): Promise<void> {
    if (!shiftInstanceId) return; // Optional field

    const shiftInstance = await prisma.shiftInstance.findUnique({
      where: { id: shiftInstanceId },
      include: {
        branch: {
          select: { organizationId: true },
        },
      },
    });

    if (!shiftInstance) {
      throw new Error(`Shift instance ${shiftInstanceId} not found`);
    }

    if (shiftInstance.branch.organizationId !== organizationId) {
      throw new Error('Access denied: Shift instance belongs to different organization');
    }
  }

  /**
   * Validate that a product belongs to the specified organization
   *
   * @param productId Product UUID
   * @param organizationId Organization UUID (from JWT)
   * @throws Error if product not found or belongs to different organization
   */
  static async validateProduct(
    productId: string,
    organizationId: string
  ): Promise<void> {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { organizationId: true },
    });

    if (!product) {
      throw new Error(`Product ${productId} not found`);
    }

    if (product.organizationId !== organizationId) {
      throw new Error('Access denied: Product belongs to different organization');
    }
  }

  /**
   * Batch validate all foreign keys for a queued sale
   *
   * @param queuedSale Sale data from offline queue
   * @param organizationId Organization UUID (from JWT)
   * @throws Error if any validation fails
   */
  static async validateSaleForeignKeys(
    queuedSale: {
      branchId: string;
      customerId?: string | null;
      shiftInstanceId?: string;
      fuelSales?: Array<{ nozzleId: string }>;
      nonFuelSales?: Array<{ productId: string }>;
    },
    organizationId: string
  ): Promise<void> {
    // Validate branch (CRITICAL - determines tenant boundary)
    await this.validateBranch(queuedSale.branchId, organizationId);

    // Validate optional customer
    if (queuedSale.customerId) {
      await this.validateCustomer(queuedSale.customerId, organizationId);
    }

    // Validate optional shift instance
    if (queuedSale.shiftInstanceId) {
      await this.validateShiftInstance(queuedSale.shiftInstanceId, organizationId);
    }

    // Validate all nozzles in fuel sales
    if (queuedSale.fuelSales) {
      for (const fuelSale of queuedSale.fuelSales) {
        await this.validateNozzle(fuelSale.nozzleId, organizationId);
      }
    }

    // Validate all products in non-fuel sales
    if (queuedSale.nonFuelSales) {
      for (const nonFuelSale of queuedSale.nonFuelSales) {
        await this.validateProduct(nonFuelSale.productId, organizationId);
      }
    }
  }

  /**
   * Batch validate all foreign keys for a queued meter reading
   *
   * @param queuedReading Meter reading data from offline queue
   * @param organizationId Organization UUID (from JWT)
   * @throws Error if any validation fails
   */
  static async validateMeterReadingForeignKeys(
    queuedReading: {
      nozzleId: string;
      shiftInstanceId: string;
    },
    organizationId: string
  ): Promise<void> {
    // Validate nozzle (CRITICAL - determines tenant boundary)
    await this.validateNozzle(queuedReading.nozzleId, organizationId);

    // Validate shift instance
    await this.validateShiftInstance(queuedReading.shiftInstanceId, organizationId);
  }
}
