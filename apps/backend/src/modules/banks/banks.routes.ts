import { Router } from 'express';
import { BanksController } from './banks.controller';
import { authenticate } from '../../middleware/auth.middleware';

const router = Router();
const banksController = new BanksController();

// GET /api/banks - Get all banks
router.get('/', authenticate, banksController.getAll);

export default router;
