import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { bootstrapController } from './bootstrap.controller';

const router = Router();

// GET /api/inventory/bootstrap?branchId=...&asOfDate=YYYY-MM-DD[&category=...][&productId=...]
router.get('/', authenticate, bootstrapController.list);

// PUT /api/inventory/bootstrap - bulk upsert of opening quantities
router.put('/', authenticate, bootstrapController.upsert);

export default router;
