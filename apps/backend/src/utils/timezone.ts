import { zonedTimeToUtc, utcToZonedTime } from 'date-fns-tz';

/**
 * Timezone utility for Kuwait Petrol Pump POS
 * Branch timezone: Asia/Karachi (PKT, UTC+5)
 *
 * All date boundaries (report filters, reconciliation ranges, etc.)
 * should use branch-local midnight, not UTC midnight.
 */

const BRANCH_TIMEZONE = 'Asia/Karachi'; // PKT (Pakistan Time, UTC+5)

/**
 * Convert date string (YYYY-MM-DD) to branch-local start-of-day in UTC
 * Example: "2026-01-15" → 2026-01-15T00:00:00 PKT → 2026-01-14T19:00:00Z
 */
export function toBranchStartOfDay(dateString: string): Date {
  const [year, month, day] = dateString.split('-').map(Number);
  if (!year || !month || !day) {
    throw new Error(`Invalid date string: ${dateString}`);
  }

  // Create date at midnight in branch timezone
  const localMidnight = new Date(year, month - 1, day, 0, 0, 0, 0);

  // Convert to UTC
  return zonedTimeToUtc(localMidnight, BRANCH_TIMEZONE);
}

/**
 * Convert date string (YYYY-MM-DD) to branch-local end-of-day in UTC
 * Example: "2026-01-15" → 2026-01-15T23:59:59.999 PKT → 2026-01-15T18:59:59.999Z
 */
export function toBranchEndOfDay(dateString: string): Date {
  const [year, month, day] = dateString.split('-').map(Number);
  if (!year || !month || !day) {
    throw new Error(`Invalid date string: ${dateString}`);
  }

  // Create date at end-of-day in branch timezone
  const localEndOfDay = new Date(year, month - 1, day, 23, 59, 59, 999);

  // Convert to UTC
  return zonedTimeToUtc(localEndOfDay, BRANCH_TIMEZONE);
}

/**
 * Convert UTC timestamp to branch-local date string (YYYY-MM-DD)
 * Example: 2026-01-15T20:00:00Z → "2026-01-16" (next day in PKT)
 */
export function toBranchDateString(utcDate: Date): string {
  const branchDate = utcToZonedTime(utcDate, BRANCH_TIMEZONE);
  const year = branchDate.getFullYear();
  const month = String(branchDate.getMonth() + 1).padStart(2, '0');
  const day = String(branchDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Get branch-local "now" as date string (YYYY-MM-DD)
 * Used for default date selection in UI
 */
export function getBranchToday(): string {
  return toBranchDateString(new Date());
}

/**
 * Normalize businessDate string to UTC midnight (legacy compatibility)
 * For date-only comparisons where timezone doesn't matter
 */
export function normalizeBusinessDateUTC(dateString: string): Date {
  const [year, month, day] = dateString.split('-').map(Number);
  if (!year || !month || !day) {
    throw new Error(`Invalid date string: ${dateString}`);
  }
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
}
