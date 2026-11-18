/**
 * Cash-session mirror. Owner direction 2026-10-26 removed the time-based
 * minimum stay; owner direction 2026-11-06 holds a winning player for ten
 * hands in profit instead (the hit-and-run rule, see hitRunHandsRemaining).
 * The database still owns atomic cashout and the full-stack two-hour return
 * requirement. Session transitions continue for financial/session accounting.
 */

import type { CashSessionEntry, CashSessionRow } from '../services/supabase/cashSessions.js';

export const STAY_CLOCK_DEFAULT_MS = 0;

/** The remaining stay clock as of `nowMs`, derived the way the database derives it. */
export function stayRemainingMs(
  row: Pick<CashSessionRow, 'stay_remaining_ms' | 'stay_running' | 'stay_last_tick_at'>,
  nowMs: number
): number {
  // Legacy wire fields remain readable, but no longer impose a stay.
  return 0;
}

/**
 * HIT AND RUN (owner 2026-11-06): "ONCE A PLAYER 'IS IN PROFIT' AT A TABLE...
 * THEY CAN NOT LEAVE THE TABLE UNTIL THEY PLAY 10 HANDS IN PROFIT", plus the
 * Charles Rule (+10 hands per double while counting down). The database owns
 * the count (fn_cash_session_evaluate advances it once per dealt hand); this
 * is the synchronous reading of the mirror row against the engine's live
 * stack. The time stay clock stays retired (owner 2026-10-26).
 */
type OwedRow = Pick<
  CashSessionRow,
  'baseline' | 'hands_required' | 'hands_played' | 'hit_run_completed'
> &
  Partial<Pick<CashSessionRow, 'big_win_required' | 'big_win_played'>>;

/** The ten-hand countdown in profit, with the Charles doubles (owner 2026-11-06). */
export function countdownHandsRemaining(row: OwedRow, stackNow: number): number {
  const required = Math.max(0, Math.floor(Number(row.hands_required) || 0));
  const played = Math.max(0, Math.floor(Number(row.hands_played) || 0));
  if (row.hit_run_completed === true || required <= 0 || played >= required) return 0;
  if (!(Number(stackNow) > Number(row.baseline))) return 0;
  return required - played;
}

/**
 * THE CHARLES RULE AFTER A LARGE WIN (owner 2026-11-11): ten subsequent hands
 * after a hand netting +250 BB or more, owed while the player has chips. The
 * database (fn_cash_big_win_hands_remaining) is the same arithmetic.
 */
export function bigWinHandsRemaining(row: OwedRow, stackNow: number): number {
  const required = Math.max(0, Math.floor(Number(row.big_win_required) || 0));
  const played = Math.max(0, Math.floor(Number(row.big_win_played) || 0));
  if (required <= played || !(Number(stackNow) > 0)) return 0;
  return required - played;
}

/**
 * Every hand the session still owes at this stack: the larger of the two
 * obligations (fn_cash_session_hands_owed). Finishing one never clears the
 * other. Every engine reader (the leave door, the sit-out hold, the blind
 * off, the seat fields) reads this one function.
 */
export function hitRunHandsRemaining(row: OwedRow, stackNow: number): number {
  return Math.max(countdownHandsRemaining(row, stackNow), bigWinHandsRemaining(row, stackNow));
}

/** Why hands are owed at this stack, for the felt and the leave confirmation. */
export function handsOwedReason(
  row: OwedRow,
  stackNow: number
): 'hit_run' | 'big_win' | 'both' | null {
  const h = countdownHandsRemaining(row, stackNow);
  const b = bigWinHandsRemaining(row, stackNow);
  if (h > 0 && b > 0) return 'both';
  if (b > 0) return 'big_win';
  if (h > 0) return 'hit_run';
  return null;
}

/** In profit and still owing hands at this stack. */
export function isLeaveLocked(row: OwedRow, stackNow: number, _nowMs?: number): boolean {
  return hitRunHandsRemaining(row, stackNow) > 0;
}

/** The leave control's label while hands are owed. Title Case, no em dash. */
export function handsLeftLabel(hands: number): string {
  const n = Math.max(0, Math.floor(hands));
  return `${n} ${n === 1 ? 'Hand' : 'Hands'} Left Before You Can Leave`;
}

