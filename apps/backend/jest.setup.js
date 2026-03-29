/**
 * Jest Setup File
 *
 * Sets required environment variables for tests
 */

process.env.NODE_ENV = 'test';
process.env.PORT = '3000';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.JWT_SECRET = 'test-jwt-secret-12345678901234567890123456789012';
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-12345678901234567890123456789012';
process.env.QUICKBOOKS_CLIENT_ID = 'test-client-id';
process.env.QUICKBOOKS_CLIENT_SECRET = 'test-client-secret';
process.env.QUICKBOOKS_REDIRECT_URI = 'http://localhost:3000/api/quickbooks/callback';
process.env.QUICKBOOKS_ENVIRONMENT = 'sandbox';
process.env.QB_TOKEN_ENCRYPTION_KEY = 'dGVzdC1lbmNyeXB0aW9uLWtleS0xMjM0NTY3ODkwMTI='; // base64 encoded 32 bytes
