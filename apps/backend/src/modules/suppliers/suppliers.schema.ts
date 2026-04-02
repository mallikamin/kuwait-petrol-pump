import { z } from 'zod';

export const createSupplierSchema = z.object({
  name: z.string().min(1, 'Supplier name is required'),
  code: z.string().optional(),
  contactPerson: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email('Invalid email format').optional().or(z.literal('')),
  paymentTerms: z.string().optional(),
  creditDays: z.number().int().positive().optional(),
});

export const updateSupplierSchema = z.object({
  name: z.string().min(1).optional(),
  code: z.string().optional(),
  contactPerson: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email('Invalid email format').optional().or(z.literal('')),
  paymentTerms: z.string().optional(),
  creditDays: z.number().int().positive().optional(),
  isActive: z.boolean().optional(),
});

export const getSuppliersQuerySchema = z.object({
  search: z.string().optional(),
  isActive: z.enum(['true', 'false']).transform(val => val === 'true').optional(),
  limit: z.string().transform(val => parseInt(val, 10)).optional(),
  offset: z.string().transform(val => parseInt(val, 10)).optional(),
});

export const idParamSchema = z.object({
  id: z.string().uuid(),
});

// Inferred types
export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;
export type GetSuppliersQuery = z.infer<typeof getSuppliersQuerySchema>;
