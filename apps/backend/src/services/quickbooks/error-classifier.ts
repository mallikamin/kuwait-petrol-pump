/**
 * QuickBooks Error Classification Service
 *
 * Structured error taxonomy for operational visibility and automated handling.
 * Classifies QB errors into actionable categories.
 */

export type ErrorCategory =
  | 'AUTH_TOKEN'
  | 'VALIDATION_MAPPING'
  | 'RATE_LIMIT_TRANSIENT'
  | 'UNKNOWN_INTERNAL';

export interface ClassifiedError {
  category: ErrorCategory;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  isRetryable: boolean;
  retryDelay?: number; // milliseconds
  action: string; // Recommended action
  details?: Record<string, any>;
}

/**
 * Classify a QuickBooks error for operational handling
 */
export function classifyError(error: Error | string, context?: {
  httpStatus?: number;
  qbErrorCode?: string;
  operation?: string;
}): ClassifiedError {
  const errorMsg = typeof error === 'string' ? error : error.message;
  const errorMsgLower = errorMsg.toLowerCase();

  // Category 1: Auth/Token Errors
  if (
    errorMsg.includes('401') ||
    errorMsgLower.includes('unauthorized') ||
    errorMsgLower.includes('token') && (errorMsgLower.includes('expired') || errorMsgLower.includes('invalid')) ||
    errorMsgLower.includes('authentication') ||
    errorMsgLower.includes('token refresh failed') ||
    context?.httpStatus === 401 ||
    context?.qbErrorCode === '003200' // QB auth error code
  ) {
    return {
      category: 'AUTH_TOKEN',
      severity: 'critical',
      message: `[QB_AUTH_ERROR] ${errorMsg}`,
      isRetryable: false,
      action: 'Reconnect QuickBooks OAuth. Token expired or invalid.',
      details: {
        httpStatus: context?.httpStatus,
        qbErrorCode: context?.qbErrorCode,
        hint: 'Run GET /api/quickbooks/oauth/authorize to reconnect'
      }
    };
  }

  // Category 2: Validation/Mapping Errors
  if (
    errorMsg.includes('mapping not found') ||
    errorMsg.includes('Missing required field') ||
    errorMsg.includes('Invalid') && !errorMsg.includes('token') ||
    errorMsg.includes('validation') ||
    errorMsg.includes('required') ||
    context?.httpStatus === 400 ||
    context?.qbErrorCode?.startsWith('610') // QB validation errors (6100-6199)
  ) {
    return {
      category: 'VALIDATION_MAPPING',
      severity: 'warning',
      message: `[QB_VALIDATION_ERROR] ${errorMsg}`,
      isRetryable: false,
      action: 'Fix data or mapping configuration. Run preflight checks.',
      details: {
        httpStatus: context?.httpStatus,
        qbErrorCode: context?.qbErrorCode,
        hint: 'Check entity mappings: GET /api/quickbooks/preflight'
      }
    };
  }

  // Category 3: Rate Limit/Transient Errors
  if (
    errorMsg.includes('429') ||
    errorMsgLower.includes('rate limit') ||
    errorMsgLower.includes('too many requests') ||
    errorMsgLower.includes('throttle') ||
    errorMsgLower.includes('timeout') ||
    errorMsg.includes('ECONNREFUSED') ||
    errorMsg.includes('ETIMEDOUT') ||
    errorMsg.includes('503') ||
    errorMsg.includes('502') ||
    errorMsg.includes('504') ||
    context?.httpStatus === 429 ||
    context?.httpStatus === 502 ||
    context?.httpStatus === 503 ||
    context?.httpStatus === 504 ||
    context?.qbErrorCode === '3200' // QB throttling error
  ) {
    // Calculate retry delay based on error type
    let retryDelay = 60000; // Default: 1 minute
    if (errorMsg.includes('429') || errorMsgLower.includes('rate limit')) {
      retryDelay = 300000; // 5 minutes for rate limit
    } else if (errorMsgLower.includes('timeout')) {
      retryDelay = 30000; // 30 seconds for timeout
    }

    return {
      category: 'RATE_LIMIT_TRANSIENT',
      severity: 'info',
      message: `[QB_TRANSIENT_ERROR] ${errorMsg}`,
      isRetryable: true,
      retryDelay,
      action: 'Retry after delay. Consider reducing request rate.',
      details: {
        httpStatus: context?.httpStatus,
        qbErrorCode: context?.qbErrorCode,
        recommendedDelay: `${retryDelay / 1000}s`
      }
    };
  }

  // Category 4: Unknown/Internal Errors (catch-all)
  return {
    category: 'UNKNOWN_INTERNAL',
    severity: 'critical',
    message: `[QB_UNKNOWN_ERROR] ${errorMsg}`,
    isRetryable: true,
    retryDelay: 60000, // 1 minute
    action: 'Review error details. Check QB service status. May require manual intervention.',
    details: {
      httpStatus: context?.httpStatus,
      qbErrorCode: context?.qbErrorCode,
      operation: context?.operation,
      originalError: errorMsg
    }
  };
}

