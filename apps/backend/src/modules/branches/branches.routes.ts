import { Router } from 'express';
import { BranchesController } from './branches.controller';
import { authenticate } from '../../middleware/auth.middleware';

const router = Router();
const branchesController = new BranchesController();

// All routes require authentication
router.use(authenticate);

// Branch routes
router.get('/', branchesController.getAllBranches);
router.get('/:id', branchesController.getBranchById);
router.get('/:id/dispensing-units', branchesController.getDispensingUnits);

// Dispensing unit routes (prefix: /api/dispensing-units)
export const dispensingUnitsRouter = Router();
dispensingUnitsRouter.use(authenticate);
dispensingUnitsRouter.get('/:id', branchesController.getDispensingUnitById);
dispensingUnitsRouter.get('/:id/nozzles', branchesController.getNozzlesByUnit);

export default router;
