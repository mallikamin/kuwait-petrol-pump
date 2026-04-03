import { prisma } from '../../config/database';
import { Prisma } from '@prisma/client';
import { AppError } from '../../middleware/error.middleware';

export interface CreateBackdatedEntryDto {
  branchId: string;
  businessDate: string; // YYYY-MM-DD
  nozzleId: string;
  shiftId?: string;
  openingReading: number;
  closingReading: number;
  notes?: string;
  createdBy?: string;
}

export interface CreateBackdatedTransactionDto {
  backdatedEntryId: string;
  customerId?: string;
  vehicleNumber?: string;
  slipNumber?: string;
  productId?: string;
  fuelTypeId?: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  paymentMethod: 'cash' | 'credit_card' | 'bank_card' | 'pso_card' | 'credit_customer';
  transactionDateTime: string; // ISO timestamp
  notes?: string;
  createdBy?: string;
}

export interface ReconcileBackdatedEntryDto {
  id: string;
  isReconciled: boolean;
  varianceLiters?: number;
  varianceAmount?: number;
}

export class BackdatedEntriesService {
  /**
   * Get all backdated entries with optional filters
   */
  async getAllEntries(filters?: {
    branchId?: string;
    businessDateFrom?: string;
    businessDateTo?: string;
    nozzleId?: string;
    shiftId?: string;
    isReconciled?: boolean;
  }) {
    const where: Prisma.BackdatedEntryWhereInput = {};

    if (filters?.branchId) {
      where.branchId = filters.branchId;
    }

    if (filters?.businessDateFrom || filters?.businessDateTo) {
      where.businessDate = {};
      if (filters.businessDateFrom) {
        where.businessDate.gte = new Date(filters.businessDateFrom);
      }
      if (filters.businessDateTo) {
        where.businessDate.lte = new Date(filters.businessDateTo);
      }
    }

    if (filters?.nozzleId) {
      where.nozzleId = filters.nozzleId;
    }

    if (filters?.shiftId) {
      where.shiftId = filters.shiftId;
    }

    if (filters?.isReconciled !== undefined) {
      where.isReconciled = filters.isReconciled;
    }

    return prisma.backdatedEntry.findMany({
      where,
      include: {
        branch: true,
        nozzle: {
          include: {
            fuelType: true,
            dispensingUnit: true,
          },
        },
        shift: true,
        transactions: {
          include: {
            customer: true,
            product: true,
            fuelType: true,
          },
          orderBy: {
            transactionDateTime: 'asc',
          },
        },
      },
      orderBy: [
        { businessDate: 'desc' },
        { createdAt: 'asc' },
      ],
    });
  }

  /**
   * Get a single backdated entry by ID
   */
  async getEntryById(id: string) {
    return prisma.backdatedEntry.findUnique({
      where: { id },
      include: {
        branch: true,
        nozzle: {
          include: {
            fuelType: true,
            dispensingUnit: true,
          },
        },
        shift: true,
        transactions: {
          include: {
            customer: true,
            product: true,
            fuelType: true,
          },
          orderBy: {
            transactionDateTime: 'asc',
          },
        },
      },
    });
  }

  /**
   * Create a new backdated entry
   */
  async createEntry(data: CreateBackdatedEntryDto, organizationId: string) {
    // Validate nozzle belongs to organization
    const nozzle = await prisma.nozzle.findFirst({
      where: {
        id: data.nozzleId,
        dispensingUnit: {
          branch: {
            organizationId,
          },
        },
      },
    });

    if (!nozzle) {
      throw new AppError(404, 'Nozzle not found or does not belong to organization');
    }

    // Validate branch belongs to organization
    const branch = await prisma.branch.findFirst({
      where: {
        id: data.branchId,
        organizationId,
      },
    });

    if (!branch) {
      throw new AppError(404, 'Branch not found or does not belong to organization');
    }

    // Check for duplicate (same nozzle + date + shift)
    const existing = await prisma.backdatedEntry.findFirst({
      where: {
        nozzleId: data.nozzleId,
        businessDate: new Date(data.businessDate),
        shiftId: data.shiftId || null,
      },
    });

    if (existing) {
      throw new AppError(400, 'Backdated entry already exists for this nozzle/date/shift combination');
    }

    return prisma.backdatedEntry.create({
      data: {
        branchId: data.branchId,
        businessDate: new Date(data.businessDate),
        nozzleId: data.nozzleId,
        shiftId: data.shiftId,
        openingReading: new Prisma.Decimal(data.openingReading),
        closingReading: new Prisma.Decimal(data.closingReading),
        notes: data.notes,
        createdBy: data.createdBy,
      },
      include: {
        branch: true,
        nozzle: {
          include: {
            fuelType: true,
          },
        },
        shift: true,
        transactions: true,
      },
    });
  }

