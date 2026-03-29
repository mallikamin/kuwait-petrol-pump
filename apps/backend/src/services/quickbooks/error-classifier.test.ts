/**
 * Error Classifier Tests
 * Tests structured error taxonomy for operational handling
 */

import {
  classifyError,
  formatOperationalError,
  getRetryStrategy,
  OpLog,
} from './error-classifier';

describe('ErrorClassifier', () => {
  describe('classifyError', () => {
    describe('AUTH_TOKEN category', () => {
      it('should classify 401 errors as AUTH_TOKEN', () => {
        const error = new Error('401 Unauthorized');
        const classified = classifyError(error, { httpStatus: 401 });

        expect(classified.category).toBe('AUTH_TOKEN');
        expect(classified.severity).toBe('critical');
        expect(classified.isRetryable).toBe(false);
        expect(classified.message).toContain('QB_AUTH_ERROR');
      });

      it('should classify token expired errors as AUTH_TOKEN', () => {
        const error = new Error('Token refresh failed: token expired');
        const classified = classifyError(error);

        expect(classified.category).toBe('AUTH_TOKEN');
        expect(classified.isRetryable).toBe(false);
      });

      it('should classify authentication errors as AUTH_TOKEN', () => {
        const error = new Error('authentication failed');
        const classified = classifyError(error);

        expect(classified.category).toBe('AUTH_TOKEN');
        expect(classified.action).toContain('Reconnect');
      });

      it('should classify QB auth error codes as AUTH_TOKEN', () => {
        const error = new Error('QB API error');
        const classified = classifyError(error, { qbErrorCode: '003200' });

        expect(classified.category).toBe('AUTH_TOKEN');
      });
    });

    describe('VALIDATION_MAPPING category', () => {
      it('should classify mapping not found errors as VALIDATION_MAPPING', () => {
        const error = new Error('Customer mapping not found: localId=123');
        const classified = classifyError(error);

        expect(classified.category).toBe('VALIDATION_MAPPING');
        expect(classified.severity).toBe('warning');
        expect(classified.isRetryable).toBe(false);
        expect(classified.message).toContain('QB_VALIDATION_ERROR');
      });

      it('should classify 400 errors as VALIDATION_MAPPING', () => {
        const error = new Error('Bad Request: Missing required field');
        const classified = classifyError(error, { httpStatus: 400 });

        expect(classified.category).toBe('VALIDATION_MAPPING');
      });

      it('should classify validation errors as VALIDATION_MAPPING', () => {
        const error = new Error('Invalid fuelTypeId format');
        const classified = classifyError(error);

        expect(classified.category).toBe('VALIDATION_MAPPING');
        expect(classified.action).toContain('Fix data or mapping');
      });

      it('should classify QB validation error codes as VALIDATION_MAPPING', () => {
        const error = new Error('QB validation error');
        const classified = classifyError(error, { qbErrorCode: '6100' });

        expect(classified.category).toBe('VALIDATION_MAPPING');
      });
    });

    describe('RATE_LIMIT_TRANSIENT category', () => {
      it('should classify 429 errors as RATE_LIMIT_TRANSIENT', () => {
        const error = new Error('429 Too Many Requests');
        const classified = classifyError(error, { httpStatus: 429 });

        expect(classified.category).toBe('RATE_LIMIT_TRANSIENT');
        expect(classified.severity).toBe('info');
        expect(classified.isRetryable).toBe(true);
        expect(classified.retryDelay).toBe(300000); // 5 minutes for rate limit
        expect(classified.message).toContain('QB_TRANSIENT_ERROR');
      });

      it('should classify rate limit errors with appropriate delay', () => {
        const error = new Error('Rate limit exceeded');
        const classified = classifyError(error);

        expect(classified.category).toBe('RATE_LIMIT_TRANSIENT');
        expect(classified.retryDelay).toBe(300000); // 5 minutes
      });

      it('should classify timeout errors as RATE_LIMIT_TRANSIENT with shorter delay', () => {
        const error = new Error('Request timeout');
        const classified = classifyError(error);

        expect(classified.category).toBe('RATE_LIMIT_TRANSIENT');
        expect(classified.retryDelay).toBe(30000); // 30 seconds
      });

      it('should classify network errors as RATE_LIMIT_TRANSIENT', () => {
        const error = new Error('ECONNREFUSED: Connection refused');
        const classified = classifyError(error);

        expect(classified.category).toBe('RATE_LIMIT_TRANSIENT');
        expect(classified.isRetryable).toBe(true);
      });

      it('should classify 503 errors as RATE_LIMIT_TRANSIENT', () => {
        const error = new Error('Service Unavailable');
        const classified = classifyError(error, { httpStatus: 503 });

        expect(classified.category).toBe('RATE_LIMIT_TRANSIENT');
      });

      it('should classify QB throttling error codes as RATE_LIMIT_TRANSIENT', () => {
        const error = new Error('QB throttling');
        const classified = classifyError(error, { qbErrorCode: '3200' });

        expect(classified.category).toBe('RATE_LIMIT_TRANSIENT');
      });
    });

    describe('UNKNOWN_INTERNAL category', () => {
      it('should classify unrecognized errors as UNKNOWN_INTERNAL', () => {
        const error = new Error('Something went wrong internally');
        const classified = classifyError(error);

        expect(classified.category).toBe('UNKNOWN_INTERNAL');
        expect(classified.severity).toBe('critical');
        expect(classified.isRetryable).toBe(true);
        expect(classified.retryDelay).toBe(60000); // 1 minute
        expect(classified.message).toContain('QB_UNKNOWN_ERROR');
      });

      it('should classify errors with no context as UNKNOWN_INTERNAL', () => {
        const error = 'Generic error string';
        const classified = classifyError(error);

        expect(classified.category).toBe('UNKNOWN_INTERNAL');
        expect(classified.action).toContain('Review error details');
      });
    });

    it('should handle string errors', () => {
      const error = 'String error message';
      const classified = classifyError(error);

      expect(classified).toBeDefined();
      expect(classified.category).toBeDefined();
    });

    it('should include context in details', () => {
      const error = new Error('Test error');
      const classified = classifyError(error, {
        httpStatus: 500,
        qbErrorCode: 'TEST-500',
        operation: 'CREATE_SALES_RECEIPT',
      });

      expect(classified.details?.httpStatus).toBe(500);
      expect(classified.details?.qbErrorCode).toBe('TEST-500');
    });
  });

  describe('formatOperationalError', () => {
    it('should format error with stable prefix', () => {
      const error = new Error('401 Unauthorized');
      const classified = classifyError(error, { httpStatus: 401 });
      const formatted = formatOperationalError(classified);

      expect(formatted).toContain('[QB_ERROR]');
      expect(formatted).toContain('[AUTH_TOKEN]');
      expect(formatted).toContain('[CRITICAL]');
      expect(formatted).toContain('Action:');
    });

    it('should include action in formatted message', () => {
      const error = new Error('Mapping not found');
      const classified = classifyError(error);
      const formatted = formatOperationalError(classified);

      expect(formatted).toContain(classified.action);
    });
  });

  describe('getRetryStrategy', () => {
    it('should return no retry for non-retryable errors', () => {
      const error = new Error('401 Unauthorized');
      const classified = classifyError(error, { httpStatus: 401 });
      const strategy = getRetryStrategy(classified);

      expect(strategy.shouldRetry).toBe(false);
      expect(strategy.maxRetries).toBe(0);
    });

    it('should return appropriate retry for rate limit errors', () => {
      const error = new Error('429 Too Many Requests');
      const classified = classifyError(error, { httpStatus: 429 });
      const strategy = getRetryStrategy(classified);

      expect(strategy.shouldRetry).toBe(true);
      expect(strategy.maxRetries).toBe(3);
      expect(strategy.delayMs).toBe(300000); // 5 minutes
    });

    it('should return standard retry for unknown errors', () => {
      const error = new Error('Unknown error');
      const classified = classifyError(error);
      const strategy = getRetryStrategy(classified);

      expect(strategy.shouldRetry).toBe(true);
      expect(strategy.maxRetries).toBe(5);
      expect(strategy.delayMs).toBe(60000); // 1 minute
    });
  });

  describe('OpLog', () => {
    it('should generate preflight failure log with stable prefix', () => {
      const log = OpLog.preflightFail('Database Migration', 'Table not found');

      expect(log).toContain('[QB_PREFLIGHT][FAIL]');
      expect(log).toContain('Database Migration');
      expect(log).toContain('Table not found');
    });

    it('should generate preflight warning log with stable prefix', () => {
      const log = OpLog.preflightWarn('Token Expiry', 'Access token expires soon');

      expect(log).toContain('[QB_PREFLIGHT][WARN]');
      expect(log).toContain('Token Expiry');
    });

    it('should generate dry-run decision log with stable prefix', () => {
      const log = OpLog.dryRunDecision('sale-123', 'Testing mode');

      expect(log).toContain('[QB_DRY_RUN][DECISION]');
      expect(log).toContain('sale-123');
      expect(log).toContain('Testing mode');
    });

    it('should generate control change log with stable prefix', () => {
      const log = OpLog.controlChange('syncMode', 'READ_ONLY', 'FULL_SYNC', 'user-456');

      expect(log).toContain('[QB_CONTROL][CHANGE]');
      expect(log).toContain('syncMode');
      expect(log).toContain('READ_ONLY');
      expect(log).toContain('FULL_SYNC');
      expect(log).toContain('user-456');
    });

    it('should generate QB write failure log with stable prefix', () => {
      const log = OpLog.qbWriteFail('CREATE_SALES_RECEIPT', 'sale-789', 'AUTH_TOKEN');

      expect(log).toContain('[QB_WRITE][FAIL][AUTH_TOKEN]');
      expect(log).toContain('CREATE_SALES_RECEIPT');
      expect(log).toContain('sale-789');
    });

    it('should generate QB write success log with stable prefix', () => {
      const log = OpLog.qbWriteSuccess('CREATE_SALES_RECEIPT', 'sale-999', 'QB-123', 500);

      expect(log).toContain('[QB_WRITE][SUCCESS]');
      expect(log).toContain('CREATE_SALES_RECEIPT');
      expect(log).toContain('sale-999');
      expect(log).toContain('QB-123');
      expect(log).toContain('500ms');
    });
  });
});
