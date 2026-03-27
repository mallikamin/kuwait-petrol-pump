import { Router } from 'express';
import { NozzlesController } from './nozzles.controller';
import { authenticate } from '../../middleware/auth.middleware';

const router = Router();
const nozzlesController = new NozzlesController();

// All routes require authentication
router.use(authenticate);

router.get('/', nozzlesController.getAllNozzles);
router.get('/:id', nozzlesController.getNozzleById);
router.patch('/:id', nozzlesController.updateNozzleStatus);
router.get('/:id/latest-reading', nozzlesController.getLatestReading);

export default router;