  /**
   * Update a backdated entry
   */
  async updateEntry(id: string, data: Partial<CreateBackdatedEntryDto>) {
    const updateData: Prisma.BackdatedEntryUpdateInput = {};

    if (data.openingReading !== undefined) {
      updateData.openingReading = new Prisma.Decimal(data.openingReading);
    }
    if (data.closingReading !== undefined) {
      updateData.closingReading = new Prisma.Decimal(data.closingReading);
    }
    if (data.notes !== undefined) {
      updateData.notes = data.notes;
    }

    return prisma.backdatedEntry.update({
      where: { id },
      data: updateData,
      include: {
        branch: true,
        nozzle: {
          include: {
            fuelType: true,
          },
        },
        shift: true,
        transactions: {
          include: {
            customer: true,
            product: true,
            fuelType: true,
          },
        },
      },
    });
  }

  /**
   * Delete a backdated entry (cascade deletes transactions)
   */
  async deleteEntry(id: string) {
    return prisma.backdatedEntry.delete({
      where: { id },
    });
  }

  /**
   * Create a backdated transaction
   */
  async createTransaction(data: CreateBackdatedTransactionDto, organizationId: string) {
    // Validate backdated entry exists
    const entry = await prisma.backdatedEntry.findFirst({
      where: {
        id: data.backdatedEntryId,
        branch: {
          organizationId,
        },
      },
    });

    if (!entry) {
      throw new AppError(404, 'Backdated entry not found');
    }

    // Validate credit customer transactions require customer + vehicle + slip
    if (data.paymentMethod === 'credit_customer') {
      if (!data.customerId || !data.vehicleNumber || !data.slipNumber) {
        throw new AppError(
          400,
          'Credit customer transactions require customerId, vehicleNumber, and slipNumber'
        );
      }
    }

    // Validate customer belongs to organization if provided
    if (data.customerId) {
      const customer = await prisma.customer.findFirst({
        where: {
          id: data.customerId,
          organizationId,
        },
      });

      if (!customer) {
        throw new AppError(404, 'Customer not found or does not belong to organization');
      }
    }

    return prisma.backdatedTransaction.create({
      data: {
        backdatedEntryId: data.backdatedEntryId,
        customerId: data.customerId,
        vehicleNumber: data.vehicleNumber,
        slipNumber: data.slipNumber,
        productId: data.productId,
        fuelTypeId: data.fuelTypeId,
        productName: data.productName,
        quantity: new Prisma.Decimal(data.quantity),
        unitPrice: new Prisma.Decimal(data.unitPrice),
        lineTotal: new Prisma.Decimal(data.lineTotal),
        paymentMethod: data.paymentMethod,
        transactionDateTime: new Date(data.transactionDateTime),
        notes: data.notes,
        createdBy: data.createdBy,
      },
      include: {
        backdatedEntry: true,
        customer: true,
        product: true,
        fuelType: true,
      },
    });
  }

  /**
   * Get transactions for a backdated entry
   */
  async getTransactions(backdatedEntryId: string) {
    return prisma.backdatedTransaction.findMany({
      where: { backdatedEntryId },
      include: {
        customer: true,
        product: true,
        fuelType: true,
      },
      orderBy: {
        transactionDateTime: 'asc',
      },
    });
  }

