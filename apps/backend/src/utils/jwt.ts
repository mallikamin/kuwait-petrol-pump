import jwt, { SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';

export interface TokenPayload {
  userId: string;
  email: string;
  role: string;
  organizationId: string;
  branchId?: string;
}

export function generateAccessToken(payload: TokenPayload): string {
  const options: SignOptions = {
    expiresIn: env.JWT_EXPIRY as any,
  };
  return jwt.sign(payload, env.JWT_SECRET, options);
}

export function generateRefreshToken(payload: TokenPayload): string {
  const options: SignOptions = {
    expiresIn: env.JWT_REFRESH_EXPIRY as any,
  };
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, options);
}

export function verifyAccessToken(token: string): TokenPayload {
  return jwt.verify(token, env.JWT_SECRET) as TokenPayload;
}

export function verifyRefreshToken(token: string): TokenPayload {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as TokenPayload;
}
