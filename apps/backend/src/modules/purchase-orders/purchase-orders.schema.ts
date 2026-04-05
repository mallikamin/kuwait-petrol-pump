import { z } from 'zod';

export const createPurchaseOrderItemSchema = z.object({
  itemType: z.enum(['fuel', 'product']),
  fuelTypeId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  quantityOrdered: z.number().positive(),
  costPerUnit: z.number().positive(),
}).refine(
  (data) => {
    if (data.itemType === 'fuel') return !!data.fuelTypeId;
    if (data.itemType === 'product') return !!data.productId;
    return false;
  },
  {
    message: 'fuelTypeId required for fuel items, productId required for product items',
  }
);

export const createPurchaseOrderSchema = z.object({
  supplierId: z.string().uuid(),
  branchId: z.string().uuid(),
  poNumber: z.string().min(1),
  orderDate: z.string().datetime().transform(val => new Date(val)),
  items: z.array(createPurchaseOrderItemSchema).min(1, 'At least one item required'),
  notes: z.string().optional(),
});

export const updatePurchaseOrderSchema = z.object({
  supplierId: z.string().uuid().optional(),
  orderDate: z.string().datetime().transform(val => new Date(val)).optional(),
  notes: z.string().optional(),
  items: z.array(createPurchaseOrderItemSchema).optional(),
});

export const receiveStockSchema = z.object({
  receiptNumber: z.string().min(1),
  receiptDate: z.string().datetime().transform(val => new Date(val)),
  items: z.array(z.object({
    poItemId: z.string().uuid(),
    quantityReceived: z.number().positive(),
  })).min(1),
  notes: z.string().optional(),
});

export const recordPaymentSchema = z.object({
  paymentDate: z.string().datetime().transform(val => new Date(val)),
  amount: z.number().positive(),
  paymentMethod: z.enum(['cash', 'bank_transfer', 'cheque']),
  referenceNumber: z.string().optional(),
  notes: z.string().optional(),
});

export const getPurchaseOrdersQuerySchema = z.object({
  supplierId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  status: z.enum(['draft', 'confirmed', 'partial_received', 'received', 'cancelled']).optional(),
  startDate: z.string().datetime().transform(val => new Date(val)).optional(),
  endDate: z.string().datetime().transform(val => new Date(val)).optional(),
  limit: z.string().transform(val => parseInt(val, 10)).optional(),
  offset: z.string().transform(val => parseInt(val, 10)).optional(),
});

export const idParamSchema = z.object({
  id: z.string().uuid(),
});

// Inferred types
export type CreatePurchaseOrderInput = z.infer<typeof createPurchaseOrderSchema>;
export type UpdatePurchaseOrderInput = z.infer<typeof updatePurchaseOrderSchema>;
export type ReceiveStockInput = z.infer<typeof receiveStockSchema>;
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;
export type GetPurchaseOrdersQuery = z.infer<typeof getPurchaseOrdersQuerySchema>;
