import { z } from 'zod';

export const daySummaryQuerySchema = z.object({
  branchId: z.string().uuid(),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD'),
});

export const createManualAdjustmentSchema = z.object({
  branchId: z.string().uuid(),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD'),
  direction: z.enum(['IN', 'OUT']),
  amount: z.number().positive(),
  memo: z.string().min(1, 'memo required for manual adjustment'),
});

export const reverseEntrySchema = z.object({
  entryId: z.string().uuid(),
  reason: z.string().min(1),
});
