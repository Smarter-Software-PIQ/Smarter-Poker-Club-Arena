/**
 * BANK THE WIN ON LIGHTNING (owner 2026-11-10, completed 2026-11-11).
 *
 * The owner's rule (HorseBankTheWin): at 4-6x its starting stack a horse
 * books the win; never the hand after a big pot - it plays one more orbit and
 * gets up before its next big blind; and only once every hand it owes under
 * the Charles Rule has been played.
 *
 * A Lightning hand is dealt from the pool and settled by LightningHandHost,
 * whose host-table seats say nothing about who is the next big blind or
 * whether an orbit is complete. So this file is only a cheap PRE-FILTER fed by
 * each committed pool hand: "is this horse's stack at or above its line?".
 * The decision itself is the door's (services/LightningBankTheWinDoor), from
 * the database's own facts (fn_lightning_bank_the_win_reading): the session's
 * durable start basis and hands since its big pot (advanced by the same
 * settlement that counts the Charles Rule), every hand it owes, and its place
 * in fn_lightning_blind_order, the pool's real big blind order.
 *
 * The pre-filter's line is the session's DURABLE start basis, which the door
 * reports with its first answer: until then the pool session is asked once,
 * so a restart or a re-entry can never raise the line above the database's.
 *
 * The door answers each ask with one outcome, and the tracker keeps the
 * bounds: at most one ask in flight per pool session (an ask unanswered for
 * ASK_STALE_MS is abandoned, and a late answer to it is ignored), re-asked on
 * a later hand while not ready, and at most MAX_LEAVE_ATTEMPTS leave attempts
 * that were refused or uncertain, after which this pool session stops asking.
 * No IO here; the clock is a parameter, so it is directly testable.
 */

import { bankTheWinMultiple } from '../services/HorseBankTheWin.js';

export interface LightningBankParticipant {
  playerId: string;
  poolSessionId: string;
  isHorse: boolean;
  blindRole: string;
  stackBefore: number;
}

/** Leave attempts (refused, or uncertain and verified not left) per pool session. */
export const MAX_LEAVE_ATTEMPTS = 3;
/** An ask still unanswered after this long is abandoned; its late answer is ignored. */
export const ASK_STALE_MS = 30_000;

export type LightningBankOutcome =
  /** Not ready (an obligation, the orbit, the blind order, the line): ask again later. */
  | 'not_ready'
  /** Left, already leaving, or no longer in the pool: never ask again. */
  | 'done'
  /** A leave was attempted and refused, or its outcome was uncertain and verified not left. */
  | 'attempt_failed';

export type LightningBankHandler = (req: {
  clusterId: string;
  playerId: string;
  poolSessionId: string;
  maxBuyIn: number;
  /** One outcome per ask; `startBasis` is the durable basis the door read. */
  settle: (outcome: LightningBankOutcome, startBasis?: number | null) => void;
}) => void;

interface PoolSessionState {
  /** The durable start basis, once the door has read it; null until then. */
  start: number | null;
  /** The ask in flight (its token) and when it was made. */
  askToken: number;
  askedAtMs: number | null;
  finished: boolean;
  attempts: number;
}

let nextToken = 0;

const MAX_TRACKED = 20_000;
const sessions = new Map<string, PoolSessionState>();
let handler: LightningBankHandler | null = null;

/** The door registers here (leader-owned, index.ts). */
export function onLightningBankTheWin(fn: LightningBankHandler | null): void {
  handler = fn;
}

/**
 * Feed one committed pool hand. Returns the horses asked about at this
 * boundary. A start basis is the first stack a pool session is seen with,
 * never above the maximum buy-in, and never raised afterwards; the door
 * re-checks against the session's durable basis.
 */
