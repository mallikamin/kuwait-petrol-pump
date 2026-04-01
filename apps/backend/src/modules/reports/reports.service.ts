import { prisma } from '../../config/database';
import { AppError } from '../../middleware/error.middleware';

export class ReportsService {
  /**
   * Get daily sales report with breakdown by type, fuel type, and payment method
   */
  async getDailySalesReport(branchId: string, date: Date, organizationId: string) {
    // Verify branch belongs to organization
    const branch = await prisma.branch.findFirst({
      where: { id: branchId, organizationId },
    });

    if (!branch) {
      throw new AppError(404, 'Branch not found');
    }

    // Set date range for the day
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    // Get all sales for the day
    const sales = await prisma.sale.findMany({
      where: {
        branchId,
        saleDate: {
          gte: startOfDay,
          lte: endOfDay,
        },
      },
      include: {
        fuelSales: {
          include: {
            fuelType: true,
            nozzle: true,
          },
        },
        nonFuelSales: {
          include: {
            product: true,
          },
        },
        shiftInstance: {
          include: {
            shift: true,
          },
        },
      },
    });

    // Aggregate data
    let totalFuelAmount = 0;
    let totalNonFuelAmount = 0;
    const fuelByType: { [key: string]: { liters: number; amount: number } } = {};
    const paymentBreakdown: { [key: string]: { count: number; amount: number } } = {};
    const shiftBreakdown: { [key: string]: { count: number; amount: number } } = {};

    for (const sale of sales) {
      // Fuel sales breakdown
      if (sale.saleType === 'fuel') {
        const amount = sale.totalAmount.toNumber();
        totalFuelAmount += amount;

        for (const fuelSale of sale.fuelSales) {
          const fuelTypeName = fuelSale.fuelType.name;
          if (!fuelByType[fuelTypeName]) {
            fuelByType[fuelTypeName] = { liters: 0, amount: 0 };
          }
          fuelByType[fuelTypeName].liters += fuelSale.quantityLiters.toNumber();
          fuelByType[fuelTypeName].amount += fuelSale.totalAmount.toNumber();
        }
      }

      // Non-fuel sales breakdown
      if (sale.saleType === 'non_fuel') {
        totalNonFuelAmount += sale.totalAmount.toNumber();
      }

      // Payment method breakdown
      const method = sale.paymentMethod;
      if (!paymentBreakdown[method]) {
        paymentBreakdown[method] = { count: 0, amount: 0 };
      }
      paymentBreakdown[method].count += 1;
      paymentBreakdown[method].amount += sale.totalAmount.toNumber();

      // Shift-wise breakdown
      if (sale.shiftInstance) {
        const shiftName = `${sale.shiftInstance.shift.name} (${sale.shiftInstance.date.toLocaleDateString()})`;
        if (!shiftBreakdown[shiftName]) {
          shiftBreakdown[shiftName] = { count: 0, amount: 0 };
        }
        shiftBreakdown[shiftName].count += 1;
        shiftBreakdown[shiftName].amount += sale.totalAmount.toNumber();
      }
    }

    return {
      date,
      branch: {
        id: branch.id,
        name: branch.name,
      },
      totalSales: sales.length,
      summary: {
        totalAmount: totalFuelAmount + totalNonFuelAmount,
        totalTransactions: sales.length,
        fuel: {
          amount: totalFuelAmount,
          count: sales.filter(s => s.saleType === 'fuel').length,
          byType: fuelByType,
        },
        nonFuel: {
          amount: totalNonFuelAmount,
          count: sales.filter(s => s.saleType === 'non_fuel').length,
        },
      },
      paymentMethodBreakdown: Object.entries(paymentBreakdown).map(([method, data]) => ({
        paymentMethod: method,
        ...data,
      })),
      shiftBreakdown: Object.entries(shiftBreakdown).map(([name, data]) => ({
        name,
        ...data,
      })),
    };
  }

