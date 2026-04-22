import { z } from 'zod';

export const listMovementsQuerySchema = z.object({
  customerId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  includeVoided: z.string().optional().transform((v) => v === 'true'),
  limit: z.string().transform((v) => parseInt(v, 10)).default('100'),
  offset: z.string().transform((v) => parseInt(v, 10)).default('0'),
});

export const depositSchema = z.object({
  customerId: z.string().uuid(),
  branchId: z.string().uuid(),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  method: z.enum(['cash', 'ibft', 'bank_card', 'pso_card']),
  amount: z.number().positive(),
  bankId: z.string().uuid().optional(),
  referenceNumber: z.string().max(100).optional(),
  memo: z.string().max(2000).optional(),
  shiftInstanceId: z.string().uuid().optional(),
});

export const cashHandoutSchema = z.object({
  customerId: z.string().uuid(),
  branchId: z.string().uuid(),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number().positive(),
  memo: z.string().max(2000).optional(),
  shiftInstanceId: z.string().uuid().optional(),
});

export const voidSchema = z.object({
  reason: z.string().min(1),
});

export const balanceQuerySchema = z.object({
  customerId: z.string().uuid(),
});
