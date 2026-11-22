/**
 * Read-only horse seat counter for `poker_horses_seated` and
 * `poker_tables_with_horses` (CLAUDE.md 10.5: identification only — counts,
 * decides nothing, zero side effects, never throws).
 *
 * Counts horses holding chips across:
 *   1. every live `ServerTableEngine` (`tableEngines`), and
 *   2. every live Lightning pool hand (`lightning.seatedHorseEntries()`),
 *      deduplicated by `(clusterId, playerId)` against any Lightning anchor
 *      engine already counted in `tableEngines` and by `poolSessionId` across
 *      overlapping fast-fold hosts, so Lightning-seated horses are never
 *      omitted when an anchor engine is absent or has a stale roster stack,
 *      and never double-counted when an anchor engine already holds them.
 */

export interface HorseSeatEngineSource {
  horsesSeated(): number;
  lightningAnchorHorseIds?: () => { clusterId: string; userIds: string[] } | null;
}

export interface LightningSeatedHorseEntry {
  clusterId: string;
  playerId: string;
  poolSessionId: string;
}

export interface LightningHorseSeatSource {
  seatedHorseEntries(): Iterable<LightningSeatedHorseEntry>;
}

export interface HorseSeatCounts {
  horses: number;
  tables: number;
}

export function countHorseSeats(
  tableEngines: Iterable<HorseSeatEngineSource>,
  lightning?: LightningHorseSeatSource | null
): HorseSeatCounts {
  const counts: HorseSeatCounts = { horses: 0, tables: 0 };
  const countedAnchorHorses = new Set<string>();

  for (const engine of tableEngines) {
    try {
      const n = engine.horsesSeated();
      if (n > 0) {
        counts.horses += n;
        counts.tables += 1;
      }
      const anchor = engine.lightningAnchorHorseIds?.();
      if (anchor && anchor.clusterId) {
        for (const userId of anchor.userIds) {
          if (userId) countedAnchorHorses.add(`${anchor.clusterId}:${userId}`);
        }
      }
    } catch {
      /* one table's bad state never hides the rest of the fleet */
    }
  }

  if (!lightning) return counts;

  try {
    const seenRooms = new Set<string>();
    for (const entry of lightning.seatedHorseEntries()) {
      if (!entry || !entry.poolSessionId || !entry.playerId) continue;
      if (seenRooms.has(entry.poolSessionId)) continue;
      seenRooms.add(entry.poolSessionId);
      if (entry.clusterId && countedAnchorHorses.has(`${entry.clusterId}:${entry.playerId}`)) {
        continue;
      }
      counts.horses += 1;
    }
  } catch {
    /* absent or throwing Lightning state never breaks the metrics scrape */
  }

  return counts;
}