export function noteLightningHandForBankTheWin(
  hand: {
    clusterId: string;
    maxBuyIn: number;
    participants: ReadonlyArray<LightningBankParticipant>;
    stacksAfter: ReadonlyMap<string, number>;
  },
  nowMs: number = Date.now()
): string[] {
  const out: string[] = [];
  for (const p of hand.participants) {
    if (!p.isHorse || !p.poolSessionId) continue;
    const after = hand.stacksAfter.get(p.playerId);
    if (after === undefined || !Number.isFinite(after)) continue;
    let s = sessions.get(p.poolSessionId);
    if (!s) {
      if (sessions.size >= MAX_TRACKED) sessions.delete(sessions.keys().next().value as string);
      s = { start: null, askToken: 0, askedAtMs: null, finished: false, attempts: 0 };
      sessions.set(p.poolSessionId, s);
    }
    if (s.finished || !handler) continue;
    if (s.askedAtMs !== null && nowMs - s.askedAtMs < ASK_STALE_MS) continue; // in flight
    // Unknown basis: ask once to learn it. Known: ask only at the line.
    if (s.start !== null && !(after >= bankTheWinMultiple(p.playerId) * s.start)) continue;
    const token = ++nextToken;
    s.askToken = token;
    s.askedAtMs = nowMs;
    out.push(p.playerId);
    const state = s;
    const settle = (outcome: LightningBankOutcome, startBasis?: number | null): void => {
      if (state.askToken !== token || state.askedAtMs === null) return; // one outcome per ask
      state.askedAtMs = null;
      const basis = Number(startBasis);
      if (Number.isFinite(basis) && basis > 0) state.start = basis;
      if (outcome === 'done') state.finished = true;
      else if (outcome === 'attempt_failed') {
        state.attempts += 1;
        if (state.attempts >= MAX_LEAVE_ATTEMPTS) state.finished = true;
      }
    };
    try {
      handler({
        clusterId: hand.clusterId,
        playerId: p.playerId,
        poolSessionId: p.poolSessionId,
        maxBuyIn: hand.maxBuyIn,
        settle,
      });
    } catch {
      settle('not_ready');
    }
  }
  return out;
}

/** The authoritative facts the door reads (fn_lightning_bank_the_win_reading). */
export interface LightningBankReading {
  found: boolean;
  table_id?: string;
  stack?: number;
  leave_pending?: boolean;
  start_basis?: number;
  hands_since_big_pot?: number | null;
  hands_owed?: number;
  blind_rank?: number | null;
  pool_players?: number;
  players_per_hand?: number;
}

/**
 * The door's decision from the database's facts alone: 'leave' now, 'done'
 * (already leaving or gone), or 'not_ready'. The pool hands its big blinds to
 * the front of fn_lightning_blind_order, as many as the next formation needs
 * (one per hand of players_per_hand), so a horse inside that front is due.
 */
export function decideLightningBankTheWin(
  horseId: string,
  r: LightningBankReading
): 'leave' | 'done' | 'not_ready' {
  // Not found is transient (a seat moving between sister tables, a session
  // row mid-replacement): asked again later. Already leaving is final.
  if (!r.found) return 'not_ready';
  if (r.leave_pending) return 'done';
  const start = Number(r.start_basis);
  const stack = Number(r.stack);
  if (!(start > 0) || !(stack >= bankTheWinMultiple(horseId) * start)) return 'not_ready';
  if ((r.hands_owed ?? 0) > 0) return 'not_ready';
  const perHand = Math.max(2, Math.floor(Number(r.players_per_hand) || 0));
  const since = r.hands_since_big_pot;
  if (since !== null && since !== undefined && since < perHand) return 'not_ready';
  const rank = r.blind_rank;
  if (rank === null || rank === undefined) return 'not_ready';
  const front = Math.max(1, Math.floor(Math.max(0, Number(r.pool_players) || 0) / perHand));
  return rank <= front ? 'leave' : 'not_ready';
}

/** Tests only. */
export function resetLightningBankTheWin(): void {
  sessions.clear();
  handler = null;
}
