import { z } from 'zod';

export const createProductSchema = z.object({
  sku: z.string().min(1).max(100),
  name: z.string().min(1).max(255),
  category: z.string().max(100).optional(),
  barcode: z.string().max(100).optional(),
  unitPrice: z.number().positive(),
  costPrice: z.number().nonnegative().optional(),
  lowStockThreshold: z.number().int().nonnegative().optional(),
});

export const updateProductSchema = z.object({
  sku: z.string().min(1).max(100).optional(),
  name: z.string().min(1).max(255).optional(),
  category: z.string().max(100).optional(),
  barcode: z.string().max(100).optional(),
  unitPrice: z.number().positive().optional(),
  costPrice: z.number().nonnegative().optional(),
  lowStockThreshold: z.number().int().nonnegative().optional(),
  isActive: z.boolean().optional(),
});

export const getProductsQuerySchema = z.object({
  search: z.string().optional(),
  category: z.string().optional(),
  isActive: z.enum(['true', 'false']).optional(),
  limit: z.string().regex(/^\d+$/).optional(),
  offset: z.string().regex(/^\d+$/).optional(),
});

export const searchProductsQuerySchema = z.object({
  q: z.string().min(1),
});

export const stockLevelSchema = z.object({
  branchId: z.string().uuid(),
  quantity: z.number().int().nonnegative(),
});

export const idParamSchema = z.object({
  id: z.string().uuid(),
});

// Inferred types - single source of truth
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
