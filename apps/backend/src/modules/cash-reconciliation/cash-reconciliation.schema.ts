import { z } from 'zod';

export const previewQuerySchema = z.object({
  branchId: z.string().uuid(),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const submitSchema = z.object({
  branchId: z.string().uuid(),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  physicalCash: z.number().nonnegative(),
  notes: z.string().max(2000).optional(),
  close: z.boolean().optional().default(false),
});

export const reopenSchema = z.object({
  reconId: z.string().uuid(),
  reason: z.string().min(1),
});
