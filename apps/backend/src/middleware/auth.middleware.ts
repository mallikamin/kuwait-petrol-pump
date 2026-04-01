import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, TokenPayload } from '../utils/jwt';

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

export function authenticate(req: Request, res: Response, next: NextFunction) {
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

    next();
  } catch (error) {
    if (error instanceof Error && error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
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
