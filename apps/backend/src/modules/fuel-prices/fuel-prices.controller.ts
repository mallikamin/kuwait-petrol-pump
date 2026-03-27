import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { FuelPricesService } from './fuel-prices.service';

const updatePriceSchema = z.object({
  fuelTypeId: z.string().uuid(),
  price: z.number().positive(),
  effectiveFrom: z.string().datetime(),
  notes: z.string().optional(),
});

export class FuelPricesController {
  private service: FuelPricesService;

  constructor() {
    this.service = new FuelPricesService();
  }

  getCurrentPrices = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const prices = await this.service.getCurrentPrices();
      res.json(prices);
    } catch (error) {
      next(error);
    }
  };

  getPriceHistory = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { fuelTypeId, limit } = req.query;
      const prices = await this.service.getPriceHistory(
        fuelTypeId as string,
        limit ? parseInt(limit as string) : undefined
      );
      res.json(prices);
    } catch (error) {
      next(error);
    }
  };

  updatePrice = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { fuelTypeId, price, effectiveFrom, notes } = updatePriceSchema.parse(req.body);

      const newPrice = await this.service.updatePrice(
        fuelTypeId,
        price,
        new Date(effectiveFrom),
        req.user.userId,
        notes
      );

      res.json(newPrice);
    } catch (error) {
      next(error);
    }
  };

  getFuelTypes = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const fuelTypes = await this.service.getFuelTypes();
      res.json(fuelTypes);
    } catch (error) {
      next(error);
    }
  };
}
