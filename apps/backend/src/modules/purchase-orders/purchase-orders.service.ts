import { prisma } from '../../config/database';
import { AppError } from '../../middleware/error.middleware';
import { Decimal } from '@prisma/client/runtime/library';
import {
  CreatePurchaseOrderInput,
  UpdatePurchaseOrderInput,
  RecordPaymentInput,
} from './purchase-orders.schema';

interface PurchaseOrderFilters {
  supplierId?: string;
  branchId?: string;
  status?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

export class PurchaseOrdersService {
  /**
   * Get all purchase orders with filters
   */
  async getAllPurchaseOrders(organizationId: string, filters: PurchaseOrderFilters) {
    const {
      supplierId,
      branchId,
      status,
      startDate,
      endDate,
      limit = 50,
      offset = 0,
    } = filters;

    const where: Record<string, unknown> = {
      organizationId,
    };

    if (supplierId) where.supplierId = supplierId;
    if (branchId) where.branchId = branchId;
    if (status) where.status = status;

    if (startDate || endDate) {
      where.orderDate = {};
      if (startDate) (where.orderDate as Record<string, unknown>).gte = startDate;
      if (endDate) (where.orderDate as Record<string, unknown>).lte = endDate;
    }

    const [purchaseOrders, total] = await Promise.all([
      prisma.purchaseOrder.findMany({
        where,
        include: {
          supplier: true,
          branch: true,
          items: {
            include: {
              fuelType: true,
              product: true,
            },
          },
        },
        orderBy: { orderDate: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.purchaseOrder.count({ where }),
    ]);

    return {
      purchaseOrders,
      pagination: {
        total,
        limit,
        offset,
        pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get purchase order by ID
   */
  async getPurchaseOrderById(poId: string, organizationId: string) {
    const po = await prisma.purchaseOrder.findFirst({
      where: {
        id: poId,
        organizationId,
      },
      include: {
        supplier: true,
        branch: true,
        items: {
          include: {
            fuelType: true,
            product: true,
          },
        },
        stockReceipts: {
          include: {
            items: true,
            receivedByUser: {
              select: {
                id: true,
                fullName: true,
                username: true,
              },
            },
          },
          orderBy: { receiptDate: 'desc' },
        },
      },
    });

    if (!po) {
      throw new AppError(404, 'Purchase order not found');
    }

    return po;
  }

  /**
   * Create new purchase order
   */
  async createPurchaseOrder(organizationId: string, data: CreatePurchaseOrderInput) {
    // Check for duplicate PO number
    const existing = await prisma.purchaseOrder.findFirst({
      where: {
        organizationId,
        poNumber: data.poNumber,
      },
    });

    if (existing) {
      throw new AppError(400, 'Purchase order number already exists');
    }

    // Calculate total amount
    const totalAmount = data.items.reduce(
      (sum, item) => sum + item.quantityOrdered * item.costPerUnit,
      0
    );

    // Create PO with items
    const po = await prisma.purchaseOrder.create({
      data: {
        organization: { connect: { id: organizationId } },
        branch: { connect: { id: data.branchId } },
        supplier: { connect: { id: data.supplierId } },
        poNumber: data.poNumber,
        orderDate: data.orderDate,
        totalAmount: new Decimal(totalAmount),
        notes: data.notes,
        items: {
          create: data.items.map(item => ({
            itemType: item.itemType,
            fuelTypeId: item.fuelTypeId,
            productId: item.productId,
            quantityOrdered: new Decimal(item.quantityOrdered),
            costPerUnit: new Decimal(item.costPerUnit),
            totalCost: new Decimal(item.quantityOrdered * item.costPerUnit),
          })),
        },
      },
      include: {
        supplier: true,
        branch: true,
        items: {
          include: {
            fuelType: true,
            product: true,
          },
        },
      },
    });

    return po;
  }

  /**
   * Update purchase order (only draft status)
   */
  async updatePurchaseOrder(
    poId: string,
    organizationId: string,
    data: UpdatePurchaseOrderInput
  ) {
    const existing = await prisma.purchaseOrder.findFirst({
      where: {
        id: poId,
        organizationId,
      },
    });

    if (!existing) {
      throw new AppError(404, 'Purchase order not found');
    }

    if (existing.status !== 'draft') {
      throw new AppError(400, 'Only draft purchase orders can be updated');
    }

    // If updating items, recalculate total
    let totalAmount = existing.totalAmount;
    if (data.items) {
      totalAmount = new Decimal(
        data.items.reduce(
          (sum, item) => sum + item.quantityOrdered * item.costPerUnit,
          0
        )
      );

      // Delete old items and create new ones
      await prisma.purchaseOrderItem.deleteMany({
        where: { purchaseOrderId: poId },
      });
    }

    const updated = await prisma.purchaseOrder.update({
      where: { id: poId },
      data: {
        supplierId: data.supplierId,
        orderDate: data.orderDate,
        totalAmount,
        notes: data.notes,
        ...(data.items && {
          items: {
            create: data.items.map(item => ({
              itemType: item.itemType,
              fuelTypeId: item.fuelTypeId,
              productId: item.productId,
              quantityOrdered: new Decimal(item.quantityOrdered),
              costPerUnit: new Decimal(item.costPerUnit),
              totalCost: new Decimal(item.quantityOrdered * item.costPerUnit),
            })),
          },
        }),
      },
      include: {
        supplier: true,
        branch: true,
        items: {
          include: {
            fuelType: true,
            product: true,
          },
        },
      },
    });

    return updated;
  }

  /**
   * Confirm purchase order (change from draft to confirmed)
   */
  async confirmPurchaseOrder(poId: string, organizationId: string) {
    const po = await prisma.purchaseOrder.findFirst({
      where: {
        id: poId,
        organizationId,
      },
    });

    if (!po) {
      throw new AppError(404, 'Purchase order not found');
    }

    if (po.status !== 'draft') {
      throw new AppError(400, 'Only draft purchase orders can be confirmed');
    }

    const confirmed = await prisma.purchaseOrder.update({
      where: { id: poId },
      data: { status: 'confirmed' },
      include: {
        supplier: true,
        items: {
          include: {
            fuelType: true,
            product: true,
          },
        },
      },
    });

    return confirmed;
  }

  /**
   * Cancel purchase order
   */
  async cancelPurchaseOrder(poId: string, organizationId: string) {
    const po = await prisma.purchaseOrder.findFirst({
      where: {
        id: poId,
        organizationId,
      },
    });

    if (!po) {
      throw new AppError(404, 'Purchase order not found');
    }

    if (po.status === 'received') {
      throw new AppError(400, 'Cannot cancel fully received purchase order');
    }

    const cancelled = await prisma.purchaseOrder.update({
      where: { id: poId },
      data: { status: 'cancelled' },
    });

    return cancelled;
  }

  /**
   * Record payment for purchase order
   */
  async recordPayment(
    poId: string,
    organizationId: string,
    data: RecordPaymentInput
  ) {
    const po = await prisma.purchaseOrder.findFirst({
      where: {
        id: poId,
        organizationId,
      },
      include: {
        supplier: true,
      },
    });

    if (!po) {
      throw new AppError(404, 'Purchase order not found');
    }

    const totalPaid = Number(po.paidAmount) + data.amount;
    if (totalPaid > Number(po.totalAmount)) {
      throw new AppError(400, 'Payment amount exceeds total purchase amount');
    }

    // Create payment record
    const payment = await prisma.supplierPayment.create({
      data: {
        supplierId: po.supplierId,
        paymentDate: data.paymentDate,
        amount: new Decimal(data.amount),
        paymentMethod: data.paymentMethod,
        referenceNumber: data.referenceNumber,
        notes: data.notes || `Payment for PO ${po.poNumber}`,
      },
    });

    // Update PO paid amount
    await prisma.purchaseOrder.update({
      where: { id: poId },
      data: {
        paidAmount: {
          increment: new Decimal(data.amount),
        },
      },
    });

    return payment;
  }
}
