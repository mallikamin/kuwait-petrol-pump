import { createApp } from './app';
import { env } from './config/env';
import { connectRedis } from './config/redis';
import { prisma } from './config/database';
import { logger } from './utils/logger';
import { queueProcessor } from './services/quickbooks/queue-processor.service';

async function startServer() {
  try {
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

    // Graceful shutdown
    process.on('SIGTERM', async () => {
      logger.info('SIGTERM received, shutting down gracefully...');

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
