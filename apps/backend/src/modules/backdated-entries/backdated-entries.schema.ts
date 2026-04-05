import { z } from 'zod';

/**
 * Schema for creating a backdated entry (daily/nozzle anchor)
 */
export const createBackdatedEntrySchema = z
  .object({
    branchId: z.string().uuid(),
    businessDate: z.string(), // YYYY-MM-DD
    nozzleId: z.string().uuid(),
    shiftId: z.string().uuid().optional(),
    openingReading: z.number().nonnegative(),
    closingReading: z.number().nonnegative(),
    notes: z.string().optional(),
  })
  .refine((data) => data.closingReading > data.openingReading, {
    message: 'Closing reading must be greater than opening reading',
  });

export type CreateBackdatedEntryInput = z.infer<typeof createBackdatedEntrySchema>;

/**
 * Schema for creating a backdated transaction
 */
export const createBackdatedTransactionSchema = z.object({
  backdatedEntryId: z.string().uuid(),

  // Customer details (nullable for walk-in cash)
  customerId: z.string().uuid().optional(),
  vehicleNumber: z.string().optional(),
  slipNumber: z.string().optional(),

  // Product details
  productId: z.string().uuid().optional(),
  fuelTypeId: z.string().uuid().optional(),
  productName: z.string(),

  // Quantity and pricing (all in PKR)
  quantity: z.number().positive(),
  unitPrice: z.number().positive(),
  lineTotal: z.number().positive(),

  // Payment method
  paymentMethod: z.enum(['cash', 'credit_card', 'bank_card', 'pso_card', 'credit_customer']),

  // Transaction timestamp (backdated)
  transactionDateTime: z.string(), // ISO timestamp

  notes: z.string().optional(),
});

export type CreateBackdatedTransactionInput = z.infer<typeof createBackdatedTransactionSchema>;

/**
 * Schema for reconciling a backdated entry
 */
export const reconcileBackdatedEntrySchema = z.object({
  id: z.string().uuid(),
  isReconciled: z.boolean(),
  varianceLiters: z.number().optional(),
  varianceAmount: z.number().optional(), // PKR
});

export type ReconcileBackdatedEntryInput = z.infer<typeof reconcileBackdatedEntrySchema>;
