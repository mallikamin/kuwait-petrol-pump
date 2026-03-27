import { createClient } from 'redis';
import { env } from './env';
import { logger } from '../utils/logger';

export const redis = createClient({
  url: env.REDIS_URL,
});

redis.on('error', (err) => logger.error('Redis Client Error', err));
redis.on('connect', () => logger.info('✅ Redis connected'));

export async function connectRedis() {
  if (!redis.isOpen) {
    await redis.connect();
  }
}

// Graceful shutdown
process.on('beforeExit', async () => {
  await redis.quit();
});
