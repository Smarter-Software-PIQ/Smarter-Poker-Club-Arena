/**
 * SEAT-BOUNDARY SIGNALS (2026-10-24). In-process, synchronous, never awaited.
 *
 * Dan 2026-10-23: "MAIN GAME MUST BE FED RIGHT AWAY WHEN A SEAT OPENS UP.
 * THERE SHOULDN'T BE A DELAY, NEXT HAND, PLAYER GOES TO THE MAIN GAME."
 *
 * #7873 made a must-move land at the first completed source boundary and
 * before the next feeder deal. Measured live on c485ce7a (2026-10-24 09:05-
 * 09:11 UTC, 18 natural moves), two residual races remained, both inside the
 * two-second rest (the-next-hand-deals-two-seconds-after-completion):
 *
 *   1. FEEDER. The pre-deal read runs at the START of the rest. A plan the
 *      ClusterController committed after that read - 0.9 s and 1.2 s before
 *      the deal in the two cases measured (moves 1440caa7, 4f1e32f4) - was
 *      invisible, so the player was dealt one more feeder hand.
 *   2. MAIN. The roster read also runs at the start of the rest. A player
 *      whose transfer committed after it (0.8 s and 1.4 s before Main's deal,
 *      moves 0152cb45, 1440caa7) sat out Main's very next hand.
 *
 * The planner, every feeder and every Main run in this one engine process, so
 * the cure is not another database read under the rest (the rest law forbids
 * any wait there): the side that changes the seat boundary bumps a counter
 * here the instant its committed RPC returns, and the dealing loop compares
 * the counters it captured before its reads with a synchronous check
 * immediately before dealHand. Only when one moved does the loop go round
 * once more - re-reading, moving the player or adopting the arrival - so an
 * ordinary deal still waits exactly the rest and nothing else.
 *
 * GRANULARITY. The planner reports how many moves it planned for a game, not
 * from which table, so plans are counted per GAME: every feeder of that game
 * re-reads once if a plan lands under its rest. Plans are a few per game per
 * hour, so an uninvolved feeder pays that re-read on well under 1% of its
 * deals, and the involved feeder never misses its boundary. Arrivals are
 * exact: the executor knows the destination table.
 *
 * Counters only grow and are keyed by a bounded set of ids (games and tables
 * this process runs), so nothing here needs pruning. A process restart starts
 * every counter at zero together with every engine's captured value.
 */

const plannedByGame = new Map<string, number>();
const plannedGameWideByGame = new Map<string, number>();
const plannedByTable = new Map<string, number>();
const arrivedByTable = new Map<string, number>();

const tableArrivalListeners = new Map<string, Set<() => void>>();
const tablePlanListeners = new Map<string, Set<() => void>>();
const gamePlanListeners = new Map<string, Set<() => void>>();

function addListener(
  map: Map<string, Set<() => void>>,
  key: string,
  listener: () => void
): () => void {
  let set = map.get(key);
  if (!set) {
    set = new Set();
    map.set(key, set);
  }
  set.add(listener);
  return () => {
    const current = map.get(key);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) map.delete(key);
  };
}

function notifyListeners(map: Map<string, Set<() => void>>, key: string): void {
  const set = map.get(key);
  if (!set || set.size === 0) return;
  for (const listener of [...set]) {
    try {
      listener();
    } catch {
      /* signal listeners are synchronous wakes and must never throw into callers */
    }
  }
}

/**
 * The ClusterController committed at least one must-move plan for this game.
 * When `sourceTableIds` is supplied (non-empty), only those source tables are
 * targeted (so uninvolved feeders and Main 1 are not disturbed unless named,
 * e.g. in a swap). When omitted, a game-wide signal is raised for non-Main-1
 * tables while Main 1 continues to wait for actual `noteSeatArrival(tableId)`.
 */
export function noteMovesPlanned(
  gameId: string | null | undefined,
  sourceTableIds?: Iterable<string> | null
): void {
  if (!gameId) return;
  plannedByGame.set(gameId, (plannedByGame.get(gameId) ?? 0) + 1);
  const sources = new Set<string>();
  if (sourceTableIds) {
    for (const id of sourceTableIds) {
      if (typeof id === 'string' && id.length > 0) sources.add(id);
    }
  }
  if (sources.size > 0) {
    for (const tableId of sources) {
      plannedByTable.set(tableId, (plannedByTable.get(tableId) ?? 0) + 1);
      notifyListeners(tablePlanListeners, tableId);
    }
    return;
  }
  plannedGameWideByGame.set(gameId, (plannedGameWideByGame.get(gameId) ?? 0) + 1);
  notifyListeners(gamePlanListeners, gameId);
}

