import { prisma } from '../../config/database';
import { AppError } from '../../middleware/error.middleware';
import { Decimal } from '@prisma/client/runtime/library';
import { CreateFuelSaleInput, CreateNonFuelSaleInput } from './sales.schema';

type CreateFuelSaleData = CreateFuelSaleInput;
type CreateNonFuelSaleData = CreateNonFuelSaleInput;

export class SalesService {
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

    // Verify nozzle exists and is active (only if nozzleId provided)
    // Client removed nozzle selection from POS, so nozzleId is now optional
    if (nozzleId) {
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

    const [sales, total] = await Promise.all([
      prisma.sale.findMany({
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
        take: limit,
        skip: offset,
      }),
      prisma.sale.count({ where }),
    ]);

    return {
      sales,
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

    // Get aggregated data
    const [totalSales, fuelSales, nonFuelSales, paymentBreakdown] = await Promise.all([
      // Total sales count and amount
      prisma.sale.aggregate({
        where,
        _count: true,
        _sum: {
          totalAmount: true,
        },
      }),
      // Fuel sales summary
      prisma.fuelSale.aggregate({
        where: {
          sale: where,
        },
        _sum: {
          quantityLiters: true,
          totalAmount: true,
        },
      }),
      // Non-fuel sales summary
      prisma.nonFuelSale.aggregate({
        where: {
          sale: where,
        },
        _sum: {
          quantity: true,
          totalAmount: true,
        },
      }),
      // Payment method breakdown
      prisma.sale.groupBy({
        by: ['paymentMethod'],
        where,
        _sum: {
          totalAmount: true,
        },
        _count: true,
      }),
    ]);

    return {
      totalSales: totalSales._count,
      totalAmount: totalSales._sum.totalAmount?.toNumber() || 0,
      fuelSales: {
        totalLiters: fuelSales._sum.quantityLiters?.toNumber() || 0,
        totalAmount: fuelSales._sum.totalAmount?.toNumber() || 0,
      },
      nonFuelSales: {
        totalItems: nonFuelSales._sum.quantity || 0,
        totalAmount: nonFuelSales._sum.totalAmount?.toNumber() || 0,
      },
      paymentBreakdown: paymentBreakdown.map(pm => ({
        method: pm.paymentMethod,
        count: pm._count,
        amount: pm._sum.totalAmount?.toNumber() || 0,
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
      createdAt: sale.createdAt,
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
