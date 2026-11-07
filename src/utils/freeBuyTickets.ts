/**
 * FIVE FREE BUY TICKETS, AND WHAT A PLAYER IS TOLD ABOUT THEM (owner, 2026-11-06)
 *
 * Every player has five Free Buy tickets per gaming day (20261105223835). A
 * ticket covers one first entry into a Midway Free Buy and is drawn from the
 * gaming day of the EVENT's start, which turns at 6:00 AM Chicago time.
 * fn_ca_free_buy_tickets_for_event (20261107043307) reads the one book a
 * registration will draw on, so the Sign Up card can say how many are left for
 * that day.
 *
 * The redeem refuses inside the registration transaction with one of two
 * codes. Both are definitive: the whole registration rolled back, nothing was
 * charged, and asking again cannot succeed, so they are never retried and
 * never reported as an unconfirmed result.
 */

export interface FreeBuyTicketBook {
  /** The event takes a Free Buy ticket at all (a Midway Free Buy). */
  applies: boolean;
  /** The gaming day the ticket is drawn from, YYYY-MM-DD. */
  gamingDay: string | null;
  /** That gaming day is today's. */
  today: boolean;
  allotment: number;
  used: number;
  remaining: number;
  /** The player already holds a live ticket on this event. */
  usedHere: boolean;
}

export const FREE_BUY_TICKET_REFUSAL_CODES = {
  FREE_BUY_TICKETS_USED_TODAY: 'free_buy_tickets_used_today',
  FREE_BUY_TICKET_ALREADY_USED_FOR_EVENT: 'free_buy_ticket_already_used_for_event',
} as const;

export const FREE_BUY_TICKET_REFUSAL_TEXT: Record<string, string> = {
  free_buy_tickets_used_today:
    'All 5 Of Your Free Buy Tickets For That Day Are Used. New Tickets Arrive At 6:00 AM Chicago Time. No Chips Were Charged.',
  free_buy_ticket_already_used_for_event:
    'You Already Used A Free Buy Ticket On This Event. No Chips Were Charged.',
};

function errorText(error: unknown): string {
  if (!error) return '';
  if (typeof error === 'string') return error;
  if (typeof error !== 'object') return '';
  const e = error as { message?: unknown; details?: unknown; hint?: unknown };
  return [e.message, e.details, e.hint].filter((x) => typeof x === 'string').join(' ');
}

/** The refusal reason a Free Buy ticket raised, or null for anything else. */
export function freeBuyTicketRefusalReason(error: unknown): string | null {
  const text = errorText(error);
  for (const [code, reason] of Object.entries(FREE_BUY_TICKET_REFUSAL_CODES)) {
    if (text.includes(code)) return reason;
  }
  return null;
}

function whole(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

/**
 * The RPC's answer, or null when it is not a well-formed book. A null book is
 * "could not tell": the card prints no ticket line and the server decides.
 */
export function parseFreeBuyTicketBook(raw: unknown): FreeBuyTicketBook | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.applies === false) {
    return {
      applies: false,
      gamingDay: null,
      today: false,
      allotment: 0,
      used: 0,
      remaining: 0,
      usedHere: false,
    };
  }
  if (r.applies !== true) return null;
  const allotment = whole(r.allotment);
  const used = whole(r.used);
  const remaining = whole(r.remaining);
  const day =
    typeof r.gaming_day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.gaming_day)
      ? r.gaming_day
      : null;
  if (allotment === null || used === null || remaining === null || !day) return null;
  return {
    applies: true,
    gamingDay: day,
    today: r.today === true,
    allotment,
    used,
    remaining,
    usedHere: r.used_here === true,
  };
}

/** "Today", or the weekday of the event's gaming day ("Saturday"). */
export function freeBuyTicketDayWord(book: Pick<FreeBuyTicketBook, 'today' | 'gamingDay'>): string {
  if (book.today || !book.gamingDay) return 'Today';
  const d = new Date(`${book.gamingDay}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return 'Today';
  return `For ${d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })}`;
}

/** The Sign Up card's value: "Uses 1 Of 3 Left Today". */
export function freeBuyTicketCardValue(book: FreeBuyTicketBook): string {
  return `Uses 1 Of ${book.remaining} Left ${freeBuyTicketDayWord(book)}`;
}

/** The line after a registration: "4 Of 5 Free Buy Tickets Left Today". */
export function freeBuyTicketsLeftLine(book: FreeBuyTicketBook): string {
  return `${book.remaining} Of ${book.allotment} Free Buy Tickets Left ${freeBuyTicketDayWord(book)}`;
}

/** No ticket is left for this event's day, and none is already held on it. */
export function freeBuyTicketsExhausted(book: FreeBuyTicketBook | null): boolean {
  return !!book && book.applies && !book.usedHere && book.remaining <= 0;
}
