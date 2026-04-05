import { prisma } from '../../config/database';
import { AppError } from '../../middleware/error.middleware';
import { Decimal } from '@prisma/client/runtime/library';
import { CreateProductInput } from './products.schema';

type CreateProductData = CreateProductInput;

interface UpdateProductData {
  sku?: string;
  name?: string;
  category?: string;
  barcode?: string;
  unitPrice?: number;
  costPrice?: number;
  lowStockThreshold?: number;
  isActive?: boolean;
}

interface ProductFilters {
  search?: string;
  category?: string;
  isActive?: boolean;
  limit?: number;
  offset?: number;
}

export class ProductsService {
  /**
   * Get all products for an organization with optional filters
   */
  async getAllProducts(organizationId: string, filters: ProductFilters) {
    const {
      search,
      category,
      isActive,
      limit = 50,
      offset = 0,
    } = filters;

    const where: Record<string, unknown> = {
      organizationId,
    };

    if (category) {
      where.category = category;
    }

    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    if (search) {
      where.OR = [
        { sku: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
        { barcode: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include: {
          stockLevels: {
            include: {
              branch: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.product.count({ where }),
    ]);

    return {
      products,
      pagination: {
        total,
        limit,
        offset,
        pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get a single product by ID
   */
  async getProductById(productId: string, organizationId: string) {
    const product = await prisma.product.findFirst({
      where: {
        id: productId,
        organizationId,
      },
      include: {
        stockLevels: {
          include: {
            branch: true,
          },
        },
      },
    });

    if (!product) {
      throw new AppError(404, 'Product not found');
    }

    return product;
  }

  /**
   * Create a new product
   */
  async createProduct(data: CreateProductData, organizationId: string) {
    const {
      sku,
      name,
      category,
      barcode,
      unitPrice,
      costPrice,
      lowStockThreshold,
    } = data;

    // Check for duplicate SKU within organization
    const existingSku = await prisma.product.findFirst({
      where: {
        organizationId,
        sku,
      },
    });

    if (existingSku) {
      throw new AppError(409, 'Product with this SKU already exists');
    }

    const product = await prisma.product.create({
      data: {
        organizationId,
        sku,
        name,
        category,
        barcode,
        unitPrice: new Decimal(unitPrice),
        costPrice: costPrice ? new Decimal(costPrice) : null,
        lowStockThreshold: lowStockThreshold || 0,
      },
      include: {
        stockLevels: {
          include: {
            branch: true,
          },
        },
      },
    });

    return product;
  }

  /**
   * Update a product
   */
  async updateProduct(
    productId: string,
    organizationId: string,
    data: UpdateProductData
  ) {
    // Verify product exists and belongs to organization
    const product = await prisma.product.findFirst({
      where: {
        id: productId,
        organizationId,
      },
    });

    if (!product) {
      throw new AppError(404, 'Product not found');
    }

    // Check for duplicate SKU if updating SKU
    if (data.sku && data.sku !== product.sku) {
      const existingSku = await prisma.product.findFirst({
        where: {
          organizationId,
          sku: data.sku,
        },
      });

      if (existingSku) {
        throw new AppError(409, 'Product with this SKU already exists');
      }
    }

    const updateData: Record<string, unknown> = {};

    if (data.sku !== undefined) updateData.sku = data.sku;
    if (data.name !== undefined) updateData.name = data.name;
    if (data.category !== undefined) updateData.category = data.category;
    if (data.barcode !== undefined) updateData.barcode = data.barcode;
    if (data.unitPrice !== undefined) updateData.unitPrice = new Decimal(data.unitPrice);
    if (data.costPrice !== undefined) updateData.costPrice = data.costPrice ? new Decimal(data.costPrice) : null;
    if (data.lowStockThreshold !== undefined) updateData.lowStockThreshold = data.lowStockThreshold;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;

    const updatedProduct = await prisma.product.update({
      where: { id: productId },
      data: updateData,
      include: {
        stockLevels: {
          include: {
            branch: true,
          },
        },
      },
    });

    return updatedProduct;
  }

  /**
   * Search products by SKU or barcode
   */
  async searchProducts(organizationId: string, query: string) {
    const products = await prisma.product.findMany({
      where: {
        organizationId,
        isActive: true,
        OR: [
          { sku: { contains: query, mode: 'insensitive' } },
          { barcode: { contains: query, mode: 'insensitive' } },
        ],
      },
      include: {
        stockLevels: {
          include: {
            branch: true,
          },
        },
      },
      orderBy: { sku: 'asc' },
      take: 20,
    });

    return products;
  }

  /**
   * Get stock levels for a product across branches
   */
  async getStockLevels(
    productId: string,
    organizationId: string,
    branchId?: string
  ) {
    // Verify product exists and belongs to organization
    const product = await prisma.product.findFirst({
      where: {
        id: productId,
        organizationId,
      },
    });

    if (!product) {
      throw new AppError(404, 'Product not found');
    }

    const where: Record<string, unknown> = {
      productId,
    };

    if (branchId) {
      where.branchId = branchId;
    }

    const stockLevels = await prisma.stockLevel.findMany({
      where,
      include: {
        branch: true,
        product: true,
      },
    });

    // Calculate totals
    const totalQuantity = stockLevels.reduce((sum, sl) => sum + sl.quantity, 0);
    const isLowStock = totalQuantity < (product.lowStockThreshold || 0);

    return {
      product,
      stockLevels,
      totalQuantity,
      isLowStock,
      lowStockThreshold: product.lowStockThreshold,
    };
  }

  /**
   * Update stock level for a product at a branch
   */
  async updateStockLevel(
    productId: string,
    branchId: string,
    organizationId: string,
    quantity: number
  ) {
    // Verify product exists and belongs to organization
    const product = await prisma.product.findFirst({
      where: {
        id: productId,
        organizationId,
      },
    });

    if (!product) {
      throw new AppError(404, 'Product not found');
    }

    // Verify branch belongs to organization
    const branch = await prisma.branch.findFirst({
      where: {
        id: branchId,
        organizationId,
      },
    });

    if (!branch) {
      throw new AppError(404, 'Branch not found');
    }

    // Get or create stock level
    let stockLevel = await prisma.stockLevel.findFirst({
      where: {
        productId,
        branchId,
      },
    });

    if (!stockLevel) {
      stockLevel = await prisma.stockLevel.create({
        data: {
          productId,
          branchId,
          quantity,
        },
        include: {
          branch: true,
          product: true,
        },
      });
    } else {
      stockLevel = await prisma.stockLevel.update({
        where: { id: stockLevel.id },
        data: {
          quantity,
        },
        include: {
          branch: true,
          product: true,
        },
      });
    }

    return stockLevel;
  }

  /**
   * Get all product categories for an organization
   */
  async getCategories(organizationId: string) {
    const categories = await prisma.product.findMany({
      where: {
        organizationId,
        category: { not: null },
      },
      distinct: ['category'],
      select: {
        category: true,
      },
    });

    return categories.map(c => c.category).filter(Boolean);
  }

  /**
   * Get products with low stock levels
   */
  async getLowStockProducts(organizationId: string, branchId?: string) {
    const where: Record<string, unknown> = {
      organization: { id: organizationId },
      lowStockThreshold: { gt: 0 },
    };

    const products = await prisma.product.findMany({
      where,
      include: {
        stockLevels: {
          where: branchId ? { branchId } : undefined,
          include: {
            branch: true,
          },
        },
      },
    });

    // Filter to only include products with stock below threshold
    return products.filter(product => {
      const totalStock = product.stockLevels.reduce((sum, sl) => sum + sl.quantity, 0);
      return totalStock < (product.lowStockThreshold || 0);
    });
  }
}
