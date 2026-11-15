/**
 * CLUB DATA READS THE UNION INVOICE WEEK FROM THE INVOICE (owner, 2026-11-14).
 *
 * "The data page display data starts and stops at the same 2AM time that the
 * invoices are appearing as; the data on this page should match the invoices
 * 1:1."
 *
 * ca_club_data_union_weeks (20261114235606) returns the issued union weekly
 * invoices inside a window that starts and stops at 02:00 America/Chicago,
 * the invoice's own boundary. Fee and player net loss are the document's
 * rake_generated and players_won, so what this module prints cannot disagree
 * with the invoice: it is the same row. Nothing here adds, estimates or
 * re-attributes; a response that is not exact is refused, never repaired.
 */
import { CLUB_DATA_TIME_ZONE, addCalendarDays } from './clubDataDay';

export interface UnionInvoiceRef {
  invoice_id: string;
  invoice_number: string | null;
  status: string;
  club_id: string;
  club_name: string | null;
  fee: number;
  player_net_loss: number;
}

export interface UnionInvoiceWeek {
  period_start: string;
  period_end: string;
  fee: number;
  player_net_loss: number;
  cash_net_loss: number | null;
  tournament_net_loss: number | null;
  invoices: UnionInvoiceRef[];
}

export interface UnionInvoiceWeeks {
  union_id: string | null;
  day_boundary: '02:00';
  day_zone: 'America/Chicago';
  window_start: string;
  window_end: string;
  covers_window: boolean;
  open_from: string | null;
  weeks: UnionInvoiceWeek[];
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isInstant = (v: unknown): v is string =>
  typeof v === 'string' && v.length >= 20 && Number.isFinite(Date.parse(v));
/** A finite amount that is a whole number of cents. */
const isCents = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && Math.abs(v * 100 - Math.round(v * 100)) < 1e-6;
const cents = (v: number) => Math.round(v * 100);

/**
 * The accounting day an instant belongs to: 02:00 to 02:00 Chicago. Mirrors
 * public.fn_ca_accounting_day, daylight saving included (the two hours are
 * taken off the Chicago wall clock, not off the instant).
 */
export function accountingDay(at: Date | string | number = new Date()): string {
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: CLUB_DATA_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(d)
      .map((part) => [part.type, part.value])
  );
  const day = `${p.year}-${p.month}-${p.day}`;
  return Number(p.hour) < 2 ? addCalendarDays(day, -1) : day;
}

/**
 * The boundary the server is asked to stop at. The page's end date is its
 * last calendar day, so the window that contains every invoice week touching
 * those dates stops at 02:00 of the following day.
 */
export function unionWeeksBoundaryEnd(lastDay: string): string {
  return addCalendarDays(lastDay, 1);
}

const stampFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: CLUB_DATA_TIME_ZONE,
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

/** "Nov 2 2:00 AM": a boundary instant on the Chicago clock. */
export function chicagoBoundaryStamp(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  const p = Object.fromEntries(stampFormat.formatToParts(d).map((part) => [part.type, part.value]));
  return `${p.month} ${p.day} ${p.hour}:${p.minute} ${p.dayPeriod}`;
}

/** "Nov 2 2:00 AM To Nov 9 2:00 AM": the real boundaries of an invoice week. */
export function unionWeekLabel(
  week: Pick<UnionInvoiceWeek, 'period_start' | 'period_end'>
): string {
  return `${chicagoBoundaryStamp(week.period_start)} To ${chicagoBoundaryStamp(week.period_end)}`;
}

/**
 * Accept the RPC's answer only when it is exact: every week's figures are
 * whole cents, its invoices add up to it to the cent, the weeks sit inside
 * the window in order, and a week that states a cash and tournament split
 * states one that adds up to its loss. Anything else is null and the page
 * says the figures could not be read.
 */
export function parseUnionWeeks(value: unknown): UnionInvoiceWeeks | null {
  if (!isObject(value)) return null;
  if (value.day_boundary !== '02:00' || value.day_zone !== 'America/Chicago') return null;
  if (!isInstant(value.window_start) || !isInstant(value.window_end)) return null;
  if (typeof value.covers_window !== 'boolean') return null;
  if (value.open_from !== null && !isInstant(value.open_from)) return null;
  if (value.union_id !== null && typeof value.union_id !== 'string') return null;
  if (!Array.isArray(value.weeks)) return null;
  const windowStart = Date.parse(value.window_start);
  const windowEnd = Date.parse(value.window_end);
  if (!(windowStart < windowEnd)) return null;
  const weeks: UnionInvoiceWeek[] = [];
  let cursor = windowStart;
  let contiguous = true;
  for (const raw of value.weeks) {
    if (!isObject(raw) || !isInstant(raw.period_start) || !isInstant(raw.period_end)) return null;
    const start = Date.parse(raw.period_start);
    const end = Date.parse(raw.period_end);
    if (!(start < end) || start < cursor || end > windowEnd) return null;
    if (start !== cursor) contiguous = false;
    cursor = end;
    if (!isCents(raw.fee) || !isCents(raw.player_net_loss)) return null;
    const cash = raw.cash_net_loss ?? null;
    const tournament = raw.tournament_net_loss ?? null;
    if ((cash === null) !== (tournament === null)) return null;
    if (cash !== null && tournament !== null) {
      if (!isCents(cash) || !isCents(tournament)) return null;
      if (cents(cash) + cents(tournament) !== cents(raw.player_net_loss)) return null;
    }
    if (!Array.isArray(raw.invoices) || raw.invoices.length === 0) return null;
    const invoices: UnionInvoiceRef[] = [];
    let fee = 0;
    let loss = 0;
    for (const inv of raw.invoices) {
      if (!isObject(inv) || typeof inv.invoice_id !== 'string' || typeof inv.club_id !== 'string') {
        return null;
      }
      if (typeof inv.status !== 'string' || inv.status === 'cancelled') return null;
      if (!isCents(inv.fee) || !isCents(inv.player_net_loss)) return null;
      fee += cents(inv.fee);
      loss += cents(inv.player_net_loss);
      invoices.push({
        invoice_id: inv.invoice_id,
        invoice_number: typeof inv.invoice_number === 'string' ? inv.invoice_number : null,
        status: inv.status,
        club_id: inv.club_id,
        club_name: typeof inv.club_name === 'string' ? inv.club_name : null,
        fee: inv.fee,
        player_net_loss: inv.player_net_loss,
      });
    }
    if (fee !== cents(raw.fee) || loss !== cents(raw.player_net_loss)) return null;
    weeks.push({
      period_start: raw.period_start,
      period_end: raw.period_end,
      fee: raw.fee,
      player_net_loss: raw.player_net_loss,
      cash_net_loss: cash as number | null,
      tournament_net_loss: tournament as number | null,
      invoices,
    });
  }
  // The server's own statement of coverage must be the one the weeks support.
  const covers = weeks.length > 0 && contiguous && cursor === windowEnd;
  if (covers !== value.covers_window) return null;
  return {
    union_id: value.union_id as string | null,
    day_boundary: '02:00',
    day_zone: 'America/Chicago',
    window_start: value.window_start,
    window_end: value.window_end,
    covers_window: value.covers_window,
    open_from: value.open_from as string | null,
    weeks,
  };
}