  /**
   * Get detailed shift report with meter readings and sales summary
   */
  async getShiftReport(shiftInstanceId: string, organizationId: string) {
    // Verify shift instance belongs to organization
    const shiftInstance = await prisma.shiftInstance.findFirst({
      where: {
        id: shiftInstanceId,
        branch: {
          organizationId,
        },
      },
      include: {
        shift: true,
        branch: true,
        openedByUser: {
          select: {
            id: true,
            fullName: true,
            username: true,
          },
        },
        closedByUser: {
          select: {
            id: true,
            fullName: true,
            username: true,
          },
        },
      },
    });

    if (!shiftInstance) {
      throw new AppError(404, 'Shift instance not found');
    }

    // Get meter readings for this shift
    const meterReadings = await prisma.meterReading.findMany({
      where: { shiftInstanceId },
      include: {
        nozzle: {
          include: {
            fuelType: true,
            dispensingUnit: true,
          },
        },
        recordedByUser: {
          select: {
            id: true,
            fullName: true,
            username: true,
          },
        },
      },
      orderBy: [
        { nozzle: { dispensingUnit: { unitNumber: 'asc' } } },
        { nozzle: { nozzleNumber: 'asc' } },
        { readingType: 'asc' },
      ],
    });

    // Calculate meter variance for each nozzle
    type NozzleReadingData = {
      nozzle: typeof meterReadings[0]['nozzle'];
      opening: typeof meterReadings[0] | null;
      closing: typeof meterReadings[0] | null;
    };
    const nozzleReadings: Record<string, NozzleReadingData> = {};
    for (const reading of meterReadings) {
      const nozzleKey = `${reading.nozzle.dispensingUnit.unitNumber}-${reading.nozzle.nozzleNumber}`;
      if (!nozzleReadings[nozzleKey]) {
        nozzleReadings[nozzleKey] = {
          nozzle: reading.nozzle,
          opening: null,
          closing: null,
        };
      }
      if (reading.readingType === 'opening') {
        nozzleReadings[nozzleKey].opening = reading;
      } else {
        nozzleReadings[nozzleKey].closing = reading;
      }
    }

    // Get sales summary for the shift
    const sales = await prisma.sale.findMany({
      where: { shiftInstanceId },
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

    // Get actual sales for each nozzle during this shift
    const salesByNozzle: Record<string, number> = {};
    for (const sale of sales) {
      if (sale.saleType === 'fuel') {
        for (const fuelSale of sale.fuelSales) {
          const nozzleKey = fuelSale.nozzleId || '';
          if (!salesByNozzle[nozzleKey]) {
            salesByNozzle[nozzleKey] = 0;
          }
          salesByNozzle[nozzleKey] += fuelSale.quantityLiters.toNumber();
        }
      }
    }

    // Calculate variances: (closing - opening) - actual_sales
    const meterVariances = Object.values(nozzleReadings).map((data) => {
      const opening = data.opening ? parseFloat(data.opening.meterValue.toString()) : null;
      const closing = data.closing ? parseFloat(data.closing.meterValue.toString()) : null;
      const meterDifference = opening !== null && closing !== null ? closing - opening : null;
      const actualSales = salesByNozzle[data.nozzle.id] || 0;
      const variance = meterDifference !== null ? meterDifference - actualSales : null;

      return {
        nozzle: {
          id: data.nozzle.id,
          unitNumber: data.nozzle.dispensingUnit.unitNumber,
          nozzleNumber: data.nozzle.nozzleNumber,
          fuelType: data.nozzle.fuelType.name,
        },
        openingReading: data.opening ? {
          value: parseFloat(data.opening.meterValue.toString()),
          recordedBy: data.opening.recordedByUser,
          recordedAt: data.opening.recordedAt,
        } : null,
        closingReading: data.closing ? {
          value: parseFloat(data.closing.meterValue.toString()),
          recordedBy: data.closing.recordedByUser,
          recordedAt: data.closing.recordedAt,
        } : null,
        meterDifference,
        actualSales,
        variance,
      };
    });

    let totalSalesAmount = 0;
    let fuelSalesAmount = 0;
    let nonFuelSalesAmount = 0;
    const paymentBreakdown: { [key: string]: { count: number; amount: number } } = {};
    const fuelByType: { [key: string]: { liters: number; amount: number } } = {};

    for (const sale of sales) {
      totalSalesAmount += sale.totalAmount.toNumber();

      if (sale.saleType === 'fuel') {
        fuelSalesAmount += sale.totalAmount.toNumber();
        for (const fuelSale of sale.fuelSales) {
          const fuelTypeName = fuelSale.fuelType.name;
          if (!fuelByType[fuelTypeName]) {
            fuelByType[fuelTypeName] = { liters: 0, amount: 0 };
          }
          fuelByType[fuelTypeName].liters += fuelSale.quantityLiters.toNumber();
          fuelByType[fuelTypeName].amount += fuelSale.totalAmount.toNumber();
        }
      }

      if (sale.saleType === 'non_fuel') {
        nonFuelSalesAmount += sale.totalAmount.toNumber();
      }

      const method = sale.paymentMethod;
      if (!paymentBreakdown[method]) {
        paymentBreakdown[method] = { count: 0, amount: 0 };
      }
      paymentBreakdown[method].count += 1;
      paymentBreakdown[method].amount += sale.totalAmount.toNumber();
    }

    return {
      shiftInstance: {
        id: shiftInstance.id,
        shiftName: shiftInstance.shift.name,
        date: shiftInstance.date,
        status: shiftInstance.status,
        openedAt: shiftInstance.openedAt,
        closedAt: shiftInstance.closedAt,
        openedBy: shiftInstance.openedByUser,
        closedBy: shiftInstance.closedByUser,
        notes: shiftInstance.notes,
      },
      branch: {
        id: shiftInstance.branch.id,
        name: shiftInstance.branch.name,
      },
      meterReadings: {
        count: meterReadings.length,
        variance: meterVariances,
      },
      sales: {
        totalCount: sales.length,
        totalAmount: totalSalesAmount,
        fuel: {
          count: sales.filter(s => s.saleType === 'fuel').length,
          amount: fuelSalesAmount,
          byType: fuelByType,
        },
        nonFuel: {
          count: sales.filter(s => s.saleType === 'non_fuel').length,
          amount: nonFuelSalesAmount,
        },
        paymentBreakdown,
      },
    };
  }

  /**
   * Get variance report for meter readings across a date range
   */
  async getVarianceReport(
    branchId: string,
    startDate: Date,
    endDate: Date,
    organizationId: string
  ) {
    // Verify branch belongs to organization
    const branch = await prisma.branch.findFirst({
      where: { id: branchId, organizationId },
    });

    if (!branch) {
      throw new AppError(404, 'Branch not found');
    }

    // Get all meter readings for the branch within date range
    const meterReadings = await prisma.meterReading.findMany({
      where: {
        shiftInstance: {
          branchId,
          date: {
            gte: startDate,
            lte: endDate,
          },
        },
      },
      include: {
        nozzle: {
          include: {
            fuelType: true,
            dispensingUnit: true,
          },
        },
        shiftInstance: {
          include: {
            shift: true,
          },
        },
      },
      orderBy: [
        { shiftInstance: { date: 'asc' } },
        { nozzle: { dispensingUnit: { unitNumber: 'asc' } } },
        { nozzle: { nozzleNumber: 'asc' } },
      ],
    });

    // Group by shift and nozzle
    type NozzleData = {
      nozzle: { id: string; unitNumber: number; nozzleNumber: number; fuelType: string };
      opening: number | null;
      closing: number | null;
    };
    type ShiftVarianceData = {
      shiftInstance: { id: string; date: Date; shiftName: string };
      nozzles: Record<string, NozzleData>;
    };
    const shiftVariances: Record<string, ShiftVarianceData> = {};

    for (const reading of meterReadings) {
      const shiftKey = reading.shiftInstanceId;
      const nozzleKey = `${reading.nozzle.dispensingUnit.unitNumber}-${reading.nozzle.nozzleNumber}`;

      if (!shiftVariances[shiftKey]) {
        shiftVariances[shiftKey] = {
          shiftInstance: {
            id: reading.shiftInstance.id,
            date: reading.shiftInstance.date,
            shiftName: reading.shiftInstance.shift.name,
          },
          nozzles: {},
        };
      }

      if (!shiftVariances[shiftKey].nozzles[nozzleKey]) {
        shiftVariances[shiftKey].nozzles[nozzleKey] = {
          nozzle: {
            id: reading.nozzle.id,
            unitNumber: reading.nozzle.dispensingUnit.unitNumber,
            nozzleNumber: reading.nozzle.nozzleNumber,
            fuelType: reading.nozzle.fuelType.name,
          },
          opening: null,
          closing: null,
        };
      }

      if (reading.readingType === 'opening') {
        shiftVariances[shiftKey].nozzles[nozzleKey].opening = parseFloat(
          reading.meterValue.toString()
        );
      } else {
        shiftVariances[shiftKey].nozzles[nozzleKey].closing = parseFloat(
          reading.meterValue.toString()
        );
      }
    }

    // Get actual sales per shift per nozzle
    const salesByShiftNozzle: Record<string, Record<string, number>> = {};
    const shiftsWithSales = await prisma.sale.findMany({
      where: {
        shiftInstanceId: { in: Object.keys(shiftVariances) },
        saleType: 'fuel',
      },
      include: {
        fuelSales: true,
      },
    });

    for (const sale of shiftsWithSales) {
      if (!salesByShiftNozzle[sale.shiftInstanceId]) {
        salesByShiftNozzle[sale.shiftInstanceId] = {};
      }
      for (const fuelSale of sale.fuelSales) {
        const nozzleId = fuelSale.nozzleId || '';
        if (!salesByShiftNozzle[sale.shiftInstanceId][nozzleId]) {
          salesByShiftNozzle[sale.shiftInstanceId][nozzleId] = 0;
        }
        salesByShiftNozzle[sale.shiftInstanceId][nozzleId] += fuelSale.quantityLiters.toNumber();
      }
    }

    // Calculate variances: (closing - opening) - actual_sales
    const report = Object.values(shiftVariances).map((shift) => {
      const shiftSales = salesByShiftNozzle[shift.shiftInstance.id] || {};

      const nozzleVariances = Object.values(shift.nozzles).map((nozzle) => {
        const meterDifference =
          nozzle.opening !== null && nozzle.closing !== null
            ? nozzle.closing - nozzle.opening
            : null;
        const actualSales = shiftSales[nozzle.nozzle.id] || 0;
        const variance = meterDifference !== null ? meterDifference - actualSales : null;

        return {
          ...nozzle,
          meterDifference,
          actualSales,
          variance,
        };
      });

      const totalVariance = nozzleVariances.reduce((sum, n) => {
        return sum + ((n.variance as number) || 0);
      }, 0);

      return {
        shift: shift.shiftInstance,
        nozzles: nozzleVariances,
        totalVariance,
      };
    });

    return {
      branch: {
        id: branch.id,
        name: branch.name,
      },
      dateRange: {
        startDate,
        endDate,
      },
      shifts: report,
    };
  }

  /**
   * Get customer ledger with transaction history
   */
  async getCustomerLedgerReport(
    customerId: string,
    startDate: Date,
    endDate: Date,
    organizationId: string
  ) {
    // Verify customer belongs to organization
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, organizationId },
    });

