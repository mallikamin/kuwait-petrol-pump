import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AdminService } from './admin.service';

const userIdParamSchema = z.object({ userId: z.string().uuid() });
const setOrgAccessBodySchema = z.object({
  orgIds: z.array(z.string().uuid()),
});

export class AdminController {
  private adminService: AdminService;

  constructor() {
    this.adminService = new AdminService();
  }

  listClients = async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const clients = await this.adminService.listClients();
      res.json({ clients });
    } catch (error) {
      next(error);
    }
  };

  listUsersWithOrgAccess = async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const users = await this.adminService.listUsersWithOrgAccess();
      res.json({ users });
    } catch (error) {
      next(error);
    }
  };

  getUserOrgAccess = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = userIdParamSchema.parse(req.params);
      const result = await this.adminService.getUserOrgAccess(userId);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  setUserOrgAccess = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }
      const { userId } = userIdParamSchema.parse(req.params);
      const { orgIds } = setOrgAccessBodySchema.parse(req.body);
      const result = await this.adminService.setUserOrgAccess(userId, orgIds, req.user.userId);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };
}
