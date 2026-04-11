import { prisma } from '../../config/database';
import { AppError } from '../../middleware/error.middleware';

export class ReportsService {
  /**
   * Get daily sales report with breakdown by type, fuel type, and payment method
   * Supports both single date and date range filtering
   */
  async getDailySalesReport(branchId: string, startDate: Date, endDate: Date, organizationId: string) {
    // Verify branch belongs to organization
    const branch = await prisma.branch.findFirst({
      where: { id: branchId, organizationId },
    });

    if (!branch) {
      throw new AppError(404, 'Branch not found');
    }

    // Get all sales for the date range
    const sales = await prisma.sale.findMany({
      where: {
        branchId,
        saleDate: {
          gte: startDate,
          lte: endDate,
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

    // Shift-wise fuel breakdown: Key format "ShiftName|FuelType"
    type ShiftFuelKey = string;
    const shiftFuelBreakdown: {
      [key: ShiftFuelKey]: {
        shiftName: string;
        fuelType: string;
        liters: number;
        amount: number;
        count: number;
        isUnassigned?: boolean;
      }
    } = {};

    // Product Variant × Payment Type breakdown
    type VariantPaymentKey = string; // Format: "HSD|Cash", "PMG|Credit", "NonFuel|Card"
    const variantPaymentBreakdown: {
      [key: VariantPaymentKey]: {
        variant: string;
        paymentMethod: string;
        count: number;
        amount: number;
        liters?: number
      }
    } = {};

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

          // Product variant × payment type tracking
          const variantKey = `${fuelTypeName}|${sale.paymentMethod}`;
          if (!variantPaymentBreakdown[variantKey]) {
            variantPaymentBreakdown[variantKey] = {
              variant: fuelTypeName,
              paymentMethod: sale.paymentMethod,
              count: 0,
              amount: 0,
              liters: 0,
            };
          }
          variantPaymentBreakdown[variantKey].count += 1;
          variantPaymentBreakdown[variantKey].amount += fuelSale.totalAmount.toNumber();
          variantPaymentBreakdown[variantKey].liters! += fuelSale.quantityLiters.toNumber();

          // Shift-wise fuel type breakdown
          let shiftName: string;
          let isUnassigned = false;
          if (sale.shiftInstance) {
            shiftName = sale.shiftInstance.shift.name;
          } else {
            // Fallback for unassigned sales: attribute based on sale time
            // Morning: 00:00-12:00, Evening: 12:01-23:59
            const saleHour = sale.saleDate.getHours();
            shiftName = `${saleHour < 12 ? 'Morning' : 'Evening'} (Unassigned)`;
            isUnassigned = true;
          }

          const shiftFuelKey = `${shiftName}|${fuelTypeName}`;
          if (!shiftFuelBreakdown[shiftFuelKey]) {
            shiftFuelBreakdown[shiftFuelKey] = {
              shiftName,
              fuelType: fuelTypeName,
              liters: 0,
              amount: 0,
              count: 0,
              isUnassigned,
            };
          }
          shiftFuelBreakdown[shiftFuelKey].liters += fuelSale.quantityLiters.toNumber();
          shiftFuelBreakdown[shiftFuelKey].amount += fuelSale.totalAmount.toNumber();
          shiftFuelBreakdown[shiftFuelKey].count += 1;
        }
      }

      // Non-fuel sales breakdown
      if (sale.saleType === 'non_fuel') {
        totalNonFuelAmount += sale.totalAmount.toNumber();

        // Non-fuel variant × payment type tracking
        const variantKey = `Non-Fuel|${sale.paymentMethod}`;
        if (!variantPaymentBreakdown[variantKey]) {
          variantPaymentBreakdown[variantKey] = {
            variant: 'Non-Fuel',
            paymentMethod: sale.paymentMethod,
            count: 0,
            amount: 0,
          };
        }
        variantPaymentBreakdown[variantKey].count += 1;
        variantPaymentBreakdown[variantKey].amount += sale.totalAmount.toNumber();
      }

      // Payment method breakdown
      const method = sale.paymentMethod;
      if (!paymentBreakdown[method]) {
        paymentBreakdown[method] = { count: 0, amount: 0 };
      }
      paymentBreakdown[method].count += 1;
      paymentBreakdown[method].amount += sale.totalAmount.toNumber();

      // Shift-wise breakdown
      let shiftName: string;
      if (sale.shiftInstance) {
        // Sale explicitly assigned to a shift
        shiftName = `${sale.shiftInstance.shift.name} (${sale.shiftInstance.date.toLocaleDateString()})`;
      } else {
        // Fallback for unassigned sales: attribute based on sale time
        // Morning: 00:00-12:00, Evening: 12:01-23:59
        const saleHour = sale.saleDate.getHours();
        const shiftType = saleHour < 12 ? 'Morning' : 'Evening';
        const saleDay = sale.saleDate.toLocaleDateString();
        shiftName = `${shiftType} (Unassigned) - ${saleDay}`;
      }

      if (!shiftBreakdown[shiftName]) {
        shiftBreakdown[shiftName] = { count: 0, amount: 0 };
      }
      shiftBreakdown[shiftName].count += 1;
      shiftBreakdown[shiftName].amount += sale.totalAmount.toNumber();
    }

    return {
      dateRange: {
        startDate,
        endDate,
        isSingleDay: startDate.toDateString() === endDate.toDateString(),
      },
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
      // NEW: Shift-wise Fuel Type Breakdown
      shiftFuelBreakdown: Object.values(shiftFuelBreakdown),
      // NEW: Product Variant × Payment Type Breakdown
      variantPaymentBreakdown: Object.values(variantPaymentBreakdown),
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
    let runningBalance = 0;
    const transactions = sales.map(sale => {
      const saleAmount = sale.totalAmount.toNumber();
      runningBalance += saleAmount;

      return {
        id: sale.id,
        slipNumber: sale.id.substring(0, 8).toUpperCase(), // Short slip number from ID
        date: sale.saleDate,
        type: sale.saleType,
        amount: saleAmount,
        paymentMethod: sale.paymentMethod,
        vehicleNumber: sale.vehicleNumber || null, // Include vehicle number for each transaction
        runningBalance,
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
                  pricePerLiter: fs.pricePerLiter.toNumber(),
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
        vehicleNumbers: customer.vehicleNumbers || [],
      },
      dateRange: {
        startDate,
        endDate,
      },
      summary: {
        totalTransactions: sales.length,
        totalAmount: runningBalance,
      },
      transactions,
    };
  }

  /**
   * Get inventory report with current stock levels, low-stock alerts, and purchases received
   */
  async getInventoryReport(branchId: string, organizationId: string, asOfDate?: string, startDate?: string, endDate?: string) {
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

    // Get purchases received (stock receipts with items)
    let purchases: any[] = [];
    try {
      // Determine date filter precedence:
      // 1. If startDate/endDate provided => range mode
      // 2. Else if asOfDate provided => single-date mode
      // 3. Else => no filter (all purchases)
      let dateFilter: any = null;
      if (startDate && endDate) {
        // Range mode: inclusive of both start and end dates
        const rangeStart = new Date(startDate);
        rangeStart.setHours(0, 0, 0, 0); // Start of day
        const rangeEnd = new Date(endDate);
        rangeEnd.setHours(23, 59, 59, 999); // End of day
        dateFilter = {
          gte: rangeStart,
          lte: rangeEnd,
        };
      } else if (asOfDate) {
        // Single-date mode: up to and including the specified date
        const asOfDateObj = new Date(asOfDate);
        asOfDateObj.setHours(23, 59, 59, 999); // End of that day
        dateFilter = {
          lte: asOfDateObj,
        };
      }
      // else: dateFilter remains null (no date filter)

      // Query 1: Get all stock receipts (items received with receipt form)
      const purchaseWhere: any = {
        purchaseOrder: {
          branchId,
        },
      };

      if (dateFilter) {
        purchaseWhere.receiptDate = dateFilter;
      }

      const stockReceipts = await prisma.stockReceipt.findMany({
        where: purchaseWhere,
        include: {
          purchaseOrder: {
            include: {
              supplier: true,
              items: {
                include: {
                  product: true,
                  fuelType: true,
                },
              },
            },
          },
          receivedByUser: {
            select: {
              id: true,
              fullName: true,
              username: true,
            },
          },
        },
        orderBy: {
          receiptDate: 'desc',
        },
      });

      // Transform stock receipts for display
      const stockReceiptPurchases = stockReceipts.flatMap(receipt =>
        receipt.purchaseOrder.items.map(item => ({
          poNumber: receipt.purchaseOrder.poNumber,
          receiptNumber: receipt.receiptNumber,
          id: item.id,
          name: item.product?.name || item.fuelType?.name || 'Unknown',
          sku: item.product?.sku || '',
          supplierName: receipt.purchaseOrder.supplier?.name,
          quantityReceived: parseFloat(item.quantityReceived.toString()),
          costPerUnit: parseFloat(item.costPerUnit.toString()),
          totalCost: parseFloat(item.totalCost.toString()),
          receiptDate: receipt.receiptDate,
          status: 'received_with_receipt',
          receivedBy: receipt.receivedByUser?.fullName || 'Unknown',
          receivedByUsername: receipt.receivedByUser?.username,
        }))
      );

      // Query 2: Get PurchaseOrders with status='received' that might not have stock receipts yet
      const poWhere: any = {
        branchId,
        status: 'received',
      };

      if (dateFilter) {
        poWhere.receivedDate = dateFilter;
      }

      const receivedPos = await prisma.purchaseOrder.findMany({
        where: poWhere,
        include: {
          supplier: true,
          items: {
            include: {
              product: true,
              fuelType: true,
            },
          },
        },
        orderBy: {
          receivedDate: 'desc',
        },
      });

      // Transform received POs for display (exclude those already in stock receipts)
      const poNumbers = new Set(stockReceipts.map(r => r.purchaseOrder.poNumber));
      const receivedPoPurchases = receivedPos
        .filter(po => !poNumbers.has(po.poNumber))
        .flatMap(po =>
          po.items.map(item => ({
            poNumber: po.poNumber,
            receiptNumber: null,
            id: item.id,
            name: item.product?.name || item.fuelType?.name || 'Unknown',
            sku: item.product?.sku || '',
            supplierName: po.supplier?.name,
            quantityReceived: parseFloat(item.quantityReceived.toString()),
            costPerUnit: parseFloat(item.costPerUnit.toString()),
            totalCost: parseFloat(item.totalCost.toString()),
            receiptDate: po.receivedDate,
            status: 'received_no_receipt',
            receivedBy: 'Pending Receipt Form',
            receivedByUsername: null,
          }))
        );

      // Combine both sources and sort by date
      purchases = [...stockReceiptPurchases, ...receivedPoPurchases].sort(
        (a, b) => new Date(b.receiptDate).getTime() - new Date(a.receiptDate).getTime()
      );
    } catch (error) {
      // If purchases query fails, continue without purchases data
      console.warn('[Inventory Report] Failed to fetch purchases:', error);
      purchases = [];
    }

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

    // Calculate total value
    const totalValue = stockLevels.reduce(
      (sum, sl) => sum + (sl.quantity * sl.product.unitPrice.toNumber()),
      0
    );

    return {
      branch: {
        id: branch.id,
        name: branch.name,
      },
      asOfDate: asOfDate || new Date().toISOString(),
      summary: {
        totalProducts: totalItems,
        totalQuantity,
        lowStockCount,
        lowStockPercentage: ((lowStockCount / totalItems) * 100).toFixed(2),
        totalValue: totalValue.toFixed(2),
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
      purchases: purchases,
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

  /**
   * Get fuel price history report with all price changes in a date range
   */
  async getFuelPriceHistoryReport(
    startDate: Date,
    endDate: Date,
    organizationId: string
  ) {
    // Get all fuel price changes within the date range
    const priceHistory = await prisma.fuelPrice.findMany({
      where: {
        effectiveFrom: {
          gte: startDate,
          lte: endDate,
        },
      },
      include: {
        fuelType: true,
        changedByUser: {
          select: {
            id: true,
            fullName: true,
            username: true,
          },
        },
      },
      orderBy: {
        effectiveFrom: 'desc',
      },
    });

    // Group by fuel type to calculate old price vs new price
    const priceChanges = priceHistory.map((current, index) => {
      // Find previous price (next in array since we're sorted desc)
      const previous = index < priceHistory.length - 1 ? priceHistory[index + 1] : null;

      return {
        id: current.id,
        fuelType: current.fuelType.name,
        fuelTypeCode: current.fuelType.code,
        date: current.effectiveFrom,
        oldPrice: previous ? previous.pricePerLiter.toNumber() : null,
        newPrice: current.pricePerLiter.toNumber(),
        priceChange: previous
          ? current.pricePerLiter.toNumber() - previous.pricePerLiter.toNumber()
          : null,
        percentageChange: previous
          ? ((current.pricePerLiter.toNumber() - previous.pricePerLiter.toNumber()) / previous.pricePerLiter.toNumber()) * 100
          : null,
        changedBy: current.changedByUser?.fullName || 'System',
        notes: current.notes,
      };
    });

    return {
      dateRange: {
        startDate,
        endDate,
      },
      totalChanges: priceChanges.length,
      priceChanges,
    };
  }

  /**
   * Get customer-wise sales report
   * Shows all sales per customer with product variant and payment type segregation
   */
  async getCustomerWiseSalesReport(
    branchId: string,
    startDate: Date,
    endDate: Date,
    organizationId: string,
    customerId?: string
  ) {
    // Verify branch belongs to organization
    const branch = await prisma.branch.findFirst({
      where: { id: branchId, organizationId },
    });

    if (!branch) {
      throw new AppError(404, 'Branch not found');
    }

    // Build where clause
    const whereClause: any = {
      branchId,
      saleDate: {
        gte: startDate,
        lte: endDate,
      },
    };

    // Optional customer filter
    if (customerId) {
      whereClause.customerId = customerId;
    } else {
      // Only show sales with customers (exclude walk-in)
      whereClause.customerId = { not: null };
    }

    // Get all sales with customer info
    const sales = await prisma.sale.findMany({
      where: whereClause,
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
            email: true,
          },
        },
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
      orderBy: [
        { customer: { name: 'asc' } },
        { saleDate: 'desc' },
      ],
    });

    // Transform sales into customer-wise breakdown
    interface SaleDetail {
      date: Date;
      saleId: string;
      slipNumber: string | null;
      customerName: string;
      productVariant: string; // 'HSD', 'PMG', 'Non-Fuel'
      productName: string;
      rate: number;
      quantity: number;
      amount: number;
      paymentMethod: string;
      vehicleNumber: string | null;
    }

    const saleDetails: SaleDetail[] = [];

    for (const sale of sales) {
      const customerName = sale.customer?.name || 'Walk-in';

      // Process fuel sales
      if (sale.saleType === 'fuel') {
        for (const fuelSale of sale.fuelSales) {
          saleDetails.push({
            date: sale.saleDate,
            saleId: sale.id,
            slipNumber: sale.slipNumber,
            customerName,
            productVariant: fuelSale.fuelType.name, // HSD, PMG, etc.
            productName: fuelSale.fuelType.name,
            rate: fuelSale.pricePerLiter.toNumber(),
            quantity: fuelSale.quantityLiters.toNumber(),
            amount: fuelSale.totalAmount.toNumber(),
            paymentMethod: sale.paymentMethod,
            vehicleNumber: sale.vehicleNumber,
          });
        }
      }

      // Process non-fuel sales
      if (sale.saleType === 'non_fuel') {
        for (const item of sale.nonFuelSales) {
          saleDetails.push({
            date: sale.saleDate,
            saleId: sale.id,
            slipNumber: sale.slipNumber,
            customerName,
            productVariant: 'Non-Fuel',
            productName: item.product.name,
            rate: item.unitPrice.toNumber(),
            quantity: item.quantity,
            amount: item.totalAmount.toNumber(),
            paymentMethod: sale.paymentMethod,
            vehicleNumber: sale.vehicleNumber,
          });
        }
      }
    }

    // Calculate summary by customer
    const customerSummary: {
      [customerId: string]: {
        name: string;
        totalTransactions: number;
        totalAmount: number;
        byVariant: {
          [variant: string]: { count: number; amount: number };
        };
        byPaymentMethod: {
          [method: string]: { count: number; amount: number };
        };
      };
    } = {};

    for (const detail of saleDetails) {
      const custKey = detail.customerName;
      if (!customerSummary[custKey]) {
        customerSummary[custKey] = {
          name: detail.customerName,
          totalTransactions: 0,
          totalAmount: 0,
          byVariant: {},
          byPaymentMethod: {},
        };
      }

      customerSummary[custKey].totalTransactions += 1;
      customerSummary[custKey].totalAmount += detail.amount;

      // By variant
      if (!customerSummary[custKey].byVariant[detail.productVariant]) {
        customerSummary[custKey].byVariant[detail.productVariant] = { count: 0, amount: 0 };
      }
      customerSummary[custKey].byVariant[detail.productVariant].count += 1;
      customerSummary[custKey].byVariant[detail.productVariant].amount += detail.amount;

      // By payment method
      if (!customerSummary[custKey].byPaymentMethod[detail.paymentMethod]) {
        customerSummary[custKey].byPaymentMethod[detail.paymentMethod] = { count: 0, amount: 0 };
      }
      customerSummary[custKey].byPaymentMethod[detail.paymentMethod].count += 1;
      customerSummary[custKey].byPaymentMethod[detail.paymentMethod].amount += detail.amount;
    }

    return {
      dateRange: {
        startDate,
        endDate,
      },
      branch: {
        id: branch.id,
        name: branch.name,
      },
      totalSales: saleDetails.length,
      totalAmount: saleDetails.reduce((sum, d) => sum + d.amount, 0),
      saleDetails, // All transaction details
      customerSummary: Object.values(customerSummary), // Aggregated by customer
    };
  }
}
