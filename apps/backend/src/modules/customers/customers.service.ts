import { prisma } from '../../config/database';
import { AppError } from '../../middleware/error.middleware';
import { Decimal } from '@prisma/client/runtime/library';

interface CreateCustomerData {
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  vehicleNumbers?: string[];
  creditLimit?: number;
  creditDays?: number;
}

interface UpdateCustomerData {
  name?: string;
  phone?: string;
  email?: string;
  address?: string;
  vehicleNumbers?: string[];
  creditLimit?: number;
  creditDays?: number;
  isActive?: boolean;
}

interface CustomerFilters {
  search?: string;
  isActive?: boolean;
  limit?: number;
  offset?: number;
}

export class CustomersService {
  /**
   * Get all customers with filters
   */
  async getAllCustomers(organizationId: string, filters: CustomerFilters) {
    const {
      search,
      isActive,
      limit = 50,
      offset = 0,
    } = filters;

    const where: any = {
      organizationId,
    };

    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [customers, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        orderBy: { name: 'asc' },
        take: limit,
        skip: offset,
      }),
      prisma.customer.count({ where }),
    ]);

    return {
      customers,
      pagination: {
        total,
        limit,
        offset,
        pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get customer by ID
   */
  async getCustomerById(customerId: string, organizationId: string) {
    const customer = await prisma.customer.findFirst({
      where: {
        id: customerId,
        organizationId,
      },
      include: {
        sales: {
          orderBy: { saleDate: 'desc' },
          take: 10, // Get latest 10 sales
          include: {
            fuelSales: {
              include: {
                fuelType: true,
              },
            },
            nonFuelSales: {
              include: {
                product: true,
              },
            },
          },
        },
      },
    });

    if (!customer) {
      throw new AppError(404, 'Customer not found');
    }

    return customer;
  }

  /**
   * Create a new customer
   */
  async createCustomer(data: CreateCustomerData, organizationId: string) {
    const {
      name,
      phone,
      email,
      address,
      vehicleNumbers = [],
      creditLimit,
      creditDays,
    } = data;

    // Validate required fields
    if (!name || name.trim() === '') {
      throw new AppError(400, 'Customer name is required');
    }

    // Check if customer with same phone already exists (if phone provided)
    if (phone) {
      const existingCustomer = await prisma.customer.findFirst({
        where: {
          organizationId,
          phone,
        },
      });

      if (existingCustomer) {
        throw new AppError(400, 'Customer with this phone number already exists');
      }
    }

    const customer = await prisma.customer.create({
      data: {
        organizationId,
        name: name.trim(),
        phone: phone?.trim(),
        email: email?.trim(),
        address: address?.trim(),
        vehicleNumbers: vehicleNumbers.filter(v => v.trim() !== ''),
        creditLimit: creditLimit ? new Decimal(creditLimit) : null,
        creditDays: creditDays || null,
        isActive: true,
      },
    });

    return customer;
  }

  /**
   * Update customer
   */
  async updateCustomer(
    customerId: string,
    organizationId: string,
    data: UpdateCustomerData
  ) {
    // Verify customer exists
    const existingCustomer = await prisma.customer.findFirst({
      where: {
        id: customerId,
        organizationId,
      },
    });

    if (!existingCustomer) {
      throw new AppError(404, 'Customer not found');
    }

    // Check if phone is being updated and already exists
    if (data.phone && data.phone !== existingCustomer.phone) {
      const phoneExists = await prisma.customer.findFirst({
        where: {
          organizationId,
          phone: data.phone,
          id: { not: customerId },
        },
      });

      if (phoneExists) {
        throw new AppError(400, 'Customer with this phone number already exists');
      }
    }

    const updateData: any = {};

    if (data.name !== undefined) {
      updateData.name = data.name.trim();
    }
    if (data.phone !== undefined) {
      updateData.phone = data.phone.trim();
    }
    if (data.email !== undefined) {
      updateData.email = data.email?.trim();
    }
    if (data.address !== undefined) {
      updateData.address = data.address?.trim();
    }
    if (data.vehicleNumbers !== undefined) {
      updateData.vehicleNumbers = data.vehicleNumbers.filter(v => v.trim() !== '');
    }
    if (data.creditLimit !== undefined) {
      updateData.creditLimit = data.creditLimit ? new Decimal(data.creditLimit) : null;
    }
    if (data.creditDays !== undefined) {
      updateData.creditDays = data.creditDays || null;
    }
    if (data.isActive !== undefined) {
      updateData.isActive = data.isActive;
    }

    const customer = await prisma.customer.update({
      where: { id: customerId },
      data: updateData,
    });

    return customer;
  }

  /**
   * Get customer ledger (sales history)
   */
  async getCustomerLedger(
    customerId: string,
    organizationId: string,
    filters: {
      startDate?: Date;
      endDate?: Date;
      limit?: number;
      offset?: number;
    }
  ) {
    const {
      startDate,
      endDate,
      limit = 50,
      offset = 0,
    } = filters;

    // Verify customer exists
    const customer = await prisma.customer.findFirst({
      where: {
        id: customerId,
        organizationId,
      },
    });

    if (!customer) {
      throw new AppError(404, 'Customer not found');
    }

    const where: any = {
      customerId,
      branch: { organizationId },
    };

    if (startDate || endDate) {
      where.saleDate = {};
      if (startDate) where.saleDate.gte = startDate;
      if (endDate) where.saleDate.lte = endDate;
    }

    const [sales, total] = await Promise.all([
      prisma.sale.findMany({
        where,
        include: {
          fuelSales: {
            include: {
              nozzle: {
                include: {
                  dispensingUnit: true,
                },
              },
              fuelType: true,
            },
          },
          nonFuelSales: {
            include: {
              product: true,
            },
          },
          cashier: {
            select: {
              id: true,
              fullName: true,
              username: true,
            },
          },
          branch: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: { saleDate: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.sale.count({ where }),
    ]);

    // Calculate summary
    const summary = await prisma.sale.aggregate({
      where,
      _sum: {
        totalAmount: true,
      },
      _count: true,
    });

    return {
      customer: {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        email: customer.email,
        creditLimit: customer.creditLimit?.toNumber() || null,
        creditDays: customer.creditDays,
      },
      sales,
      summary: {
        totalSales: summary._count,
        totalAmount: summary._sum.totalAmount?.toNumber() || 0,
      },
      pagination: {
        total,
        limit,
        offset,
        pages: Math.ceil(total / limit),
      },
    };
  }
}
