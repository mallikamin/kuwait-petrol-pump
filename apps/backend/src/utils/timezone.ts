import { fromZonedTime, toZonedTime } from 'date-fns-tz';

/**
 * Timezone utility for Kuwait Petrol Pump POS
 * Branch timezone: Asia/Karachi (PKT, UTC+5)
 *
 * All date boundaries (report filters, reconciliation ranges, etc.)
 * should use branch-local midnight, not UTC midnight.
 */

const BRANCH_TIMEZONE = 'Asia/Karachi'; // PKT (Pakistan Time, UTC+5)

/**
 * Accepts both "YYYY-MM-DD" and any ISO-prefixed string ("YYYY-MM-DDTHH:MM:SS.sssZ",
 * "YYYY-MM-DD...+05:00", etc.). Only the calendar-date prefix is consumed; any
 * time/zone suffix is intentionally discarded so branch-local boundaries are
 * computed from the date the caller wrote, not the UTC instant they typed.
 */
function parseBranchDateParts(dateString: string): [number, number, number] {
  const [year, month, day] = dateString.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) {
    throw new Error(`Invalid date string: ${dateString}`);
  }
  return [year, month, day];
}

/**
 * Convert date string to branch-local start-of-day in UTC.
 * Example: "2026-01-15" → 2026-01-15T00:00:00 PKT → 2026-01-14T19:00:00Z
 * Also accepts ISO-prefixed input — only the leading YYYY-MM-DD is used.
 */
export function toBranchStartOfDay(dateString: string): Date {
  const [year, month, day] = parseBranchDateParts(dateString);
  const localMidnight = new Date(year, month - 1, day, 0, 0, 0, 0);
  return fromZonedTime(localMidnight, BRANCH_TIMEZONE);
}

/**
 * Convert date string to branch-local end-of-day in UTC.
 * Example: "2026-01-15" → 2026-01-15T23:59:59.999 PKT → 2026-01-15T18:59:59.999Z
 * Also accepts ISO-prefixed input — only the leading YYYY-MM-DD is used.
 */
export function toBranchEndOfDay(dateString: string): Date {
  const [year, month, day] = parseBranchDateParts(dateString);
  const localEndOfDay = new Date(year, month - 1, day, 23, 59, 59, 999);
  return fromZonedTime(localEndOfDay, BRANCH_TIMEZONE);
}

/**
 * Convert UTC timestamp to branch-local date string (YYYY-MM-DD)
 * Example: 2026-01-15T20:00:00Z → "2026-01-16" (next day in PKT)
 */
export function toBranchDateString(utcDate: Date): string {
  const branchDate = toZonedTime(utcDate, BRANCH_TIMEZONE);
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
 * Get business date as Date object (for backward compatibility)
 * Returns current date in branch timezone as start-of-day UTC
 */
export async function getBusinessDate(_organizationId?: string): Promise<Date> {
  const todayString = getBranchToday();
  return toBranchStartOfDay(todayString);
}

/**
 * Normalize businessDate string to UTC midnight (legacy compatibility)
 * For date-only comparisons where timezone doesn't matter
 */
export function normalizeBusinessDateUTC(dateString: string): Date {
  const [year, month, day] = parseBranchDateParts(dateString);
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
}
