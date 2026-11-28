import { hourlyCashAdmissionRpcName, hourlyCashCloseRpcName } from '../CashHourlyPolicy.js';
export { hourlyCashAdmissionRpcName, hourlyCashCloseRpcName } from '../CashHourlyPolicy.js';
import { supabase } from './client.js';
import { confirmedCashout, type SeatCashoutReceipt } from './seats.js';

export type HourlyCashAdmission = { maxHorses: number; startsGame: boolean };
export async function readHourlyCashAdmissions(): Promise<
  ReadonlyMap<string, HourlyCashAdmission>
> {
  const { data, error } = await supabase.rpc(hourlyCashAdmissionRpcName);
  if (error || !Array.isArray(data)) throw new Error('cash_hourly_admission_unknown');
  const allowed = new Map<string, HourlyCashAdmission>();
  const seen = new Set<string>();
  for (const row of data) {
    if (
      typeof row?.table_id !== 'string' ||
      typeof row.allowed !== 'boolean' ||
      typeof row.starts_game !== 'boolean' ||
      !Number.isInteger(row.max_horses) ||
      row.max_horses < 1 ||
      seen.has(row.table_id)
    )
      throw new Error('cash_hourly_admission_invalid');
    seen.add(row.table_id);
    if (row.allowed)
      allowed.set(row.table_id, { maxHorses: row.max_horses, startsGame: row.starts_game });
  }
  return allowed;
}

/**
 * The cap and the counted tables, as the database's feeder opener sums them
 * (fn_cash_hourly_feeder_admissible): the hour's table_cap and the rows of the
 * capacity census. Null on any failed or malformed read: the caller then
 * treats the owed starts as fitting and releases nothing (HorseVarietyFirst).
 */
export async function readHourlyCashRoom(): Promise<{ cap: number; counted: number } | null> {
  try {
    const [range, census] = await Promise.all([
      supabase.rpc('fn_cash_hourly_table_range'),
      supabase.rpc('fn_cash_hourly_table_capacity_census'),
    ]);
    if (range.error || census.error) return null;
    const row = Array.isArray(range.data) ? range.data[0] : range.data;
    const cap = Number(row?.table_cap);
    if (!Number.isInteger(cap) || cap < 0 || !Array.isArray(census.data)) return null;
    return { cap, counted: census.data.length };
  } catch {
    return null;
  }
}

/**
 * HANDS A SESSION STILL OWES AT THIS STACK, by the engine's own rule (PURE).
 * The same arithmetic as fn_cash_session_hands_owed (20261111174148): the
 * larger of the ten-hand countdown in profit (fn_cash_hit_run_hands_remaining,
 * 20261106203853: the engine acknowledged it, not completed, hands left, and
 * the stack above the baseline) and the Charles big-win count
 * (fn_cash_big_win_hands_remaining: acknowledged, hands left, chips at the
 * table). The engine reads the same two counts (ChipContinuity.
 * hitRunHandsRemaining). A seat below its baseline owes no countdown hands.
 */
export function sessionHandsOwed(row: Record<string, unknown>, stack: number): number {
  if (row.hr_engine_ack !== true) return 0;
  const stackNow = Number(stack) || 0;
  const required = Math.max(0, Math.floor(Number(row.hr_hands_required) || 0));
  const played = Math.max(0, Math.floor(Number(row.hr_hands_played) || 0));
  const countdown =
    row.hr_completed !== true &&
    required > 0 &&
    played < required &&
    stackNow > (Number(row.baseline) || 0)
      ? required - played
      : 0;
  const bigRequired = Math.max(0, Math.floor(Number(row.hr_big_win_required) || 0));
  const bigPlayed = Math.max(0, Math.floor(Number(row.hr_big_win_played) || 0));
  const bigWin = bigRequired > bigPlayed && stackNow > 0 ? bigRequired - bigPlayed : 0;
  return Math.max(countdown, bigWin);
}

/**
 * HANDS OWED IN PROFIT, BY TABLE (2026-11-26). Seats at these tables whose
 * open cash session still owes hands at the seat's current stack, by the
 * engine's own rule (sessionHandsOwed), counted per table. The variety drain
 * prefers, among equal choices, a table whose Horses owe no hands: it empties
 * in one sweep. Review follow-up 2026-11-27: the session row alone counted a
 * seat that had fallen below its baseline (or that the engine had not
 * acknowledged) as owing, though the engine lets it leave. Null on any failed
 * read (no preference).
 */
export async function readHandsOwedByTable(
  tableIds: ReadonlyArray<string>
): Promise<Map<string, number> | null> {
  if (tableIds.length === 0) return new Map();
  try {
    const [sessions, seats] = await Promise.all([
      supabase
        .from('cash_player_session')
        .select(
          'table_id, player_id, baseline, hr_engine_ack, hr_completed, hr_hands_required, hr_hands_played, hr_big_win_required, hr_big_win_played'
        )
        .in('table_id', [...tableIds])
        .is('closed_at', null),
      supabase
        .from('table_seats')
        .select('table_id, user_id, stack')
        .in('table_id', [...tableIds])
        .is('left_at', null),
    ]);
    if (
      sessions.error ||
      seats.error ||
      !Array.isArray(sessions.data) ||
      !Array.isArray(seats.data)
    )
      return null;
    const stackAt = new Map<string, number>();
    for (const r of seats.data as Array<Record<string, unknown>>)
      stackAt.set(`${String(r.table_id)}|${String(r.user_id)}`, Number(r.stack) || 0);
    const out = new Map<string, number>();
    for (const r of sessions.data as Array<Record<string, unknown>>) {
      const id = String(r.table_id);
      const stack = stackAt.get(`${id}|${String(r.player_id)}`);
      // Not seated: the engine's hitRunHandsOwed reads 0 for a seat it does not hold.
      if (stack === undefined || sessionHandsOwed(r, stack) <= 0) continue;
      out.set(id, (out.get(id) ?? 0) + 1);
    }
    return out;
  } catch {
    return null;
  }
}

export type HourlyCashClose =
  | { closed: false; reason: string }
  | { closed: true; departures: SeatCashoutReceipt[] };

/** A repeated unknown outcome always uses the original operation identity. */
export async function closeHourlyCashTable(
  tableId: string,
  operationId: string,
  instanceId: string,
  leaseGeneration: string
): Promise<HourlyCashClose> {
  const { data, error } = await supabase.rpc(hourlyCashCloseRpcName, {
    p_table_id: tableId,
    p_operation_id: operationId,
    p_instance_id: instanceId,
    p_lease_generation: leaseGeneration,
  });
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  if (data?.closed === false && typeof data.reason === 'string') return data;
  if (
    data?.closed !== true ||
    data.table_id !== tableId ||
    data.operation_id !== operationId ||
    !Array.isArray(data.departures)
  )
    throw new Error('cash_hourly_close_outcome_unknown');
  const seen = new Set<string>();
  const departures = data.departures.map((r: Record<string, unknown>) => {
    if (
      typeof r?.user_id !== 'string' ||
      typeof r.occupancy_id !== 'string' ||
      !Number.isInteger(r.seat_number) ||
      seen.has(r.occupancy_id)
    )
      throw new Error('cash_hourly_close_receipt_invalid');
    seen.add(r.occupancy_id);
    const receipt = confirmedCashout(r, {
      userId: r.user_id,
      occupancyId: r.occupancy_id,
      seatNumber: r.seat_number as number,
      tableId,
    });
    if (receipt.tournament_table) throw new Error('cash_hourly_close_tournament_refused');
    return receipt;
  });
  return { closed: true, departures };
}
