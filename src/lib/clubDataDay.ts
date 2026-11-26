/**
 * Club Data accounting uses Pacific calendar dates (owner 2026-11-16).
 * The union invoice week is Monday midnight through the next Monday midnight
 * in America/Los_Angeles. Chicago clocks may still be printed explicitly, but
 * subtracting two Chicago wall-clock hours is not a Pacific calendar date on
 * fall-back Sunday. Standalone and pre-union reports use the same Pacific
 * calendar boundaries, while preserving their own net-money-flow definition.
 */
export const CLUB_DATA_TIME_ZONE = 'America/Chicago';
/** The short badge printed beside a range or a time. */
export const CLUB_DATA_ZONE_LABEL = 'Chicago Time';

const dayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: CLUB_DATA_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The Chicago calendar date of an instant, as YYYY-MM-DD. */
export function chicagoDay(at: Date | string | number = new Date()): string {
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  const parts = Object.fromEntries(dayFormat.formatToParts(d).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/**
 * A real YYYY-MM-DD calendar date. The browser rolls 2026-02-30 over to
 * March 2 and refuses 2026-13-01 outright, so both are checked here, at noon
 * UTC (a date-only string is never read as an instant on these screens).
 */
export function isCalendarDate(day: unknown): day is string {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const t = Date.parse(`${day}T12:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === day;
}

/** A calendar date moved by whole days. Zone free: the date is a label. */
export function addCalendarDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Pacific calendar day, shared by every viewer of the accounting reports. */
const accountingDayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Los_Angeles',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Pacific midnight is the invoice boundary, including clock-change Sundays. */
export function accountingDay(at: Date | string | number = new Date()): string {
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  const p = Object.fromEntries(accountingDayFormat.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

/** The start of a Pacific date. Ask the zone database rather than assuming an offset. */
export function accountingDayStart(day: string): Date | null {
  if (!isCalendarDate(day)) return null;
  const [y, m, d] = day.split('-').map(Number);
  const before = addCalendarDays(day, -1);
  for (const hour of [7, 8]) {
    const at = new Date(Date.UTC(y, m - 1, d, hour));
    if (accountingDay(at) === day && accountingDay(at.getTime() - 1) === before) return at;
  }
  return null;
}

const boundaryFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: CLUB_DATA_TIME_ZONE,
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

/** "Nov 2, 2026 2:00 AM": an instant on the Chicago clock, for a boundary. */
export function chicagoBoundaryStamp(at: Date | string | number): string {
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  const p = Object.fromEntries(boundaryFormat.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.month} ${p.day}, ${p.year} ${p.hour}:${p.minute} ${p.dayPeriod}`;
}

/**
 * The instant a Chicago calendar day starts: its midnight, daylight saving
 * included (the clocks change at 02:00, so midnight always exists once).
 * Found from the zone database, never by adding a fixed offset.
 */
export function chicagoDayStart(day: string): Date | null {
  if (!isCalendarDate(day)) return null;
  const [y, m, d] = day.split('-').map(Number);
  const before = addCalendarDays(day, -1);
  for (const hour of [5, 6]) {
    const at = new Date(Date.UTC(y, m - 1, d, hour));
    if (chicagoDay(at) === day && chicagoDay(new Date(at.getTime() - 1)) === before) return at;
  }
  return null;
}

/**
 * WHICH DAY A CLUB DATA ANSWER COUNTS.
 * Union invoices and standalone/pre-union net-flow reports both count Pacific
 * calendar dates. Their financial definitions stay distinct. Older deployed
 * answers may still state Chicago calendar days, so retain that explicit
 * compatibility basis until an upgraded answer arrives.
 */
export type ClubDataDayBasis = 'accounting' | 'pacific' | 'calendar';
export const PACIFIC_NET_FLOW_BASIS = 'pacific_net_money_flow';
/** accounting_basis of an answer on the union invoice basis. */
export const UNION_INVOICE_BASIS = 'union_invoice_accounting';
/** day_basis of an answer on the union invoice basis. */
export const ACCOUNTING_DAY_BASIS = 'America/Los_Angeles 00:00';

export function clubDataDayBasis(answer: unknown): ClubDataDayBasis {
  if (answer && typeof answer === 'object') {
    const a = answer as { accounting_basis?: unknown; day_basis?: unknown };
    if (a.accounting_basis === PACIFIC_NET_FLOW_BASIS) return 'pacific';
    if (
      a.accounting_basis === UNION_INVOICE_BASIS ||
      a.day_basis === ACCOUNTING_DAY_BASIS ||
      a.day_basis === 'America/Chicago 02:00'
    ) {
      return 'accounting';
    }
  }
  return 'calendar';
}

/**
 * Whether an answer belongs to a union. Financial definitions must never be
 * inferred from its Pacific time zone alone: standalone reports share that
 * zone but do not use union invoice accounting.
 */
export function isUnionClubAnswer(answer: unknown): boolean {
  if (!answer || typeof answer !== 'object') return false;
  const unionId = (answer as { union_id?: unknown }).union_id;
  return (
    (typeof unionId === 'string' && unionId.length > 0) || clubDataDayBasis(answer) === 'accounting'
  );
}

/** Today (or the day of `at`) on a basis. */
export function clubDataDayOn(basis: ClubDataDayBasis, at: Date | string | number = new Date()) {
  return basis === 'calendar' ? chicagoDay(at) : accountingDay(at);
}

/** Pacific midnight for current reports; Chicago midnight for older answers. */
export function clubDataDayStart(day: string, basis: ClubDataDayBasis): Date | null {
  return basis === 'calendar' ? chicagoDayStart(day) : accountingDayStart(day);
}

/**
 * The window [start, end) of the first through the last day, inclusive: from
 * the start of the first day to the start of the day after the last. So the
 * pair 2026-11-02 / 2026-11-08 on the accounting basis is exactly
 * [Nov 2 02:00, Nov 9 02:00) Chicago, the invoice week, and two adjacent
 * windows share one boundary instant: nothing is counted twice or dropped.
 */
export function clubDataWindow(
  firstDay: string,
  lastDay: string,
  basis: ClubDataDayBasis
): { start: Date; end: Date } | null {
  const start = clubDataDayStart(firstDay, basis);
  const end = clubDataDayStart(addCalendarDays(lastDay, 1), basis);
  if (!start || !end || end.getTime() <= start.getTime()) return null;
  return { start, end };
}

/** "Nov 2, 2026 2:00 AM To Nov 9, 2026 2:00 AM": a window by its real boundaries. */
export function clubDataWindowLabel(
  firstDay: string,
  lastDay: string,
  basis: ClubDataDayBasis
): string {
  const w = clubDataWindow(firstDay, lastDay, basis);
  return w ? `${chicagoBoundaryStamp(w.start)} To ${chicagoBoundaryStamp(w.end)}` : '';
}

/**
 * The accounting window label, kept for callers that only ever read the
 * union basis. "Nov 2 2:00 AM To Nov 9 2:00 AM" is exactly the invoice week.
 */
export function accountingWindowLabel(firstDay: string, lastDay: string): string {
  return clubDataWindowLabel(firstDay, lastDay, 'accounting');
}

/** The clock time a day starts at on a basis, as the date pickers say it. */
export function clubDataBoundaryClock(basis: ClubDataDayBasis, day = accountingDay()): string {
  if (basis === 'calendar') return '12:00 AM';
  const start = accountingDayStart(day);
  if (!start) return '';
  return start.toLocaleTimeString('en-US', {
    timeZone: CLUB_DATA_TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/** The short statement of the day the screens count. */
export const CLUB_DATA_DAY_RULE =
  'Days Run Midnight To Midnight Pacific Time. Weeks Run Monday Through Sunday';
export function clubDataDayRule(basis: ClubDataDayBasis): string {
  return basis === 'calendar' ? 'Days Run Midnight To Midnight Chicago Time' : CLUB_DATA_DAY_RULE;
}

/**
 * What the union basis figures are, and which of them equal the invoice
 * (stage 2 contract, corrected 2026-11-15 by review): Total Winnings is cash
 * plus every tournament result, MTT Winnings is finished MTTs only.
 */
export const UNION_BASIS_DEFINITIONS =
  "Union Invoice Basis. Fee Is The Rake Credited To The Club, The Invoice's Rake Generated; " +
  'Tournament Fees Are Recognized When The Tournament Settles. ' +
  "Total Winnings Is The Players' Result: Cash Winnings (Each Cash Hand's Stack Change, Bad Beat " +
  'Jackpot Awards Included) Plus Tournament Results (MTT Winnings, Sit And Go Results And ' +
  'Unfinished MTT Entries). MTT Winnings Are Finished MTTs Only: Prizes, Bounties And Refunds ' +
  'Less Buy-Ins, Rebuys And Add-Ons; An Entry In A Tournament Still Running At A Week Boundary ' +
  'Counts In The Week It Settles, As On The Invoice. For A Whole Invoice Week With No Filters, ' +
  "Fee Equals The Invoice's Rake Generated And Total Winnings Equals Its Player Win/Loss (Its " +
  'Player Net Loss With The Sign Reversed). Chips Still On The Felt Are Not Added.';

/**
 * fn_ca_club_acct_coverage: whether the accounting read model holds the
 * window whole, and whether an issued union weekly invoice covers it yet.
 * Present on the union basis only.
 */
export interface ClubDataCoverage {
  complete?: boolean;
  missing_days?: string[];
  failed_days?: string[];
  not_invoice_exact_days?: string[];
  awaiting_boundary_days?: string[];
  provisional?: boolean;
  provisional_from?: string | null;
  window_start?: string;
  window_end?: string;
}

/** "Nov 3, 2026" for a calendar date. Zone free: the date is a label. */
function dayName(day: string): string {
  if (!isCalendarDate(day)) return day;
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function dayList(days: unknown): string {
  const list = Array.isArray(days) ? days.filter((d): d is string => typeof d === 'string') : [];
  const shown = list.slice(0, 4).map(dayName).join(', ');
  return list.length > 4 ? `${shown} And ${list.length - 4} More` : shown;
}

/**
 * The window a covered answer states, by the reader's own boundary instants
 * ("Nov 2, 2026 2:00 AM To Nov 9, 2026 2:00 AM"); null when it states none.
 */
export function coverageWindowLabel(coverage: ClubDataCoverage | null | undefined): string | null {
  if (!coverage?.window_start || !coverage.window_end) return null;
  const from = chicagoBoundaryStamp(coverage.window_start);
  const to = chicagoBoundaryStamp(coverage.window_end);
  return from && to ? `${from} To ${to}` : null;
}

/**
 * What the screens say about a window the model does not hold whole, and
 * about a window no issued invoice covers yet. Null when there is nothing to
 * say. A missing, failed or not-invoice-exact day is named, never folded into
 * a total that looks final.
 */
export function coverageNotices(coverage: ClubDataCoverage | null | undefined): {
  incomplete: string | null;
  provisional: string | null;
} {
  if (!coverage) return { incomplete: null, provisional: null };
  const parts: string[] = [];
  const missing = coverage.missing_days ?? [];
  const failed = coverage.failed_days ?? [];
  const inexact = coverage.not_invoice_exact_days ?? [];
  if (missing.length) parts.push(`Not Yet Loaded: ${dayList(missing)}`);
  if (failed.length) parts.push(`Load Failed: ${dayList(failed)}`);
  if (inexact.length) parts.push(`Week Boundary Not Invoice-Exact: ${dayList(inexact)}`);
  const incomplete =
    coverage.complete === false || parts.length
      ? `Incomplete: ${parts.length ? parts.join('. ') : 'Not Every Accounting Day Is Held'}. These Totals Can Differ From The Union Invoice Until Those Days Are Whole.`
      : null;
  let provisional: string | null = null;
  if (coverage.provisional) {
    const from = coverage.provisional_from ? accountingDayStart(coverage.provisional_from) : null;
    provisional = from
      ? `Provisional From ${chicagoBoundaryStamp(from)} ${CLUB_DATA_ZONE_LABEL}: No Weekly Invoice Has Been Issued For That Part Of The Window Yet, So These Figures Can Still Change.`
      : 'Provisional: No Weekly Invoice Has Been Issued For Part Of This Window Yet, So These Figures Can Still Change.';
  }
  const awaiting = coverage.awaiting_boundary_days ?? [];
  if (awaiting.length) {
    const note = `Week Boundary Not Yet Certified: ${dayList(awaiting)}. Tournament Entries Still Running At That Boundary Are Added When It Is Certified.`;
    provisional = provisional ? `${provisional} ${note}` : `Provisional: ${note}`;
  }
  return { incomplete, provisional };
}

/** HH:MM of an instant on the Chicago clock. */
export function chicagoClock(at: Date | string | number): string {
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-GB', {
    timeZone: CLUB_DATA_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** MM/DD HH:MM of an instant on the Chicago clock. */
export function chicagoStamp(at: Date | string | number): string {
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  const day = chicagoDay(d);
  return `${day.slice(5, 7)}/${day.slice(8, 10)} ${chicagoClock(d)}`;
}

/** Last N Chicago calendar dates, inclusive of today. */
export function lastDaysRange(days: number): { from: string; to: string } {
  const to = chicagoDay();
  return { from: addCalendarDays(to, 1 - days), to };
}

/** Next Chicago midnight, including 23-hour and 25-hour days. */
export function nextChicagoDay(now = new Date()): number {
  if (!Number.isFinite(now.getTime())) throw new RangeError('A Valid Date Is Required');
  const today = chicagoDay(now);
  let lo = now.getTime();
  let hi = lo + 26 * 60 * 60 * 1000;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (chicagoDay(mid) === today) lo = mid;
    else hi = mid;
  }
  return hi;
}

export function clubDataSelectedDatesLabel(first: string, last: string): string {
  return first === last ? dayName(first) : `${dayName(first)} Through ${dayName(last)}`;
}

/** Inclusive calendar labels are distinct from the exclusive instant at the right boundary. */
export function clubDataCalendarLabel(
  first: string,
  last: string,
  basis: ClubDataDayBasis
): string {
  const dates = clubDataSelectedDatesLabel(first, last);
  return `${dates} ${basis === 'calendar' ? 'Chicago Calendar Dates' : 'Pacific Calendar Dates'}`;
}
