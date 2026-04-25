import { prisma } from '../../config/database';
import { AppError } from '../../middleware/error.middleware';
import { Decimal } from '@prisma/client/runtime/library';
import { computeStockAtDate } from './stock-at-date.service';

export interface CreateMonthlyGainLossInput {
  branchId: string;
  fuelTypeId: string;
  month: string; // Format: YYYY-MM (legacy month-only path)
  quantity: number; // Positive for gain, negative for loss
  remarks?: string;
  recordedBy: string; // User ID
}

/**
 * New-style input: accountant picks a specific business_date and either
 * the measured liters (auto-compute) or the raw gain/loss quantity.
 *
 *   measuredQty given       -> quantity = measuredQty - bookQtyAtDate (system computes)
 *   quantity given directly -> measuredQty stays null (manual override)
 *
 * Server snapshots the lastPurchaseRate at write time so the valuation
 * is frozen and won't drift if rates change later.
 */
export interface CreateGainLossByDateInput {
  branchId: string;
  fuelTypeId: string;
  businessDate: string; // YYYY-MM-DD
  measuredQty?: number;
  quantity?: number;
  remarks?: string;
  recordedBy: string;
}

const yyyymmFromDate = (d: string): string => d.slice(0, 7);

export class MonthlyGainLossService {
  /**
   * Create a monthly inventory gain/loss entry (legacy month-keyed path).
   *
   * Kept for backward-compat with the existing MonthlyInventoryGainLoss
   * widget on the Inventory Report. Writes the row dated to month-01 in
   * the new business_date column; snapshot fields (book qty, last
   * purchase rate, value) stay null on this path — the date-keyed
   * `createByDate` flow is the one that captures them.
   */
  async createEntry(input: CreateMonthlyGainLossInput) {
    const {
      branchId,
      fuelTypeId,
      month,
      quantity,
      remarks,
      recordedBy,
    } = input;

    if (!/^\d{4}-\d{2}$/.test(month)) {
      throw new AppError(400, 'Invalid month format. Use YYYY-MM');
    }

    const [year, monthPart] = month.split('-');
    const targetDate = new Date(`${year}-${monthPart}-01`);
    const today = new Date();
    if (targetDate > today) {
      throw new AppError(400, 'Cannot record gain/loss for future months');
    }

    const fuelType = await prisma.fuelType.findUnique({ where: { id: fuelTypeId } });
    if (!fuelType) throw new AppError(404, 'Fuel type not found');

    const branch = await prisma.branch.findUnique({ where: { id: branchId } });
    if (!branch) throw new AppError(404, 'Branch not found');

    const user = await prisma.user.findUnique({ where: { id: recordedBy } });
    if (!user) throw new AppError(404, 'User not found');

    const businessDate = new Date(`${month}-01T00:00:00.000Z`);
    const existing = await prisma.monthlyInventoryGainLoss.findFirst({
      where: { branchId, fuelTypeId, businessDate },
    });
    if (existing) {
      throw new AppError(
        409,
        `Gain/loss entry already exists for ${fuelType.name} in ${month}`,
      );
    }

    const entry = await prisma.monthlyInventoryGainLoss.create({
      data: {
        organizationId: branch.organizationId,
        branchId,
        fuelTypeId,
        businessDate,
        month,
        quantity: new Decimal(quantity),
        remarks: remarks || null,
        recordedBy,
      },
      include: {
        fuelType: { select: { id: true, code: true, name: true } },
        user: { select: { id: true, username: true, fullName: true } },
      },
    });

    // QB enqueue (S11 dip-variance JE) — unchanged behaviour.
    try {
      const qbConnection = await prisma.qBConnection.findFirst({
        where: { organizationId: branch.organizationId, isActive: true },
        select: { id: true },
      });
      if (qbConnection && (entry.fuelType.code === 'HSD' || entry.fuelType.code === 'PMG')) {
        const qty = parseFloat(entry.quantity.toString());
        if (qty !== 0) {
          const inventoryRow = await prisma.fuelInventory.findUnique({
            where: { branchId_fuelTypeId: { branchId, fuelTypeId } },
            select: { avgCostPerLiter: true },
          });
          const costPerLitre = inventoryRow ? parseFloat(inventoryRow.avgCostPerLiter.toString()) : 0;

          if (costPerLitre > 0) {
            await prisma.qBSyncQueue.create({
              data: {
                connectionId: qbConnection.id,
                organizationId: branch.organizationId,
                jobType: 'create_journal_entry',
                entityType: 'inventory_adjustment',
                entityId: entry.id,
                priority: 5,
                status: 'pending',
                approvalStatus: 'approved',
                idempotencyKey: `qb-dipvar-${entry.id}`,
                payload: {
                  gainLossId: entry.id,
                  organizationId: branch.organizationId,
                  fuelCode: entry.fuelType.code as 'HSD' | 'PMG',
                  variant: qty > 0 ? 'gain' : 'loss',
                  quantityLitres: Math.abs(qty),
                  costPerLitre,
                  monthLabel: month,
                  branchName: branch.name,
                },
              },
            });
          } else {
            console.warn(
              `[QB enqueue][dipvar ${entry.id}] Skipping enqueue: no avgCostPerLiter on ` +
              `FuelInventory for branch=${branchId} fuel=${entry.fuelType.code}.`,
            );
          }
        }
      }
    } catch (err: any) {
      console.warn(`[QB enqueue][dipvar ${entry.id}] Enqueue failed: ${err?.message || err}`);
    }

    return this.toDto(entry);
  }

