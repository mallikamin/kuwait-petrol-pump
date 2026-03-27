import { z } from 'zod';

export const createBifurcationSchema = z.object({
  branchId: z.string().uuid(),
  date: z.string().datetime().transform(val => new Date(val)),
  shiftInstanceId: z.string().uuid().optional(),
  pmgTotalLiters: z.number().nonnegative().optional(),
  pmgTotalAmount: z.number().nonnegative().optional(),
  hsdTotalLiters: z.number().nonnegative().optional(),
  hsdTotalAmount: z.number().nonnegative().optional(),
  cashAmount: z.number().nonnegative().optional(),
  creditAmount: z.number().nonnegative().optional(),
  cardAmount: z.number().nonnegative().optional(),
  psoCardAmount: z.number().nonnegative().optional(),
  expectedTotal: z.number().optional(),
  actualTotal: z.number().nonnegative(),
  varianceNotes: z.string().optional(),
});

export const getBifurcationByDateSchema = z.object({
  branchId: z.string().uuid().optional(),
  date: z.string().datetime().transform(val => new Date(val)),
});

export const idParamSchema = z.object({
  id: z.string().uuid(),
});

export const getBifurcationHistorySchema = z.object({
  branchId: z.string().uuid(),
  startDate: z.string().datetime().transform(val => new Date(val)).optional(),
  endDate: z.string().datetime().transform(val => new Date(val)).optional(),
  status: z.enum(['pending', 'completed', 'verified']).optional(),
  limit: z.string().transform(val => parseInt(val, 10)).optional(),
  offset: z.string().transform(val => parseInt(val, 10)).optional(),
});

export const getPendingBifurcationsSchema = z.object({
  branchId: z.string().uuid(),
});

// Inferred types - single source of truth
export type CreateBifurcationInput = z.infer<typeof createBifurcationSchema>;
