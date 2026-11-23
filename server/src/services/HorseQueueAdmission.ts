import { withheldReason, type FleetPolicy, type FleetPolicyContext } from './HorseFleetPolicy.js';

/** Waiting spends no seat. Unknown game format must not opt into Classic admission. */
export function isFullClassicQueueTable(
  table: { cluster_id?: string | null; max_players: number },
  occupiedSeats: number,
  lightningGames: ReadonlySet<string> | null
): boolean {
  return (
    !!table.cluster_id &&
    lightningGames !== null &&
    !lightningGames.has(String(table.cluster_id)) &&
    table.max_players > 0 &&
    occupiedSeats >= table.max_players
  );
}

/**
 * A FULL GAME'S LINE IS NOT THE HOURLY CAP'S BUSINESS (Dan 2026-11-22: "a game
 * is never full with no waiting list").
 *
 * The hourly cash policy counts TABLES. Its projection (fn_cash_hourly_table_
 * admissions) leaves out a table it will not let a horse sit at, a table it is
 * closing among them, and the seating walk used to skip such a table before
 * its line was asked for. So a game whose only full table was being closed sat
 * "Full, 0 Waiting" until the close. A name on a list takes no seat and opens
 * no table: the opener (fn_cash_hourly_feeder_admissible) still refuses a
 * feeder over the cap, and a seat at a closing table is called past a horse to
 * the next person (fn_cash_hourly_call_admissible), so the horse keeps its
 * place without churning feeders.
 *
 * PURE. The admission the walk uses for this table: the database's own, or for
 * a physically full table the database left out, a line-only admission that
 * buys nothing (the walk's queue-only path requests zero seats).
 */
export const LINE_ONLY_HOURLY_ADMISSION = Object.freeze({ maxHorses: 0, startsGame: false });
export function hourlyAdmissionForWalk<T extends { maxHorses: number; startsGame: boolean }>(
  admission: T | undefined,
  physicallyFullQueueTable: boolean
): T | typeof LINE_ONLY_HOURLY_ADMISSION | undefined {
  if (admission) return admission;
  return physicallyFullQueueTable ? LINE_ONLY_HOURLY_ADMISSION : undefined;
}

/** Ignore only seated occupancy ceilings; still evaluate every other policy restriction. */
export function queuePolicyWithheldReason(
  policy: FleetPolicy,
  context: FleetPolicyContext
): string | null {
  return withheldReason(policy, { ...context, seatedHorses: undefined, seatedAtTable: undefined });
}
