/**
 * Supabase helpers - CHIP CONTINUITY (Operation Table Stakes, Slice 0).
 *
 * The stay clock and the rejoin floor live in Postgres (migration
 * 20260904120000_chip_continuity_slice_0). The engine is not the source of
 * truth for either; it is the thing that tells the database when a player's
 * state changed (a hand settled, a sit-out, a disconnect) and it renders what
 * the database answers. That is deliberate: the engine restarts at :55 of
 * every hour, and a clock kept in engine memory would reset with it.
 *
 * Two calls:
 *   evaluateCashSessions  - "here is each seated player's stack and whether
 *                            they are active; settle their clocks". One round
 *                            trip for a whole table.
 *   atomicCashoutVoluntary - the ONE cash-out RPC with p_leave_mode set to
 *                            'voluntary', which is the only engine call the
 *                            database enforces the stay clock on. A refusal
 *                            comes back typed, not swallowed, so the caller
 *                            can leave the seat exactly as it was.
 */

import { supabase } from './client.js';
import { atomicCashout } from './seats.js';

export interface CashSessionRow {
  user_id: string;
  baseline: number;
  stack: number;
  stay_remaining_ms: number;
  stay_running: boolean;
  /** ISO timestamp the database stamped when it settled the clock. */
  stay_last_tick_at: string;
  stay_clock_ms: number;
  leave_locked: boolean;
  /**
   * HIT AND RUN (owner 2026-11-06). Hands owed in profit (10, plus 10 per
   * Charles double; 0 = no countdown), hands played toward it, what is left
   * (0 unless the player is in profit and still owes hands), whether this
   * session completed it, and whether the player confirmed leaving early and
   * is being blinded off. Absent fields (a database without the rule) read
   * as "no countdown", never as a lock.
   */
  hands_required: number;
  hands_played: number;
  hands_remaining: number;
  hit_run_doubles: number;
  hit_run_completed: boolean;
  blind_off: boolean;
  /**
   * THE CHARLES RULE AFTER A LARGE WIN (owner 2026-11-11): a hand netting
   * +250 BB or more owes ten subsequent hands, whatever the countdown above
   * says. Absent fields (a database without the rule) read as none owed.
   */
  big_win_required?: number;
  big_win_played?: number;
  /** Why hands are owed: 'hit_run', 'big_win', 'both', or null. */
  hands_reason?: 'hit_run' | 'big_win' | 'both' | null;
  /** The +250 BB win, in big blinds, that started the big-win count. */
  big_win_bb_won?: number | null;
  /**
   * BANK THE WIN (durable, 20261111174148): the session's opening buy-in
   * capped at the table maximum, and eligible hands since a big pot (null =
   * none). Absent before the migration installs.
   */
  start_basis?: number | null;
  hands_since_big_pot?: number | null;
}

export interface CashSessionEntry {
  user_id: string;
  /** Omit to let the database read table_seats.stack. */
  stack?: number;
  /** seated AND not sitting out AND connected AND not pending a move. */
  active: boolean;
  /**
   * HIT AND RUN: the settled hand this player was dealt into. Present only on
   * the settlement report, only for dealt players; the database advances the
   * countdown once per hand id.
   */
  hand_id?: string;
}

function toRow(raw: unknown): CashSessionRow | null {
  const o = (raw ?? {}) as Record<string, unknown>;
  const userId = typeof o.user_id === 'string' ? o.user_id : '';
  if (!userId) return null;
  return {
    user_id: userId,
    baseline: Number(o.baseline ?? 0),
    stack: Number(o.stack ?? 0),
    stay_remaining_ms: Number(o.stay_remaining_ms ?? 0),
    stay_running: o.stay_running === true,
    stay_last_tick_at: typeof o.stay_last_tick_at === 'string' ? o.stay_last_tick_at : '',
    stay_clock_ms: Number(o.stay_clock_ms ?? 600000),
    leave_locked: o.leave_locked === true,
    hands_required: nonNegativeInt(o.hands_required),
    hands_played: nonNegativeInt(o.hands_played),
    hands_remaining: nonNegativeInt(o.hands_remaining),
    hit_run_doubles: nonNegativeInt(o.hit_run_doubles),
    hit_run_completed: o.hit_run_completed === true,
    blind_off: o.blind_off === true,
    big_win_required: nonNegativeInt(o.big_win_required),
    big_win_played: nonNegativeInt(o.big_win_played),
    hands_reason:
      o.hands_reason === 'hit_run' || o.hands_reason === 'big_win' || o.hands_reason === 'both'
        ? o.hands_reason
        : null,
    big_win_bb_won: (() => {
      const net = Number(o.big_win_net);
      const bb = Number(o.big_win_bb);
      return Number.isFinite(net) && Number.isFinite(bb) && bb > 0
        ? Math.round((net / bb) * 10) / 10
        : null;
    })(),
    // Present-but-null (no big pot yet) differs from absent (no such column yet).
    ...('start_basis' in o ? { start_basis: finiteOrNull(o.start_basis) } : {}),
    ...('hands_since_big_pot' in o
      ? {
          hands_since_big_pot:
            o.hands_since_big_pot === null ? null : nonNegativeInt(o.hands_since_big_pot),
        }
      : {}),
  };
}

function finiteOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function nonNegativeInt(v: unknown): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Settle and re-evaluate the stay clock for these players. Cash tables only
 * (the RPC returns [] for a tournament table). A transport failure returns
 * null so the caller keeps whatever it last knew rather than clearing it.
 */
export async function evaluateCashSessions(
  tableId: string,
  entries: CashSessionEntry[]
): Promise<CashSessionRow[] | null> {
  if (entries.length === 0) return [];
  try {
    const { data, error } = await supabase.rpc('fn_cash_session_evaluate', {
      p_table_id: tableId,
      p_entries: entries.map((e) => ({
        user_id: e.user_id,
        stack: typeof e.stack === 'number' && Number.isFinite(e.stack) ? e.stack : null,
        active: e.active === true,
        // This engine serves the hit-and-run rule (blind-off included), so
        // the database may enforce it for this player's session.
        hit_run: true,
        ...(typeof e.hand_id === 'string' && e.hand_id
          ? { hand_id: e.hand_id, hand_source: 'table' }
          : {}),
      })),
    });
    if (error) {
      console.warn(`[cashSessions] evaluate failed for ${tableId.slice(0, 8)}: ${error.message}`);
      return null;
    }
    const arr = Array.isArray(data) ? data : [];
    return arr.map(toRow).filter((r): r is CashSessionRow => r !== null);
  } catch (err: any) {
    console.warn(
      `[cashSessions] evaluate transport failure for ${tableId.slice(0, 8)}:`,
      err?.message
    );
    return null;
  }
}

export type VoluntaryCashoutResult =
  | { ok: true; stack: number }
  | { ok: false; code: 'LEAVE_LOCKED'; stayRemainingMs: number }
  /** The player is in a live Lightning hand: nothing moved; ask again after it. */
  | { ok: false; code: 'LIGHTNING_HAND_IN_PROGRESS' }
  | { ok: false; code: 'FAILED'; message: string };

/**
 * The player's OWN choice to leave: POST /leave, the horse rotator, a
 * leave_pending seat at settlement. The database refuses it while the stay
 * clock runs, and that refusal is returned as a value. The seat is untouched
 * on every non-ok path (one transaction: the credit and the vacate roll back
 * together), so the caller must NOT fall back to markSeatAsLeft - that is the
 * same RPC and would be refused for the same reason.
 *
 * One implementation of "cash a seat out" (seats.guard.test.ts): this is a
 * typed view over `atomicCashout`, not a second caller of the RPC.
 */
export async function atomicCashoutVoluntary(
  userId: string,
  tableId: string,
  seatNumber: number,
  occupancyId: string | undefined
): Promise<VoluntaryCashoutResult> {
  const out: { locked: number | null; failed: string | null; lightning: boolean } = {
    locked: null,
    failed: null,
    lightning: false,
  };
  const stack = await atomicCashout(userId, tableId, seatNumber, {
    occupancyId,
    leaveMode: 'voluntary',
    onLocked: (ms) => {
      out.locked = ms;
    },
    onFailed: (m) => {
      out.failed = m;
    },
    onLightningHandInProgress: () => {
      out.lightning = true;
    },
  });
  if (out.locked !== null) return { ok: false, code: 'LEAVE_LOCKED', stayRemainingMs: out.locked };
  if (out.lightning) return { ok: false, code: 'LIGHTNING_HAND_IN_PROGRESS' };
  if (out.failed !== null) return { ok: false, code: 'FAILED', message: out.failed };
  return { ok: true, stack };
}

/**
 * HIT AND RUN: record (or withdraw) the player's confirmed early leave, so a
 * restarted engine and the Lightning hand host read the same truth. Best
 * effort: false on any failure, and the engine's own hold still stands.
 */
export async function setCashSessionBlindOff(
  tableId: string,
  userId: string,
  on: boolean
): Promise<boolean> {
  try {
    const { error } = await supabase.rpc('fn_cash_session_set_blind_off', {
      p_table_id: tableId,
      p_user_id: userId,
      p_on: on,
    });
    if (error) {
      console.warn(
        `[cashSessions] blind-off ${on} failed for ${tableId.slice(0, 8)}: ${error.message}`
      );
      return false;
    }
    return true;
  } catch (err: any) {
    console.warn(
      `[cashSessions] blind-off transport failure for ${tableId.slice(0, 8)}:`,
      err?.message
    );
    return false;
  }
}

