import { prisma } from '../../config/database';
import { AppError } from '../../middleware/error.middleware';
import { Decimal } from '@prisma/client/runtime/library';
import { CreateFuelSaleInput, CreateNonFuelSaleInput } from './sales.schema';
import { enqueueQbSaleSync } from '../../services/quickbooks/enqueue-sale';
import { CashLedgerService } from '../cash-ledger/cash-ledger.service';

type CreateFuelSaleData = CreateFuelSaleInput;
type CreateNonFuelSaleData = CreateNonFuelSaleInput;

export class SalesService {
  private buildFuelSaleSignature(sale: {
    saleType?: string | null;
    saleDate: Date;
    totalAmount: Decimal | { toString(): string } | string | number | null;
    paymentMethod?: string | null;
    customerId?: string | null;
    vehicleNumber?: string | null;
    slipNumber?: string | null;
  }): string | null {
    if (sale.saleType !== 'fuel') return null;
    const amount =
      typeof sale.totalAmount === 'string' || typeof sale.totalAmount === 'number'
        ? String(sale.totalAmount)
        : sale.totalAmount?.toString?.() || '0';
    return [
      new Date(sale.saleDate).toISOString(),
      amount,
      sale.paymentMethod || '',
      sale.customerId || '',
      sale.vehicleNumber || '',
      sale.slipNumber || '',
    ].join('|');
  }

  private dedupeLegacyFuelDuplicates<T extends {
    saleType?: string | null;
    saleDate: Date;
    totalAmount: Decimal | { toString(): string } | string | number | null;
    paymentMethod?: string | null;
    customerId?: string | null;
    vehicleNumber?: string | null;
    slipNumber?: string | null;
    offlineQueueId?: string | null;
    shiftInstanceId?: string | null;
    syncStatus?: string | null;
  }>(sales: T[]): T[] {
    const isLegacyMidnightFuelStub = (s: T) =>
      s.saleType === 'fuel' &&
      !s.offlineQueueId &&
      !s.shiftInstanceId &&
      s.syncStatus === 'synced' &&
      new Date(s.saleDate).toISOString().endsWith('T00:00:00.000Z');

    const withoutLegacyMidnight = sales.filter((s) => !isLegacyMidnightFuelStub(s));

    const bySignature = new Map<string, T[]>();
    for (const sale of withoutLegacyMidnight) {
      const sig = this.buildFuelSaleSignature(sale);
      if (!sig) continue;
      const arr = bySignature.get(sig) || [];
      arr.push(sale);
      bySignature.set(sig, arr);
    }

    const stale = new Set<T>();
    for (const grouped of bySignature.values()) {
      const hasCanonical = grouped.some((s) => !!s.offlineQueueId);
      if (!hasCanonical) continue;
      grouped.forEach((s) => {
        if (!s.offlineQueueId && !s.shiftInstanceId && s.syncStatus === 'synced') {
          stale.add(s);
        }
      });
    }

    return stale.size > 0 ? withoutLegacyMidnight.filter((s) => !stale.has(s)) : withoutLegacyMidnight;
  }

