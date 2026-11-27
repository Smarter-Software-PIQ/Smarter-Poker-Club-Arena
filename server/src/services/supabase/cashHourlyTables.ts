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
 * HANDS OWED IN PROFIT, BY TABLE (2026-11-26). Open cash sessions at these
 * tables whose hit-and-run count is not complete, counted per table. The
 * variety drain prefers, among equal choices, a table whose Horses owe no
 * hands: it empties in one sweep. Null on any failed read (no preference).
 */
export async function readHandsOwedByTable(
  tableIds: ReadonlyArray<string>
): Promise<Map<string, number> | null> {
  if (tableIds.length === 0) return new Map();
  try {
    const { data, error } = await supabase
      .from('cash_player_session')
      .select('table_id, hr_hands_required, hr_hands_played')
      .in('table_id', [...tableIds])
      .is('closed_at', null)
      .eq('hr_completed', false);
    if (error || !Array.isArray(data)) return null;
    const out = new Map<string, number>();
    for (const r of data as Array<Record<string, unknown>>) {
      const required = Number(r.hr_hands_required) || 0;
      const played = Number(r.hr_hands_played) || 0;
      if (required <= played) continue;
      const id = String(r.table_id);
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