  /**
   * Date-keyed creation flow. The accountant picks a calendar date,
   * optionally enters the measured liters (and the system computes the
   * gain/loss against the book stock), or enters the gain/loss quantity
   * directly. Either way we snapshot:
   *   - bookQtyAtDate (system value at write time)
   *   - lastPurchaseRate (most recent purchase cost/L)
   *   - valueAtRate (quantity * rate, frozen)
   */
  async createByDate(input: CreateGainLossByDateInput) {
    const {
      branchId,
      fuelTypeId,
      businessDate,
      measuredQty,
      quantity: directQty,
      remarks,
      recordedBy,
    } = input;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) {
      throw new AppError(400, 'businessDate must be YYYY-MM-DD');
    }

    const dateObj = new Date(`${businessDate}T00:00:00.000Z`);
    const today = new Date();
    today.setUTCHours(23, 59, 59, 999);
    if (dateObj > today) {
      throw new AppError(400, 'Cannot record gain/loss for future dates');
    }

    if (typeof measuredQty !== 'number' && typeof directQty !== 'number') {
      throw new AppError(400, 'Provide either measuredQty or quantity');
    }
    if (typeof measuredQty === 'number' && !Number.isFinite(measuredQty)) {
      throw new AppError(400, 'measuredQty must be a finite number');
    }
    if (typeof directQty === 'number' && !Number.isFinite(directQty)) {
      throw new AppError(400, 'quantity must be a finite number');
    }

    const branch = await prisma.branch.findUnique({ where: { id: branchId } });
    if (!branch) throw new AppError(404, 'Branch not found');

    const fuelType = await prisma.fuelType.findUnique({ where: { id: fuelTypeId } });
    if (!fuelType) throw new AppError(404, 'Fuel type not found');

    const user = await prisma.user.findUnique({ where: { id: recordedBy } });
    if (!user) throw new AppError(404, 'User not found');

    // Reject duplicate (branch, fuel, date).
    const existing = await prisma.monthlyInventoryGainLoss.findFirst({
      where: { branchId, fuelTypeId, businessDate: dateObj },
    });
    if (existing) {
      throw new AppError(
        409,
        `Gain/loss entry already exists for ${fuelType.name} on ${businessDate}`,
      );
    }

    // Snapshot the book stock + last purchase rate at this date.
    const stock = await computeStockAtDate({ branchId, fuelTypeId, asOfDate: businessDate });

    const finalQty =
      typeof measuredQty === 'number' ? measuredQty - stock.bookQty : (directQty as number);

    const finalMeasured = typeof measuredQty === 'number' ? measuredQty : null;

    const valueAtRate =
      stock.lastPurchaseRate != null
        ? Number((finalQty * stock.lastPurchaseRate).toFixed(2))
        : null;

    const month = yyyymmFromDate(businessDate);

    const entry = await prisma.monthlyInventoryGainLoss.create({
      data: {
        organizationId: branch.organizationId,
        branchId,
        fuelTypeId,
        businessDate: dateObj,
        month,
        quantity: new Decimal(finalQty),
        measuredQty: finalMeasured != null ? new Decimal(finalMeasured) : null,
        bookQtyAtDate: new Decimal(stock.bookQty),
        lastPurchaseRate:
          stock.lastPurchaseRate != null ? new Decimal(stock.lastPurchaseRate) : null,
        valueAtRate: valueAtRate != null ? new Decimal(valueAtRate) : null,
        remarks: remarks || null,
        recordedBy,
      },
      include: {
        fuelType: { select: { id: true, code: true, name: true } },
        user: { select: { id: true, username: true, fullName: true } },
      },
    });

