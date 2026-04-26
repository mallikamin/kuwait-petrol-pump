import { Router } from 'express';
import { AdminController } from './admin.controller';
import { authenticate, authorize } from '../../middleware/auth.middleware';

const router = Router();
const controller = new AdminController();

router.use(authenticate);
router.use(authorize('admin'));

// Master Client List — read-only listing of all organizations + branches
// + user counts + QB connection status.
router.get('/clients', controller.listClients);

// Cross-org access management (BPO/admin grants).
router.get('/users-with-org-access', controller.listUsersWithOrgAccess);
router.get('/users/:userId/org-access', controller.getUserOrgAccess);
router.put('/users/:userId/org-access', controller.setUserOrgAccess);

export default router;
