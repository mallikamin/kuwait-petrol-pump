import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { env } from './config/env';
import { errorHandler } from './middleware/error.middleware';

// Routes
import authRoutes from './modules/auth/auth.routes';
import fuelPricesRoutes from './modules/fuel-prices/fuel-prices.routes';
import branchesRoutes, { dispensingUnitsRouter } from './modules/branches/branches.routes';
import nozzlesRoutes from './modules/nozzles/nozzles.routes';
import shiftsRoutes from './modules/shifts/shifts.routes';
import meterReadingsRoutes from './modules/meter-readings/meter-readings.routes';
import salesRoutes from './modules/sales/sales.routes';
import customersRoutes from './modules/customers/customers.routes';
import productsRoutes from './modules/products/products.routes';
import bifurcationRoutes from './modules/bifurcation/bifurcation.routes';
import reportsRoutes from './modules/reports/reports.routes';
import dashboardRoutes from './modules/dashboard/dashboard.routes';
import usersRoutes from './modules/users/users.routes';
import syncRoutes from './modules/sync/sync.routes';
import quickbooksRoutes from './services/quickbooks/routes';
import { validateQuickBooksConfig } from './services/quickbooks/startup-validation';

// Validate QB config on startup (P0: fail fast if missing)
validateQuickBooksConfig();

export function createApp() {
  const app = express();

  // Security middleware
  app.use(helmet());

  // Parse CORS_ORIGIN as comma-separated list
  const allowedOrigins = env.CORS_ORIGIN.split(',').map(origin => origin.trim());

  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps or curl)
        if (!origin) return callback(null, true);

        if (allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      },
      credentials: true,
    })
  );

  // Rate limiting
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
  });
  app.use('/api/', limiter);

  // Body parsing (increased limit for base64 images from mobile OCR)
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Serve uploaded images for audit trail (requires authentication)
  app.use('/uploads', express.static('uploads'));

  // Health check (both paths for nginx proxy and direct access)
  const healthHandler = (_req: express.Request, res: express.Response) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  };
  app.get('/health', healthHandler);
  app.get('/api/health', healthHandler);

  // API Routes
  app.use('/api/auth', authRoutes);
  app.use('/api/fuel-prices', fuelPricesRoutes);
  app.use('/api/branches', branchesRoutes);
  app.use('/api/dispensing-units', dispensingUnitsRouter);
  app.use('/api/nozzles', nozzlesRoutes);
  app.use('/api/shifts', shiftsRoutes);
  app.use('/api/meter-readings', meterReadingsRoutes);
  app.use('/api/sales', salesRoutes);
  app.use('/api/customers', customersRoutes);
  app.use('/api/products', productsRoutes);
  app.use('/api/bifurcation', bifurcationRoutes);
  app.use('/api/reports', reportsRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/sync', syncRoutes); // Sprint 1: Offline Foundation
  app.use('/api/quickbooks', quickbooksRoutes); // QuickBooks OAuth & sync

  app.use('/api/users', usersRoutes);

  // Root endpoint
  app.get('/', (req, res) => {
    res.json({
      name: 'Kuwait Petrol Pump POS API',
      version: '1.0.0',
      status: 'running',
      description: 'Complete POS system for petrol pump management',
      endpoints: {
        health: 'GET /health',
        auth: '/api/auth/*',
        fuelPrices: '/api/fuel-prices/*',
        branches: '/api/branches/*',
        dispensingUnits: '/api/dispensing-units/*',
        nozzles: '/api/nozzles/*',
        shifts: '/api/shifts/*',
        meterReadings: '/api/meter-readings/*',
        sales: '/api/sales/*',
        customers: '/api/customers/*',
        products: '/api/products/*',
        bifurcation: '/api/bifurcation/*',
        reports: '/api/reports/*',
        dashboard: '/api/dashboard/*',
        sync: '/api/sync/*',
        quickbooks: '/api/quickbooks/*',
        users: '/api/users/*',
      },
      documentation: 'See BUILD_STATUS.md for full API documentation',
    });
  });

  // 404 handler
  app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
  });

  // Error handler (must be last)
  app.use(errorHandler);

  return app;
}
