import { Router } from 'express';
import { AdminController } from './admin.controller';
import { authenticate, authorize } from '../../middleware/auth.middleware';

const router = Router();
const controller = new AdminController();

// Master Client List — read-only listing of all organizations + branches
// + user counts + QB connection status. Admin-only.
router.get('/clients', authenticate, authorize('admin'), controller.listClients);

export default router;
