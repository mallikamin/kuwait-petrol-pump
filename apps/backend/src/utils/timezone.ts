import { prisma } from '../config/database';
import { toZonedTime, format } from 'date-fns-tz';
import { startOfDay } from 'date-fns';

/**
 * Get the current business date for an organization based on its timezone
 *
 * This ensures shift dates and business operations use the correct local date,
 * not the server's system timezone. Critical for multi-timezone deployments.
 *
 * @param organizationId - Organization UUID
 * @returns Date object set to start of business day (00:00:00) in the organization's timezone
 *
 * @example
 * // Server in UTC on Apr 3 11pm, business in Asia/Karachi on Apr 4 4am
 * const businessDate = await getBusinessDate(orgId); // Returns Apr 4 00:00:00 UTC
 */
export async function getBusinessDate(organizationId: string): Promise<Date> {
  // Fetch organization timezone from database
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { timezone: true },
  });

  if (!organization) {
    throw new Error(`Organization ${organizationId} not found`);
  }

  const timezone = organization.timezone || 'Asia/Karachi'; // Default fallback

  // Get current time in the business timezone
  const now = new Date();
  const zonedNow = toZonedTime(now, timezone);

  // Get start of day (00:00:00) in the business timezone
  const businessDayStart = startOfDay(zonedNow);

  // Convert back to UTC Date object (but preserving the business date)
  // This Date will have the correct date component for database storage
  const utcBusinessDate = new Date(format(businessDayStart, 'yyyy-MM-dd', { timeZone: timezone }));
  utcBusinessDate.setUTCHours(0, 0, 0, 0);

  return utcBusinessDate;
}

/**
 * Get business date synchronously from a cached timezone string
 * Use this when you already have the timezone and don't need to query the database
 *
 * @param timezone - IANA timezone string (e.g., 'Asia/Karachi')
 * @returns Date object set to start of business day in that timezone
 */
export function getBusinessDateSync(timezone: string = 'Asia/Karachi'): Date {
  const now = new Date();
  const zonedNow = toZonedTime(now, timezone);
  const businessDayStart = startOfDay(zonedNow);

  const utcBusinessDate = new Date(format(businessDayStart, 'yyyy-MM-dd', { timeZone: timezone }));
  utcBusinessDate.setUTCHours(0, 0, 0, 0);

  return utcBusinessDate;
}

/**
 * Format a date for display in the business timezone
 *
 * @param date - Date to format
 * @param timezone - IANA timezone string
 * @param formatStr - date-fns format string (default: 'PPpp' = 'Apr 3, 2026, 4:30:00 PM')
 * @returns Formatted date string in the business timezone
 */
export function formatInBusinessTimezone(
  date: Date,
  timezone: string = 'Asia/Karachi',
  formatStr: string = 'PPpp'
): string {
  const zonedDate = toZonedTime(date, timezone);
  return format(zonedDate, formatStr, { timeZone: timezone });
}