/** Captured before a feeder's pending-move read; compared before its deal. */
export function movesPlannedGeneration(gameId: string | null | undefined): number {
  return gameId ? (plannedByGame.get(gameId) ?? 0) : 0;
}

/** Game-wide (unspecified source) move-plan generation for non-Main-1 tables. */
export function gameWideMovesPlannedGeneration(gameId: string | null | undefined): number {
  return gameId ? (plannedGameWideByGame.get(gameId) ?? 0) : 0;
}

/** Table-targeted move-plan generation (includes swaps naming Main 1). */
export function tableMovesPlannedGeneration(tableId: string | null | undefined): number {
  return tableId ? (plannedByTable.get(tableId) ?? 0) : 0;
}

/** A seat move into this table committed (its executor RPC returned). */
export function noteSeatArrival(tableId: string | null | undefined): void {
  if (!tableId) return;
  arrivedByTable.set(tableId, (arrivedByTable.get(tableId) ?? 0) + 1);
  notifyListeners(tableArrivalListeners, tableId);
}

/** Captured before a table's roster read; compared before its deal. */
export function seatArrivalGeneration(tableId: string | null | undefined): number {
  return tableId ? (arrivedByTable.get(tableId) ?? 0) : 0;
}

/**
 * Subscribe to synchronous wake callbacks for this table's seat arrivals,
 * table-targeted plans (including swaps), and (when `gameId` is passed for a
 * non-Main-1 table) game-wide plans. Always call the returned unsubscribe in a
 * `finally` block so zero listeners leak.
 */
export function subscribeSeatBoundaryChange(
  target: { tableId?: string | null; gameId?: string | null },
  onChange: () => void
): () => void {
  const unsubs: Array<() => void> = [];
  if (target.tableId) {
    unsubs.push(addListener(tableArrivalListeners, target.tableId, onChange));
    unsubs.push(addListener(tablePlanListeners, target.tableId, onChange));
  }
  if (target.gameId) {
    unsubs.push(addListener(gamePlanListeners, target.gameId, onChange));
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const unsub of unsubs) unsub();
  };
}

/**
 * fn_cash_cluster_tick reports `{ moves_planned: n }` among its actions when
 * it planned any (20260905 controller SQL). Anything unreadable is "no plan":
 * a missed signal only falls back to the pre-signal behaviour (the move lands
 * at the end of the hand that was dealt), never to a wrong move.
 */
export function tickReportsMovesPlanned(result: unknown): boolean {
  const actions = (result as { actions?: unknown } | null | undefined)?.actions;
  if (!Array.isArray(actions)) return false;
  return actions.some((action) => {
    const planned = (action as { moves_planned?: unknown } | null)?.moves_planned;
    return typeof planned === 'number' && planned > 0;
  });
}

/**
 * Extract explicit planned source table IDs from a tick result when the SQL
 * reports them alongside `moves_planned`. Returns `undefined` when any
 * `moves_planned` action omits source table IDs so callers fall back to the
 * game-wide signal (excluding Main 1 unless explicitly named).
 */
export function tickPlannedSourceTableIds(result: unknown): string[] | undefined {
  const actions = (result as { actions?: unknown } | null | undefined)?.actions;
  if (!Array.isArray(actions)) return undefined;
  const sources = new Set<string>();
  let sawPlanned = false;
  for (const action of actions) {
    if (!action || typeof action !== 'object') continue;
    const rec = action as Record<string, unknown>;
    const planned = rec.moves_planned;
    if (typeof planned !== 'number' || !(planned > 0)) continue;
    sawPlanned = true;
    const list = rec.source_table_ids ?? rec.from_table_ids ?? rec.swap_table_ids;
    if (!Array.isArray(list) || list.length === 0) return undefined;
    let added = false;
    for (const id of list) {
      if (typeof id === 'string' && id.length > 0) {
        sources.add(id);
        added = true;
      }
    }
    if (!added) return undefined;
  }
  return sawPlanned && sources.size > 0 ? [...sources] : undefined;
}

/** Test seam only: counts active wake listeners across all tables/games. */
export function seatBoundaryListenerCountForTest(): number {
  let count = 0;
  for (const set of tableArrivalListeners.values()) count += set.size;
  for (const set of tablePlanListeners.values()) count += set.size;
  for (const set of gamePlanListeners.values()) count += set.size;
  return count;
}

/** Test seam only: production never resets a counter. */
export function resetSeatBoundarySignalsForTest(): void {
  plannedByGame.clear();
  plannedGameWideByGame.clear();
  plannedByTable.clear();
  arrivedByTable.clear();
  tableArrivalListeners.clear();
  tablePlanListeners.clear();
  gamePlanListeners.clear();
}
