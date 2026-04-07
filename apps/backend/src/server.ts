import { createApp } from './app';
import { env } from './config/env';
import { connectRedis } from './config/redis';
import { prisma } from './config/database';
import { logger } from './utils/logger';
import { queueProcessor } from './services/quickbooks/queue-processor.service';
import { startKeepaliveService, stopKeepaliveService } from './services/quickbooks/token-keepalive.service';
import { initializeUploadDirectory } from './utils/image-storage';

async function startServer() {
  let keepaliveIntervalId: NodeJS.Timeout | null = null;

  try {
    // Initialize upload directory for audit trail images
    initializeUploadDirectory();

    // Connect to Redis
    await connectRedis();

    // Test database connection
    await prisma.$connect();
    logger.info('✅ Database connected');

    // Create Express app
    const app = createApp();

    // Start server
    const server = app.listen(env.PORT, () => {
      logger.info(`🚀 Server running on http://localhost:${env.PORT}`);
      logger.info(`📊 Environment: ${env.NODE_ENV}`);
      logger.info(`🔐 CORS Origin: ${env.CORS_ORIGIN}`);
    });

    // Start QuickBooks queue processor (unless disabled)
    if (process.env.ENABLE_QB_PROCESSOR !== 'false') {
      try {
        await queueProcessor.start();
        logger.info('✅ QuickBooks queue processor started');
      } catch (error) {
        logger.error('⚠️ Failed to start QB queue processor:', error);
        // Don't crash app if processor fails to start
      }
    }

    // Start QuickBooks token keepalive service (unless disabled)
    if (process.env.ENABLE_QB_KEEPALIVE !== 'false') {
      try {
        keepaliveIntervalId = startKeepaliveService();
        logger.info('✅ QuickBooks token keepalive service started');
      } catch (error) {
        logger.error('⚠️ Failed to start QB keepalive service:', error);
        // Don't crash app if keepalive fails to start
      }
    }

    // Graceful shutdown
    process.on('SIGTERM', async () => {
      logger.info('SIGTERM received, shutting down gracefully...');

      // Stop keepalive service
      if (keepaliveIntervalId) {
        try {
          stopKeepaliveService(keepaliveIntervalId);
        } catch (error) {
          logger.error('Error stopping keepalive service:', error);
        }
      }

      // Stop queue processor
      try {
        await queueProcessor.stop();
      } catch (error) {
        logger.error('Error stopping queue processor:', error);
      }

      server.close(() => {
        logger.info('Server closed');
        process.exit(0);
      });
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
