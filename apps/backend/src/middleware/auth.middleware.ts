import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, TokenPayload } from '../utils/jwt';
import { prisma } from '../config/database';

// Extend Express Request type
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

/**
 * Check if user has one of the allowed roles (case-insensitive)
 * @param user - User payload from JWT
 * @param allowedRoles - Array of allowed role names (lowercase)
 * @returns true if user has one of the allowed roles
 */
export function hasRole(user: TokenPayload | undefined, allowedRoles: string[]): boolean {
  if (!user) {
    return false;
  }

  const userRole = user.role.toLowerCase();
  const normalizedRoles = allowedRoles.map(r => r.toLowerCase());

  return normalizedRoles.includes(userRole);
}

/**
 * Check if user is a superuser (admin or accountant)
 * Superusers can perform cross-branch operations
 * @param user - User payload from JWT
 * @returns true if user is admin or accountant
 */
export function isSuperuser(user: TokenPayload | undefined): boolean {
  return hasRole(user, ['admin', 'accountant']);
}

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7); // Remove 'Bearer '
    const payload = verifyAccessToken(token);

    // Normalize role to lowercase for consistent role checking
    req.user = {
      ...payload,
      role: payload.role.toLowerCase(),
    };

    // JWT-only branch is done — fall through to async context resolution.
  } catch (error) {
    if (error instanceof Error && error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }

  // Multi-org switch: if X-Active-Org-Id / X-Active-Branch-Id headers are
  // present and differ from the JWT, validate access and override the
  // active org/branch for this request. Single-org users never send the
  // headers — for them this is a no-op and behavior is unchanged.
  try {
    const switchError = await applyActiveContextHeaders(req);
    if (switchError) {
      return res.status(switchError.status).json({ error: switchError.message });
    }
  } catch (error) {
    return next(error); // DB / unexpected error → goes through error middleware
  }

  next();
}

/**
 * Read the X-Active-Org-Id / X-Active-Branch-Id headers and override
 * req.user.organizationId / req.user.branchId after validating the user
 * has access. Returns an error descriptor (not thrown) so the caller can
 * map it to an HTTP response.
 *
 * Rules:
 *  - No headers → no-op (existing single-org behavior preserved).
 *  - X-Active-Org-Id matches the JWT org → no DB lookup needed.
 *  - X-Active-Org-Id differs → must have a matching row in user_org_access.
 *  - X-Active-Branch-Id set → branch must belong to the (post-override) org.
 */
async function applyActiveContextHeaders(
  req: Request
): Promise<{ status: number; message: string } | null> {
  if (!req.user) return null;

  const headerOrgId = pickHeader(req, 'x-active-org-id');
  const headerBranchId = pickHeader(req, 'x-active-branch-id');

  if (!headerOrgId && !headerBranchId) return null;

  if (headerOrgId && headerOrgId !== req.user.organizationId) {
    const access = await prisma.userOrgAccess.findUnique({
      where: { unique_user_org: { userId: req.user.userId, organizationId: headerOrgId } },
      select: { id: true },
    });
    if (!access) {
      return { status: 403, message: 'No access to the requested organization' };
    }
    req.user.organizationId = headerOrgId;
    // The JWT branch belongs to the OLD org; clear it so any branch-scoped
    // query without an explicit X-Active-Branch-Id falls back to org-wide
    // (existing isSuperuser-gated reads handle this correctly).
    req.user.branchId = undefined;
  }

  if (headerBranchId) {
    const branch = await prisma.branch.findFirst({
      where: { id: headerBranchId, organizationId: req.user.organizationId },
      select: { id: true },
    });
    if (!branch) {
      return { status: 403, message: 'No access to the requested branch' };
    }
    req.user.branchId = headerBranchId;
  }

  return null;
}

function pickHeader(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  if (Array.isArray(value)) return value[0]?.trim() || undefined;
  return value?.trim() || undefined;
}

/**
 * Middleware to check if user has one of the allowed roles
 * @param roles - Array of allowed role names (will be normalized to lowercase)
 */
export function authorize(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (!hasRole(req.user, roles)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
}
