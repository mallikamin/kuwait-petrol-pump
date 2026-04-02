import { z } from 'zod';

// Transform empty strings to undefined so optional validators pass
const emptyToUndefined = (val: unknown) => (val === '' ? undefined : val);

export const createCustomerSchema = z.object({
  name: z.string().min(1, 'Customer name is required'),
  phone: z.string().optional(),
  email: z.preprocess(emptyToUndefined, z.string().email().optional()),
  address: z.string().optional(),
  vehicleNumbers: z.array(z.string()).optional(),
  creditLimit: z.number().nonnegative().optional(),
  creditDays: z.number().int().nonnegative().optional(),
});

export const updateCustomerSchema = z.object({
  name: z.string().min(1).optional(),
  phone: z.string().optional(),
  email: z.preprocess(emptyToUndefined, z.string().email().optional()),
  address: z.string().optional(),
  vehicleNumbers: z.array(z.string()).optional(),
  creditLimit: z.number().nonnegative().optional(),
  creditDays: z.number().int().nonnegative().optional(),
  isActive: z.boolean().optional(),
});

export const getCustomersQuerySchema = z.object({
  search: z.string().optional(),
  isActive: z.enum(['true', 'false']).transform(val => val === 'true').optional(),
  limit: z.string().transform(val => parseInt(val, 10)).optional(),
  offset: z.string().transform(val => parseInt(val, 10)).optional(),
});

export const getLedgerQuerySchema = z.object({
  startDate: z.string().datetime().transform(val => new Date(val)).optional(),
  endDate: z.string().datetime().transform(val => new Date(val)).optional(),
  limit: z.string().transform(val => parseInt(val, 10)).optional(),
  offset: z.string().transform(val => parseInt(val, 10)).optional(),
});

export const idParamSchema = z.object({
  id: z.string().uuid(),
});

// Inferred types - single source of truth
export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
