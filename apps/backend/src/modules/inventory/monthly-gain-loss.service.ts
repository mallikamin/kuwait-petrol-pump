import { prisma } from '../../config/database';
import { AppError } from '../../middleware/error.middleware';
import { Decimal } from '@prisma/client/runtime/library';

export interface CreateMonthlyGainLossInput {
  branchId: string;
  fuelTypeId: string;
  month: string; // Format: YYYY-MM
  quantity: number; // Positive for gain, negative for loss
  remarks?: string;
  recordedBy: string; // User ID
}

export interface MonthlyGainLossEntry {
  id: string;
  branchId: string;
  fuelTypeId: string;
  month: string;
  quantity: number;
  remarks: string | null;
  recordedBy: string;
  recordedAt: string;
  fuel?: {
    code: string;
    name: string;
  };
  recordedByUser?: {
    id: string;
    username: string;
    fullName: string | null;
  };
}

export class MonthlyGainLossService {
  /**
   * Create a monthly inventory gain/loss entry
   * Validates: one entry per fuel type per month per branch
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

    // Validate month format (YYYY-MM)
    if (!/^\d{4}-\d{2}$/.test(month)) {
      throw new AppError(400, 'Invalid month format. Use YYYY-MM');
    }

    // Validate month is not in the future
    const [year, monthPart] = month.split('-');
    const targetDate = new Date(`${year}-${monthPart}-01`);
    const today = new Date();
    if (targetDate > today) {
      throw new AppError(400, 'Cannot record gain/loss for future months');
    }

    // Verify fuel type exists
    const fuelType = await prisma.fuelType.findUnique({
      where: { id: fuelTypeId },
    });
    if (!fuelType) {
      throw new AppError(404, 'Fuel type not found');
    }

    // Verify branch exists
    const branch = await prisma.branch.findUnique({
      where: { id: branchId },
    });
    if (!branch) {
      throw new AppError(404, 'Branch not found');
    }

    // Verify user exists
    const user = await prisma.user.findUnique({
      where: { id: recordedBy },
    });
    if (!user) {
      throw new AppError(404, 'User not found');
    }

    // Check for duplicate entry (one per fuel type per month per branch)
    const existing = await prisma.monthlyInventoryGainLoss.findUnique({
      where: {
        unique_branch_fuel_month: {
          branchId,
          fuelTypeId,
          month,
        },
      },
    });

    if (existing) {
      throw new AppError(
        409,
        `Gain/loss entry already exists for ${fuelType.name} in ${month}`
      );
    }

    // Create the entry
    const entry = await prisma.monthlyInventoryGainLoss.create({
      data: {
        organizationId: branch.organizationId,
        branchId,
        fuelTypeId,
        month,
        quantity: new Decimal(quantity),
        remarks: remarks || null,
        recordedBy,
      },
      include: {
        fuelType: {
          select: { id: true, code: true, name: true },
        },
        user: {
          select: { id: true, username: true, fullName: true },
        },
      },
    });

    // QB enqueue (S11 — dip-variance JournalEntry). Uses the branch's current
    // FuelInventory.avgCostPerLiter as the cost basis (workbook: "Variance Qty
    // × Last Purchase Cost" — weighted average is the closest running value
    // the system tracks).
    try {
      const qbConnection = await prisma.qBConnection.findFirst({
        where: { organizationId: branch.organizationId, isActive: true },
        select: { id: true },
      });
      if (qbConnection && (entry.fuelType.code === 'HSD' || entry.fuelType.code === 'PMG')) {
        const qty = parseFloat(entry.quantity.toString());
        if (qty !== 0) {
          const inventoryRow = await prisma.fuelInventory.findUnique({
            where: {
              branchId_fuelTypeId: { branchId, fuelTypeId },
            },
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
                // Key includes fuel + month so re-entering the same row
                // (after a delete-then-recreate) is naturally deduped.
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
              `FuelInventory for branch=${branchId} fuel=${entry.fuelType.code}. ` +
              `Admin must seed a cost basis before this JE can sync.`
            );
          }
        }
      }
    } catch (err: any) {
      // Don't fail the write — the row is persisted and admin can replay.
      console.warn(
        `[QB enqueue][dipvar ${entry.id}] Enqueue failed: ${err?.message || err}`
      );
    }

    return {
      id: entry.id,
      branchId: entry.branchId,
      fuelTypeId: entry.fuelTypeId,
      month: entry.month,
      quantity: parseFloat(entry.quantity.toString()),
      remarks: entry.remarks,
      recordedBy: entry.recordedBy,
      recordedAt: entry.recordedAt.toISOString(),
      fuel: {
        code: entry.fuelType.code,
        name: entry.fuelType.name,
      },
      recordedByUser: {
        id: entry.user.id,
        username: entry.user.username,
        fullName: entry.user.fullName,
      },
    };
  }

  /**
   * Get monthly gain/loss entries for a branch (optionally filtered by month/fuel)
   */
  async getEntries(input: {
    branchId: string;
    month?: string; // Filter to specific month (YYYY-MM)
    fuelTypeId?: string;
  }) {
    const { branchId, month, fuelTypeId } = input;

    // Verify branch exists
    const branch = await prisma.branch.findUnique({
      where: { id: branchId },
    });
    if (!branch) {
      throw new AppError(404, 'Branch not found');
    }

    const entries = await prisma.monthlyInventoryGainLoss.findMany({
      where: {
        branchId,
        ...(month && { month }),
        ...(fuelTypeId && { fuelTypeId }),
      },
      include: {
        fuelType: {
          select: { id: true, code: true, name: true },
        },
        user: {
          select: { id: true, username: true, fullName: true },
        },
      },
      orderBy: [{ month: 'desc' }, { fuelType: { code: 'asc' } }],
    });

    return entries.map((entry) => ({
      id: entry.id,
      branchId: entry.branchId,
      fuelTypeId: entry.fuelTypeId,
      month: entry.month,
      quantity: parseFloat(entry.quantity.toString()),
      remarks: entry.remarks,
      recordedBy: entry.recordedBy,
      recordedAt: entry.recordedAt.toISOString(),
      fuel: {
        code: entry.fuelType.code,
        name: entry.fuelType.name,
      },
      recordedByUser: {
        id: entry.user.id,
        username: entry.user.username,
        fullName: entry.user.fullName,
      },
    }));
  }

