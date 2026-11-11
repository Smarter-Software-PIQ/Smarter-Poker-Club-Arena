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

/** Ignore only seated occupancy ceilings; still evaluate every other policy restriction. */
export function queuePolicyWithheldReason(
  policy: FleetPolicy,
  context: FleetPolicyContext
): string | null {
  return withheldReason(policy, { ...context, seatedHorses: undefined, seatedAtTable: undefined });
}
