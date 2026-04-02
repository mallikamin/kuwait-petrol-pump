import { z } from 'zod';

export const createFuelSaleSchema = z.object({
  branchId: z.string().uuid(),
  shiftInstanceId: z.string().uuid().optional(),
  nozzleId: z.string().uuid().optional(), // Optional - client removed nozzle selection from POS
  fuelTypeId: z.string().uuid(),
  quantityLiters: z.number().positive(),
  pricePerLiter: z.number().positive(),
  paymentMethod: z.enum(['cash', 'credit', 'card', 'pso_card']),
  customerId: z.string().uuid().optional(),
  vehicleNumber: z.string().optional(),
  slipNumber: z.string().optional(),
  // Meter reading fields (optional - for reconciliation tracking)
  previousReading: z.number().nonnegative().optional(),
  currentReading: z.number().nonnegative().optional(),
  calculatedLiters: z.number().positive().optional(),
  imageUrl: z.string().url().optional(),
  ocrConfidence: z.number().min(0).max(1).optional(),
  isManualReading: z.boolean().optional(),
});

export const createNonFuelSaleSchema = z.object({
  branchId: z.string().uuid(),
  shiftInstanceId: z.string().uuid().optional(),
  items: z.array(
    z.object({
      productId: z.string().uuid(),
      quantity: z.number().int().positive(),
      unitPrice: z.number().positive(),
    })
  ).min(1),
  paymentMethod: z.enum(['cash', 'credit', 'card']),
  customerId: z.string().uuid().optional(),
  taxAmount: z.number().nonnegative().optional(),
  discountAmount: z.number().nonnegative().optional(),
});

export const getSalesQuerySchema = z.object({
  branchId: z.string().uuid().optional(),
  shiftInstanceId: z.string().uuid().optional(),
  saleType: z.enum(['fuel', 'non_fuel']).optional(),
  paymentMethod: z.string().optional(),
  customerId: z.string().uuid().optional(),
  startDate: z.string().datetime().transform(val => new Date(val)).optional(),
  endDate: z.string().datetime().transform(val => new Date(val)).optional(),
  limit: z.string().transform(val => parseInt(val, 10)).optional(),
  offset: z.string().transform(val => parseInt(val, 10)).optional(),
});

export const getSummaryQuerySchema = z.object({
  branchId: z.string().uuid(),
  shiftInstanceId: z.string().uuid().optional(),
  startDate: z.string().datetime().transform(val => new Date(val)).optional(),
  endDate: z.string().datetime().transform(val => new Date(val)).optional(),
});

export const idParamSchema = z.object({
  id: z.string().uuid(),
});

// Inferred types - single source of truth
export type CreateFuelSaleInput = z.infer<typeof createFuelSaleSchema>;
export type CreateNonFuelSaleInput = z.infer<typeof createNonFuelSaleSchema>;
