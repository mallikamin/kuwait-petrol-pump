import { Request, Response, NextFunction } from 'express';
import { DailyBackdatedEntriesService } from './daily.service';
import { hasRole } from '../../middleware/auth.middleware';
import { z } from 'zod';
import { createHash } from 'crypto';
import { redis } from '../../config/redis';

/**
 * Daily Backdated Entries Controller
 *
 * Day-level consolidated endpoints for accountant reconciliation workflow
 */

const getDailySummaryQuerySchema = z.object({
  branchId: z.string().uuid(),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  shiftId: z.string().uuid().optional(),
});

const saveDailyDraftSchema = z.object({
  branchId: z.string().uuid(),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  shiftId: z.string().uuid().optional(),
  transactions: z.array(
    z.object({
      id: z.string().uuid().optional(), // ✅ NEW: Client-side stable ID for upsert (prevents data loss)
      customerId: z.string().uuid().optional(),
      nozzleId: z.string().uuid().optional(), // Optional - backlog slips may lack nozzle detail
      fuelCode: z.string().optional(), // HSD, PMG, etc. - used when nozzleId not available
      vehicleNumber: z.string().optional(),
      slipNumber: z.string().optional(),
      productName: z.string(),
      quantity: z.number().positive(),
      unitPrice: z.number().positive(),
      lineTotal: z.number().positive(),
      paymentMethod: z.enum(['cash', 'credit_card', 'bank_card', 'pso_card', 'credit_customer']),
      bankId: z.string().uuid().optional(), // Required for credit_card/bank_card payments
    })
  ),
});

const finalizeDaySchema = z.object({
  branchId: z.string().uuid(),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export class DailyBackdatedEntriesController {
  private service: DailyBackdatedEntriesService;

  constructor() {
    this.service = new DailyBackdatedEntriesService();
  }

  /**
   * GET /api/backdated-entries/daily
   *
   * Get consolidated daily summary:
   * - All nozzles with meter status
   * - HSD/PMG meter totals
   * - All transactions
   * - Posted liters by fuel
   * - Remaining liters
   * - Payment breakdown
   * - Back-traced cash calculation
   */
  getDailySummary = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      if (!hasRole(req.user, ['admin', 'manager', 'accountant'])) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const params = getDailySummaryQuerySchema.parse(req.query);

      const summary = await this.service.getDailySummary(
        {
          branchId: params.branchId,
          businessDate: params.businessDate,
          shiftId: params.shiftId,
        },
        req.user.organizationId
      );

      res.json({
        success: true,
        data: summary,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * POST /api/backdated-entries/daily
   *
   * Upsert/save draft:
   * - Create/update entries per nozzle based on transactions
   * - Save all transactions
   * - Return updated daily summary
   */
  saveDailyDraft = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      if (!hasRole(req.user, ['admin', 'manager', 'accountant'])) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const validatedData = saveDailyDraftSchema.parse(req.body);

      // ✅ IDEMPOTENCY GUARD: Prevent duplicate saves from rapid clicks/retries/multi-tab
      const payloadHash = createHash('sha256')
        .update(JSON.stringify({
          transactions: validatedData.transactions.map(t => ({
            id: t.id,
            productName: t.productName,
            quantity: t.quantity,
            unitPrice: t.unitPrice,
            paymentMethod: t.paymentMethod,
          })),
        }))
        .digest('hex')
        .substring(0, 16);

      const idempotencyKey = `save-draft:${req.user.organizationId}:${validatedData.branchId}:${validatedData.businessDate}:${validatedData.shiftId || 'no-shift'}:${payloadHash}`;

      const existing = await redis.get(idempotencyKey);
      if (existing) {
        return res.status(409).json({
          error: 'Save already in progress',
          message: 'A save request with the same data is currently being processed. Please wait.',
        });
      }

      // Set key with 45s TTL (enough for save + network lag, but not too long)
      await redis.set(idempotencyKey, '1', { EX: 45 });

      const summary = await this.service.saveDailyDraft(
        {
          branchId: validatedData.branchId,
          businessDate: validatedData.businessDate,
          shiftId: validatedData.shiftId,
          transactions: validatedData.transactions as any[], // Zod validation ensures shape
        },
        req.user.organizationId,
        req.user.userId // Pass user ID for audit trail
      );

      // Clear idempotency key after successful save
      await redis.del(idempotencyKey);

      res.status(200).json({
        success: true,
        message: 'Daily draft saved successfully',
        data: summary,
      });
    } catch (error) {
      // Clear idempotency key on error to allow retry
      try {
        const validatedData = saveDailyDraftSchema.parse(req.body);
        const payloadHash = createHash('sha256')
          .update(JSON.stringify({
            transactions: validatedData.transactions.map(t => ({
              id: t.id,
              productName: t.productName,
              quantity: t.quantity,
              unitPrice: t.unitPrice,
              paymentMethod: t.paymentMethod,
            })),
          }))
          .digest('hex')
          .substring(0, 16);
        const idempotencyKey = `save-draft:${req.user?.organizationId}:${validatedData.branchId}:${validatedData.businessDate}:${validatedData.shiftId || 'no-shift'}:${payloadHash}`;
        await redis.del(idempotencyKey);
      } catch {
        // Ignore cleanup errors
      }
      next(error);
    }
  };

  /**
   * GET /api/backdated-entries/daily/forensic
   *
   * Forensic inspection endpoint (DIAGNOSTIC)
   * Returns detailed transaction audit trail with consistency checks
   */
  getForensicTransactions = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      if (!hasRole(req.user, ['admin', 'manager', 'accountant'])) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const params = getDailySummaryQuerySchema.parse(req.query);

      const forensic = await this.service.getForensicTransactions(
        {
          branchId: params.branchId,
          businessDate: params.businessDate,
          shiftId: params.shiftId,
        },
        req.user.organizationId
      );

      res.json({
        success: true,
        data: forensic,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * POST /api/backdated-entries/daily/finalize
   *
   * Mark all entries for the day as finalized and enqueue QB sync
   */
  finalizeDay = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      if (!hasRole(req.user, ['admin', 'manager', 'accountant'])) {
        return res.status(403).json({
          error: 'Insufficient permissions. Only admin, manager, or accountant can finalize entries.',
        });
      }

      const validatedData = finalizeDaySchema.parse(req.body);

      const result = await this.service.finalizeDay(
        {
          branchId: validatedData.branchId,
          businessDate: validatedData.businessDate,
        },
        req.user.organizationId
      );

      res.status(200).json({
        success: true,
        message: result.message,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };
}
