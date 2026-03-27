import { Router } from 'express';
import { CustomersController } from './customers.controller';
import { authenticate } from '../../middleware/auth.middleware';

const router = Router();
const customersController = new CustomersController();

// All routes require authentication
router.use(authenticate);

// Customer routes
router.get('/', customersController.getAllCustomers);
router.post('/', customersController.createCustomer);
router.get('/:id', customersController.getCustomerById);
router.put('/:id', customersController.updateCustomer);
router.get('/:id/ledger', customersController.getCustomerLedger);

export default router;