    if (!customer) {
      throw new AppError(404, 'Customer not found');
    }

    // Get all sales for this customer within date range
    const sales = await prisma.sale.findMany({
      where: {
        customerId,
        saleDate: {
          gte: startDate,
          lte: endDate,
        },
      },
      include: {
        branch: true,
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
        shiftInstance: {
          include: {
            shift: true,
          },
        },
        cashier: {
          select: {
            id: true,
            fullName: true,
            username: true,
          },
        },
      },
      orderBy: { saleDate: 'asc' },
    });

    // Calculate running balance and aggregate
    let totalAmount = 0;
    const transactions = sales.map(sale => {
      totalAmount += sale.totalAmount.toNumber();
      return {
        id: sale.id,
        date: sale.saleDate,
        type: sale.saleType,
        amount: sale.totalAmount.toNumber(),
        paymentMethod: sale.paymentMethod,
        branch: {
          id: sale.branch.id,
          name: sale.branch.name,
        },
        shift: sale.shiftInstance ? {
          id: sale.shiftInstance.id,
          name: sale.shiftInstance.shift.name,
          date: sale.shiftInstance.date,
        } : null,
        cashier: sale.cashier,
        details:
          sale.saleType === 'fuel'
            ? {
                fuelSales: sale.fuelSales.map(fs => ({
                  fuelType: fs.fuelType.name,
                  liters: fs.quantityLiters.toNumber(),
                  amount: fs.totalAmount.toNumber(),
                })),
              }
            : {
                items: sale.nonFuelSales.map(nfs => ({
                  productName: nfs.product.name,
                  quantity: nfs.quantity,
                  unitPrice: nfs.unitPrice.toNumber(),
                  amount: nfs.totalAmount.toNumber(),
                })),
              },
      };
    });

