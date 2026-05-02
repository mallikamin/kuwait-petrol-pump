import { Router } from 'express';
import { FuelPricesController } from './fuel-prices.controller';
import { authenticate, authorize } from '../../middleware/auth.middleware';

const router = Router();
const controller = new FuelPricesController();

router.get('/current', controller.getCurrentPrices);
router.get('/for-date', controller.getPricesForDate); // Get prices for specific date (backdated)
router.get('/history', authenticate, controller.getPriceHistory);
router.post('/', authenticate, authorize('admin', 'manager', 'accountant'), controller.updatePrice);
router.get('/fuel-types', controller.getFuelTypes);

export default router;
