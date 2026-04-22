import { Request, Response, NextFunction } from 'express';
import { hasRole } from '../../middleware/auth.middleware';
import { ExpensesService } from './expenses.service';
import {
  createAccountSchema,
  createEntrySchema,
  listAccountsQuerySchema,
  listEntriesQuerySchema,
  updateAccountSchema,
  voidEntrySchema,
} from './expenses.schema';

export class ExpensesController {
  listAccounts = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
      const q = listAccountsQuerySchema.parse(req.query);
      const accounts = await ExpensesService.listAccounts(req.user.organizationId, !!q.includeInactive);
      return res.json({ success: true, items: accounts });
    } catch (err) { next(err); }
  };

  createAccount = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
      if (!hasRole(req.user, ['admin', 'manager'])) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      const body = createAccountSchema.parse(req.body);
      const account = await ExpensesService.createAccount({
        organizationId: req.user.organizationId,
        label: body.label,
        qbAccountName: body.qbAccountName,
        sortOrder: body.sortOrder,
      });
      return res.status(201).json({ success: true, data: account });
    } catch (err) { next(err); }
  };

  updateAccount = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
      if (!hasRole(req.user, ['admin', 'manager'])) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      const body = updateAccountSchema.parse(req.body);
      const account = await ExpensesService.updateAccount(
        req.user.organizationId,
        req.params.id,
        body,
      );
      return res.json({ success: true, data: account });
    } catch (err) { next(err); }
  };

  listEntries = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
      if (!hasRole(req.user, ['admin', 'manager', 'accountant', 'cashier'])) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      const q = listEntriesQuerySchema.parse(req.query);
      const result = await ExpensesService.listEntries({
        organizationId: req.user.organizationId,
        branchId: q.branchId,
        startDate: q.startDate,
        endDate: q.endDate,
        expenseAccountId: q.expenseAccountId,
        includeVoided: q.includeVoided,
        limit: q.limit,
        offset: q.offset,
      });
      return res.json({ success: true, ...result });
    } catch (err) { next(err); }
  };

  createEntry = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
      if (!hasRole(req.user, ['admin', 'manager', 'accountant', 'cashier'])) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      const body = createEntrySchema.parse(req.body);
      const entry = await ExpensesService.createEntry({
        organizationId: req.user.organizationId,
        userId: req.user.userId,
        branchId: body.branchId,
        businessDate: body.businessDate,
        expenseAccountId: body.expenseAccountId,
        amount: body.amount,
        memo: body.memo,
        attachmentPath: body.attachmentPath,
        shiftInstanceId: body.shiftInstanceId,
      });
      return res.status(201).json({ success: true, data: entry });
    } catch (err) { next(err); }
  };

  voidEntry = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
      if (!hasRole(req.user, ['admin', 'manager'])) {
        return res.status(403).json({ error: 'Only managers/admins may void expense entries' });
      }
      const body = voidEntrySchema.parse(req.body);
      await ExpensesService.voidEntry(
        req.user.organizationId,
        req.params.id,
        req.user.userId,
        body.reason,
      );
      return res.json({ success: true });
    } catch (err) { next(err); }
  };
}
