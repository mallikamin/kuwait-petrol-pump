import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { prisma } from '../../config/database';
import { AppError } from '../../middleware/error.middleware';

type User = {
  id: string;
  username: string;
  email: string | null;
  fullName: string | null;
  role: string;
  branchId: string | null;
  organizationId: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  branch?: { id: string; name: string } | null;
};

// ---------------------------------------------------------------------------
// Validation Schemas
// ---------------------------------------------------------------------------

const VALID_ROLES = ['admin', 'manager', 'accountant', 'cashier', 'operator'] as const;

const createUserSchema = z.object({
  username: z.string().min(3, 'Username must be at least 3 characters').max(100),
  email: z.string().email().optional().nullable(),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  fullName: z.string().max(255).optional().nullable(),
  role: z.enum(VALID_ROLES),
  branchId: z.string().uuid().optional().nullable(),
  isActive: z.boolean().optional(),
});

const updateUserSchema = z.object({
  username: z.string().min(3).max(100).optional(),
  email: z.string().email().optional().nullable(),
  fullName: z.string().max(255).optional().nullable(),
  role: z.enum(VALID_ROLES).optional(),
  branchId: z.string().uuid().optional().nullable(),
  isActive: z.boolean().optional(),
});

const resetPasswordSchema = z.object({
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

const idParamSchema = z.object({
  id: z.string().uuid('Invalid user ID format'),
});

const listUsersQuerySchema = z.object({
  page: z.string().transform(val => {
    const n = parseInt(val, 10);
    return Number.isNaN(n) || n < 1 ? 1 : n;
  }).optional(),
  limit: z.string().transform(val => {
    const n = parseInt(val, 10);
    return Number.isNaN(n) || n < 1 ? 10 : Math.min(n, 100);
  }).optional(),
  size: z.string().transform(val => {
    const n = parseInt(val, 10);
    return Number.isNaN(n) || n < 1 ? 10 : Math.min(n, 100);
  }).optional(),
  search: z.string().optional(),
  role: z.string().optional(),
  isActive: z.enum(['true', 'false']).transform(val => val === 'true').optional(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SALT_ROUNDS = 10;

/**
 * Strip sensitive fields and remap to snake_case for the frontend contract.
 * Frontend User type: { id, username, email, full_name, role, branch_id, is_active, created_at }
 */
function toUserResponse(user: User) {
  return {
    id: user.id,
    username: user.username,
    email: user.email || '',
    full_name: user.fullName || '',
    role: user.role,
    branch_id: user.branchId || null,
    is_active: user.isActive,
    created_at: user.createdAt instanceof Date ? user.createdAt.toISOString() : user.createdAt,
    updated_at: user.updatedAt instanceof Date ? user.updatedAt.toISOString() : user.updatedAt,
    organization_id: user.organizationId,
    branch: user.branch
      ? { id: user.branch.id, name: user.branch.name }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export class UsersController {
  /**
   * GET /api/users
   * List users with pagination, search, and filters.
   * Returns: { items, total, page, size, pages }
   */
  getAll = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const query = listUsersQuerySchema.parse(req.query);

      // Accept both "limit" and "size" -- frontend sends "size"
      const pageSize = query.size ?? query.limit ?? 10;
      const page = query.page ?? 1;
      const skip = (page - 1) * pageSize;

      const where: Record<string, unknown> = {
        organizationId: req.user.organizationId,
      };

      if (query.isActive !== undefined) {
        where.isActive = query.isActive;
      }

      if (query.role) {
        where.role = query.role;
      }

      if (query.search) {
        where.OR = [
          { username: { contains: query.search, mode: 'insensitive' } },
          { fullName: { contains: query.search, mode: 'insensitive' } },
          { email: { contains: query.search, mode: 'insensitive' } },
        ];
      }

      const [users, total] = await Promise.all([
        prisma.user.findMany({
          where,
          include: {
            branch: {
              select: { id: true, name: true },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: pageSize,
          skip,
        }),
        prisma.user.count({ where }),
      ]);

      const totalPages = Math.ceil(total / pageSize);

      res.json({
        items: users.map(toUserResponse),
        total,
        page,
        size: pageSize,
        pages: totalPages,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/users/:id
   * Get a single user by ID.
   */
  getById = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { id } = idParamSchema.parse(req.params);

      const user = await prisma.user.findFirst({
        where: {
          id,
          organizationId: req.user.organizationId,
        },
        include: {
          branch: {
            select: { id: true, name: true },
          },
        },
      });

      if (!user) {
        throw new AppError(404, 'User not found');
      }

      res.json(toUserResponse(user));
    } catch (error) {
      next(error);
    }
  };

  /**
   * POST /api/users
   * Create a new user (admin/manager only).
   */
  create = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const data = createUserSchema.parse(req.body);

      // Check if username already exists (globally unique in schema)
      const existingUser = await prisma.user.findUnique({
        where: { username: data.username },
      });

      if (existingUser) {
        throw new AppError(409, 'Username already exists');
      }

      // If branchId is provided, verify it belongs to the same organization
      if (data.branchId) {
        const branch = await prisma.branch.findFirst({
          where: {
            id: data.branchId,
            organizationId: req.user.organizationId,
          },
        });

        if (!branch) {
          throw new AppError(400, 'Invalid branch: branch not found in your organization');
        }
      }

      const passwordHash = await bcrypt.hash(data.password, SALT_ROUNDS);

      const user = await prisma.user.create({
        data: {
          organizationId: req.user.organizationId,
          username: data.username.trim(),
          email: data.email?.trim() || null,
          passwordHash,
          fullName: data.fullName?.trim() || null,
          role: data.role,
          branchId: data.branchId || null,
          isActive: data.isActive !== undefined ? data.isActive : true,
        },
        include: {
          branch: {
            select: { id: true, name: true },
          },
        },
      });

      res.status(201).json(toUserResponse(user));
    } catch (error) {
      next(error);
    }
  };

  /**
   * PUT /api/users/:id
   * Update an existing user (admin/manager only).
   */
  update = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { id } = idParamSchema.parse(req.params);
      const data = updateUserSchema.parse(req.body);

      // Verify user exists in the same organization
      const existingUser = await prisma.user.findFirst({
        where: {
          id,
          organizationId: req.user.organizationId,
        },
      });

      if (!existingUser) {
        throw new AppError(404, 'User not found');
      }

      // Prevent deactivating yourself
      if (id === req.user.userId && data.isActive === false) {
        throw new AppError(400, 'You cannot deactivate your own account');
      }

      // Prevent demoting yourself from admin
      if (id === req.user.userId && data.role && data.role !== req.user.role) {
        throw new AppError(400, 'You cannot change your own role');
      }

      // If username is changing, check uniqueness
      if (data.username && data.username !== existingUser.username) {
        const usernameExists = await prisma.user.findUnique({
          where: { username: data.username },
        });

        if (usernameExists) {
          throw new AppError(409, 'Username already exists');
        }
      }

      // If branchId is provided, verify it belongs to the same organization
      if (data.branchId) {
        const branch = await prisma.branch.findFirst({
          where: {
            id: data.branchId,
            organizationId: req.user.organizationId,
          },
        });

        if (!branch) {
          throw new AppError(400, 'Invalid branch: branch not found in your organization');
        }
      }

      const updateData: Record<string, unknown> = {};

      if (data.username !== undefined) {
        updateData.username = data.username.trim();
      }
      if (data.email !== undefined) {
        updateData.email = data.email?.trim() || null;
      }
      if (data.fullName !== undefined) {
        updateData.fullName = data.fullName?.trim() || null;
      }
      if (data.role !== undefined) {
        updateData.role = data.role;
      }
      if (data.branchId !== undefined) {
        updateData.branchId = data.branchId || null;
      }
      if (data.isActive !== undefined) {
        updateData.isActive = data.isActive;
      }

      const user = await prisma.user.update({
        where: { id },
        data: updateData,
        include: {
          branch: {
            select: { id: true, name: true },
          },
        },
      });

      res.json(toUserResponse(user));
    } catch (error) {
      next(error);
    }
  };

  /**
   * DELETE /api/users/:id
   * Soft-delete (deactivate) a user (admin/manager only).
   */
  delete = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { id } = idParamSchema.parse(req.params);

      // Prevent deleting yourself
      if (id === req.user.userId) {
        throw new AppError(400, 'You cannot delete your own account');
      }

      // Verify user exists in the same organization
      const existingUser = await prisma.user.findFirst({
        where: {
          id,
          organizationId: req.user.organizationId,
        },
      });

      if (!existingUser) {
        throw new AppError(404, 'User not found');
      }

      // Soft delete: set isActive = false
      await prisma.user.update({
        where: { id },
        data: { isActive: false },
      });

      res.json({ message: 'User deactivated successfully' });
    } catch (error) {
      next(error);
    }
  };

  /**
   * POST /api/users/:id/reset-password
   * Reset a user's password (admin/manager only).
   * Body: { password: string }
   */
  resetPassword = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { id } = idParamSchema.parse(req.params);
      const { password } = resetPasswordSchema.parse(req.body);

      // Verify user exists in the same organization
      const existingUser = await prisma.user.findFirst({
        where: {
          id,
          organizationId: req.user.organizationId,
        },
      });

      if (!existingUser) {
        throw new AppError(404, 'User not found');
      }

      const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

      await prisma.user.update({
        where: { id },
        data: { passwordHash },
      });

      res.json({ message: 'Password reset successfully' });
    } catch (error) {
      next(error);
    }
  };
}
