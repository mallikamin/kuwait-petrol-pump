import { Request, Response, NextFunction } from 'express';
import { hasRole } from '../../middleware/auth.middleware';
import { PsoTopupService } from './pso-topup.service';
import { createSchema, listQuerySchema, voidSchema } from './pso-topup.schema';

export class PsoTopupController {
  list = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
      if (!hasRole(req.user, ['admin', 'manager', 'accountant', 'cashier'])) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      const q = listQuerySchema.parse(req.query);
      const result = await PsoTopupService.list({
        organizationId: req.user.organizationId,
        branchId: q.branchId,
        startDate: q.startDate,
        endDate: q.endDate,
        includeVoided: q.includeVoided,
        limit: q.limit,
        offset: q.offset,
      });
      return res.json({ success: true, ...result });
    } catch (err) { next(err); }
  };

  create = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
      if (!hasRole(req.user, ['admin', 'manager', 'accountant', 'cashier'])) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      const body = createSchema.parse(req.body);
      const topup = await PsoTopupService.create({
        organizationId: req.user.organizationId,
        userId: req.user.userId,
        branchId: body.branchId,
        businessDate: body.businessDate,
        customerId: body.customerId,
        psoCardLast4: body.psoCardLast4,
        amount: body.amount,
        memo: body.memo,
        shiftInstanceId: body.shiftInstanceId,
      });
      return res.status(201).json({ success: true, data: topup });
    } catch (err) { next(err); }
  };

  void = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
      if (!hasRole(req.user, ['admin', 'manager'])) {
        return res.status(403).json({ error: 'Only managers/admins may void PSO top-ups' });
      }
      const body = voidSchema.parse(req.body);
      await PsoTopupService.voidEntry(
        req.user.organizationId,
        req.params.id,
        req.user.userId,
        body.reason,
      );
      return res.json({ success: true });
    } catch (err) { next(err); }
  };
}
