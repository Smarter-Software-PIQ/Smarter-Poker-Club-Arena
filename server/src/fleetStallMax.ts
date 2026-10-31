/**
 * THE WORST TABLE MUST BE A TABLE THAT SHOULD BE DEALING (2026-10-31).
 *
 * `poker_fleet_table_stall_max_ms` feeds SLOTableHasStalled, the alert that
 * pages the owner "Tables Have Stopped Dealing". It took the max
 * msSinceProgress over EVERY table this process owns, while its sibling
 * `poker_fleet_tables_stalled` already said "a table below its deal minimum is
 * waiting, not stalled". So the page tracked whichever table was most idle on
 * purpose: at 18:01 UTC on 2026-10-31 that was one of 19 closed Diamond Arena
 * tables (dealable 0, refused "Diamond Tournaments Are Not Open"), and earlier
 * that day tournament tables parked on a synchronized break. 57 pages in one
 * afternoon, none of them a table a player was waiting on.
 *
 * The population is now the watchdog's own: two or more dealable seats and
 * not paused by design. A by-design pause is honoured only inside a bound - a
 * scheduled break, add-on or hand-for-hand pause that is still holding after
 * thirty minutes is a wedge, not a break, and counts again.
 */
export const FLEET_STALL_PAUSE_BOUND_MS = 30 * 60_000;

export interface FleetStallSample {
  dealable: number;
  paused?: boolean | null;
  msSinceProgress: number;
}

export function shouldBeDealing(t: FleetStallSample): boolean {
  if (!(t.dealable >= 2)) return false;
  if (t.paused && t.msSinceProgress < FLEET_STALL_PAUSE_BOUND_MS) return false;
  return true;
}

export function fleetStallMaxMs(tables: readonly FleetStallSample[]): number {
  let max = 0;
  for (const t of tables) {
    if (shouldBeDealing(t) && t.msSinceProgress > max) max = t.msSinceProgress;
  }
  return max;
}
