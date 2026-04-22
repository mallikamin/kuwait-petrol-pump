import { Request, Response, NextFunction } from 'express';
import { hasRole } from '../../middleware/auth.middleware';
import { CashLedgerService } from './cash-ledger.service';
import {
  createManualAdjustmentSchema,
  daySummaryQuerySchema,
  reverseEntrySchema,
} from './cash-ledger.schema';
import { randomUUID } from 'crypto';

export class CashLedgerController {
  getDaySummary = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
      if (!hasRole(req.user, ['admin', 'manager', 'accountant'])) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      const params = daySummaryQuerySchema.parse(req.query);
      const summary = await CashLedgerService.getDaySummary(
        req.user.organizationId,
        params.branchId,
        params.businessDate,
      );
      return res.json({ success: true, data: summary });
    } catch (err) {
      next(err);
    }
  };

  createManualAdjustment = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
      if (!hasRole(req.user, ['admin', 'manager'])) {
        return res.status(403).json({ error: 'Only managers/admins may post manual cash adjustments' });
      }
      const body = createManualAdjustmentSchema.parse(req.body);
      const sourceId = randomUUID();
      await CashLedgerService.post({
        organizationId: req.user.organizationId,
        branchId: body.branchId,
        businessDate: new Date(`${body.businessDate}T00:00:00Z`),
        direction: body.direction,
        source: 'MANUAL_ADJUSTMENT',
        sourceId,
        amount: body.amount,
        memo: body.memo,
        createdBy: req.user.userId,
      });
      return res.status(201).json({ success: true, sourceId });
    } catch (err) {
      next(err);
    }
  };

  reverseEntry = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
      if (!hasRole(req.user, ['admin', 'manager'])) {
        return res.status(403).json({ error: 'Only managers/admins may reverse cash ledger entries' });
      }
      const body = reverseEntrySchema.parse(req.body);
      await CashLedgerService.reverse(body.entryId, req.user.userId, body.reason);
      return res.json({ success: true });
    } catch (err) {
      next(err);
    }
  };
}
