/**
 * ═══════════════════════════════════════════════════════════════════════════
 * A BARRED HORSE IS NOT A BUYER (2026-09-05)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `public.cash_rejoin_constraints` carries two rules a cash player meets at
 * the door of a game (the cash game itself, `game_scope`, since 2026-11-18;
 * before that club + variant + sb + bb):
 *
 *   - `barred_until`  - booted for low VPIP: NO seat in this game until it
 *                       lifts (fn_cash_rejoin_floor raises VPIP_BARRED);
 *   - `required_stack` - the rathole floor: you may not rejoin the same game
 *                       with less than you left with, while `expires_at`
 *                       holds (atomic_table_buyin raises BUYIN_BELOW_FLOOR).
 *
 * A human sees both in the lobby and the buy-in modal
 * (fn_cash_effective_buyin) and does not try a barred game. The fleet is the
 * horse's browser (CLAUDE.md 10.5), and until today it knew about neither:
 * barred horses passed every in-memory gate, were counted as buyers, were
 * selected, and were refused by the database - 341 of 349 buy-in refusals in
 * one hour were VPIP_BARRED, from 35 horses holding 57 active bars.
 *
 * This module reads the rows into the two shapes the fleet consults, keyed
 * exactly as the SQL joins them. Pure, so it can be proven without a database.
 *
 * ONE GAME, NOT ONE STAKES LEVEL (Dan, 2026-11-18): "WOOWOO CAN NOT TAKE HIS
 * BALANCE FROM A PLO5 MADNESS GAME, INTO A PLO5 LIGHTNING GAME. THEY ARE NOT
 * THE SAME GAME (EVEN THOUGH THEY ARE THE SAME GAME AND STAKES)." The key was
 * club + variant + sb + bb, so a Madness floor followed a player into the
 * Lightning game at the same stakes and forced a 3,762.18 stack into a game
 * whose maximum is 400. The key is now the game: 'cluster:<cash_games.id>'
 * for a must-move / Lightning cluster, otherwise the table's own scope -
 * exactly `public.fn_cash_game_scope_of_table` in
 * 20261118071741_rathole_floor_is_per_game_not_per_stakes.sql.
 */

export interface RejoinConstraintRow {
  player_id: string;
  /** The cash game the floor or bar was earned in (see rejoinTableKey). */
  game_scope: string | null;
  required_stack: number | string | null;
  barred_until: string | null;
  expires_at: string;
}

export interface RejoinConstraints {
  /** `${player_id}|${tableKey}` for every bar still in force. */
  barred: Set<string>;
  /** `${player_id}|${tableKey}` -> the highest floor still in force. */
  rejoinFloor: Map<string, number>;
}

/**
 * The game key: which cash game a table belongs to. Mirrors
 * public.fn_cash_game_scope_of_table, so a row's `game_scope` and a table's
 * key are the same string. Two tables of different cash games never share a
 * key, whatever their variant and stakes.
 */
export function rejoinTableKey(t: {
  id?: string | null;
  cluster_id?: string | null;
  seat_game_scope?: string | null;
}): string {
  if (t.cluster_id) return `cluster:${t.cluster_id}`;
  if (t.seat_game_scope) return t.seat_game_scope;
  return `table:${t.id ?? ''}`;
}

export function rejoinPlayerKey(playerId: string, tableKey: string): string {
  return `${playerId}|${tableKey}`;
}

export const EMPTY_REJOIN_CONSTRAINTS: RejoinConstraints = {
  barred: new Set(),
  rejoinFloor: new Map(),
};

export function buildRejoinConstraints(
  rows: readonly RejoinConstraintRow[],
  nowMs: number = Date.now()
): RejoinConstraints {
  const barred = new Set<string>();
  const rejoinFloor = new Map<string, number>();
  for (const r of rows) {
    const expires = Date.parse(r.expires_at);
    if (!Number.isFinite(expires) || expires <= nowMs) continue;
    // A row with no game cannot be matched to any table; the database
    // matches it to nothing either (game_scope = NULL is never true).
    if (!r.game_scope) continue;
    const key = rejoinPlayerKey(r.player_id, r.game_scope);
    const barredUntil = r.barred_until ? Date.parse(r.barred_until) : NaN;
    if (Number.isFinite(barredUntil) && barredUntil > nowMs) barred.add(key);
    const floor = Number(r.required_stack);
    if (Number.isFinite(floor) && floor > 0) {
      const prev = rejoinFloor.get(key) ?? 0;
      if (floor > prev) rejoinFloor.set(key, floor);
    }
  }
  return { barred, rejoinFloor };
}

/** The full return stack is a floor even above the ordinary buy-in cap. */
export function applyRejoinFloor(
  buyIn: number,
  floor: number | undefined,
  maxBuyIn: number
): number {
  if (floor === undefined || !Number.isFinite(floor) || floor <= buyIn) return buyIn;
  const eff = floor; // A return stack may exceed the ordinary table maximum.
  return Math.max(buyIn, Math.round(eff * 100) / 100);
}
