import { addCalendarDays } from './clubDataDay';

/** The reporting RPC accepts at most 93 inclusive reporting dates. */
export const CLUB_DATA_MAX_DAYS = 93;
export function clubDataRangeError(
  start: string,
  end: string,
  today: string,
  maxDays = CLUB_DATA_MAX_DAYS
): string | null {
  const valid = (value: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T12:00:00Z`)) &&
    addCalendarDays(value, 0) === value;
  if (!valid(start) || !valid(end)) return 'Choose A Start And End Date.';
  if (start > end) return 'Start Date Must Be On Or Before End Date.';
  if (end > today) return 'Choose Dates On Or Before Today.';
  if (start < addCalendarDays(end, -(maxDays - 1))) return `Choose Up To ${maxDays} Days.`;
  return null;
}
export function clubDataRangeDays(start: string, end: string): number {
  return (
    Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86400000) + 1
  );
}

/** Inclusive user dates; older dataUntil links retain their exclusive boundary. */
export function readClubDataRange(
  params: URLSearchParams,
  today: string
): {
  start: string | null;
  end: string;
} | null {
  const until = params.get('dataUntil');
  let end = params.get('dataEnd') ?? '';
  if (until !== null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(until) || !Number.isFinite(Date.parse(`${until}T12:00:00Z`)))
      return null;
    end = addCalendarDays(until, -1);
    if (addCalendarDays(end, 1) !== until) return null;
  }
  const start = params.get('dataStart');
  return clubDataRangeError(start ?? end, end, today) ? null : { start, end };
}