  /**
   * Create a fuel sale
   */
  async createFuelSale(data: CreateFuelSaleData, userId: string, organizationId: string) {
    const {
      branchId,
      shiftInstanceId,
      nozzleId,
      fuelTypeId,
      quantityLiters,
      pricePerLiter,
      paymentMethod,
      bankId,
      customerId,
      vehicleNumber,
      slipNumber,
      previousReading,
      currentReading,
      calculatedLiters,
      imageUrl,
      ocrConfidence,
      isManualReading,
    } = data;

    // Validate card payments require bankId
    if (paymentMethod === 'card' && !bankId) {
      throw new AppError(400, 'Bank ID required for card payments');
    }

    // Verify branch belongs to organization
    const branch = await prisma.branch.findFirst({
      where: { id: branchId, organizationId },
    });

    if (!branch) {
      throw new AppError(404, 'Branch not found');
    }

    // Verify nozzle exists and is active (only if nozzleId provided and non-empty)
    // Client removed nozzle selection from POS, so nozzleId is now optional
    if (nozzleId && nozzleId.trim() !== '') {
      const nozzle = await prisma.nozzle.findFirst({
        where: {
          id: nozzleId,
          isActive: true,
          dispensingUnit: { branchId },
        },
      });

      if (!nozzle) {
        throw new AppError(404, 'Nozzle not found or inactive');
      }
    }

    // Verify customer if provided
    if (customerId) {
      const customer = await prisma.customer.findFirst({
        where: { id: customerId, organizationId },
      });
      if (!customer) {
        throw new AppError(404, 'Customer not found');
      }
    }

    // Calculate total
    const totalAmount = quantityLiters * pricePerLiter;

    // Create sale transaction
    const sale = await prisma.sale.create({
      data: {
        branchId,
        shiftInstanceId,
        saleType: 'fuel',
        totalAmount: new Decimal(totalAmount),
        paymentMethod,
        bankId,
        customerId,
        vehicleNumber,
        slipNumber,
        cashierId: userId,
        fuelSales: {
          create: {
            nozzleId,
            fuelTypeId,
            quantityLiters: new Decimal(quantityLiters),
            pricePerLiter: new Decimal(pricePerLiter),
            totalAmount: new Decimal(totalAmount),
            previousReading: previousReading !== undefined ? new Decimal(previousReading) : null,
            currentReading: currentReading !== undefined ? new Decimal(currentReading) : null,
            calculatedLiters: calculatedLiters !== undefined ? new Decimal(calculatedLiters) : null,
            imageUrl: imageUrl || null,
            ocrConfidence: ocrConfidence !== undefined ? ocrConfidence : null,
            isManualReading: isManualReading || false,
          },
        },
      },
      include: {
        fuelSales: {
          include: {
            nozzle: {
              include: {
                dispensingUnit: true,
              },
            },
            fuelType: true,
          },
        },
        customer: true,
        cashier: {
          select: {
            id: true,
            fullName: true,
            username: true,
          },
        },
      },
    });

    // QB enqueue (fuel sale) — single fuel line item
    await enqueueQbSaleSync({
      saleId: sale.id,
      organizationId,
      saleDate: sale.saleDate,
      paymentMethod,
      totalAmount,
      customerId: sale.customerId,
      bankId: sale.bankId,
      lineItems: [
        {
          itemLocalId: fuelTypeId,
          itemName: sale.fuelSales?.[0]?.fuelType?.name || 'Fuel',
          quantity: quantityLiters,
          unitPrice: pricePerLiter,
          amount: totalAmount,
        },
      ],
    });

    // Cash ledger: cash sales post an IN entry so EOD reconciliation sees
    // every rupee that entered the drawer. Non-cash sales (card/credit/
    // pso_card) must NOT post here — they don't move physical cash.
    if (paymentMethod === 'cash') {
      await CashLedgerService.tryPost({
        organizationId,
        branchId,
        businessDate: sale.saleDate,
        shiftInstanceId: sale.shiftInstanceId || null,
        direction: 'IN',
        source: 'SALE',
        sourceId: sale.id,
        amount: totalAmount,
        memo: `Cash fuel sale ${sale.id.slice(0, 8)}`,
        createdBy: userId,
      });
    }

    return sale;
  }

