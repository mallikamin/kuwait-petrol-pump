import { Router } from 'express';
import { ProductsController } from './products.controller';
import { authenticate, authorize } from '../../middleware/auth.middleware';

const router = Router();
const controller = new ProductsController();

// All routes require authentication
router.use(authenticate);

// Public read routes
router.get('/categories', controller.getCategories);
router.get('/low-stock', controller.getLowStockProducts);
router.get('/search', controller.searchProducts);
router.get('/:id/stock', controller.getStockLevels);
router.get('/:id', controller.getProductById);
router.get('/', controller.getAllProducts);

// Admin/Manager only routes
router.post('/', authorize('admin', 'manager'), controller.createProduct);
router.put('/:id', authorize('admin', 'manager'), controller.updateProduct);
router.put('/:id/stock', authorize('admin', 'manager'), controller.updateStockLevel);

export default router;