    // QB enqueue (S11 dip-variance JE) — unchanged behaviour, valued from
    // FuelInventory.avgCostPerLiter so it stays consistent with the existing
    // QB pipeline. The new lastPurchaseRate snapshot is for our own audit/UI
    // — not yet rewired into QB.
    try {
      const qbConnection = await prisma.qBConnection.findFirst({
        where: { organizationId: branch.organizationId, isActive: true },
        select: { id: true },
      });
      if (qbConnection && (entry.fuelType.code === 'HSD' || entry.fuelType.code === 'PMG')) {
        const qty = parseFloat(entry.quantity.toString());
        if (qty !== 0) {
          const inventoryRow = await prisma.fuelInventory.findUnique({
            where: { branchId_fuelTypeId: { branchId, fuelTypeId } },
            select: { avgCostPerLiter: true },
          });
          const costPerLitre = inventoryRow ? parseFloat(inventoryRow.avgCostPerLiter.toString()) : 0;

          if (costPerLitre > 0) {
            await prisma.qBSyncQueue.create({
              data: {
                connectionId: qbConnection.id,
                organizationId: branch.organizationId,
                jobType: 'create_journal_entry',
                entityType: 'inventory_adjustment',
                entityId: entry.id,
                priority: 5,
                status: 'pending',
                approvalStatus: 'approved',
                idempotencyKey: `qb-dipvar-${entry.id}`,
                payload: {
                  gainLossId: entry.id,
                  organizationId: branch.organizationId,
                  fuelCode: entry.fuelType.code as 'HSD' | 'PMG',
                  variant: qty > 0 ? 'gain' : 'loss',
                  quantityLitres: Math.abs(qty),
                  costPerLitre,
                  monthLabel: month,
                  branchName: branch.name,
                },
              },
            });
          } else {
            console.warn(
              `[QB enqueue][dipvar ${entry.id}] Skipping enqueue: no avgCostPerLiter`,
            );
          }
        }
      }
    } catch (err: any) {
      console.warn(`[QB enqueue][dipvar ${entry.id}] Enqueue failed: ${err?.message || err}`);
    }

