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

    // Use transaction to prevent data loss if update fails
    const updated = await prisma.$transaction(async (tx) => {
      // If updating items, recalculate total
      let totalAmount = existing.totalAmount;
      if (data.items) {
        totalAmount = new Decimal(
          data.items.reduce(
            (sum, item) => sum + item.quantityOrdered * item.costPerUnit,
            0
          )
        );

        // Delete old items (inside transaction)
        await tx.purchaseOrderItem.deleteMany({
          where: { purchaseOrderId: poId },
        });
      }

      // Update PO
      return await tx.purchaseOrder.update({
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
   *
   * Post-commit: if the PO has been synced to QuickBooks (po.qbBillId is set),
   * a BillPayment job is enqueued so the payment clears Trade Payables in QB.
   * Enqueue failure never rolls back the local payment record.
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

    await prisma.purchaseOrder.update({
      where: { id: poId },
      data: {
        paidAmount: {
          increment: new Decimal(data.amount),
        },
      },
    });

    // Post-commit QB enqueue. Never throw — the payment is already persisted.
    await this.enqueueQbBillPayment({
      paymentId: payment.id,
      organizationId,
      supplierId: po.supplierId,
      qbBillId: po.qbBillId,
      poNumber: po.poNumber,
      paymentDate: data.paymentDate,
      amount: data.amount,
      paymentMethod: data.paymentMethod,
      referenceNumber: data.referenceNumber,
      notes: data.notes,
    }).catch((err) => {
      console.warn(
        `[QB enqueue][bill-payment ${payment.id}] Enqueue failed: ${err?.message || err}. ` +
        `Payment is persisted; QB sync will need a manual replay.`
      );
    });

    return payment;
  }

  /**
   * Enqueue a supplier_payment/create_bill_payment job.
   *
   * Requires po.qbBillId to be set (PO must have synced to QB first as a
   * Bill). Idempotent on (organization_id, idempotency_key).
   */
  private async enqueueQbBillPayment(params: {
    paymentId: string;
    organizationId: string;
    supplierId: string;
    qbBillId: string | null;
    poNumber: string;
    paymentDate: Date;
    amount: number;
    paymentMethod: string;
    referenceNumber?: string | null;
    notes?: string | null;
  }): Promise<void> {
    const connection = await prisma.qBConnection.findFirst({
      where: { organizationId: params.organizationId, isActive: true },
      select: { id: true },
    });
    if (!connection) return; // No QB connection → nothing to enqueue

    if (!params.qbBillId) {
      console.warn(
        `[QB enqueue][bill-payment ${params.paymentId}] Skipping enqueue: ` +
        `PO ${params.poNumber} has no qbBillId (Bill not synced to QB yet). ` +
        `Sync the Bill first, then manually re-enqueue.`
      );
      return;
    }

    const paymentDateIso = new Date(params.paymentDate).toISOString().slice(0, 10);
    const notes = params.notes || `Payment for PO ${params.poNumber}`;

    await prisma.qBSyncQueue.createMany({
      data: [
        {
          connectionId: connection.id,
          organizationId: params.organizationId,
          jobType: 'create_bill_payment',
          entityType: 'supplier_payment',
          entityId: params.paymentId,
          priority: 5,
          status: 'pending',
          // Auto-approve — sync_mode on qb_connections is the real gate.
          approvalStatus: 'approved',
          idempotencyKey: `qb-bill-payment-${params.paymentId}`,
          payload: {
            paymentId: params.paymentId,
            organizationId: params.organizationId,
            supplierId: params.supplierId,
            qbBillId: params.qbBillId,
            paymentDate: paymentDateIso,
            amount: params.amount,
            paymentMethod: params.paymentMethod,
            referenceNumber: params.referenceNumber || undefined,
            notes,
          },
        },
      ],
      skipDuplicates: true,
    });
  }
}