  /**
   * Update a backdated transaction
   */
  async updateTransaction(id: string, data: Partial<CreateBackdatedTransactionDto>) {
    const updateData: Prisma.BackdatedTransactionUpdateInput = {};

    if (data.customerId !== undefined) updateData.customerId = data.customerId;
    if (data.vehicleNumber !== undefined) updateData.vehicleNumber = data.vehicleNumber;
    if (data.slipNumber !== undefined) updateData.slipNumber = data.slipNumber;
    if (data.productName !== undefined) updateData.productName = data.productName;
    if (data.quantity !== undefined) updateData.quantity = new Prisma.Decimal(data.quantity);
    if (data.unitPrice !== undefined) updateData.unitPrice = new Prisma.Decimal(data.unitPrice);
    if (data.lineTotal !== undefined) updateData.lineTotal = new Prisma.Decimal(data.lineTotal);
    if (data.paymentMethod !== undefined) updateData.paymentMethod = data.paymentMethod;
    if (data.transactionDateTime !== undefined) {
      updateData.transactionDateTime = new Date(data.transactionDateTime);
    }
    if (data.notes !== undefined) updateData.notes = data.notes;

    return prisma.backdatedTransaction.update({
      where: { id },
      data: updateData,
      include: {
        customer: true,
        product: true,
        fuelType: true,
      },
    });
  }

  /**
   * Delete a backdated transaction
   */
  async deleteTransaction(id: string) {
    return prisma.backdatedTransaction.delete({
      where: { id },
    });
  }

  /**
   * Reconcile a backdated entry
   */
  async reconcileEntry(data: ReconcileBackdatedEntryDto) {
    return prisma.backdatedEntry.update({
      where: { id: data.id },
      data: {
        isReconciled: data.isReconciled,
        varianceLiters: data.varianceLiters ? new Prisma.Decimal(data.varianceLiters) : null,
        varianceAmount: data.varianceAmount ? new Prisma.Decimal(data.varianceAmount) : null,
      },
      include: {
        transactions: {
          include: {
            customer: true,
            product: true,
            fuelType: true,
          },
        },
      },
    });
  }

  /**
   * Get daily reconciliation summary
   */
  async getDailyReconciliation(branchId: string, businessDate: string, organizationId: string) {
    // Validate branch belongs to organization
    const branch = await prisma.branch.findFirst({
      where: {
        id: branchId,
        organizationId,
      },
    });

    if (!branch) {
      throw new AppError(404, 'Branch not found');
    }

    const entries = await prisma.backdatedEntry.findMany({
      where: {
        branchId,
        businessDate: new Date(businessDate),
      },
      include: {
        nozzle: {
          include: {
            fuelType: true,
            dispensingUnit: true,
          },
        },
        shift: true,
        transactions: {
          include: {
            customer: true,
            fuelType: true,
          },
        },
      },
    });

    // Aggregate totals per entry
    const reconciliation = entries.map((entry) => {
      const meterLiters =
        parseFloat(entry.closingReading.toString()) - parseFloat(entry.openingReading.toString());

      const transactionTotals = entry.transactions.reduce(
        (acc, txn) => {
          const qty = parseFloat(txn.quantity.toString());
          const total = parseFloat(txn.lineTotal.toString());

          acc.liters += qty;
          acc.amount += total;

          // Payment method breakdown
          switch (txn.paymentMethod) {
            case 'cash':
              acc.cash += total;
              break;
            case 'credit_card':
              acc.creditCard += total;
              break;
            case 'bank_card':
              acc.bankCard += total;
              break;
            case 'pso_card':
              acc.psoCard += total;
              break;
            case 'credit_customer':
              acc.creditCustomer += total;
              break;
          }

          return acc;
        },
        {
          liters: 0,
          amount: 0,
          cash: 0,
          creditCard: 0,
          bankCard: 0,
          psoCard: 0,
          creditCustomer: 0,
        }
      );

      const varianceLiters = meterLiters - transactionTotals.liters;
      const unitPrice = entry.transactions[0]
        ? parseFloat(entry.transactions[0].unitPrice.toString())
        : 0;
      const varianceAmount = varianceLiters * unitPrice;

      return {
        entryId: entry.id,
        businessDate: entry.businessDate,
        nozzle: {
          id: entry.nozzle.id,
          name: entry.nozzle.name,
          fuelType: entry.nozzle.fuelType.code,
        },
        shift: entry.shift ? { id: entry.shift.id, name: entry.shift.name } : null,
        meterReadings: {
          opening: parseFloat(entry.openingReading.toString()),
          closing: parseFloat(entry.closingReading.toString()),
          liters: meterLiters,
        },
        transactions: transactionTotals,
        variance: {
          liters: varianceLiters,
          amount: varianceAmount,
        },
        isReconciled: entry.isReconciled,
      };
    });

    return reconciliation;
  }
}
