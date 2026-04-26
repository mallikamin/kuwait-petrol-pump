import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthService } from './auth.service';
import { prisma } from '../../config/database';

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const refreshSchema = z.object({
  refreshToken: z.string(),
});

const changePasswordSchema = z.object({
  oldPassword: z.string(),
  newPassword: z.string().min(6),
});

export class AuthController {
  private authService: AuthService;

  constructor() {
    this.authService = new AuthService();
  }

  login = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { username, password } = loginSchema.parse(req.body);
      const result = await this.authService.login(username, password);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  refresh = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { refreshToken } = refreshSchema.parse(req.body);
      const result = await this.authService.refresh(refreshToken);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  logout = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }
      await this.authService.logout(req.user.userId, req.user.sessionId);
      res.json({ message: 'Logged out successfully' });
    } catch (error) {
      next(error);
    }
  };

  me = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }
      const user = await prisma.user.findUnique({
        where: { id: req.user.userId },
        include: {
          branch: { select: { id: true, name: true, code: true } },
          organization: {
            select: {
              id: true,
              name: true,
              code: true,
              currency: true,
              timezone: true,
              isDemo: true,
              companyName: true,
              companyAddress: true,
              reportFooter: true,
            },
          },
        },
      });
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      res.json({
        id: user.id,
        username: user.username,
        email: user.email,
        full_name: user.fullName,
        role: user.role,
        branch_id: user.branchId,
        is_active: user.isActive,
        branch: user.branch,
        organization: user.organization,
      });
    } catch (error) {
      next(error);
    }
  };

  changePassword = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }
      const { oldPassword, newPassword } = changePasswordSchema.parse(req.body);
      await this.authService.changePassword(req.user.userId, oldPassword, newPassword);
      res.json({ message: 'Password changed successfully' });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/auth/accessible-orgs
   * Returns every organization the authenticated user can switch into,
   * with their branches so the frontend can populate org+branch dropdowns
   * from one fetch. Always includes the user's primary org (from JWT) plus
   * any rows in user_org_access. Single-org users get exactly one org back.
   */
  accessibleOrgs = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const primaryOrgId = req.user.organizationId;

      const grantedOrgIds = (
        await prisma.userOrgAccess.findMany({
          where: { userId: req.user.userId },
          select: { organizationId: true },
        })
      ).map((r) => r.organizationId);

      const orgIds = Array.from(new Set([primaryOrgId, ...grantedOrgIds]));

      const orgs = await prisma.organization.findMany({
        where: { id: { in: orgIds } },
        orderBy: [{ isDemo: 'desc' }, { name: 'asc' }],
        select: {
          id: true,
          code: true,
          name: true,
          companyName: true,
          companyAddress: true,
          currency: true,
          timezone: true,
          isDemo: true,
          reportFooter: true,
          branches: {
            orderBy: [{ code: 'asc' }, { name: 'asc' }],
            select: { id: true, code: true, name: true, isActive: true },
          },
        },
      });

      res.json({
        primaryOrgId,
        orgs: orgs.map((o) => ({
          ...o,
          isPrimary: o.id === primaryOrgId,
        })),
      });
    } catch (error) {
      next(error);
    }
  };
}
