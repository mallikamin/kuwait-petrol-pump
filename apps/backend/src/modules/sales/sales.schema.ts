import { z } from 'zod';

export const createFuelSaleSchema = z.object({
  branchId: z.string().uuid(),
  shiftInstanceId: z.string().uuid().optional(),
  nozzleId: z.string().uuid().optional(), // Optional - client removed nozzle selection from POS
  fuelTypeId: z.string().uuid(),
  quantityLiters: z.number().positive(),
  pricePerLiter: z.number().positive(),
  paymentMethod: z.enum(['cash', 'credit', 'card', 'pso_card']),
  bankId: z.string().uuid().optional(), // Required if paymentMethod='card'
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
  bankId: z.string().uuid().optional(), // Required if paymentMethod='card'
  customerId: z.string().uuid().optional(),
  taxAmount: z.number().nonnegative().optional(),
  discountAmount: z.number().nonnegative().optional(),
});

// Strip empty/null/falsy query param values to undefined so .optional() works
const emptyToUndefined = (val: unknown) => {
  if (val === '' || val === null || val === undefined) return undefined;
  if (val === 'null' || val === 'undefined') return undefined;
  return val;
};

// Safe date preprocess: empty/invalid -> undefined, valid string -> Date
const safeDate = z.preprocess(emptyToUndefined, z.coerce.date().optional());

// Safe int preprocess: empty -> undefined, valid string -> number
const safeInt = z.preprocess(emptyToUndefined, z.string().transform(val => parseInt(val, 10)).optional());

export const getSalesQuerySchema = z.object({
  branchId: z.preprocess(emptyToUndefined, z.string().uuid().optional()),
  shiftInstanceId: z.preprocess(emptyToUndefined, z.string().uuid().optional()),
  saleType: z.preprocess(emptyToUndefined, z.enum(['fuel', 'non_fuel']).optional()),
  paymentMethod: z.preprocess(emptyToUndefined, z.string().optional()),
  customerId: z.preprocess(emptyToUndefined, z.string().uuid().optional()),
  startDate: safeDate,
  endDate: safeDate,
  limit: safeInt,
  offset: safeInt,
  page: safeInt,
  size: safeInt,
});

export const getSummaryQuerySchema = z.object({
  branchId: z.string().uuid(),
  shiftInstanceId: z.string().uuid().optional(),
  // ✅ FIX: Accept both YYYY-MM-DD and ISO datetime formats
  startDate: z.string().refine(
    (val) => /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}.*)?$/.test(val),
    { message: 'Invalid date format. Expected YYYY-MM-DD or ISO datetime' }
  ).transform(val => new Date(val)).optional(),
  endDate: z.string().refine(
    (val) => /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}.*)?$/.test(val),
    { message: 'Invalid date format. Expected YYYY-MM-DD or ISO datetime' }
  ).transform(val => new Date(val)).optional(),
});

export const idParamSchema = z.object({
  id: z.string().uuid(),
});

// Inferred types - single source of truth
export type CreateFuelSaleInput = z.infer<typeof createFuelSaleSchema>;
export type CreateNonFuelSaleInput = z.infer<typeof createNonFuelSaleSchema>;
