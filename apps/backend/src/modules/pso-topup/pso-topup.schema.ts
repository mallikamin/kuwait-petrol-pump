import { z } from 'zod';

export const listQuerySchema = z.object({
  branchId: z.string().uuid(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  includeVoided: z.string().optional().transform((v) => v === 'true'),
  limit: z.string().transform((v) => parseInt(v, 10)).default('100'),
  offset: z.string().transform((v) => parseInt(v, 10)).default('0'),
});

export const createSchema = z.object({
  branchId: z.string().uuid(),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  customerId: z.string().uuid().optional(),
  psoCardLast4: z.string().max(10).optional(),
  amount: z.number().positive(),
  memo: z.string().max(2000).optional(),
  shiftInstanceId: z.string().uuid().optional(),
});

export const voidSchema = z.object({
  reason: z.string().min(1),
});
