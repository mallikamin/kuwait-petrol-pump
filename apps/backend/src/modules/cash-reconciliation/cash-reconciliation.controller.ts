import { Request, Response, NextFunction } from 'express';
import { hasRole } from '../../middleware/auth.middleware';
import { CashReconciliationService } from './cash-reconciliation.service';
import { previewQuerySchema, reopenSchema, submitSchema, summaryRangeQuerySchema } from './cash-reconciliation.schema';

export class CashReconciliationController {
  getPreview = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
      if (!hasRole(req.user, ['admin', 'manager', 'accountant'])) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      const q = previewQuerySchema.parse(req.query);
      const preview = await CashReconciliationService.getPreview(
        req.user.organizationId,
        q.branchId,
        q.businessDate,
      );
      return res.json({ success: true, data: preview });
    } catch (err) { next(err); }
  };

  submit = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
      if (!hasRole(req.user, ['admin', 'manager', 'accountant'])) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      const body = submitSchema.parse(req.body);
      const recon = await CashReconciliationService.submit({
        organizationId: req.user.organizationId,
        userId: req.user.userId,
        branchId: body.branchId,
        businessDate: body.businessDate,
        physicalCash: body.physicalCash,
        notes: body.notes,
        close: body.close,
      });
      return res.json({ success: true, data: recon });
    } catch (err) { next(err); }
  };

  getSummaryRange = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
      if (!hasRole(req.user, ['admin', 'manager', 'accountant'])) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      const q = summaryRangeQuerySchema.parse(req.query);
      const rows = await CashReconciliationService.getSummaryRange(
        req.user.organizationId,
        q.branchId,
        q.from,
        q.to,
      );
      return res.json({ success: true, data: rows });
    } catch (err) { next(err); }
  };

  reopen = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
      if (!hasRole(req.user, ['admin', 'manager'])) {
        return res.status(403).json({ error: 'Only managers/admins may reopen a closed day' });
      }
      const body = reopenSchema.parse(req.body);
      await CashReconciliationService.reopen(
        req.user.organizationId,
        body.reconId,
        req.user.userId,
        body.reason,
      );
      return res.json({ success: true });
    } catch (err) { next(err); }
  };
}