    return this.toDto(entry);
  }

  /**
   * Get gain/loss entries for a branch, optionally filtered by month or
   * a [startDate, endDate] window or specific fuel.
   */
  async getEntries(input: {
    branchId: string;
    month?: string;
    startDate?: string;
    endDate?: string;
    fuelTypeId?: string;
  }) {
    const { branchId, month, startDate, endDate, fuelTypeId } = input;

    const branch = await prisma.branch.findUnique({ where: { id: branchId } });
    if (!branch) {
      throw new AppError(404, 'Branch not found');
    }

    const where: any = {
      branchId,
      ...(month && { month }),
      ...(fuelTypeId && { fuelTypeId }),
    };
    if (startDate || endDate) {
      where.businessDate = {};
      if (startDate) where.businessDate.gte = new Date(`${startDate}T00:00:00.000Z`);
      if (endDate) where.businessDate.lte = new Date(`${endDate}T23:59:59.999Z`);
    }

    const entries = await prisma.monthlyInventoryGainLoss.findMany({
      where,
      include: {
        fuelType: { select: { id: true, code: true, name: true } },
        user: { select: { id: true, username: true, fullName: true } },
      },
      orderBy: [{ businessDate: 'desc' }, { fuelType: { code: 'asc' } }],
    });

    return entries.map((e) => this.toDto(e));
  }

  async getEntryById(id: string) {
    const entry = await prisma.monthlyInventoryGainLoss.findUnique({
      where: { id },
      include: {
        fuelType: { select: { id: true, code: true, name: true } },
        user: { select: { id: true, username: true, fullName: true } },
      },
    });
    if (!entry) throw new AppError(404, 'Gain/loss entry not found');
    return this.toDto(entry);
  }

  /**
   * Edit an existing entry. measuredQty edits re-derive quantity against
   * the SAME bookQtyAtDate that was originally captured (not a fresh
   * stock lookup) so editing one entry doesn't ripple through the chain
   * of later entries. Date and fuel cannot change — those are the row's
   * identity; if either is wrong, delete and re-add.
   */
  async updateEntry(
    id: string,
    input: {
      measuredQty?: number | null;
      quantity?: number | null;
      remarks?: string | null;
    },
    userId: string,
    userRole?: string,
  ) {
    const entry = await prisma.monthlyInventoryGainLoss.findUnique({
      where: { id },
      include: { fuelType: { select: { id: true, code: true, name: true } } },
    });
    if (!entry) throw new AppError(404, 'Gain/loss entry not found');

    const isAdmin = userRole === 'admin';
    if (!isAdmin && entry.recordedBy !== userId) {
      throw new AppError(403, 'Only the recorder or an admin can edit this entry');
    }

    const data: any = {};

    if (input.measuredQty !== undefined) {
      if (input.measuredQty === null) {
        data.measuredQty = null;
      } else {
        if (!Number.isFinite(input.measuredQty)) {
          throw new AppError(400, 'measuredQty must be a finite number');
        }
        data.measuredQty = new Decimal(input.measuredQty);
        const baseBook =
          entry.bookQtyAtDate != null ? Number(entry.bookQtyAtDate.toString()) : 0;
        const newQty = input.measuredQty - baseBook;
        data.quantity = new Decimal(newQty);
        if (entry.lastPurchaseRate != null) {
          const rate = Number(entry.lastPurchaseRate.toString());
          data.valueAtRate = new Decimal(Number((newQty * rate).toFixed(2)));
        }
      }
    } else if (input.quantity !== undefined) {
      if (input.quantity === null) throw new AppError(400, 'quantity cannot be null');
      if (!Number.isFinite(input.quantity)) {
        throw new AppError(400, 'quantity must be a finite number');
      }
      data.quantity = new Decimal(input.quantity);
      data.measuredQty = null;
      if (entry.lastPurchaseRate != null) {
        const rate = Number(entry.lastPurchaseRate.toString());
        data.valueAtRate = new Decimal(Number((input.quantity * rate).toFixed(2)));
      }
    }

    if (input.remarks !== undefined) data.remarks = input.remarks;

    if (Object.keys(data).length === 0) {
      throw new AppError(400, 'No fields to update');
    }

    const updated = await prisma.monthlyInventoryGainLoss.update({
      where: { id },
      data,
      include: {
        fuelType: { select: { id: true, code: true, name: true } },
        user: { select: { id: true, username: true, fullName: true } },
      },
    });

    return this.toDto(updated);
  }

  async deleteEntry(id: string, userId: string, userRole?: string) {
    const entry = await prisma.monthlyInventoryGainLoss.findUnique({ where: { id } });
    if (!entry) throw new AppError(404, 'Gain/loss entry not found');

    const isAdmin = userRole === 'admin';
    if (!isAdmin && entry.recordedBy !== userId) {
      throw new AppError(403, 'Only the recorder or an admin can delete this entry');
    }

    // Admins can delete any entry; the 24h window only applies to non-admins
    // so accountants can clean up their own mistakes within a day.
    if (!isAdmin) {
      const recordedDate = new Date(entry.recordedAt);
      const now = new Date();
      const hoursDiff = (now.getTime() - recordedDate.getTime()) / (1000 * 60 * 60);
      if (hoursDiff > 24) {
        throw new AppError(
          400,
          'Cannot delete entries older than 24 hours. Contact admin for corrections.',
        );
      }
    }

    await prisma.monthlyInventoryGainLoss.delete({ where: { id } });
    return { message: 'Entry deleted successfully' };
  }

  async getMonthSummary(input: { branchId: string; month: string }) {
    const { branchId, month } = input;

    const entries = await prisma.monthlyInventoryGainLoss.findMany({
      where: { branchId, month },
      include: { fuelType: { select: { code: true, name: true } } },
      orderBy: { fuelType: { code: 'asc' } },
    });

    const summary = entries.reduce(
      (acc, entry) => {
        const key = entry.fuelType.code;
        if (!acc[key]) {
          acc[key] = {
            fuelCode: entry.fuelType.code,
            fuelName: entry.fuelType.name,
            totalGainLoss: 0,
            entries: [],
          };
        }
        acc[key].totalGainLoss += parseFloat(entry.quantity.toString());
        acc[key].entries.push({
          id: entry.id,
          quantity: parseFloat(entry.quantity.toString()),
          remarks: entry.remarks,
          recordedAt: entry.recordedAt.toISOString(),
        });
        return acc;
      },
      {} as Record<
        string,
        {
          fuelCode: string;
          fuelName: string;
          totalGainLoss: number;
          entries: Array<{
            id: string;
            quantity: number;
            remarks: string | null;
            recordedAt: string;
          }>;
        }
      >,
    );

    return Object.values(summary);
  }

  private toDto(entry: any) {
    return {
      id: entry.id,
      branchId: entry.branchId,
      fuelTypeId: entry.fuelTypeId,
      businessDate: entry.businessDate
        ? entry.businessDate.toISOString().slice(0, 10)
        : null,
      month: entry.month,
      quantity: parseFloat(entry.quantity.toString()),
      measuredQty: entry.measuredQty != null ? parseFloat(entry.measuredQty.toString()) : null,
      bookQtyAtDate:
        entry.bookQtyAtDate != null ? parseFloat(entry.bookQtyAtDate.toString()) : null,
      lastPurchaseRate:
        entry.lastPurchaseRate != null ? parseFloat(entry.lastPurchaseRate.toString()) : null,
      valueAtRate:
        entry.valueAtRate != null ? parseFloat(entry.valueAtRate.toString()) : null,
      remarks: entry.remarks,
      recordedBy: entry.recordedBy,
      recordedAt: entry.recordedAt.toISOString(),
      fuel: entry.fuelType
        ? { code: entry.fuelType.code, name: entry.fuelType.name }
        : undefined,
      recordedByUser: entry.user
        ? {
            id: entry.user.id,
            username: entry.user.username,
            fullName: entry.user.fullName,
          }
        : undefined,
    };
  }
}