/**
 * #10740: a queued Lightning leave whose cash-out the hand count refused goes
 * back to the pool as a blind off (fn_lightning_owed_leave_returns_to_pool).
 * The database asks the leave door itself whether hands are owed and refuses,
 * writing nothing, for a forced request, a live hand, a stale occupancy or
 * nothing owed. Null on any failure: nothing changed, ask again next pass.
 */
let lastOwedLeaveWarnAt = 0;
export async function returnOwedLightningLeaveToPool(
  userId: string,
  tableId: string,
  seatNumber: number,
  occupancyId: string
): Promise<{ returned: boolean; handsRemaining: number; reason: string | null } | null> {
  try {
    const { data, error } = await supabase.rpc('fn_lightning_owed_leave_returns_to_pool', {
      p_user_id: userId,
      p_table_id: tableId,
      p_seat_number: seatNumber,
      p_occupancy_id: occupancyId,
    });
    if (error || !data || typeof data !== 'object' || Array.isArray(data)) {
      // Asked every release pass while a seat is held; say so once a minute.
      if (error && Date.now() - lastOwedLeaveWarnAt > 60_000) {
        lastOwedLeaveWarnAt = Date.now();
        console.warn(
          `[cashSessions] owed Lightning leave for ${tableId.slice(0, 8)} not returned: ${error.message}`
        );
      }
      return null;
    }
    const row = data as { returned?: unknown; hands_remaining?: unknown; reason?: unknown };
    const hands = Number(row.hands_remaining);
    return {
      returned: row.returned === true,
      handsRemaining: Number.isFinite(hands) ? Math.max(0, Math.floor(hands)) : 0,
      reason: typeof row.reason === 'string' ? row.reason : null,
    };
  } catch (err: any) {
    console.warn(
      `[cashSessions] owed Lightning leave transport failure for ${tableId.slice(0, 8)}:`,
      err?.message
    );
    return null;
  }
}

let lastPlaysOnWarnAt = 0;

/**
 * AN OWED LEAVE ALONE AT ITS TABLE PLAYS ON IN ITS GAME (2026-11-14).
 *
 * Asked before a held leave that still owes hands is released for having
 * nobody left at its table. The database answers whether the same game is
 * still dealing at another table; if it is, the seat stops pending and keeps
 * its blind off so the game moves it to that table, and `keep` is true. Null
 * (function missing, transport, refusal) keeps the established behaviour: the
 * caller releases the seat as before. Engine-only.
 */
export async function owedLeavePlaysOnInGame(
  userId: string,
  tableId: string,
  seatNumber: number,
  occupancyId: string
): Promise<{
  keep: boolean;
  returned: boolean;
  handsRemaining: number;
  reason: string | null;
} | null> {
  try {
    const { data, error } = await supabase.rpc('fn_owed_leave_plays_on_in_game', {
      p_user_id: userId,
      p_table_id: tableId,
      p_seat_number: seatNumber,
      p_occupancy_id: occupancyId,
    });
    if (error || !data || typeof data !== 'object' || Array.isArray(data)) {
      if (error && Date.now() - lastPlaysOnWarnAt > 60_000) {
        lastPlaysOnWarnAt = Date.now();
        console.warn(
          `[cashSessions] owed leave at ${tableId.slice(0, 8)} not kept in its game: ${error.message}`
        );
      }
      return null;
    }
    const row = data as {
      keep?: unknown;
      returned?: unknown;
      hands_remaining?: unknown;
      reason?: unknown;
    };
    const hands = Number(row.hands_remaining);
    return {
      keep: row.keep === true,
      returned: row.returned === true,
      handsRemaining: Number.isFinite(hands) ? Math.max(0, Math.floor(hands)) : 0,
      reason: typeof row.reason === 'string' ? row.reason : null,
    };
  } catch (err: any) {
    console.warn(
      `[cashSessions] owed leave transport failure for ${tableId.slice(0, 8)}:`,
      err?.message
    );
    return null;
  }
}

/**
 * HIT AND RUN (Lightning): which of these pool sessions are being blinded off
 * and still owe hands. An unreadable answer is the empty set: the seat then
 * plays on its ordinary clock, which is never a reason to fold a player.
 */
export async function lightningBlindOffPlayers(
  poolSessionIds: readonly string[]
): Promise<Set<string>> {
  const out = new Set<string>();
  if (poolSessionIds.length === 0) return out;
  try {
    const { data, error } = await supabase.rpc('fn_lightning_blind_off_players', {
      p_pool_session_ids: [...poolSessionIds],
    });
    if (error || !Array.isArray(data)) return out;
    for (const row of data as unknown[]) {
      const id =
        typeof row === 'string'
          ? row
          : typeof (row as any)?.fn_lightning_blind_off_players === 'string'
            ? (row as any).fn_lightning_blind_off_players
            : null;
      if (id) out.add(id);
    }
  } catch {
    /* empty set */
  }
  return out;
}
