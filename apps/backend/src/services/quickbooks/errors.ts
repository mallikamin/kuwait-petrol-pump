/**
 * QuickBooks-specific error types for proper error handling and classification
 */

/**
 * Thrown when QB refresh token is invalid/expired and requires user re-authentication
 */
export class QBTokenExpiredError extends Error {
  constructor(message: string = 'QuickBooks token expired. Please reconnect.') {
    super(message);
    this.name = 'QBTokenExpiredError';
  }
}

/**
 * Thrown when QB API returns a transient error that can be retried
 */
export class QBTransientError extends Error {
  constructor(message: string, public readonly originalError?: any) {
    super(message);
    this.name = 'QBTransientError';
  }
}