/** Legacy name kept for callers that still pass a clock: hands when known. */
export function leaveLabel(remainingMs: number, handsRemaining?: number): string {
  if (typeof handsRemaining === 'number' && handsRemaining > 0)
    return handsLeftLabel(handsRemaining);
  const totalSec = Math.max(0, Math.ceil(remainingMs / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `Leave Available In ${m}:${s < 10 ? '0' : ''}${s}`;
}

export interface ContinuitySeatFields {
  session_baseline: number;
  stay_remaining_ms: number;
  stay_running: boolean;
  leave_locked: boolean;
  /**
   * HIT AND RUN: hands still owed in profit (null when none are owed), the
   * total owed this countdown (10 + 10 per double), and whether the player
   * confirmed leaving and is being blinded off.
   */
  hit_run_hands_remaining: number | null;
  hit_run_hands_required: number | null;
  hit_run_blind_off: boolean;
  /** Why they are owed: the countdown in profit, a +250 BB win, or both. */
  hit_run_reason: 'hit_run' | 'big_win' | 'both' | null;
  /** The +250 BB win in big blinds, while the big-win count is owed. */
  hit_run_big_win_bb: number | null;
}

export interface ChipContinuityDeps {
  tableId: string;
  /** Tournament tables have no stay clock; the tracker is inert for them. */
  isCash: () => boolean;
  /** Never evaluate during the maintenance freeze (CLAUDE.md section 13 rule 5). */
  isFrozen: () => boolean;
  /** Exact engine/process authority for reflecting an awaited database answer. */
  canMutate?: () => boolean;
  evaluate: (tableId: string, entries: CashSessionEntry[]) => Promise<CashSessionRow[] | null>;
  report: (err: unknown, context: string) => void;
}

export class ChipContinuityTracker {
  private readonly rows = new Map<string, CashSessionRow>();
  /** Last `active` value sent per player; a change is a transition worth a round trip. */
  private readonly lastActive = new Map<string, boolean>();
  /**
   * Seats that left (cashed out, evicted, kicked). The hand roster keeps them
   * until the next reload, and the database returns nothing for a vacated
   * seat, so without this the sweep re-sent every departed seat on every
   * tick until the next hand. Cleared the moment the roster stops naming them.
   */
  private readonly departed = new Set<string>();
  /** The platform was frozen at the last sweep; the thaw shifted every clock. */
  private sawFrozen = false;
  private inflight: Promise<void> | null = null;
  /** Players this engine is blinding off (their confirmed early leave). */
  private readonly blindOff = new Set<string>();

  constructor(private readonly deps: ChipContinuityDeps) {}

  /** HIT AND RUN: this engine holds the player's confirmed leave and blinds them off. */
  markBlindOff(userId: string, on: boolean): void {
    if (on) this.blindOff.add(userId);
    else this.blindOff.delete(userId);
    // The mirror carries the database's flag; keep it in step with what this
    // engine just told the database, so a restore pass never re-holds a seat
    // whose player sat back in.
    const row = this.rows.get(userId);
    if (row && row.blind_off !== on) this.rows.set(userId, { ...row, blind_off: on });
  }

  /** The mirror row, if the database has ever answered for this player. */
  row(userId: string): CashSessionRow | undefined {
    return this.rows.get(userId);
  }

  /**
   * Synchronous answer for POST /leave. `stackNow` is the engine's live stack
   * (post-settlement between hands; the roster's stack mid-hand). Unknown
   * player -> not locked: the database still checks under the seat lock.
   */
  leaveLock(
    userId: string,
    stackNow: number,
    nowMs = Date.now()
  ): { locked: boolean; remainingMs: number; handsRemaining: number } {
    const row = this.rows.get(userId);
    if (!row || !this.deps.isCash()) return { locked: false, remainingMs: 0, handsRemaining: 0 };
    const hands = hitRunHandsRemaining(row, stackNow);
    return { locked: hands > 0, remainingMs: stayRemainingMs(row, nowMs), handsRemaining: hands };
  }

  /** Fields every state payload carries per seat. */
  seatFields(userId: string, stackNow: number, nowMs = Date.now()): ContinuitySeatFields {
    const row = this.rows.get(userId);
    if (!row || !this.deps.isCash()) {
      return {
        session_baseline: 0,
        stay_remaining_ms: 0,
        stay_running: false,
        leave_locked: false,
        hit_run_hands_remaining: null,
        hit_run_hands_required: null,
        hit_run_blind_off: false,
        hit_run_reason: null,
        hit_run_big_win_bb: null,
      };
    }
    const remaining = stayRemainingMs(row, nowMs);
    const hands = hitRunHandsRemaining(row, stackNow);
    const reason = handsOwedReason(row, stackNow);
    // The total shown beside the count is the binding obligation's own.
    const bigWinBinds =
      bigWinHandsRemaining(row, stackNow) >= countdownHandsRemaining(row, stackNow) &&
      bigWinHandsRemaining(row, stackNow) > 0;
    return {
      session_baseline: row.baseline,
      stay_remaining_ms: remaining,
      stay_running: row.stay_running && remaining > 0 && stackNow > row.baseline,
      leave_locked: hands > 0,
      hit_run_hands_remaining: hands > 0 ? hands : null,
      hit_run_hands_required:
        hands > 0 ? (bigWinBinds ? (row.big_win_required ?? 0) : row.hands_required) : null,
      hit_run_blind_off: hands > 0 && this.blindOff.has(userId),
      hit_run_reason: hands > 0 ? reason : null,
      hit_run_big_win_bb:
        reason === 'big_win' || reason === 'both' ? (row.big_win_bb_won ?? null) : null,
    };
  }

  /** The seat is gone (cashed out, evicted): forget the mirror. */
  forget(userId: string): void {
    this.blindOff.delete(userId);
    this.rows.delete(userId);
    this.lastActive.delete(userId);
    this.departed.add(userId);
  }

  /** A new seat for a player the mirror had written off (re-buy before the roster reload). */
  welcome(userId: string): void {
    this.departed.delete(userId);
    this.lastActive.delete(userId);
  }

  /** A refusal came back from the database with a remaining time: trust it over the mirror. */
  noteRefusal(userId: string, stayRemainingMs: number, nowMs = Date.now()): void {
    // A Lightning settlement may have evaluated this same database clock
    // since the anchor's last observation. A refusal is an actual transition:
    // the next existing presence pass must adopt running/paused as well as
    // the remaining number, even when the player's presence did not change.
    this.lastActive.delete(userId);
    const row = this.rows.get(userId);
    if (!row) return;
    this.rows.set(userId, {
      ...row,
      stay_remaining_ms: stayRemainingMs,
      stay_last_tick_at: new Date(nowMs).toISOString(),
    });
  }

  /**
   * Report transitions. Serialised per table so two overlapping settlements
   * cannot interleave their answers; a frozen platform is skipped outright.
   */
  async evaluate(entries: CashSessionEntry[]): Promise<void> {
    if (!this.deps.isCash() || entries.length === 0) return;
    if (this.deps.isFrozen()) return;
    const run = async () => {
      try {
        const rows = await this.deps.evaluate(this.deps.tableId, entries);
        if (!rows || this.deps.canMutate?.() === false) return;
        for (const r of rows) if (!this.departed.has(r.user_id)) this.rows.set(r.user_id, r);
        for (const e of entries)
          if (!this.departed.has(e.user_id)) this.lastActive.set(e.user_id, e.active);
      } catch (err) {
        this.deps.report(err, `ChipContinuity.${this.deps.tableId}.evaluate_failed`);
      }
    };
    const prev = this.inflight ?? Promise.resolve();
    const next = prev.then(run, run);
    this.inflight = next;
    try {
      await next;
    } finally {
      if (this.inflight === next) this.inflight = null;
    }
  }

  /**
   * Presence sweep, called from the 10-second heartbeat tick. Sends only the
   * players whose `active` changed since the last report - plus anyone the
   * mirror has never seen, which after a restart is everyone at the table,
   * and is how every seat gets a session row and a countdown back.
   */
  sweepPresence(
    players: Array<{ user_id: string }>,
    isActive: (userId: string) => boolean
  ): Promise<void> {
    if (!this.deps.isCash()) return Promise.resolve();
    // The thaw (fn_thaw_platform) moved every running clock by the frozen
    // minutes. The mirror did not move with it, so the first sweep after a
    // freeze re-sends everyone and adopts the database's answer.
    if (this.deps.isFrozen()) {
      this.sawFrozen = true;
      return Promise.resolve();
    }
    if (this.sawFrozen) {
      this.sawFrozen = false;
      this.lastActive.clear();
    }
    const present = new Set(players.map((p) => p.user_id));
    for (const id of [...this.departed]) if (!present.has(id)) this.departed.delete(id);
    const entries: CashSessionEntry[] = [];
    for (const p of players) {
      if (this.departed.has(p.user_id)) continue;
      const active = isActive(p.user_id);
      const known = this.rows.has(p.user_id);
      if (!known || this.lastActive.get(p.user_id) !== active) {
        // No stack: mid-hand the engine's roster copy is the pre-hand stack
        // and so is table_seats.stack, so let the database read its own row.
        entries.push({ user_id: p.user_id, active });
      }
    }
    // Players who left the roster take their mirror with them.
    for (const id of [...this.rows.keys()]) if (!present.has(id)) this.forget(id);
    return this.evaluate(entries);
  }
}
