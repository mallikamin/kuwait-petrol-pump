import { prisma } from '../../config/database';
import { AppError } from '../../middleware/error.middleware';
import { Decimal } from '@prisma/client/runtime/library';
import { CreateBifurcationInput } from './bifurcation.schema';

type CreateBifurcationData = CreateBifurcationInput;

interface BifurcationFilters {
  startDate?: Date;
  endDate?: Date;
  status?: 'pending' | 'completed' | 'verified';
  limit?: number;
  offset?: number;
}

export class BifurcationService {
  /**
   * Create a bifurcation record with daily sales reconciliation
   */
  async createBifurcation(
    data: CreateBifurcationData,
    userId: string,
    organizationId: string
  ) {
    const {
      branchId,
      date,
      shiftInstanceId,
      pmgTotalLiters = 0,
      pmgTotalAmount = 0,
      hsdTotalLiters = 0,
      hsdTotalAmount = 0,
      cashAmount = 0,
      creditAmount = 0,
      cardAmount = 0,
      psoCardAmount = 0,
      expectedTotal = 0,
      actualTotal,
      varianceNotes,
    } = data;

    // Verify branch belongs to organization
    const branch = await prisma.branch.findFirst({
      where: { id: branchId, organizationId },
    });

    if (!branch) {
      throw new AppError(404, 'Branch not found');
    }

    // If shiftInstanceId is provided, verify it exists
    if (shiftInstanceId) {
      const shiftInstance = await prisma.shiftInstance.findFirst({
        where: {
          id: shiftInstanceId,
          branchId,
        },
      });

      if (!shiftInstance) {
        throw new AppError(404, 'Shift instance not found');
      }
    }

    // Check if bifurcation already exists for this date and branch
    const existingBifurcation = await prisma.bifurcation.findFirst({
      where: {
        branchId,
        date: new Date(date),
        shiftInstanceId: shiftInstanceId || null,
      },
    });

    if (existingBifurcation) {
      throw new AppError(409, 'Bifurcation already exists for this date and branch');
    }

    // Calculate variance: actualTotal - expectedTotal
    const variance = actualTotal - expectedTotal;

    // Create bifurcation record
    const bifurcation = await prisma.bifurcation.create({
      data: {
        branchId,
        date: new Date(date),
        shiftInstanceId,
        pmgTotalLiters: pmgTotalLiters ? new Decimal(pmgTotalLiters) : null,
        pmgTotalAmount: pmgTotalAmount ? new Decimal(pmgTotalAmount) : null,
        hsdTotalLiters: hsdTotalLiters ? new Decimal(hsdTotalLiters) : null,
        hsdTotalAmount: hsdTotalAmount ? new Decimal(hsdTotalAmount) : null,
        cashAmount: cashAmount ? new Decimal(cashAmount) : null,
        creditAmount: creditAmount ? new Decimal(creditAmount) : null,
        cardAmount: cardAmount ? new Decimal(cardAmount) : null,
        psoCardAmount: psoCardAmount ? new Decimal(psoCardAmount) : null,
        expectedTotal: expectedTotal ? new Decimal(expectedTotal) : null,
        actualTotal: new Decimal(actualTotal),
        variance: new Decimal(variance),
        varianceNotes,
        bifurcatedBy: userId,
        bifurcatedAt: new Date(),
        status: 'completed',
      },
      include: {
        branch: true,
        shiftInstance: {
          include: {
            shift: true,
          },
        },
        bifurcatedByUser: {
          select: {
            id: true,
            fullName: true,
            username: true,
          },
        },
      },
    });

    return bifurcation;
  }

  /**
   * Get bifurcation for a specific date and branch
   */
  async getBifurcationByDate(branchId: string, date: Date, organizationId: string) {
    const bifurcation = await prisma.bifurcation.findFirst({
      where: {
        branchId,
        date: new Date(date),
        branch: { organizationId },
      },
      include: {
        branch: true,
        shiftInstance: {
          include: {
            shift: true,
          },
        },
        bifurcatedByUser: {
          select: {
            id: true,
            fullName: true,
            username: true,
          },
        },
      },
    });

    if (!bifurcation) {
      throw new AppError(404, 'Bifurcation not found for the specified date');
    }

    return bifurcation;
  }

  /**
   * Verify a bifurcation record (mark as verified)
   */
  async verifyBifurcation(bifurcationId: string, organizationId: string) {
    const bifurcation = await prisma.bifurcation.findFirst({
      where: {
        id: bifurcationId,
        branch: { organizationId },
      },
    });

    if (!bifurcation) {
      throw new AppError(404, 'Bifurcation not found');
    }

    const verified = await prisma.bifurcation.update({
      where: { id: bifurcationId },
      data: {
        status: 'verified',
      },
      include: {
        branch: true,
        shiftInstance: {
          include: {
            shift: true,
          },
        },
        bifurcatedByUser: {
          select: {
            id: true,
            fullName: true,
            username: true,
          },
        },
      },
    });

    return verified;
  }

