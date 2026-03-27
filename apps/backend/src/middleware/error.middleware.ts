import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from '../utils/logger';


export class AppError extends Error {
  constructor(
    public statusCode: number,
    public message: string,
    public isOperational = true
  ) {
    super(message);
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) {
  logger.error('Error:', {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
  });

  // Zod validation error
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Validation error',
      details: err.errors,
    });
  }

  // Prisma errors (duck-type check for compatibility)
  const prismaErr = err as any;
  if (prismaErr.name === 'PrismaClientKnownRequestError') {
    if (prismaErr.code === 'P2002') {
      return res.status(409).json({
        error: 'Duplicate entry',
        field: prismaErr.meta?.target,
      });
    }
    if (prismaErr.code === 'P2025') {
      return res.status(404).json({
        error: 'Record not found',
      });
    }
  }

  // App error
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: err.message,
    });
  }

  // Default error
  res.status(500).json({
    error: 'Internal server error',
  });
}