  /**
   * Create a non-fuel sale
   */
  async createNonFuelSale(data: CreateNonFuelSaleData, userId: string, organizationId: string) {
    const {
      branchId,
      shiftInstanceId,
      items,
      paymentMethod,
      bankId,
      customerId,
      taxAmount = 0,
      discountAmount = 0,
    } = data;

    // Validate card payments require bankId
    if (paymentMethod === 'card' && !bankId) {
      throw new AppError(400, 'Bank ID required for card payments');
    }

    // Verify branch belongs to organization
    const branch = await prisma.branch.findFirst({
      where: { id: branchId, organizationId },
    });

    if (!branch) {
      throw new AppError(404, 'Branch not found');
    }

    // Verify all products exist
    const productIds = items.map(item => item.productId);
    const products = await prisma.product.findMany({
      where: {
        id: { in: productIds },
        organizationId,
        isActive: true,
      },
    });

    if (products.length !== productIds.length) {
      throw new AppError(404, 'One or more products not found');
    }

    // Verify customer if provided
    if (customerId) {
      const customer = await prisma.customer.findFirst({
        where: { id: customerId, organizationId },
      });
      if (!customer) {
        throw new AppError(404, 'Customer not found');
      }
    }

    // Calculate total
    const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    const totalAmount = subtotal + taxAmount - discountAmount;

    // Create sale transaction with items
    const sale = await prisma.sale.create({
      data: {
        branchId,
        shiftInstanceId,
        saleType: 'non_fuel',
        totalAmount: new Decimal(totalAmount),
        taxAmount: new Decimal(taxAmount),
        discountAmount: new Decimal(discountAmount),
        paymentMethod,
        bankId,
        customerId,
        cashierId: userId,
        nonFuelSales: {
          create: items.map(item => ({
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: new Decimal(item.unitPrice),
            totalAmount: new Decimal(item.quantity * item.unitPrice),
          })),
        },
      },
      include: {
        nonFuelSales: {
          include: {
            product: true,
          },
        },
        customer: true,
        cashier: {
          select: {
            id: true,
            fullName: true,
            username: true,
          },
        },
      },
    });

    // Update stock levels
    for (const item of items) {
      await prisma.stockLevel.updateMany({
        where: {
          productId: item.productId,
          branchId,
        },
        data: {
          quantity: {
            decrement: item.quantity,
          },
        },
      });
    }

    // QB enqueue (non-fuel sale) — one line item per product in the cart
    await enqueueQbSaleSync({
      saleId: sale.id,
      organizationId,
      saleDate: sale.saleDate,
      paymentMethod,
      totalAmount,
      customerId: sale.customerId,
      bankId: sale.bankId,
      lineItems: items.map((item) => {
        const product = products.find((p) => p.id === item.productId);
        return {
          itemLocalId: item.productId,
          itemName: product?.name || 'Product',
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          amount: item.quantity * item.unitPrice,
        };
      }),
    });

    // Cash ledger IN for cash non-fuel sales (same rule as fuel).
    if (paymentMethod === 'cash') {
      await CashLedgerService.tryPost({
        organizationId,
        branchId,
        businessDate: sale.saleDate,
        shiftInstanceId: sale.shiftInstanceId || null,
        direction: 'IN',
        source: 'SALE',
        sourceId: sale.id,
        amount: totalAmount,
        memo: `Cash non-fuel sale ${sale.id.slice(0, 8)}`,
        createdBy: userId,
      });
    }

    return sale;
  }

