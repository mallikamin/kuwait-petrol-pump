import { Request, Response, NextFunction } from 'express';
import { BanksService } from './banks.service';

export class BanksController {
  private banksService: BanksService;

  constructor() {
    this.banksService = new BanksService();
  }

  /**
   * GET /api/banks
   * Get all banks for organization
   */
  getAll = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { organizationId } = req.user;
      const banks = await this.banksService.getAll(organizationId);

      res.json({
        success: true,
        count: banks.length,
        banks,
      });
    } catch (error) {
      next(error);
    }
  };
}