    return {
      customer: {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        email: customer.email,
      },
      dateRange: {
        startDate,
        endDate,
      },
      summary: {
        totalTransactions: sales.length,
        totalAmount,
      },
      transactions,
    };
  }

  /**
   * Get inventory report with current stock levels and low-stock alerts
   */
  async getInventoryReport(branchId: string, organizationId: string) {
    // Verify branch belongs to organization
    const branch = await prisma.branch.findFirst({
      where: { id: branchId, organizationId },
    });

    if (!branch) {
      throw new AppError(404, 'Branch not found');
    }

    // Get all products and their stock levels for this branch
    const stockLevels = await prisma.stockLevel.findMany({
      where: { branchId },
      include: {
        product: true,
      },
    });

    // Get all fuel types and their availability
    const fuelTypes = await prisma.fuelType.findMany({
      include: {
        nozzles: {
          where: {
            dispensingUnit: {
              branchId,
            },
            isActive: true,
          },
          include: {
            dispensingUnit: true,
          },
        },
      },
    });

    // Categorize products
    const lowStockProducts = stockLevels.filter(
      sl => sl.quantity < (sl.product.lowStockThreshold || 0)
    );
    const normalStockProducts = stockLevels.filter(
      sl => sl.quantity >= (sl.product.lowStockThreshold || 0)
    );

    // Calculate totals
    const totalItems = stockLevels.length;
    const totalQuantity = stockLevels.reduce((sum, sl) => sum + sl.quantity, 0);
    const lowStockCount = lowStockProducts.length;

    return {
      branch: {
        id: branch.id,
        name: branch.name,
      },
      summary: {
        totalItems,
        totalQuantity,
        lowStockCount,
        lowStockPercentage: ((lowStockCount / totalItems) * 100).toFixed(2),
      },
      nonFuelProducts: {
        normal: normalStockProducts.map(sl => ({
          id: sl.product.id,
          sku: sl.product.sku,
          name: sl.product.name,
          category: sl.product.category,
          quantity: sl.quantity,
          unitPrice: sl.product.unitPrice.toNumber(),
          threshold: sl.product.lowStockThreshold,
        })),
        lowStock: lowStockProducts.map(sl => ({
          id: sl.product.id,
          sku: sl.product.sku,
          name: sl.product.name,
          category: sl.product.category,
          quantity: sl.quantity,
          unitPrice: sl.product.unitPrice.toNumber(),
          threshold: sl.product.lowStockThreshold,
          shortage: (sl.product.lowStockThreshold || 0) - sl.quantity,
        })),
      },
      fuelAvailability: fuelTypes.map(ft => ({
        id: ft.id,
        name: ft.name,
        code: ft.code,
        nozzleCount: ft.nozzles.length,
        isAvailable: ft.nozzles.length > 0,
        nozzles: ft.nozzles.map(n => ({
          id: n.id,
          unitNumber: n.dispensingUnit?.unitNumber,
          nozzleNumber: n.nozzleNumber,
        })),
      })),
    };
  }
}
