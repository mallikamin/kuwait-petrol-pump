import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/database';

const salesChartQuerySchema = z.object({
  date: z.string().optional(),
});

const recentTransactionsQuerySchema = z.object({
  limit: z.string().regex(/^\d+$/).optional(),
});

const topCustomersQuerySchema = z.object({
  limit: z.string().regex(/^\d+$/).optional(),
});

export class DashboardController {
  /**
   * GET /api/dashboard/stats
   * Returns DashboardStats for the authenticated user's organization.
   *
   * Response shape (matches frontend DashboardStats):
   * {
   *   today_sales: number,
   *   today_fuel_sales: number,
   *   today_product_sales: number,
   *   active_shifts: number,
   *   pending_bifurcations: number,
   *   low_stock_products: number,
   *   total_customers: number,
   *   pending_credit: number
   * }
   */
  getStats = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { organizationId } = req.user;

      // Start of today in UTC
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const todayEnd = new Date();
      todayEnd.setHours(23, 59, 59, 999);

      const todayWhere = {
        branch: { organizationId },
        saleDate: { gte: todayStart, lte: todayEnd },
      };

      const [
        todayTotalAgg,
        todayFuelAgg,
        todayNonFuelAgg,
        activeShifts,
        pendingBifurcations,
        totalCustomers,
        pendingCreditAgg,
        productsWithThreshold,
      ] = await Promise.all([
        // Total sales today
        prisma.sale.aggregate({
          where: todayWhere,
          _sum: { totalAmount: true },
        }),

        // Fuel sales today
        prisma.sale.aggregate({
          where: { ...todayWhere, saleType: 'fuel' },
          _sum: { totalAmount: true },
        }),

        // Non-fuel (product) sales today
        prisma.sale.aggregate({
          where: { ...todayWhere, saleType: 'non_fuel' },
          _sum: { totalAmount: true },
        }),

        // Active (open) shifts count
        prisma.shiftInstance.count({
          where: {
            branch: { organizationId },
            status: 'open',
          },
        }),

        // Pending bifurcations count
        prisma.bifurcation.count({
          where: {
            branch: { organizationId },
            status: 'pending',
          },
        }),

        // Total active customers
        prisma.customer.count({
          where: {
            organizationId,
            isActive: true,
          },
        }),

        // Pending credit: sum of all credit-method sales
        prisma.sale.aggregate({
          where: {
            branch: { organizationId },
            paymentMethod: 'credit',
          },
          _sum: { totalAmount: true },
        }),

        // Products that have a low stock threshold set
        prisma.product.findMany({
          where: {
            organizationId,
            lowStockThreshold: { gt: 0 },
            isActive: true,
          },
          include: {
            stockLevels: true,
          },
        }),
      ]);

      // Count products that are actually below their threshold
      const lowStockCount = productsWithThreshold.filter((product) => {
        const totalStock = product.stockLevels.reduce(
          (sum, sl) => sum + sl.quantity,
          0
        );
        return totalStock < (product.lowStockThreshold || 0);
      }).length;

      // Mobile-specific stats
      const todayReadingsCount = await prisma.meterReading.count({
        where: {
          nozzle: {
            dispensingUnit: {
              branch: { organizationId },
            },
          },
          recordedAt: { gte: todayStart, lte: todayEnd },
        },
      });

      const lastReading = await prisma.meterReading.findFirst({
        where: {
          nozzle: {
            dispensingUnit: {
              branch: { organizationId },
            },
          },
        },
        orderBy: { recordedAt: 'desc' },
      });

      const currentShift = await prisma.shiftInstance.findFirst({
        where: {
          branch: { organizationId },
          status: 'open',
        },
        include: {
          shift: true,
        },
        orderBy: { openedAt: 'desc' },
      });

