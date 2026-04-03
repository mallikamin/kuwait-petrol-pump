import { z } from 'zod';

export const createBackdatedEntrySchema = z.object({
  date: z.string().datetime().transform(val => new Date(val)),
  nozzleId: z.string().uuid(),
  openingReading: z.number().nonnegative(),
  closingReading: z.number().nonnegative(),

  // Payment bifurcation (all in currency units)
  creditCardSales: z.number().nonnegative().optional().default(0),
  bankCardSales: z.number().nonnegative().optional().default(0),
  psoCardSales: z.number().nonnegative().optional().default(0),

  // Optional fields
  notes: z.string().optional(),
}).refine(
  (data) => data.closingReading > data.openingReading,
  { message: 'Closing reading must be greater than opening reading' }
);

export type CreateBackdatedEntryInput = z.infer<typeof createBackdatedEntrySchema>;
