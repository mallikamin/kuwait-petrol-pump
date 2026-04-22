import { Request, Response, NextFunction } from 'express';
import { hasRole } from '../../middleware/auth.middleware';
import { CustomerAdvanceService } from './customer-advance.service';
import {
  balanceQuerySchema,
  cashHandoutSchema,
  depositSchema,
  listMovementsQuerySchema,
  voidSchema,
} from './customer-advance.schema';

export class CustomerAdvanceController {
  getBalance = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
      const q = balanceQuerySchema.parse(req.query);
      const balance = await CustomerAdvanceService.getBalance(req.user.organizationId, q.customerId);
      return res.json({ success: true, data: balance });
    } catch (err) { next(err); }
  };

  listMovements = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
      const q = listMovementsQuerySchema.parse(req.query);
      const result = await CustomerAdvanceService.listMovements({
        organizationId: req.user.organizationId,
        customerId: q.customerId,
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

  deposit = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
      if (!hasRole(req.user, ['admin', 'manager', 'accountant', 'cashier'])) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      const body = depositSchema.parse(req.body);
      const movement = await CustomerAdvanceService.deposit({
        organizationId: req.user.organizationId,
        userId: req.user.userId,
        customerId: body.customerId,
        branchId: body.branchId,
        businessDate: body.businessDate,
        method: body.method,
        amount: body.amount,
        bankId: body.bankId,
        referenceNumber: body.referenceNumber,
        memo: body.memo,
        shiftInstanceId: body.shiftInstanceId,
      });
      return res.status(201).json({ success: true, data: movement });
    } catch (err) { next(err); }
  };

  cashHandout = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
      if (!hasRole(req.user, ['admin', 'manager', 'accountant', 'cashier'])) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      const body = cashHandoutSchema.parse(req.body);
      const movement = await CustomerAdvanceService.cashHandout({
        organizationId: req.user.organizationId,
        userId: req.user.userId,
        customerId: body.customerId,
        branchId: body.branchId,
        businessDate: body.businessDate,
        amount: body.amount,
        memo: body.memo,
        shiftInstanceId: body.shiftInstanceId,
      });
      return res.status(201).json({ success: true, data: movement });
    } catch (err) { next(err); }
  };

  voidMovement = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
      if (!hasRole(req.user, ['admin', 'manager'])) {
        return res.status(403).json({ error: 'Only managers/admins may void advance movements' });
      }
      const body = voidSchema.parse(req.body);
      await CustomerAdvanceService.voidMovement(
        req.user.organizationId,
        req.params.id,
        req.user.userId,
        body.reason,
      );
      return res.json({ success: true });
    } catch (err) { next(err); }
  };
}
