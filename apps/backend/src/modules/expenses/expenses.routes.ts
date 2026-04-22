import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { ExpensesController } from './expenses.controller';

const router = Router();
const controller = new ExpensesController();

router.use(authenticate);

// Accounts (the 17 seeded + any user-added)
router.get('/accounts', controller.listAccounts);
router.post('/accounts', controller.createAccount);
router.patch('/accounts/:id', controller.updateAccount);

// Entries (cashier-facing cash-out log)
router.get('/entries', controller.listEntries);
router.post('/entries', controller.createEntry);
router.post('/entries/:id/void', controller.voidEntry);

export default router;
