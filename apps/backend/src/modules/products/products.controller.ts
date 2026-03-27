import { Request, Response, NextFunction } from 'express';
import { ProductsService } from './products.service';
import {
  createProductSchema,
  updateProductSchema,
  getProductsQuerySchema,
  searchProductsQuerySchema,
  stockLevelSchema,
  idParamSchema,
  CreateProductInput,
} from './products.schema';

export class ProductsController {
  private service: ProductsService;

  constructor() {
    this.service = new ProductsService();
  }

  /**
   * GET /api/products
   * List all products with optional filters
   */
  getAllProducts = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { search, category, isActive, limit, offset } = getProductsQuerySchema.parse(req.query);

      const products = await this.service.getAllProducts(req.user.organizationId, {
        search,
        category,
        isActive: isActive === 'true' ? true : isActive === 'false' ? false : undefined,
        limit: limit ? parseInt(limit) : 50,
        offset: offset ? parseInt(offset) : 0,
      });

      res.json(products);
    } catch (error) {
      next(error);
    }
  };

  /**
   * POST /api/products
   * Create a new product (admin/manager only)
   */
  createProduct = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const data: CreateProductInput = createProductSchema.parse(req.body);

      const product = await this.service.createProduct(data, req.user.organizationId);

      res.status(201).json(product);
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/products/search
   * Search products by SKU or barcode
   */
  searchProducts = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { q } = searchProductsQuerySchema.parse(req.query);

      const products = await this.service.searchProducts(req.user.organizationId, q);

      res.json({ products });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/products/:id
   * Get product details by ID
   */
  getProductById = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { id } = idParamSchema.parse(req.params);

      const product = await this.service.getProductById(id, req.user.organizationId);

      res.json({ product });
    } catch (error) {
      next(error);
    }
  };

  /**
   * PUT /api/products/:id
   * Update a product (admin/manager only)
   */
  updateProduct = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { id } = idParamSchema.parse(req.params);
      const data = updateProductSchema.parse(req.body);

      const product = await this.service.updateProduct(id, req.user.organizationId, data);

      res.json({ product });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/products/:id/stock
   * Get stock levels for a product across branches
   */
  getStockLevels = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { id } = idParamSchema.parse(req.params);
      const { branchId } = req.query;

      const stockData = await this.service.getStockLevels(
        id,
        req.user.organizationId,
        branchId as string | undefined
      );

      res.json(stockData);
    } catch (error) {
      next(error);
    }
  };

  /**
   * PUT /api/products/:id/stock
   * Update stock level for a product at a branch (admin/manager only)
   */
  updateStockLevel = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { id } = idParamSchema.parse(req.params);
      const { branchId, quantity } = stockLevelSchema.parse(req.body);

      const stockLevel = await this.service.updateStockLevel(
        id,
        branchId,
        req.user.organizationId,
        quantity
      );

      res.json({ stockLevel });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/products/categories
   * Get all product categories for organization
   */
  getCategories = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const categories = await this.service.getCategories(req.user.organizationId);

      res.json({ categories });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/products/low-stock
   * Get products with low stock levels
   */
  getLowStockProducts = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { branchId } = req.query;

      const products = await this.service.getLowStockProducts(
        req.user.organizationId,
        branchId as string | undefined
      );

      res.json({ products });
    } catch (error) {
      next(error);
    }
  };
}
