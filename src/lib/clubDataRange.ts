import { addCalendarDays } from './clubDataDay';

/** The reporting RPC accepts at most 93 inclusive Chicago calendar days. */
export const CLUB_DATA_MAX_DAYS = 93;
export function clubDataRangeError(start: string, end: string, today: string): string | null {
  const valid = (value: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T12:00:00Z`)) &&
    addCalendarDays(value, 0) === value;
  if (!valid(start) || !valid(end)) return 'Choose A Start And End Date.';
  if (start > end) return 'Start Date Must Be On Or Before End Date.';
  if (end > today) return 'Choose Dates On Or Before Today.';
  if (start < addCalendarDays(end, -(CLUB_DATA_MAX_DAYS - 1))) return 'Choose Up To 93 Days.';
  return null;
}
export function clubDataRangeDays(start: string, end: string): number {
  return (
    Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86400000) + 1
  );
}