      res.json({
        // Web dashboard fields
        today_sales: todayTotalAgg._sum.totalAmount?.toNumber() || 0,
        today_fuel_sales: todayFuelAgg._sum.totalAmount?.toNumber() || 0,
        today_product_sales: todayNonFuelAgg._sum.totalAmount?.toNumber() || 0,
        active_shifts: activeShifts,
        pending_bifurcations: pendingBifurcations,
        low_stock_products: lowStockCount,
        total_customers: totalCustomers,
        pending_credit: pendingCreditAgg._sum.totalAmount?.toNumber() || 0,
        // Mobile dashboard fields
        current_shift: currentShift
          ? {
              id: currentShift.shift.id,
              name: currentShift.shift.name,
              start_time: currentShift.shift.startTime.toISOString(),
              end_time: currentShift.shift.endTime.toISOString(),
            }
          : null,
        pending_readings_count: 0, // No pending readings concept yet
        last_reading_timestamp: lastReading?.recordedAt.toISOString() || null,
        total_readings_today: todayReadingsCount,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/dashboard/sales-chart?date=2026-03-27
   * Returns hourly sales breakdown for a given date (defaults to today).
   *
   * Response shape (matches frontend SalesChart[]):
   * [{ hour: "00:00", fuel: number, products: number, total: number }, ...]
   */
  getSalesChart = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { organizationId } = req.user;
      const { date } = salesChartQuerySchema.parse(req.query);

      // Determine the target date
      const targetDate = date ? new Date(date) : new Date();
      const dayStart = new Date(targetDate);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(targetDate);
      dayEnd.setHours(23, 59, 59, 999);

      // Fetch all sales for the day
      const sales = await prisma.sale.findMany({
        where: {
          branch: { organizationId },
          saleDate: { gte: dayStart, lte: dayEnd },
        },
        select: {
          saleDate: true,
          saleType: true,
          totalAmount: true,
        },
      });

      // Build hourly buckets (24 hours)
      const hourlyData: Array<{
        hour: string;
        fuel: number;
        products: number;
        total: number;
      }> = [];

      for (let h = 0; h < 24; h++) {
        const hourLabel = `${h.toString().padStart(2, '0')}:00`;
        let fuel = 0;
        let products = 0;

        for (const sale of sales) {
          const saleHour = new Date(sale.saleDate).getHours();
          if (saleHour === h) {
            const amount = sale.totalAmount.toNumber();
            if (sale.saleType === 'fuel') {
              fuel += amount;
            } else {
              products += amount;
            }
          }
        }

        hourlyData.push({
          hour: hourLabel,
          fuel: Math.round(fuel * 100) / 100,
          products: Math.round(products * 100) / 100,
          total: Math.round((fuel + products) * 100) / 100,
        });
      }

      res.json(hourlyData);
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/dashboard/payment-stats
   * Returns payment method breakdown for today.
   *
   * Response shape (matches frontend PaymentMethodStats[]):
   * [{ method: "cash", amount: number, count: number }, ...]
   */
  getPaymentStats = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { organizationId } = req.user;

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date();
      todayEnd.setHours(23, 59, 59, 999);

      const paymentBreakdown = await prisma.sale.groupBy({
        by: ['paymentMethod'],
        where: {
          branch: { organizationId },
          saleDate: { gte: todayStart, lte: todayEnd },
        },
        _sum: {
          totalAmount: true,
        },
        _count: true,
      });

      const result = paymentBreakdown.map((pm) => ({
        method: pm.paymentMethod,
        amount: pm._sum.totalAmount?.toNumber() || 0,
        count: pm._count,
      }));

      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/dashboard/recent-transactions?limit=10
   * Returns recent sales for the organization.
   *
   * Response shape (matches frontend Sale[]):
   * Each sale has: id, sale_type, net_amount, payment_method, created_at, items[], etc.
   */
  getRecentTransactions = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { organizationId } = req.user;
      const { limit } = recentTransactionsQuerySchema.parse(req.query);
      const take = limit ? parseInt(limit, 10) : 10;

      // Cap at 50 to prevent abuse
      const safeTake = Math.min(Math.max(take, 1), 50);

      const sales = await prisma.sale.findMany({
        where: {
          branch: { organizationId },
        },
        include: {
          customer: true,
          cashier: {
            select: {
              id: true,
              fullName: true,
              username: true,
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
        orderBy: { saleDate: 'desc' },
        take: safeTake,
      });

      // Map to the frontend Sale shape (snake_case with net_amount)
      const result = sales.map((sale) => ({
        id: sale.id,
        sale_type: sale.saleType,
        payment_method: sale.paymentMethod,
        total_amount: sale.totalAmount.toNumber(),
        tax_amount: sale.taxAmount.toNumber(),
        discount_amount: sale.discountAmount.toNumber(),
        net_amount: sale.totalAmount.toNumber(),
        customer_id: sale.customerId,
        customer: sale.customer
          ? {
              id: sale.customer.id,
              name: sale.customer.name,
              phone: sale.customer.phone,
            }
          : null,
        cashier: sale.cashier
          ? {
              id: sale.cashier.id,
              full_name: sale.cashier.fullName,
              username: sale.cashier.username,
            }
          : null,
        status: 'completed' as const,
        created_at: sale.saleDate.toISOString(),
        items: [
          ...sale.fuelSales.map((fs) => ({
            id: fs.id,
            item_type: 'fuel' as const,
            quantity: fs.quantityLiters.toNumber(),
            unit_price: fs.pricePerLiter.toNumber(),
            total_price: fs.totalAmount.toNumber(),
          })),
          ...sale.nonFuelSales.map((nfs) => ({
            id: nfs.id,
            item_type: 'product' as const,
            quantity: nfs.quantity,
            unit_price: nfs.unitPrice.toNumber(),
            total_price: nfs.totalAmount.toNumber(),
          })),
        ],
      }));

      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/dashboard/low-stock
   * Returns products with stock levels below their threshold.
   *
   * Response shape (matches frontend Product[]):
   * Each product has: id, name, code, min_stock_level, etc.
   */
  getLowStock = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { organizationId } = req.user;

      const products = await prisma.product.findMany({
        where: {
          organizationId,
          isActive: true,
          lowStockThreshold: { gt: 0 },
        },
        include: {
          stockLevels: {
            include: {
              branch: true,
            },
          },
        },
      });

      // Filter to only products actually below threshold, then map to frontend shape
      const lowStockProducts = products
        .filter((product) => {
          const totalStock = product.stockLevels.reduce(
            (sum, sl) => sum + sl.quantity,
            0
          );
          return totalStock < (product.lowStockThreshold || 0);
        })
        .map((product) => {
          const totalStock = product.stockLevels.reduce(
            (sum, sl) => sum + sl.quantity,
            0
          );
          return {
            id: product.id,
            name: product.name,
            code: product.sku,
            barcode: product.barcode,
            category: product.category,
            unit_price: product.unitPrice.toNumber(),
            cost_price: product.costPrice?.toNumber() || 0,
            unit: 'pcs',
            min_stock_level: product.lowStockThreshold || 0,
            current_stock: totalStock,
            is_active: product.isActive,
            created_at: product.createdAt.toISOString(),
          };
        });

      res.json(lowStockProducts);
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/dashboard/top-customers?limit=5
   * Returns top customers by total spend.
   *
   * Response shape (matches frontend Customer[]):
   * Each customer has: id, name, code, customer_type, current_balance, credit_limit, etc.
   */
  getTopCustomers = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { organizationId } = req.user;
      const { limit } = topCustomersQuerySchema.parse(req.query);
      const take = limit ? parseInt(limit, 10) : 5;
      const safeTake = Math.min(Math.max(take, 1), 50);

      // Get customers with their sales for spend calculation
      const customers = await prisma.customer.findMany({
        where: {
          organizationId,
          isActive: true,
        },
        include: {
          sales: {
            select: {
              totalAmount: true,
              paymentMethod: true,
            },
          },
        },
      });

      // Calculate totals and sort by spend descending
      const customersWithSpend = customers
        .map((customer) => {
          const totalSpend = customer.sales.reduce(
            (sum, sale) => sum + sale.totalAmount.toNumber(),
            0
          );
          const creditBalance = customer.sales
            .filter((sale) => sale.paymentMethod === 'credit')
            .reduce((sum, sale) => sum + sale.totalAmount.toNumber(), 0);

          return {
            id: customer.id,
            name: customer.name,
            code: customer.phone || '',
            phone: customer.phone,
            email: customer.email,
            address: customer.address,
            customer_type: 'corporate' as const,
            credit_limit: customer.creditLimit?.toNumber() || 0,
            current_balance: creditBalance,
            vehicle_numbers: customer.vehicleNumbers || [],
            is_active: customer.isActive,
            created_at: customer.createdAt.toISOString(),
            total_spend: totalSpend,
          };
        })
        .sort((a, b) => b.total_spend - a.total_spend)
        .slice(0, safeTake);

      res.json(customersWithSpend);
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/dashboard/liters-available
   * Returns available liters for PMG and HSD fuel types.
   *
   * For now, this returns 0 (placeholder) until inventory tracking is implemented.
   * Future: Calculate from opening stock - today's sales
   *
   * Response shape:
   * { pmg: number, hsd: number }
   */
  getLitersAvailable = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { organizationId } = req.user;
      const branchId = req.user.branchId;

      if (!branchId) {
        return res.status(400).json({ error: 'User has no assigned branch' });
      }

      // Get PMG and HSD fuel type IDs
      const fuelTypes = await prisma.fuelType.findMany({
        where: {
          name: { in: ['PMG', 'HSD'] },
        },
      });

      const pmgFuelType = fuelTypes.find(ft => ft.name === 'PMG');
      const hsdFuelType = fuelTypes.find(ft => ft.name === 'HSD');

      // For now, return 0 as placeholder
      // TODO: Implement inventory tracking
      // Future: opening_stock - sum(sales.liters where date = today)
      const pmgAvailable = 0;
      const hsdAvailable = 0;

      res.json({
        pmg: pmgAvailable,
        hsd: hsdAvailable,
        note: 'Inventory tracking coming soon',
      });
    } catch (error) {
      next(error);
    }
  };
}
