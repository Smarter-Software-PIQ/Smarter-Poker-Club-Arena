import {
  accountingDay,
  addCalendarDays,
  isCalendarDate,
  UNION_INVOICE_BASIS,
  type ClubDataCoverage,
} from './clubDataDay';

/** One server snapshot, with the same scope and filters as its headline. */
export interface ClubDataReconciliation {
  complete: boolean;
  missing_days: string[];
  bbj_gross: number | null;
  bbj_awards: number | null;
  bbj_net: number | null;
  cash_fee: number;
  cash_winnings: number;
  tournament_fee: number;
  tournament_winnings: number;
  cash_residual: number | null;
  tournament_flow_difference: number;
}

export function parseClubDataReconciliation(value: unknown): ClubDataReconciliation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (
    typeof v.complete !== 'boolean' ||
    !Array.isArray(v.missing_days) ||
    !v.missing_days.every(isCalendarDate)
  )
    return null;
  for (const key of [
    'cash_fee',
    'cash_winnings',
    'tournament_fee',
    'tournament_winnings',
    'tournament_flow_difference',
  ]) {
    if (typeof v[key] !== 'number' || !Number.isFinite(v[key])) return null;
  }
  for (const key of ['bbj_gross', 'bbj_awards', 'bbj_net', 'cash_residual']) {
    if (v[key] !== null && (typeof v[key] !== 'number' || !Number.isFinite(v[key]))) return null;
    if (v.complete && v[key] === null) return null;
  }
  if (v.complete && v.missing_days.length) return null;
  return value as ClubDataReconciliation;
}

export function financialWindowStatus(
  basis: string | undefined,
  coverage: ClubDataCoverage | null | undefined,
  range: { start: string; end: string },
  today = accountingDay()
): { posted: boolean; current: boolean; final: boolean; closingBoundaries: string[] } {
  const invoice = basis === UNION_INVOICE_BASIS;
  const gaps = [coverage?.missing_days, coverage?.failed_days, coverage?.not_invoice_exact_days];
  const noGaps = gaps.every(
    (days) => days === undefined || (Array.isArray(days) && days.length === 0)
  );
  const waiting = coverage?.awaiting_boundary_days;
  const certifiedNoGaps = [...gaps, waiting].every(
    (days) => Array.isArray(days) && days.length === 0
  );
  const posted = invoice && coverage?.complete === true && noGaps;
  const validRange =
    isCalendarDate(range.start) && isCalendarDate(range.end) && range.start <= range.end;
  const current = validRange && range.start === today && range.end === today;
  return {
    posted,
    current,
    final:
      posted &&
      validRange &&
      range.end < today &&
      coverage?.provisional === false &&
      certifiedNoGaps,
    closingBoundaries: Array.isArray(waiting)
      ? [...new Set(waiting.filter(isCalendarDate).map((day) => addCalendarDays(day, 1)))].sort()
      : [],
  };
}

export function pacificClosingBoundary(day: string): string {
  if (!isCalendarDate(day)) return '';
  const label = new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  return `${label} 12:00 AM Pacific Time`;
}