/**
 * Format error for operational logging (stable prefix for grep/monitoring)
 */
export function formatOperationalError(classified: ClassifiedError): string {
  return `[QB_ERROR][${classified.category}][${classified.severity.toUpperCase()}] ${classified.message} | Action: ${classified.action}`;
}

/**
 * Log error with classification for monitoring
 */
export function logClassifiedError(
  error: Error | string,
  context?: {
    httpStatus?: number;
    qbErrorCode?: string;
    operation?: string;
  }
): void {
  const classified = classifyError(error, context);
  const logMsg = formatOperationalError(classified);

  // Use appropriate log level based on severity
  switch (classified.severity) {
    case 'critical':
      console.error(logMsg, classified.details);
      break;
    case 'warning':
      console.warn(logMsg, classified.details);
      break;
    case 'info':
      console.log(logMsg, classified.details);
      break;
  }
}

/**
 * Get retry strategy based on error classification
 */
export function getRetryStrategy(classified: ClassifiedError): {
  shouldRetry: boolean;
  delayMs: number;
  maxRetries: number;
} {
  if (!classified.isRetryable) {
    return { shouldRetry: false, delayMs: 0, maxRetries: 0 };
  }

  // RATE_LIMIT_TRANSIENT: fewer retries, longer delays
  if (classified.category === 'RATE_LIMIT_TRANSIENT') {
    return {
      shouldRetry: true,
      delayMs: classified.retryDelay || 60000,
      maxRetries: 3
    };
  }

  // UNKNOWN_INTERNAL: standard retry with exponential backoff
  return {
    shouldRetry: true,
    delayMs: classified.retryDelay || 60000,
    maxRetries: 5
  };
}

/**
 * Operational log line generators (stable prefixes for monitoring)
 */
export const OpLog = {
  preflightFail: (check: string, detail: string) =>
    `[QB_PREFLIGHT][FAIL] Check failed: ${check} | ${detail}`,

  preflightWarn: (check: string, detail: string) =>
    `[QB_PREFLIGHT][WARN] Check warning: ${check} | ${detail}`,

  dryRunDecision: (saleId: string, reason: string) =>
    `[QB_DRY_RUN][DECISION] Sale ${saleId} processed in dry-run mode | ${reason}`,

  controlChange: (control: string, from: any, to: any, userId: string) =>
    `[QB_CONTROL][CHANGE] ${control} changed from ${from} to ${to} by user ${userId}`,

  qbWriteFail: (operation: string, entityId: string, category: ErrorCategory) =>
    `[QB_WRITE][FAIL][${category}] Operation ${operation} failed for entity ${entityId}`,

  qbWriteSuccess: (operation: string, entityId: string, qbId: string, durationMs: number) =>
    `[QB_WRITE][SUCCESS] Operation ${operation} succeeded for entity ${entityId} | QB ID: ${qbId} | ${durationMs}ms`
};
