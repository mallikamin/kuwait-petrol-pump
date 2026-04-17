/**
 * Session Debug Logger
 * Tracks all auth events for debugging session logout issues
 * Stores in localStorage so data persists across page reloads
 */

export interface SessionLog {
  timestamp: string;
  event: string;
  data?: Record<string, any>;
}

const SESSION_LOG_KEY = 'app-session-debug-log';
const MAX_LOG_ENTRIES = 100; // Prevent localStorage from growing unbounded

export class SessionDebugger {
  private logs: SessionLog[] = [];

  constructor() {
    this.loadLogs();
  }

  /**
   * Log an auth event with timestamp and data
   */
  log(event: string, data?: Record<string, any>) {
    const log: SessionLog = {
      timestamp: new Date().toISOString(),
      event,
      data,
    };

    this.logs.push(log);

    // Keep only recent logs to prevent localStorage overflow
    if (this.logs.length > MAX_LOG_ENTRIES) {
      this.logs = this.logs.slice(-MAX_LOG_ENTRIES);
    }

    this.saveLogs();
    this.logToConsole(log);
  }

  /**
   * Log a critical logout event with full context
   */
  logLogout(reason: string, context?: Record<string, any>) {
    const logoutEvent: SessionLog = {
      timestamp: new Date().toISOString(),
      event: 'LOGOUT',
      data: {
        reason,
        context,
        userAgent: navigator.userAgent,
        url: window.location.href,
        sessionDuration: this.getSessionDuration(),
        errorCount: this.getErrorCount(),
      },
    };

    this.logs.push(logoutEvent);
    if (this.logs.length > MAX_LOG_ENTRIES) {
      this.logs = this.logs.slice(-MAX_LOG_ENTRIES);
    }

    this.saveLogs();
    this.logToConsole(logoutEvent, 'error');
  }

  /**
   * Get all session logs
   */
  getLogs(): SessionLog[] {
    return this.logs;
  }

  /**
   * Get logs as formatted text for error reporting
   */
  getLogsAsText(): string {
    return this.logs
      .map(
        (log) =>
          `[${log.timestamp}] ${log.event}${
            log.data ? ': ' + JSON.stringify(log.data) : ''
          }`
      )
      .join('\n');
  }

  /**
   * Export logs for error reporting/debugging
   */
  exportLogs(): {
    logs: SessionLog[];
    summary: string;
    userAgent: string;
    url: string;
  } {
    return {
      logs: this.logs,
      summary: this.generateSummary(),
      userAgent: navigator.userAgent,
      url: window.location.href,
    };
  }

  /**
   * Clear all logs
   */
  clear() {
    this.logs = [];
    localStorage.removeItem(SESSION_LOG_KEY);
  }

  /**
   * Get count of errors in logs
   */
  private getErrorCount(): number {
    return this.logs.filter(
      (log) =>
        log.event.includes('error') ||
        log.event.includes('failed') ||
        log.event.includes('logout')
    ).length;
  }

  /**
   * Get session duration from first log to last
   */
  private getSessionDuration(): string {
    if (this.logs.length < 2) return 'Unknown';

    const first = new Date(this.logs[0].timestamp).getTime();
    const last = new Date(this.logs[this.logs.length - 1].timestamp).getTime();
    const duration = last - first;

    const hours = Math.floor(duration / (1000 * 60 * 60));
    const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((duration % (1000 * 60)) / 1000);

    return `${hours}h ${minutes}m ${seconds}s`;
  }

  /**
   * Generate summary of session for error reporting
   */
  private generateSummary(): string {
    const logoutLogs = this.logs.filter((log) => log.event === 'LOGOUT');
    const refreshLogs = this.logs.filter((log) =>
      log.event.includes('refresh')
    );
    const errorLogs = this.logs.filter(
      (log) =>
        log.event.includes('error') ||
        log.event.includes('failed') ||
        log.event.includes('invalid')
    );

    return `
Session Debug Summary
=====================
Total Events: ${this.logs.length}
Logouts: ${logoutLogs.length}
Refresh Attempts: ${refreshLogs.length}
Errors: ${errorLogs.length}
Duration: ${this.getSessionDuration()}

Last 5 Events:
${this.logs
  .slice(-5)
  .map(
    (log) =>
      `- [${log.timestamp}] ${log.event}${
        log.data ? ' (' + JSON.stringify(log.data) + ')' : ''
      }`
  )
  .join('\n')}

Logout Events:
${logoutLogs
  .map(
    (log) =>
      `- [${log.timestamp}] ${log.data?.reason || 'Unknown'}${
        log.data?.context ? ' (' + JSON.stringify(log.data.context) + ')' : ''
      }`
  )
  .join('\n') || '- None'}
    `.trim();
  }

  /**
   * Log to console with appropriate level
   */
  private logToConsole(log: SessionLog, level: 'log' | 'error' = 'log') {
    if (level === 'error') {
      console.error(`[SessionDebug] ${log.event}`, log.data || '');
    } else {
      console.log(`[SessionDebug] ${log.event}`, log.data || '');
    }
  }

  /**
   * Load logs from localStorage
   */
  private loadLogs() {
    try {
      const stored = localStorage.getItem(SESSION_LOG_KEY);
      if (stored) {
        this.logs = JSON.parse(stored);
      }
    } catch (e) {
      console.error('Failed to load session logs from localStorage:', e);
      this.logs = [];
    }
  }

  /**
   * Save logs to localStorage
   */
  private saveLogs() {
    try {
      localStorage.setItem(SESSION_LOG_KEY, JSON.stringify(this.logs));
    } catch (e) {
      console.error('Failed to save session logs to localStorage:', e);
    }
  }
}

// Global singleton instance
export const sessionDebugger = new SessionDebugger();

/**
 * Helper to get session logs for error reporting
 * Usage: In error handler, call: navigator.clipboard.writeText(getSessionLogsText())
 */
export const getSessionLogsText = (): string => {
  const exported = sessionDebugger.exportLogs();
  return `
LOGOUT ERROR REPORT
===================
URL: ${exported.url}
User Agent: ${exported.userAgent}

${exported.summary}

Full Log:
${exported.logs
  .map(
    (log) =>
      `[${log.timestamp}] ${log.event}${
        log.data ? ': ' + JSON.stringify(log.data, null, 2) : ''
      }`
  )
  .join('\n\n')}
  `.trim();
};
