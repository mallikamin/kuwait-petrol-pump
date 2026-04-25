import { Request, Response, NextFunction } from 'express';
import { AdminService } from './admin.service';

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
}
