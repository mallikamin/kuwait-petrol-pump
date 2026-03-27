import { Router } from 'express';
import { UsersController } from './users.controller';
import { authenticate, authorize } from '../../middleware/auth.middleware';

const router = Router();
const usersController = new UsersController();

// All routes require authentication + admin or manager role
router.use(authenticate);
router.use(authorize('admin', 'manager'));

// User management routes
router.get('/', usersController.getAll);
router.post('/', usersController.create);
router.get('/:id', usersController.getById);
router.put('/:id', usersController.update);
router.delete('/:id', usersController.delete);
router.post('/:id/reset-password', usersController.resetPassword);

export default router;