  /**
   * Get pending bifurcations for a branch
   */
  async getPendingBifurcations(branchId: string, organizationId: string) {
    const branch = await prisma.branch.findFirst({
      where: { id: branchId, organizationId },
    });

    if (!branch) {
      throw new AppError(404, 'Branch not found');
    }

    const pendingBifurcations = await prisma.bifurcation.findMany({
      where: {
        branchId,
        status: { in: ['pending', 'completed'] },
      },
      include: {
        branch: true,
        shiftInstance: {
          include: {
            shift: true,
          },
        },
        bifurcatedByUser: {
          select: {
            id: true,
            fullName: true,
            username: true,
          },
        },
      },
      orderBy: { date: 'desc' },
    });

    return pendingBifurcations;
  }

  /**
   * Get bifurcation history with filters
   */
  async getBifurcationHistory(
    branchId: string,
    organizationId: string,
    filters: BifurcationFilters = {}
  ) {
    const {
      startDate,
      endDate,
      status,
      limit = 50,
      offset = 0,
    } = filters;

    const branch = await prisma.branch.findFirst({
      where: { id: branchId, organizationId },
    });

    if (!branch) {
      throw new AppError(404, 'Branch not found');
    }

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

    const [bifurcations, total] = await Promise.all([
      prisma.bifurcation.findMany({
        where,
        include: {
          branch: true,
          shiftInstance: {
            include: {
              shift: true,
            },
          },
          bifurcatedByUser: {
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
      prisma.bifurcation.count({ where }),
    ]);

    return {
      bifurcations,
      pagination: {
        total,
        limit,
        offset,
        pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get bifurcation by ID
   */
  async getBifurcationById(bifurcationId: string, organizationId: string) {
    const bifurcation = await prisma.bifurcation.findFirst({
      where: {
        id: bifurcationId,
        branch: { organizationId },
      },
      include: {
        branch: true,
        shiftInstance: {
          include: {
            shift: true,
          },
        },
        bifurcatedByUser: {
          select: {
            id: true,
            fullName: true,
            username: true,
          },
        },
      },
    });

    if (!bifurcation) {
      throw new AppError(404, 'Bifurcation not found');
    }

    return bifurcation;
  }

  /**
   * Get daily sales summary for bifurcation
   * Auto-fetches sales data from fuel_sales table
   */
  async getDailySalesSummary(branchId: string, date: string, organizationId: string) {
    // Verify branch belongs to organization
    const branch = await prisma.branch.findFirst({
      where: { id: branchId, organizationId },
    });

    if (!branch) {
      throw new AppError(404, 'Branch not found');
    }

    // Parse date and create start/end range for the day
    const targetDate = new Date(date);
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    // Get all fuel sales for the date with payment method from Sale
    const fuelSales = await prisma.fuelSale.findMany({
      where: {
        sale: {
          branchId,
          saleDate: {
            gte: startOfDay,
            lte: endOfDay,
          },
        },
      },
      include: {
        sale: {
          select: {
            paymentMethod: true,
            totalAmount: true,
          },
        },
        fuelType: {
          select: {
            code: true,
          },
        },
      },
    });

    // Initialize summary
    let pmgTotalLiters = 0;
    let pmgTotalAmount = 0;
    let hsdTotalLiters = 0;
    let hsdTotalAmount = 0;
    let cashAmount = 0;
    let creditAmount = 0;
    let cardAmount = 0; // Bank cards
    let psoCardAmount = 0;

    // Process each fuel sale
    for (const fuelSale of fuelSales) {
      const liters = parseFloat(fuelSale.quantityLiters.toString());
      const amount = parseFloat(fuelSale.totalAmount.toString());
      const fuelCode = fuelSale.fuelType.code;
      const paymentMethod = fuelSale.sale.paymentMethod;

      // Sum by fuel type
      if (fuelCode === 'PMG') {
        pmgTotalLiters += liters;
        pmgTotalAmount += amount;
      } else if (fuelCode === 'HSD') {
        hsdTotalLiters += liters;
        hsdTotalAmount += amount;
      }

      // Sum by payment method
      if (paymentMethod === 'cash') {
        cashAmount += amount;
      } else if (paymentMethod === 'credit') {
        creditAmount += amount;
      } else if (paymentMethod === 'card') {
        cardAmount += amount;
      } else if (paymentMethod === 'pso_card') {
        psoCardAmount += amount;
      }
    }

    // Calculate expected total
    const expectedTotal = cashAmount + creditAmount + cardAmount + psoCardAmount;

    return {
      date,
      branchId,
      pmgTotalLiters: Number(pmgTotalLiters.toFixed(2)),
      pmgTotalAmount: Number(pmgTotalAmount.toFixed(2)),
      hsdTotalLiters: Number(hsdTotalLiters.toFixed(2)),
      hsdTotalAmount: Number(hsdTotalAmount.toFixed(2)),
      cashAmount: Number(cashAmount.toFixed(2)),
      creditAmount: Number(creditAmount.toFixed(2)),
      cardAmount: Number(cardAmount.toFixed(2)),
      psoCardAmount: Number(psoCardAmount.toFixed(2)),
      expectedTotal: Number(expectedTotal.toFixed(2)),
      totalSalesCount: fuelSales.length,
    };
  }
}
