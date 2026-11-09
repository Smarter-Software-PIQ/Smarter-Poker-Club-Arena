/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  HEADS UP REMATCH - the result card's Play Again, for two players (2026-11-08)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Dan, verbatim: "WHEN PLAYERS ARE PLAYING 'HEADS UP' WHEN THE MATCH IS OVER,
 * THEY SHOULD BOTH RECEIVE A 'PLAY AGAIN' POP UP, AND IF BOTH PLAYERS AGREE,
 * THE MATCH STARTS AGAIN. THEY BOTH 'BUY BACK IN' RAKE IS TAKEN AND THE MATCH
 * STARTS BACK OVER AT THE START OF THE HEADS UP."
 *
 * The database decides everything (migration
 * 20261109021122_heads_up_rematch_atomic_buy_in): who may ask, whether both
 * have agreed, and - in the one transaction that records the second Yes - a
 * fresh copy of the game just played with BOTH seats bought through the
 * ordinary buy-in path (buy-in + fee, exactly as the first game). If either
 * player cannot pay, neither is charged and no game is created. This module
 * only names the answers and what the card says about each, so the card and
 * its tests read one vocabulary.
 *
 * NOTHING HERE MOVES MONEY. A matched answer means both seats are already
 * bought; the host only opens the table.
 *
 * Popup copy is Title Case with no em dashes (CLAUDE.md 5.7), and never says
 * anything about what kind of player the opponent is (CLAUDE.md 10.5).
 */

export type RematchServerStatus =
  | 'none'
  | 'waiting_for_you'
  | 'waiting_for_opponent'
  | 'finding_table'
  | 'matched'
  | 'opponent_declined'
  | 'you_declined'
  | 'buy_in_refused'
  | 'entries_closed'
  | 'expired'
  | 'not_eligible';

export interface RematchAnswer {
  status: RematchServerStatus;
  tableId?: string;
  seatNumber?: number;
  secondsLeft?: number;
  reason?: string;
  /** On a match: what this player's seat cost, in the game's own asset. */
  cost?: number;
  asset?: string;
  diamondsAfter?: number;
}

const KNOWN: ReadonlySet<string> = new Set<RematchServerStatus>([
  'none',
  'waiting_for_you',
  'waiting_for_opponent',
  'finding_table',
  'matched',
  'opponent_declined',
  'you_declined',
  'buy_in_refused',
  'entries_closed',
  'expired',
  'not_eligible',
]);

/**
 * Read an RPC answer. Anything unrecognised is null - "could not tell" - and
 * never coerced into a state the card would act on (CLAUDE.md 10.86 rule 2).
 * A matched answer without a table and a seat is not a match.
 */
export function parseRematchAnswer(raw: unknown): RematchAnswer | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const status = typeof r.status === 'string' ? r.status : '';
  if (!KNOWN.has(status)) return null;
  const answer: RematchAnswer = { status: status as RematchServerStatus };
  const seconds = Number(r.seconds_left);
  if (Number.isFinite(seconds) && seconds >= 0) answer.secondsLeft = Math.floor(seconds);
  if (typeof r.reason === 'string') answer.reason = r.reason;
  if (status === 'matched') {
    const tableId = typeof r.table_id === 'string' ? r.table_id : '';
    const seat = Number(r.seat_number);
    if (!tableId || !Number.isInteger(seat) || seat < 1) return null;
    answer.tableId = tableId;
    answer.seatNumber = seat;
    const cost = Number(r.cost);
    if (r.cost != null && Number.isFinite(cost)) answer.cost = cost;
    if (typeof r.asset === 'string') answer.asset = r.asset;
    const after = Number(r.diamonds_after);
    if (r.diamonds_after != null && Number.isFinite(after)) answer.diamondsAfter = after;
  }
  return answer;
}

/** A heads-up result: a two-seat Sit & Go, the only game a rematch exists for. */
export function isHeadsUpFormat(row: { format_contract?: unknown; max_players?: unknown }): boolean {
  return row.format_contract === 'sng-v1' && Number(row.max_players) === 2;
}

/** States the card keeps polling through. Every other state is final. */
export function rematchIsLive(status: RematchCardStatus | null): boolean {
  return (
    status === 'none' ||
    status === 'waiting_for_you' ||
    status === 'waiting_for_opponent' ||
    status === 'finding_table'
  );
}

/** A final state in which the card offers the ordinary Play Again instead. */
export function rematchFellThrough(status: RematchCardStatus | null): boolean {
  return (
    status === 'buy_in_refused' ||
    status === 'you_declined' ||
    status === 'opponent_declined' ||
    status === 'entries_closed' ||
    status === 'expired'
  );
}

/** What the card shows for the rematch, if anything. */
export interface RematchView {
  /** The line printed above the plates; null when there is nothing to say. */
  line: string | null;
  /** The primary plate's label. */
  primaryLabel: string;
  /** The secondary plate's label, when the rematch replaces Share. */
  secondaryLabel: string | null;
  /** True while the primary plate would only repeat an answer already given. */
  primaryBusy: boolean;
}

/** The card's state is the server's answer. */
export type RematchCardStatus = RematchServerStatus;

export function rematchView(
  status: RematchCardStatus | null,
  secondsLeft: number | null,
  joining: boolean
): RematchView {
  const countdown = secondsLeft != null && secondsLeft > 0 ? ` ${secondsLeft}s` : '';
  if (joining) {
    return {
      line: 'Starting Your Rematch',
      primaryLabel: 'Joining',
      secondaryLabel: null,
      primaryBusy: true,
    };
  }
  switch (status) {
    case 'waiting_for_you':
      return {
        line: `Your Opponent Wants To Play Again${countdown}`,
        primaryLabel: 'Play Again',
        secondaryLabel: 'No Thanks',
        primaryBusy: false,
      };
    case 'waiting_for_opponent':
      return {
        line: `Waiting For Your Opponent${countdown}`,
        primaryLabel: 'Waiting',
        secondaryLabel: null,
        primaryBusy: true,
      };
    case 'finding_table':
      return {
        line: 'Finding Your Rematch Table',
        primaryLabel: 'Waiting',
        secondaryLabel: null,
        primaryBusy: true,
      };
    case 'matched':
      return {
        line: 'Starting Your Rematch',
        primaryLabel: 'Joining',
        secondaryLabel: null,
        primaryBusy: true,
      };
    case 'opponent_declined':
      return {
        line: 'Your Opponent Left',
        primaryLabel: 'Find A New Game',
        secondaryLabel: null,
        primaryBusy: false,
      };
    case 'entries_closed':
      return {
        line: 'Heads Up Games Are Closed Right Now',
        primaryLabel: 'Find A New Game',
        secondaryLabel: null,
        primaryBusy: false,
      };
    case 'expired':
      return {
        line: 'The Rematch Offer Has Ended',
        primaryLabel: 'Find A New Game',
        secondaryLabel: null,
        primaryBusy: false,
      };
    case 'you_declined':
      return {
        line: 'You Passed On The Rematch',
        primaryLabel: 'Find A New Game',
        secondaryLabel: null,
        primaryBusy: false,
      };
    case 'buy_in_refused':
      return {
        line: 'Your Rematch Could Not Start',
        primaryLabel: 'Find A New Game',
        secondaryLabel: null,
        primaryBusy: false,
      };
    default:
      return { line: null, primaryLabel: 'Play Again', secondaryLabel: null, primaryBusy: false };
  }
}

/** How often the card asks while it is up (the server evaluates every deadline on read). */
export const REMATCH_POLL_MS = 1500;
