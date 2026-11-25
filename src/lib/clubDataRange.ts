import { addCalendarDays, isCalendarDate } from './clubDataDay';

/** The reporting RPC accepts the past 90 inclusive reporting dates. */
export const CLUB_DATA_MAX_DAYS = 90;
export const CLUB_DATA_PRESETS = [1, 7, 14, 30, 90] as const;
export type ClubDataPreset = (typeof CLUB_DATA_PRESETS)[number];

export function readClubDataPreset(params: URLSearchParams): ClubDataPreset {
  return CLUB_DATA_PRESETS.find((days) => String(days) === params.get('dataDays')) ?? 1;
}

/** Rolling periods follow Pacific midnight unless a historical end date is pinned. */
export function writeClubDataRange(
  params: URLSearchParams,
  start: string | null,
  end: string,
  today: string,
  days: ClubDataPreset
): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete('dataUntil');
  if (start !== null) next.set('dataStart', start);
  else next.delete('dataStart');
  if (start !== null || end !== today) next.set('dataEnd', end);
  else next.delete('dataEnd');
  if (start === null && days !== 1) next.set('dataDays', String(days));
  else next.delete('dataDays');
  return next;
}

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
  if (maxDays === CLUB_DATA_MAX_DAYS && start < clubDataOldestDay(today))
    return 'Choose Dates Within The Past 90 Days.';
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

export function clubDataOldestDay(today: string): string {
  return addCalendarDays(today, -(CLUB_DATA_MAX_DAYS - 1));
}
export function clubDataRequestedRangeError(params: URLSearchParams, today: string): string | null {
  if (!params.has('dataStart') && !params.has('dataEnd') && !params.has('dataUntil')) return null;
  const until = params.get('dataUntil');
  if (until !== null && !isCalendarDate(until)) return 'Choose A Start And End Date.';
  const end = until !== null ? addCalendarDays(until, -1) : (params.get('dataEnd') ?? '');
  const start =
    params.get('dataStart') ??
    (isCalendarDate(end) ? addCalendarDays(end, 1 - readClubDataPreset(params)) : end);
  return clubDataRangeError(start, end, today);
}
