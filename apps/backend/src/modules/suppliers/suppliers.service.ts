import { prisma } from '../../config/database';
import { AppError } from '../../middleware/error.middleware';
import { CreateSupplierInput, UpdateSupplierInput } from './suppliers.schema';

interface SupplierFilters {
  search?: string;
  isActive?: boolean;
  limit?: number;
  offset?: number;
}

export class SuppliersService {
  /**
   * Get all suppliers with filters
   */
  async getAllSuppliers(organizationId: string, filters: SupplierFilters) {
    const {
      search,
      isActive,
      limit = 50,
      offset = 0,
    } = filters;

    const where: Record<string, unknown> = {
      organizationId,
    };

    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
        { contactPerson: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [suppliers, total] = await Promise.all([
      prisma.supplier.findMany({
        where,
        orderBy: { name: 'asc' },
        take: limit,
        skip: offset,
      }),
      prisma.supplier.count({ where }),
    ]);

    return {
      suppliers,
      pagination: {
        total,
        limit,
        offset,
        pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get supplier by ID
   */
  async getSupplierById(supplierId: string, organizationId: string) {
    const supplier = await prisma.supplier.findFirst({
      where: {
        id: supplierId,
        organizationId,
      },
      include: {
        purchaseOrders: {
          orderBy: { orderDate: 'desc' },
          take: 10,
        },
        payments: {
          orderBy: { paymentDate: 'desc' },
          take: 10,
        },
      },
    });

    if (!supplier) {
      throw new AppError(404, 'Supplier not found');
    }

    return supplier;
  }

  /**
   * Create new supplier
   */
  async createSupplier(organizationId: string, data: CreateSupplierInput) {
    // Check for duplicate name
    const existing = await prisma.supplier.findFirst({
      where: {
        organizationId,
        name: data.name,
      },
    });

    if (existing) {
      throw new AppError(400, 'Supplier with this name already exists');
    }

    const supplier = await prisma.supplier.create({
      data: {
        organization: { connect: { id: organizationId } },
        name: data.name,
        code: data.code,
        contactPerson: data.contactPerson,
        phone: data.phone,
        email: data.email || undefined,
        paymentTerms: data.paymentTerms,
        creditDays: data.creditDays,
      },
    });

    return supplier;
  }

  /**
   * Update supplier
   */
  async updateSupplier(
    supplierId: string,
    organizationId: string,
    data: UpdateSupplierInput
  ) {
    // Verify supplier exists and belongs to organization
    const existing = await prisma.supplier.findFirst({
      where: {
        id: supplierId,
        organizationId,
      },
    });

    if (!existing) {
      throw new AppError(404, 'Supplier not found');
    }

    // Check for duplicate name if name is being updated
    if (data.name && data.name !== existing.name) {
      const duplicate = await prisma.supplier.findFirst({
        where: {
          organizationId,
          name: data.name,
          id: { not: supplierId },
        },
      });

      if (duplicate) {
        throw new AppError(400, 'Supplier with this name already exists');
      }
    }

    const updated = await prisma.supplier.update({
      where: { id: supplierId },
      data,
    });

    return updated;
  }

  /**
   * Soft delete supplier
   */
  async deleteSupplier(supplierId: string, organizationId: string) {
    const existing = await prisma.supplier.findFirst({
      where: {
        id: supplierId,
        organizationId,
      },
    });

    if (!existing) {
      throw new AppError(404, 'Supplier not found');
    }

    const deleted = await prisma.supplier.update({
      where: { id: supplierId },
      data: { isActive: false },
    });

    return deleted;
  }

  /**
   * Get supplier balance (total unpaid amount)
   */
  async getSupplierBalance(supplierId: string, organizationId: string) {
    const supplier = await prisma.supplier.findFirst({
      where: {
        id: supplierId,
        organizationId,
      },
      include: {
        purchaseOrders: {
          where: {
            status: { in: ['confirmed', 'partial_received', 'received'] },
          },
        },
        payments: true,
      },
    });

    if (!supplier) {
      throw new AppError(404, 'Supplier not found');
    }

    const totalPurchases = supplier.purchaseOrders.reduce(
      (sum, po) => sum + Number(po.totalAmount),
      0
    );

    const totalPaid = supplier.payments.reduce(
      (sum, payment) => sum + Number(payment.amount),
      0
    );

    return {
      supplierId: supplier.id,
      supplierName: supplier.name,
      totalPurchases,
      totalPaid,
      balance: totalPurchases - totalPaid,
    };
  }
}