  /**
   * Get sales with filters
   */
  async getSales(
    organizationId: string,
    filters: {
      branchId?: string;
      shiftInstanceId?: string;
      saleType?: 'fuel' | 'non_fuel';
      paymentMethod?: string;
      customerId?: string;
      startDate?: Date;
      endDate?: Date;
      limit?: number;
      offset?: number;
    }
  ) {
    const {
      branchId,
      shiftInstanceId,
      saleType,
      paymentMethod,
      customerId,
      startDate,
      endDate,
      limit = 50,
      offset = 0,
    } = filters;

    const where: Record<string, unknown> = {
      branch: { organizationId },
    };

    if (branchId) where.branchId = branchId;
    if (shiftInstanceId) where.shiftInstanceId = shiftInstanceId;
    if (saleType) where.saleType = saleType;
    if (paymentMethod) where.paymentMethod = paymentMethod;
    if (customerId) where.customerId = customerId;

    if (startDate || endDate) {
      where.saleDate = {} as Record<string, Date>;
      if (startDate) (where.saleDate as Record<string, Date>).gte = startDate;
      if (endDate) (where.saleDate as Record<string, Date>).lte = endDate;
    }

    const sales = await prisma.sale.findMany({
      where,
      include: {
        fuelSales: {
          include: {
            nozzle: {
              include: {
                dispensingUnit: true,
              },
            },
            fuelType: true,
          },
        },
        nonFuelSales: {
          include: {
            product: true,
          },
        },
        customer: true,
        cashier: {
          select: {
            id: true,
            fullName: true,
            username: true,
          },
        },
      },
      orderBy: { saleDate: 'desc' },
    });
    const dedupedSales = this.dedupeLegacyFuelDuplicates(sales);
    const total = dedupedSales.length;
    const pagedSales = dedupedSales.slice(offset, offset + limit);

    return {
      sales: pagedSales,
      pagination: {
        total,
        limit,
        offset,
        pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get sale by ID
   */
  async getSaleById(saleId: string, organizationId: string) {
    const sale = await prisma.sale.findFirst({
      where: {
        id: saleId,
        branch: { organizationId },
      },
      include: {
        branch: true,
        shiftInstance: {
          include: {
            shift: true,
          },
        },
        fuelSales: {
          include: {
            nozzle: {
              include: {
                dispensingUnit: true,
              },
            },
            fuelType: true,
          },
        },
        nonFuelSales: {
          include: {
            product: true,
          },
        },
        customer: true,
        cashier: {
          select: {
            id: true,
            fullName: true,
            username: true,
          },
        },
      },
    });

    if (!sale) {
      throw new AppError(404, 'Sale not found');
    }

    return sale;
  }

  /**
   * Get sales summary
   */
  async getSalesSummary(
    branchId: string,
    organizationId: string,
    filters: {
      shiftInstanceId?: string;
      startDate?: Date;
      endDate?: Date;
    }
  ) {
    // Verify branch belongs to organization
    const branch = await prisma.branch.findFirst({
      where: { id: branchId, organizationId },
    });

    if (!branch) {
      throw new AppError(404, 'Branch not found');
    }

    const { shiftInstanceId, startDate, endDate } = filters;

    const where: Record<string, unknown> = { branchId };

    if (shiftInstanceId) {
      where.shiftInstanceId = shiftInstanceId;
    } else if (startDate || endDate) {
      where.saleDate = {} as Record<string, Date>;
      if (startDate) (where.saleDate as Record<string, Date>).gte = startDate;
      if (endDate) (where.saleDate as Record<string, Date>).lte = endDate;
    }

    const sales = await prisma.sale.findMany({
      where,
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
    });
    const dedupedSales = this.dedupeLegacyFuelDuplicates(sales);

    let totalAmount = 0;
    let fuelLiters = 0;
    let fuelAmount = 0;
    let nonFuelItems = 0;
    let nonFuelAmount = 0;
    const payment = new Map<string, { count: number; amount: number }>();

    for (const sale of dedupedSales) {
      const saleAmount = sale.totalAmount?.toNumber?.() || 0;
      totalAmount += saleAmount;

      const p = payment.get(sale.paymentMethod) || { count: 0, amount: 0 };
      p.count += 1;
      p.amount += saleAmount;
      payment.set(sale.paymentMethod, p);

      for (const fs of sale.fuelSales) {
        fuelLiters += fs.quantityLiters?.toNumber?.() || 0;
        fuelAmount += fs.totalAmount?.toNumber?.() || 0;
      }
      for (const nfs of sale.nonFuelSales) {
        nonFuelItems += nfs.quantity || 0;
        nonFuelAmount += nfs.totalAmount?.toNumber?.() || 0;
      }
    }

    return {
      totalSales: dedupedSales.length,
      totalAmount,
      fuelSales: {
        totalLiters: fuelLiters,
        totalAmount: fuelAmount,
      },
      nonFuelSales: {
        totalItems: nonFuelItems,
        totalAmount: nonFuelAmount,
      },
      paymentBreakdown: Array.from(payment.entries()).map(([method, agg]) => ({
        method,
        count: agg.count,
        amount: agg.amount,
      })),
    };
  }

  /**
   * Get today's sales for a branch (for POS display)
   */
  async getTodaysSales(
    branchId: string,
    organizationId: string,
    startOfDay: Date,
    endOfDay: Date
  ) {
    const sales = await prisma.sale.findMany({
      where: {
        branchId,
        branch: { organizationId },
        saleDate: {
          gte: startOfDay,
          lt: endOfDay,
        },
      },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
          },
        },
        cashier: {
          select: {
            id: true,
            fullName: true,
            username: true,
          },
        },
        fuelSales: {
          include: {
            fuelType: {
              select: {
                name: true,
              },
            },
          },
        },
        nonFuelSales: {
          include: {
            product: {
              select: {
                name: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 50, // Limit to last 50 sales of the day
    });

    return sales.map((sale: any) => ({
      id: sale.id,
      saleType: sale.saleType,
      totalAmount: sale.totalAmount.toNumber(),
      paymentMethod: sale.paymentMethod,
      vehicleNumber: sale.vehicleNumber,
      slipNumber: sale.slipNumber,
      customer: sale.customer,
      cashier: sale.cashier,
      createdAt: sale.createdAt,
      updatedAt: sale.updatedAt,
      items: sale.saleType === 'fuel'
        ? sale.fuelSales.map((fs: any) => ({
            fuelType: fs.fuelType.name,
            quantity: fs.quantityLiters.toNumber(),
            amount: fs.totalAmount.toNumber(),
          }))
        : sale.nonFuelSales.map((nfs: any) => ({
            product: nfs.product.name,
            quantity: nfs.quantity,
            amount: nfs.totalAmount.toNumber(),
          })),
    }));
  }
}
