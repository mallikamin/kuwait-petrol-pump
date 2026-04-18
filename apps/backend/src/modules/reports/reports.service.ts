import { prisma } from '../../config/database';
import { AppError } from '../../middleware/error.middleware';
import { toBranchStartOfDay, toBranchEndOfDay } from '../../utils/timezone';
import {
  computeInventoryOpeningClosing,
  openingClosingKey,
} from './inventory-opening.service';

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
    const isWalkInLedger = customerId === '__walkin__';

    // Verify customer belongs to organization unless using walk-in virtual ledger
    const customer = isWalkInLedger
      ? null
      : await prisma.customer.findFirst({
          where: { id: customerId, organizationId },
        });

    if (!isWalkInLedger && !customer) {
      throw new AppError(404, 'Customer not found');
    }

    // Get all sales for this customer within date range
    const sales = await prisma.sale.findMany({
      where: {
        branch: { organizationId },
        customerId: isWalkInLedger ? null : customerId,
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
        slipNumber: sale.slipNumber || null,
        receiptNumber: null, // Sales don't have receipt numbers (only customer receipts do)
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
        id: isWalkInLedger ? '__walkin__' : customer!.id,
        name: isWalkInLedger ? 'Walk-in Sales Ledger' : customer!.name,
        phone: isWalkInLedger ? null : customer!.phone,
        email: isWalkInLedger ? null : customer!.email,
        vehicleNumbers: isWalkInLedger ? [] : (customer!.vehicleNumbers || []),
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
  async getInventoryReport(
    branchId: string,
    organizationId: string,
    asOfDate?: string,
    startDate?: string,
    endDate?: string,
    category: 'all' | 'total_fuel' | 'HSD' | 'PMG' | 'non_fuel' = 'all',
    productId?: string,
  ) {
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

    // Sanitized diagnostic error codes surfaced in the response so the UI can
    // distinguish "no data" from "sub-query failed". Raw error messages/stacks
    // are kept out of the payload and only logged server-side.
    const diagnosticErrors: string[] = [];

    // Get purchases received (stock receipts with items)
    let purchases: any[] = [];
    try {
      // Determine date filter precedence:
      // 1. If startDate/endDate provided => range mode
      // 2. Else if asOfDate provided => single-date mode
      // 3. Else => no filter (all purchases)
      let dateFilter: any = null;
      if (startDate && endDate) {
        // ✅ TIMEZONE FIX: Range mode with Asia/Karachi boundaries
        const rangeStart = toBranchStartOfDay(startDate);
        const rangeEnd = toBranchEndOfDay(endDate);
        dateFilter = {
          gte: rangeStart,
          lte: rangeEnd,
        };
      } else if (asOfDate) {
        // ✅ TIMEZONE FIX: Single-date mode with Asia/Karachi end-of-day
        const asOfDateObj = toBranchEndOfDay(asOfDate);
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

      // Transform stock receipts for display. Preserve fuelType.code so fuel-movement
      // aggregation can key on the authoritative fuel code rather than matching on name.
      const stockReceiptPurchases = stockReceipts.flatMap(receipt =>
        receipt.purchaseOrder.items.map(item => ({
          poNumber: receipt.purchaseOrder.poNumber,
          receiptNumber: receipt.receiptNumber,
          id: item.id,
          // productId carried so productMovement can join non-fuel purchases ↔ sales by UUID.
          productId: item.product?.id || null,
          name: item.product?.name || item.fuelType?.name || 'Unknown',
          sku: item.product?.sku || '',
          fuelCode: item.fuelType?.code || null,
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

      // Query 2: Get PurchaseOrders in receiving states that may not have stock receipts yet.
      // Include 'received' AND 'partial_received' — both hold received stock (partial_received
      // has items in quantityReceived even if receivedDate is not yet stamped). Allow POs with
      // NULL receivedDate (common for partial_received) to qualify via updatedAt fallback so
      // stock-moved rows aren't dropped by the date filter.
      const poWhere: any = {
        branchId,
        status: { in: ['received', 'partial_received'] },
      };

      if (dateFilter) {
        poWhere.OR = [
          { receivedDate: dateFilter },
          { receivedDate: null, updatedAt: dateFilter },
        ];
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
          updatedAt: 'desc',
        },
      });

      // Transform received POs for display (exclude those already in stock receipts).
      // Skip items with quantityReceived <= 0 so open/zero lines on partial_received POs
      // don't pad the report with empty rows.
      const poNumbers = new Set(stockReceipts.map(r => r.purchaseOrder.poNumber));
      const receivedPoPurchases = receivedPos
        .filter(po => !poNumbers.has(po.poNumber))
        .flatMap(po =>
          po.items
            .filter(item => parseFloat(item.quantityReceived.toString()) > 0)
            .map(item => ({
              poNumber: po.poNumber,
              receiptNumber: null,
              id: item.id,
              productId: item.product?.id || null,
              name: item.product?.name || item.fuelType?.name || 'Unknown',
              sku: item.product?.sku || '',
              fuelCode: item.fuelType?.code || null,
              supplierName: po.supplier?.name,
              quantityReceived: parseFloat(item.quantityReceived.toString()),
              costPerUnit: parseFloat(item.costPerUnit.toString()),
              totalCost: parseFloat(item.totalCost.toString()),
              receiptDate: po.receivedDate || po.updatedAt,
              status: po.status === 'received' ? 'received_no_receipt' : 'partial_received',
              receivedBy: 'Pending Receipt Form',
              receivedByUsername: null,
            }))
        );

      // Combine both sources and sort by date
      purchases = [...stockReceiptPurchases, ...receivedPoPurchases].sort(
        (a, b) => new Date(b.receiptDate).getTime() - new Date(a.receiptDate).getTime()
      );
    } catch (error) {
      // If purchases query fails, continue without purchases data.
      // Surface a sanitized code in diagnostics; full error stays in server logs.
      console.warn('[Inventory Report] Failed to fetch purchases:', error);
      diagnosticErrors.push('purchases_query_failed');
      purchases = [];
    }

    // Categorize products
    const lowStockProducts = stockLevels.filter(
      sl => sl.quantity < (sl.product.lowStockThreshold || 0)
    );
    const normalStockProducts = stockLevels.filter(
      sl => sl.quantity >= (sl.product.lowStockThreshold || 0)
    );

    // Calculate totals (include both stock_levels AND received purchases)
    // ✅ FIX: Include fuel purchases in totals (they use tank_level_logs, not stock_levels)
    const totalItems = stockLevels.length + purchases.length; // Count both product stock + received purchases
    const totalQuantity = stockLevels.reduce((sum, sl) => sum + sl.quantity, 0);
    const lowStockCount = lowStockProducts.length;

    // Calculate total value (stock_levels + received purchases)
    const stockLevelsValue = stockLevels.reduce(
      (sum, sl) => sum + (sl.quantity * sl.product.unitPrice.toNumber()),
      0
    );
    const purchasesValue = purchases.reduce(
      (sum, p: any) => sum + (p.totalCost || 0),
      0
    );
    const totalValue = stockLevelsValue + purchasesValue;

    // Get sales movement for the date range (fuel + non-fuel)
    let salesMovement: any = null;
    let fuelMovement: any = null; // ✅ NEW: Explicit fuel movement calculation (Opening + Purchases - Sales = Closing)
    // Product-Wise Movement: per-product purchased/sold/net for the date range.
    // Only populated in date-range mode (sales data is only queried then).
    // Stays null in single-date and no-filter modes — UI must handle that.
    let productMovement: {
      filters: { category: string; productId: string | null };
      // netMovement retained for backward compatibility (= purchasedQty - soldQty).
      // openingQty / gainLossQty / closingQty are additive fields introduced
      // with the opening-stock cycle:
      //   closingQty = openingQty + purchasedQty - soldQty + gainLossQty
      // closingQty is the "Quantity in Hand (Net Movement)" label clients use.
      // openingSource is 'bootstrap' when computed from inventory_bootstrap,
      // 'assumed' when no bootstrap row exists for that item (treated as 0).
      rows: Array<{
        productId: string;
        productName: string;
        productType: 'HSD' | 'PMG' | 'non_fuel';
        unit: 'L' | 'units';
        purchasedQty: number;
        purchasedValue: number;
        soldQty: number;
        soldValue: number;
        netMovement: number;
        openingQty: number;
        gainLossQty: number;
        closingQty: number;
        openingSource: 'bootstrap' | 'assumed';
      }>;
    } | null = null;

    if (startDate && endDate) {
      try {
        // ✅ TIMEZONE FIX: Use Asia/Karachi boundaries for sales query
        const rangeStart = toBranchStartOfDay(startDate);
        const rangeEnd = toBranchEndOfDay(endDate);

        const sales = await prisma.sale.findMany({
          where: {
            branchId,
            saleDate: {
              gte: rangeStart,
              lte: rangeEnd,
            },
          },
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

        // Aggregate fuel sales by type
        const fuelSalesMap = new Map<string, { code: string; name: string; liters: number; amount: number }>();
        sales.forEach(sale => {
          sale.fuelSales.forEach(fs => {
            const key = fs.fuelType.code;
            const existing = fuelSalesMap.get(key) || {
              code: fs.fuelType.code,
              name: fs.fuelType.name,
              liters: 0,
              amount: 0,
            };
            existing.liters += fs.quantityLiters.toNumber();
            existing.amount += fs.totalAmount.toNumber();
            fuelSalesMap.set(key, existing);
          });
        });

        // ✅ NEW: Calculate fuel movement (Opening + Purchases - Sales = Closing)
        // Aggregate purchases by fuel type in the same date range
        const fuelPurchasesMap = new Map<string, { code: string; name: string; liters: number; amount: number }>();

        purchases.forEach((purchase: any) => {
          // Prefer the authoritative fuel code carried from PurchaseOrderItem.fuelType.
          // Fall back to name-matching only for legacy rows that lack a fuelType join.
          let fuelCode: string | null = (purchase.fuelCode || '').toUpperCase() || null;
          if (!fuelCode) {
            const nameUpper = (purchase.name || '').toUpperCase();
            if (nameUpper.includes('DIESEL') || nameUpper.includes('HSD')) {
              fuelCode = 'HSD';
            } else if (
              nameUpper.includes('GASOLINE') ||
              nameUpper.includes('PETROL') ||
              nameUpper.includes('PMG') ||
              nameUpper.includes('PREMIUM')
            ) {
              fuelCode = 'PMG';
            }
          }

          if (fuelCode) {
            const existing = fuelPurchasesMap.get(fuelCode) || {
              code: fuelCode,
              name: fuelCode === 'HSD' ? 'High Speed Diesel' : 'Premium Motor Gasoline',
              liters: 0,
              amount: 0,
            };
            existing.liters += purchase.quantityReceived || 0;
            existing.amount += purchase.totalCost || 0;
            fuelPurchasesMap.set(fuelCode, existing);
          }
        });

        // Calculate movement for each fuel type (HSD and PMG)
        const fuelMovementByType: any[] = [];

        ['HSD', 'PMG'].forEach((fuelCode) => {
          const sales = fuelSalesMap.get(fuelCode);
          const purchases = fuelPurchasesMap.get(fuelCode);

          const salesLiters = sales?.liters || 0;
          const purchasesLiters = purchases?.liters || 0;

          // Opening balance: We don't have historical data, so we calculate from current stock
          // Closing = Current stock from stock levels
          // Opening = Closing - Purchases + Sales
          // This is a reverse calculation from current state

          // Get current stock level for this fuel type
          const currentFuelType = fuelTypes.find(ft => ft.code === fuelCode);
          const currentStock = 0; // Would need to query tank levels or stock_levels for fuel

          // For now, just show the movement without opening/closing
          // Formula: Net Change = Purchases - Sales
          const netChange = purchasesLiters - salesLiters;

          fuelMovementByType.push({
            fuelCode,
            fuelName: fuelCode === 'HSD' ? 'High Speed Diesel' : 'Premium Motor Gasoline',
            purchases: purchasesLiters,
            sales: salesLiters,
            netMovement: netChange,
            // Note: Opening and Closing would require tank level tracking
            // which is not currently implemented in the stock_levels table
          });
        });

        fuelMovement = {
          dateRange: { startDate, endDate },
          byFuelType: fuelMovementByType,
          formula: 'Net Movement = Purchases - Sales (Opening + Closing require tank level tracking)',
        };

        // Aggregate non-fuel sales by product
        const nonFuelSalesMap = new Map<string, { id: string; name: string; quantity: number; amount: number }>();
        sales.forEach(sale => {
          sale.nonFuelSales.forEach(nfs => {
            const key = nfs.productId;
            const existing = nonFuelSalesMap.get(key) || {
              id: nfs.productId,
              name: nfs.product.name,
              quantity: 0,
              amount: 0,
            };
            existing.quantity += nfs.quantity;
            existing.amount += nfs.totalAmount.toNumber();
            nonFuelSalesMap.set(key, existing);
          });
        });

        salesMovement = {
          dateRange: { startDate, endDate },
          fuelSold: Array.from(fuelSalesMap.values()),
          nonFuelSold: Array.from(nonFuelSalesMap.values()),
          totalSalesAmount: sales.reduce((sum, s) => sum + s.totalAmount.toNumber(), 0),
        };

        // Build Product-Wise Movement: combine purchases + sales per product.
        // Fuel rows keyed by fuel code (HSD/PMG); non-fuel rows keyed by product UUID.
        // Movement-only filter: only rows with purchasedQty > 0 OR soldQty > 0.
        // Category and productId filters are applied at the row level so the
        // CSV/UI render exactly what the API returned.
        type PMRow = NonNullable<typeof productMovement>['rows'][number];
        const fuelRows: PMRow[] = (['HSD', 'PMG'] as const).map(code => {
          const purch = fuelPurchasesMap.get(code);
          const sold = fuelSalesMap.get(code);
          const purchasedQty = purch?.liters || 0;
          const soldQty = sold?.liters || 0;
          return {
            productId: code,
            productName: code === 'HSD' ? 'High Speed Diesel' : 'Premium Motor Gasoline',
            productType: code as 'HSD' | 'PMG',
            unit: 'L' as const,
            purchasedQty,
            purchasedValue: purch?.amount || 0,
            soldQty,
            soldValue: sold?.amount || 0,
            netMovement: purchasedQty - soldQty,
            // Opening-cycle fields - populated by the enrichment step below.
            openingQty: 0,
            gainLossQty: 0,
            closingQty: purchasedQty - soldQty,
            openingSource: 'assumed' as const,
          };
        });

        const nonFuelPurchasesMap = new Map<string, { id: string; name: string; qty: number; amount: number }>();
        purchases.forEach((p: any) => {
          // A purchase row is non-fuel iff it has a productId from PurchaseOrderItem.product
          // and no fuelType code. The id field on the purchase row is the PO item id, so
          // we re-derive product identity from sku as a fallback when product join is null.
          const isFuel = !!p.fuelCode;
          if (isFuel) return;
          // Skip rows without an identifiable product — they can't be aggregated meaningfully.
          const key: string | null = p.sku ? `sku:${p.sku}` : null;
          if (!key) return;
          const existing = nonFuelPurchasesMap.get(key) || { id: key, name: p.name || 'Unknown', qty: 0, amount: 0 };
          existing.qty += p.quantityReceived || 0;
          existing.amount += p.totalCost || 0;
          nonFuelPurchasesMap.set(key, existing);
        });

        // Non-fuel sales come from nonFuelSalesMap which is keyed by productId (UUID).
        // To merge purchases (keyed by sku) with sales (keyed by UUID), we need both
        // sides to use a common key. Sales carry productId; purchases carry sku via
        // the product join (already pulled into the purchase row). Build a unified
        // product index keyed by productId for accurate joining.
        const nonFuelByProductId = new Map<string, PMRow>();

        // Seed from sales (productId is authoritative).
        Array.from(nonFuelSalesMap.values()).forEach(s => {
          nonFuelByProductId.set(s.id, {
            productId: s.id,
            productName: s.name,
            productType: 'non_fuel',
            unit: 'units' as const,
            purchasedQty: 0,
            purchasedValue: 0,
            soldQty: s.quantity,
            soldValue: s.amount,
            netMovement: -s.quantity,
            openingQty: 0,
            gainLossQty: 0,
            closingQty: -s.quantity,
            openingSource: 'assumed' as const,
          });
        });

        // Add purchases — each purchase row already carries id (po item id) and we
        // need the underlying product id. Re-pull from receivedPos by walking purchases'
        // metadata, but a simpler accurate path: stockReceiptPurchases and
        // receivedPoPurchases were built from `item.product` which has `id`. The
        // current `purchases` shape doesn't carry productId — extend it now to keep
        // join honest (additive field, no consumer breakage).
        purchases.forEach((p: any) => {
          if (p.fuelCode) return; // fuel handled above
          if (!p.productId) return; // pre-existing rows without productId — skip silently
          const existing = nonFuelByProductId.get(p.productId);
          if (existing) {
            existing.purchasedQty += p.quantityReceived || 0;
            existing.purchasedValue += p.totalCost || 0;
            existing.netMovement = existing.purchasedQty - existing.soldQty;
          } else {
            const purchasedQty = p.quantityReceived || 0;
            nonFuelByProductId.set(p.productId, {
              productId: p.productId,
              productName: p.name || 'Unknown',
              productType: 'non_fuel',
              unit: 'units' as const,
              purchasedQty,
              purchasedValue: p.totalCost || 0,
              soldQty: 0,
              soldValue: 0,
              netMovement: purchasedQty,
              openingQty: 0,
              gainLossQty: 0,
              closingQty: purchasedQty,
              openingSource: 'assumed' as const,
            });
          }
        });

        const allRows: PMRow[] = [...fuelRows, ...Array.from(nonFuelByProductId.values())];

        // Enrich each row with opening/gain-loss/closing from the rolling
        // inventory-bootstrap cycle. The helper returns a map keyed by
        // "product:{uuid}" or "fuel:{code}"; rows missing from the map
        // (e.g. a new product without a bootstrap row) fall through with
        // openingQty=0 and openingSource='assumed' so the UI can annotate.
        try {
          const ocMap = await computeInventoryOpeningClosing({
            branchId,
            startDate,
            endDate,
          });
          let assumedCount = 0;
          allRows.forEach((r) => {
            const key =
              r.productType === 'non_fuel'
                ? openingClosingKey({ kind: 'product', key: r.productId })
                : openingClosingKey({ kind: 'fuel', key: r.productId });
            const oc = ocMap.get(key);
            if (oc) {
              r.openingQty = oc.openingQty;
              r.gainLossQty = oc.gainLossQtyInPeriod;
              r.closingQty = oc.closingQty;
              r.openingSource = 'bootstrap';
            } else {
              r.openingQty = 0;
              r.gainLossQty = 0;
              r.closingQty = r.purchasedQty - r.soldQty;
              r.openingSource = 'assumed';
              assumedCount += 1;
            }
          });
          // Coverage diagnostics: surface partial or total bootstrap misses
          // so operators can tell the difference between "everything looks
          // zero because opening really is zero" and "bootstrap wasn't
          // seeded / lookup failed for some keys".
          if (allRows.length > 0 && ocMap.size === 0) {
            diagnosticErrors.push('inventory_bootstrap_missing');
          } else if (assumedCount > 0) {
            diagnosticErrors.push(`inventory_bootstrap_partial:${assumedCount}_of_${allRows.length}`);
          }
        } catch (error) {
          console.warn('[Inventory Report] Opening/closing compute failed:', error);
          diagnosticErrors.push('opening_closing_compute_failed');
          allRows.forEach((r) => {
            r.openingQty = 0;
            r.gainLossQty = 0;
            r.closingQty = r.purchasedQty - r.soldQty;
            r.openingSource = 'assumed';
          });
        }

        // Apply category filter. 'total_fuel' returns both fuels (HSD + PMG)
        // — the spec's "Total Fuel" lens, distinct from 'all' which also
        // includes non-fuel products.
        let filteredByCategory: PMRow[];
        if (category === 'HSD') filteredByCategory = allRows.filter(r => r.productType === 'HSD');
        else if (category === 'PMG') filteredByCategory = allRows.filter(r => r.productType === 'PMG');
        else if (category === 'total_fuel') filteredByCategory = allRows.filter(r => r.productType === 'HSD' || r.productType === 'PMG');
        else if (category === 'non_fuel') filteredByCategory = allRows.filter(r => r.productType === 'non_fuel');
        else filteredByCategory = allRows;

        // Apply productId filter (non-fuel rows only — for fuel use category=HSD/PMG)
        const filteredByProduct = productId
          ? filteredByCategory.filter(r => r.productId === productId)
          : filteredByCategory;

        // Movement-only: drop rows with no activity in the window
        const movementOnly = filteredByProduct.filter(r => r.purchasedQty > 0 || r.soldQty > 0);

        productMovement = {
          filters: { category, productId: productId || null },
          rows: movementOnly.sort((a, b) => a.productName.localeCompare(b.productName)),
        };
      } catch (error) {
        console.warn('[Inventory Report] Failed to fetch sales movement:', error);
        diagnosticErrors.push('sales_movement_query_failed');
        salesMovement = null;
        productMovement = null;
      }
    }

    // ✅ DIAGNOSTIC: Add metadata about query scope
    const diagnostics = {
      stockLevelsFound: stockLevels.length,
      purchasesFound: purchases.length,
      dateFilter: startDate && endDate ? 'date-range' : (asOfDate ? 'single-date' : 'none'),
      dateRange: startDate && endDate ? { startDate, endDate } : null,
      productMovementRows: productMovement?.rows.length ?? 0,
      // Sanitized failure codes from any sub-query that swallowed an error above.
      // Empty array = clean run. UI can surface these without leaking stack traces.
      errors: diagnosticErrors,
    };

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
        lowStockPercentage: totalItems > 0 ? ((lowStockCount / totalItems) * 100).toFixed(2) : '0.00',
        totalValue: totalValue.toFixed(2),
      },
      diagnostics, // ✅ NEW: Help debug zero-data issues
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
      salesMovement: salesMovement, // Fuel + non-fuel sales in date range (if range provided)
      fuelMovement: fuelMovement, // ✅ NEW: Explicit fuel movement calculation (Purchases - Sales)
      // Product-Wise Movement (per-product purchased/sold/net for the date range).
      // Null when no startDate+endDate provided. Filters echoed in shape.
      productMovement: productMovement,
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

  /**
   * Get product-wise detailed summary report.
   */
  async getProductWiseSummaryReport(
    branchId: string,
    startDate: Date,
    endDate: Date,
    organizationId: string,
    productType: 'all' | 'fuel' | 'non_fuel' = 'all',
    productId?: string
  ) {
    const branch = await prisma.branch.findFirst({
      where: { id: branchId, organizationId },
    });

    if (!branch) {
      throw new AppError(404, 'Branch not found');
    }

    const whereClause: any = {
      branchId,
      saleDate: {
        gte: startDate,
        lte: endDate,
      },
    };

    if (productType === 'fuel') {
      whereClause.saleType = 'fuel';
    } else if (productType === 'non_fuel') {
      whereClause.saleType = 'non_fuel';
    }

    const sales = await prisma.sale.findMany({
      where: whereClause,
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
      orderBy: [{ saleDate: 'asc' }],
    });

    interface ProductRow {
      saleDate: Date;
      saleId: string;
      slipNumber: string | null;
      productType: 'fuel' | 'non_fuel';
      product: string;
      qty: number;
      unit: string;
      price: number;
      amount: number;
      paymentMethod: string;
      customerName: string;
      vehicleNumber: string | null;
    }

    const rows: ProductRow[] = [];

    for (const sale of sales) {
      if (sale.saleType === 'fuel') {
        for (const fuelSale of sale.fuelSales) {
          rows.push({
            saleDate: sale.saleDate,
            saleId: sale.id,
            slipNumber: sale.slipNumber || null,
            productType: 'fuel',
            product: fuelSale.fuelType.code || fuelSale.fuelType.name,
            qty: fuelSale.quantityLiters.toNumber(),
            unit: 'Ltrs',
            price: fuelSale.pricePerLiter.toNumber(),
            amount: fuelSale.totalAmount.toNumber(),
            paymentMethod: sale.paymentMethod,
            customerName: sale.customerId ? 'Customer Sale' : 'Walk-in',
            vehicleNumber: sale.vehicleNumber || null,
          });
        }
      }

      if (sale.saleType === 'non_fuel') {
        for (const item of sale.nonFuelSales) {
          if (productId && item.productId !== productId) continue;
          rows.push({
            saleDate: sale.saleDate,
            saleId: sale.id,
            slipNumber: sale.slipNumber || null,
            productType: 'non_fuel',
            product: item.product.name,
            qty: item.quantity,
            unit: 'Qty',
            price: item.unitPrice.toNumber(),
            amount: item.totalAmount.toNumber(),
            paymentMethod: sale.paymentMethod,
            customerName: sale.customerId ? 'Customer Sale' : 'Walk-in',
            vehicleNumber: sale.vehicleNumber || null,
          });
        }
      }
    }

    const sortedRows = rows.sort((a, b) => {
      const p = a.product.localeCompare(b.product);
      if (p !== 0) return p;
      return a.saleDate.getTime() - b.saleDate.getTime();
    });

    const productSummary: Record<string, { qty: number; amount: number; rows: number; unit: string }> = {};
    for (const row of sortedRows) {
      if (!productSummary[row.product]) {
        productSummary[row.product] = { qty: 0, amount: 0, rows: 0, unit: row.unit };
      }
      productSummary[row.product].qty += row.qty;
      productSummary[row.product].amount += row.amount;
      productSummary[row.product].rows += 1;
    }

    return {
      branch: {
        id: branch.id,
        name: branch.name,
      },
      dateRange: {
        startDate,
        endDate,
      },
      filters: {
        productType,
        productId: productId || null,
      },
      totalRows: sortedRows.length,
      totalAmount: sortedRows.reduce((sum, r) => sum + r.amount, 0),
      rows: sortedRows,
      productSummary: Object.entries(productSummary).map(([product, data]) => ({
        product,
        ...data,
      })),
    };
  }
}
