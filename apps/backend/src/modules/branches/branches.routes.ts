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
router.post('/:id/dispensing-units', branchesController.createDispensingUnit);

// Dispensing unit routes (prefix: /api/dispensing-units)
export const dispensingUnitsRouter = Router();
dispensingUnitsRouter.use(authenticate);
dispensingUnitsRouter.get('/:id', branchesController.getDispensingUnitById);
dispensingUnitsRouter.get('/:id/nozzles', branchesController.getNozzlesByUnit);
dispensingUnitsRouter.post('/:id/nozzles', branchesController.createNozzle);

export default router;
