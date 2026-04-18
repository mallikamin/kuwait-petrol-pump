import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { bootstrapService, type BootstrapCategory } from './bootstrap.service';
import { hasRole } from '../../middleware/auth.middleware';

const listQuerySchema = z.object({
  branchId: z.string().uuid(),
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  category: z.enum(['all', 'total_fuel', 'HSD', 'PMG', 'non_fuel']).optional(),
  productId: z.string().uuid().optional(),
});

const upsertBodySchema = z.object({
  branchId: z.string().uuid(),
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rows: z
    .array(
      z
        .object({
          productId: z.string().uuid().nullable().optional(),
          fuelTypeId: z.string().uuid().nullable().optional(),
          quantity: z.number().finite(),
          notes: z.string().max(2000).nullable().optional(),
        })
        // Exactly one of productId / fuelTypeId must be present.
        .refine(
          (r) => !!r.productId !== !!r.fuelTypeId,
          { message: 'exactly one of productId or fuelTypeId is required' },
        ),
    )
    .min(1),
});

// Role gate shared by both endpoints - only admins, managers, and
// accountants should touch opening stock numbers.
const ALLOWED_ROLES = ['admin', 'manager', 'accountant'];

export class BootstrapController {
  list = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
      if (!hasRole(req.user, ALLOWED_ROLES)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      const parsed = listQuerySchema.parse(req.query);
      const rows = await bootstrapService.listBootstrap({
        branchId: parsed.branchId,
        asOfDate: parsed.asOfDate,
        category: parsed.category as BootstrapCategory | undefined,
        productId: parsed.productId,
      });
      return res.json({
        branchId: parsed.branchId,
        asOfDate: parsed.asOfDate,
        rows,
      });
    } catch (error) {
      next(error);
    }
  };

  upsert = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
      if (!hasRole(req.user, ALLOWED_ROLES)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      const body = upsertBodySchema.parse(req.body);
      const result = await bootstrapService.upsertBootstrap({
        branchId: body.branchId,
        asOfDate: body.asOfDate,
        rows: body.rows.map((r) => ({
          productId: r.productId ?? null,
          fuelTypeId: r.fuelTypeId ?? null,
          quantity: r.quantity,
          notes: r.notes ?? null,
        })),
        updatedBy: req.user.userId,
      });
      return res.json({
        branchId: body.branchId,
        asOfDate: body.asOfDate,
        ...result,
      });
    } catch (error) {
      next(error);
    }
  };
}

export const bootstrapController = new BootstrapController();