  /**
   * Get monthly gain/loss entry by ID
   */
  async getEntryById(id: string) {
    const entry = await prisma.monthlyInventoryGainLoss.findUnique({
      where: { id },
      include: {
        fuelType: {
          select: { id: true, code: true, name: true },
        },
        user: {
          select: { id: true, username: true, fullName: true },
        },
      },
    });

    if (!entry) {
      throw new AppError(404, 'Gain/loss entry not found');
    }

    return {
      id: entry.id,
      branchId: entry.branchId,
      fuelTypeId: entry.fuelTypeId,
      month: entry.month,
      quantity: parseFloat(entry.quantity.toString()),
      remarks: entry.remarks,
      recordedBy: entry.recordedBy,
      recordedAt: entry.recordedAt.toISOString(),
      fuel: {
        code: entry.fuelType.code,
        name: entry.fuelType.name,
      },
      recordedByUser: {
        id: entry.user.id,
        username: entry.user.username,
        fullName: entry.user.fullName,
      },
    };
  }

  /**
   * Delete monthly gain/loss entry (only if recorded within current month)
   */
  async deleteEntry(id: string, userId: string) {
    const entry = await prisma.monthlyInventoryGainLoss.findUnique({
      where: { id },
    });

    if (!entry) {
      throw new AppError(404, 'Gain/loss entry not found');
    }

    // Only allow deletion by the user who recorded it
    if (entry.recordedBy !== userId) {
      throw new AppError(403, 'Only the recorder can delete this entry');
    }

    // Only allow deletion within 24 hours of recording
    const recordedDate = new Date(entry.recordedAt);
    const now = new Date();
    const hoursDiff = (now.getTime() - recordedDate.getTime()) / (1000 * 60 * 60);

    if (hoursDiff > 24) {
      throw new AppError(
        400,
        'Cannot delete entries older than 24 hours. Contact admin for corrections.'
      );
    }

    await prisma.monthlyInventoryGainLoss.delete({
      where: { id },
    });

    return { message: 'Entry deleted successfully' };
  }

  /**
   * Get monthly summary for inventory reports
   */
  async getMonthSummary(input: {
    branchId: string;
    month: string; // YYYY-MM
  }) {
    const { branchId, month } = input;

    const entries = await prisma.monthlyInventoryGainLoss.findMany({
      where: {
        branchId,
        month,
      },
      include: {
        fuelType: {
          select: { code: true, name: true },
        },
      },
      orderBy: { fuelType: { code: 'asc' } },
    });

    // Group by fuel type
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
      >
    );

    return Object.values(summary);
  }
}
