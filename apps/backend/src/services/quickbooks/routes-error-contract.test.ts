/**
 * Routes 401 Contract Tests
 * Verifies that QB endpoints return standardized 401 + QB_TOKEN_EXPIRED for token expiration
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express, { Express } from 'express';
import router from './routes';
import { QBTokenExpiredError, QBTransientError } from './errors';
import * as tokenRefresh from './token-refresh';

// Mock dependencies
vi.mock('./token-refresh', () => ({
  getValidAccessToken: vi.fn(),
  getQBApiUrl: vi.fn(() => 'https://sandbox-quickbooks.api.intuit.com'),
}));

vi.mock('./auto-match.service', () => ({
  AutoMatchService: {
    runMatching: vi.fn(),
    applyAccountDecisions: vi.fn(),
    applyEntityDecisions: vi.fn(),
  },
}));

vi.mock('./audit-logger', () => ({
  AuditLogger: {
    log: vi.fn(),
  },
}));

vi.mock('../../middleware/auth.middleware', () => ({
  authenticate: (req: any, res: any, next: any) => {
    req.user = { organizationId: 'org-123', userId: 'user-123', role: 'admin' };
    next();
  },
  authorize: (...roles: string[]) => (req: any, res: any, next: any) => next(),
}));

describe('Routes Error Contract Tests', () => {
  let app: Express;

  beforeEach(() => {
    vi.clearAllMocks();

    app = express();
    app.use(express.json());
    app.use('/api/quickbooks', router);
  });

  describe('GET /api/quickbooks/banks', () => {
    it('should return 401 with QB_TOKEN_EXPIRED code when token is expired', async () => {
      // Mock QBTokenExpiredError
      (tokenRefresh.getValidAccessToken as any).mockRejectedValue(
        new QBTokenExpiredError('QuickBooks refresh token expired. Please reconnect.')
      );

      const response = await request(app).get('/api/quickbooks/banks');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        code: 'QB_TOKEN_EXPIRED',
        message: 'QuickBooks token expired. Please reconnect.',
      });
    });

    it('should return 503 with QB_TRANSIENT_ERROR code for transient errors', async () => {
      // Mock QBTransientError
      (tokenRefresh.getValidAccessToken as any).mockRejectedValue(
        new QBTransientError('QuickBooks API temporarily unavailable. Please retry.')
      );

      const response = await request(app).get('/api/quickbooks/banks');

      expect(response.status).toBe(503);
      expect(response.body).toEqual({
        code: 'QB_TRANSIENT_ERROR',
        message: 'QuickBooks API temporarily unavailable. Please retry.',
        retryable: true,
      });
    });

    it('should return 500 for unknown errors', async () => {
      // Mock generic error
      (tokenRefresh.getValidAccessToken as any).mockRejectedValue(new Error('Unknown error'));

      const response = await request(app).get('/api/quickbooks/banks');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Unknown error');
    });

    it('should return 200 with bank data when token is valid', async () => {
      // Mock successful token and QB response
      (tokenRefresh.getValidAccessToken as any).mockResolvedValue({
        accessToken: 'valid_token',
        realmId: 'realm-123',
      });

      // Mock fetch for QB API
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          QueryResponse: {
            Account: [
              {
                Id: '1',
                Name: 'Checking Account',
                AccountType: 'Bank',
                Active: true,
                CurrentBalance: 10000,
              },
            ],
          },
        }),
      });

      const response = await request(app).get('/api/quickbooks/banks');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.count).toBe(1);
      expect(response.body.banks).toHaveLength(1);
    });
  });

  describe('POST /api/quickbooks/match/run', () => {
    it('should return 401 with QB_TOKEN_EXPIRED code when token is expired', async () => {
      const { AutoMatchService } = await import('./auto-match.service');
      (AutoMatchService.runMatching as any).mockRejectedValue(
        new QBTokenExpiredError('QuickBooks refresh token expired. Please reconnect.')
      );

      const response = await request(app).post('/api/quickbooks/match/run');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        code: 'QB_TOKEN_EXPIRED',
        message: 'QuickBooks token expired. Please reconnect.',
      });
    });

    it('should return 503 with QB_TRANSIENT_ERROR for transient errors', async () => {
      const { AutoMatchService } = await import('./auto-match.service');
      (AutoMatchService.runMatching as any).mockRejectedValue(
        new QBTransientError('Temporary QB API error')
      );

      const response = await request(app).post('/api/quickbooks/match/run');

      expect(response.status).toBe(503);
      expect(response.body.code).toBe('QB_TRANSIENT_ERROR');
      expect(response.body.retryable).toBe(true);
    });
  });

  describe('POST /api/quickbooks/match/:matchId/apply', () => {
    it('should return 401 with QB_TOKEN_EXPIRED code when token is expired', async () => {
      const { AutoMatchService } = await import('./auto-match.service');
      (AutoMatchService.applyAccountDecisions as any).mockRejectedValue(
        new QBTokenExpiredError()
      );

      const response = await request(app).post('/api/quickbooks/match/match-123/apply');

      expect(response.status).toBe(401);
      expect(response.body.code).toBe('QB_TOKEN_EXPIRED');
    });
  });

  describe('POST /api/quickbooks/match/:matchId/apply-entities', () => {
    it('should return 401 with QB_TOKEN_EXPIRED code when token is expired', async () => {
      const { AutoMatchService } = await import('./auto-match.service');
      (AutoMatchService.applyEntityDecisions as any).mockRejectedValue(
        new QBTokenExpiredError()
      );

      const response = await request(app)
        .post('/api/quickbooks/match/match-123/apply-entities')
        .send({ entityType: 'customer' });

      expect(response.status).toBe(401);
      expect(response.body.code).toBe('QB_TOKEN_EXPIRED');
    });
  });
});
