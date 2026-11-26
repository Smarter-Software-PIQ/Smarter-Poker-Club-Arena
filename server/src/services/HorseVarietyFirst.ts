/**
 * A PLAN GAME WITH NO TABLE STARTS BEFORE ANOTHER GAME'S EXTRA TABLE
 * (2026-11-18, PLO5 1/2 Madness dark for eight hours).
 *
 * The hourly cash-table cap (fn_cash_hourly_table_range, 2026-11-16) is a
 * count of occupied tables. It says nothing about WHICH games hold them. After
 * the night walk-down on 2026-11-18 five games held sixteen of the sixteen
 * counted tables (NLH .50/1 Classic alone held four) while PLO5 1/2 Madness,
 * PLO5 .50/1 Classic, PLO6 1/2 Classic, NLH .05/.10 Classic and four seeded
 * Lightning games held none, from 08:45Z until the cap rose in the evening.
 *
 * A free start under the cap is taken through three doors, and before this
 * rule only one of them had an order at all:
 *
 *  1. the seeding walk (HorseFleetManager), which ranked an `opening` feeder
 *     ahead of every other cluster table, so an empty Main 1 of a game with no
 *     table stood behind the newest feeder of a game that already had three;
 *  2. a Horse answering a seat call (claimOfferedSeats), which runs BEFORE
 *     the walk in the same cycle and sat the head of a full game's list at
 *     its empty feeder as soon as the cap admitted that table;
 *  3. the cluster tick's feeder start (`balance` moves of the last two to sit
 *     at a full Main), executed by the table engine at its own hand boundary
 *     with no reference to the walk. A move adds no body to the host, so it
 *     also passed the night seat ceiling that stopped the walk seating anyone.
 *
 * Doors 2 and 3 are why a seeded Lightning game, which the walk ranks ahead of
 * every feeder, got no start either: the walk's order was never consulted.
 *
 * The rule, one definition for all three doors. While a game Horses start on
 * their own (a plan game, or a seeded Lightning game) has NO occupied table
 * and has a table Horses may start:
 *
 *  - that table is walked straight after a short-handed person's table;
 *  - an EMPTY table of a Classic game that already has an occupied table is
 *    not started by a Horse: not by the walk, not by a seat call, not by a
 *    feeder-start move.
 *
 * Variety first, then depth. Nothing here raises or reads the cap: the
 * database still admits one start at a time under it. What it does not touch:
 *
 *  - a person. A table with a person at it is never empty, a person who sits
 *    at an empty table starts it as before, and a person's move is never held;
 *  - a table that already has players. Filling, must-move into a Main,
 *    promotion, consolidation and closing are the cluster tick's, unchanged;
 *  - a Lightning game's next ring, seeded (Dan 2026-11-17, "Fill each to
 *    10-12") or started by a person: it keeps its rank and is never held, it
 *    only walks after a game that has nothing.
 *
 * A game that cannot be started is not owed for ever. When the walk reaches an
 * owed table that the cap admits and seats nobody for a reason of that table's
 * own (no Horse can sit there, the door refused), the game rests for
 * VARIETY_START_REST_MS and depth proceeds. A floor-wide stop (the seat
 * ceiling, the seat budget, the cycle clock) is not the game's own reason and
 * rests nothing.
 */

export interface VarietyTable {
  id: string;
  cluster_id?: string | null;
  role?: string | null;
  main_index?: number | null;
  lifecycle?: string | null;
}

export interface VarietyFirstInput<T extends VarietyTable> {
  tables: ReadonlyArray<T>;
  /** Players seated at a table now. */
  seatedAt: (tableId: string) => number;
  /** Games Horses start on their own: the plan's games and the seeded Lightning games. */
  startGames: ReadonlySet<string>;
  /** Lightning games: their empty tables are the pool's next ring and are never held. */
  neverHeldGames: ReadonlySet<string>;
  /** May Horses start this empty table now? The caller's whole admission policy except the cap. */
  mayStart: (table: T) => boolean;
  /** Games resting after a start the walk could not make (see VarietyStartMemory). */
  restingGames?: ReadonlySet<string>;
  /** Tables to prefer as a game's start (a seeded Lightning game's starter). */
  preferredStarts?: ReadonlySet<string>;
}

export interface VarietyFirstPlan {
  /** Start table id -> its game: one per startable game with no occupied table. */
  owedStarts: ReadonlyMap<string, string>;
  /** Empty tables of games that already have an occupied table; not started by a Horse while a start is owed. */
  heldStarts: ReadonlySet<string>;
}

export const NO_VARIETY_PLAN: VarietyFirstPlan = { owedStarts: new Map(), heldStarts: new Set() };

const open = (t: VarietyTable): boolean => t.lifecycle !== 'closed' && t.lifecycle !== 'breaking';

/** PURE. Which starts are owed this cycle and which wait behind them. */
export function varietyFirstPlan<T extends VarietyTable>(
  input: VarietyFirstInput<T>
): VarietyFirstPlan {
  const seated = (t: VarietyTable): number => {
    const n = input.seatedAt(String(t.id));
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const occupiedGames = new Set<string>();
  const emptyByGame = new Map<string, T[]>();
  for (const t of input.tables) {
    if (typeof t.id !== 'string' || typeof t.cluster_id !== 'string' || !t.cluster_id) continue;
    /* A breaking table with players on it is still that game being played. */
    if (seated(t) > 0) {
      if (t.lifecycle !== 'closed') occupiedGames.add(t.cluster_id);
      continue;
    }
    if (!open(t)) continue;
    const list = emptyByGame.get(t.cluster_id);
    if (list) list.push(t);
    else emptyByGame.set(t.cluster_id, [t]);
  }
  const owedStarts = new Map<string, string>();
  for (const [gameId, empties] of emptyByGame) {
    if (occupiedGames.has(gameId) || !input.startGames.has(gameId)) continue;
    if (input.restingGames?.has(gameId)) continue;
    const start = empties
      .filter((t) => input.mayStart(t))
      .sort(
        (a, b) =>
          Number(input.preferredStarts?.has(b.id) ?? false) -
            Number(input.preferredStarts?.has(a.id) ?? false) ||
          Number(a.role !== 'main') - Number(b.role !== 'main') ||
          Number(a.main_index ?? 999) - Number(b.main_index ?? 999) ||
          String(a.id).localeCompare(String(b.id))
      )[0];
    if (start) owedStarts.set(start.id, gameId);
  }
  const heldStarts = new Set<string>();
  if (owedStarts.size > 0) {
    for (const [gameId, empties] of emptyByGame) {
      if (!occupiedGames.has(gameId) || input.neverHeldGames.has(gameId)) continue;
      for (const t of empties) heldStarts.add(t.id);
    }
  }
  return { owedStarts, heldStarts };
}

/**
 * THE HOLD IS ONLY AS GOOD AS THE CYCLE THAT CAN PAY THE DEBT (review of
 * 02de6de4e2f, finding 1). An extra table waits for an owed start only in a
 * cycle whose walk is seating: not withheld (fleet disabled, seating paused,
 * brain behind, fleet-wide cap, outside the schedule). In a withheld cycle
 * nothing is held by any door: the owed game cannot start, and a feeder-start
 * move, which adds no Horse to the floor, must not wait on a fleet that is not
 * seating.
 *
 * A FULL CAP IS NOT A CYCLE THAT CANNOT PAY (2026-11-24). Until then the hold
 * also required the hourly cap to admit an owed table THIS cycle. At a full
 * cap it never did, so nothing was held, and the cluster tick (every 5 s; the
 * fleet walks every 30 s) turned each slot that freed into another game's
 * waiting-list feeder: Short Deck, Pineapple, FLO8 and PLO8 dealt nothing from
 * 2026-11-23 08:43Z while ten games held up to four tables each. What keeps an
 * owed table out of the cap's admission is the cap itself or the floor clock,
 * and both pass; the extra table waits behind them so the owed start gets the
 * next slot. The same games ride the heartbeat (varietyOwedGamesThisCycle) so
 * the database's feeder opener (fn_cash_hourly_feeder_admissible,
 * 20261124072701) holds on the same list.
 */
export function varietyHoldsThisCycle(
  plan: VarietyFirstPlan,
  cycle: { withheld: boolean }
): ReadonlySet<string> {
  if (cycle.withheld || plan.owedStarts.size === 0) return NO_VARIETY_PLAN.heldStarts;
  return plan.heldStarts;
}

/**
 * The games this cycle holds extra tables for, sorted, for the heartbeat's
 * `detail.variety_owed_games`. Empty in a withheld cycle, exactly when
 * varietyHoldsThisCycle holds nothing, so the database never holds on a list
 * the fleet is not paying.
 */
export function varietyOwedGamesThisCycle(
  plan: VarietyFirstPlan,
  cycle: { withheld: boolean }
): string[] {
  if (cycle.withheld) return [];
  return [...new Set(plan.owedStarts.values())].sort();
}

/** The walk's rank: an owed start before everything but a short-handed person. */
export function compareVarietyFirst(
  a: { id: string },
  b: { id: string },
  plan: VarietyFirstPlan
): number {
  return Number(plan.owedStarts.has(String(b.id))) - Number(plan.owedStarts.has(String(a.id)));
}

/** How long a game the walk could not start stands aside for depth. */
export const VARIETY_START_REST_MS = 5 * 60_000;

/**
 * Which games rest. Process-local and deliberately forgetful: a restart or a
 * new leader simply asks every game again, which is the safe direction.
 */
export class VarietyStartMemory {
  private readonly failedAt = new Map<string, number>();

  /** The walk reached this game's admitted start and seated nobody, for a reason of its own. */
  noteCouldNotStart(gameId: string, nowMs: number): void {
    this.failedAt.set(gameId, nowMs);
  }

  noteStarted(gameId: string): void {
    this.failedAt.delete(gameId);
  }

  resting(nowMs: number): ReadonlySet<string> {
    const out = new Set<string>();
    for (const [gameId, at] of this.failedAt) {
      if (nowMs - at < VARIETY_START_REST_MS && nowMs >= at) out.add(gameId);
      else this.failedAt.delete(gameId);
    }
    return out;
  }
}

/* ── THE THIRD DOOR ────────────────────────────────────────────────────────
   The table engine executes a feeder-start move at its own hand boundary and
   cannot see the floor. The fleet publishes the held tables and its Horse ids
   once per cycle; the engine asks before it executes a move. A publication
   older than VARIETY_HOLD_FRESH_MS is ignored: a fleet that has stopped
   cycling (not the leader, withheld, crashed) must never be the reason a move
   waits. A person's move is never held. */
export const VARIETY_HOLD_FRESH_MS = 90_000;

let published: {
  tables: ReadonlySet<string>;
  horses: ReadonlySet<string>;
  atMs: number;
} | null = null;

export function publishVarietyHolds(
  tables: ReadonlySet<string>,
  horses: ReadonlySet<string>,
  nowMs: number
): void {
  published = { tables, horses, atMs: nowMs };
}

/** Does a Horse's move onto this table wait for a game that has no table? */
export function moveWaitsForVariety(
  toTableId: string,
  playerId: string,
  nowMs: number = Date.now()
): boolean {
  if (!published) return false;
  const age = nowMs - published.atMs;
  if (!(age >= 0 && age < VARIETY_HOLD_FRESH_MS)) return false;
  return published.tables.has(String(toTableId)) && published.horses.has(String(playerId));
}

/**
 * The engine's question at a hand boundary. Only the cluster tick's feeder
 * start (`balance`, one way): a must-move into a Main, a break move and a
 * seat-change swap are never part of this rule.
 */
export function feederStartWaitsForVariety(move: {
  reason: string;
  swap_move_id: string | null;
  to_table_id: string;
  player_id: string;
}): boolean {
  return (
    move.reason === 'balance' &&
    move.swap_move_id == null &&
    moveWaitsForVariety(move.to_table_id, move.player_id)
  );
}

/** A cycle that cannot make an owed start holds nothing, at once. */
export function clearVarietyHolds(): void {
  published = null;
}

/** Test seam. */
export function __resetVarietyHolds(): void {
  published = null;
}

/* ── AN EXTRA TABLE YIELDS TO AN OWED MAIN (2026-11-24) ──────────────────
   The hold above and the database's feeder opener (20261124072701) stop NEW
   extra tables from taking a freed slot. They do not free one: on 2026-11-24
   at 17:22Z eleven of seventeen counted tables were extra tables opened
   before that fix served, every one of them Horses only, and no Horse left
   any of them in an hour, so owed games started only when the cap rose.

   While a start is owed and the owed starts do not fit under the cap, ONE
   extra table at a time stops being kept: the fleet seats nobody there and
   answers no seat call there, and HorseSessionRotator stands up every Horse
   not holding cards, together, through the ordinary door (engine.leaveTable, cashed out at
   the end of the hand, owed hands and orbits played first). The empty table
   closes by the game's own controller and the slot goes to the owed Main 1.

   Which table: the TOP of its game's ladder, never a table the ladder fills.
   Every Main N draws from higher Mains and feeders (20261124003437), so the
   live feeder, or with none the highest Main above the game's lowest, is a
   source and never a destination. Never the game's lowest Main (its Main 1),
   never a table with a person, never a game with a person on its list, never
   a Lightning game, never a table that is opening or breaking, and only where
   another of the game's tables is occupied, so the game keeps playing. Among
   the candidates: the fewest Horses, then the newest. The table already
   draining keeps draining while it is still a candidate. */

export interface DrainTable extends VarietyTable {
  created_at?: string | null;
}

export interface VarietyDrainInput<T extends DrainTable> {
  tables: ReadonlyArray<T>;
  /** Players seated at a table now. */
  seatedAt: (tableId: string) => number;
  /** Is a person (not a Horse) seated at this table? */
  personSeatedAt: (tableId: string) => boolean;
  /** Games with a person on their waiting list. */
  personWaitingGames: ReadonlySet<string>;
  /** Lightning games: never drained (their pool runs its own rings). */
  neverHeldGames: ReadonlySet<string>;
  /** varietyOwedGamesThisCycle: empty in a withheld cycle. */
  owedGames: ReadonlyArray<string>;
  /** Do the owed starts fit under the cap now? Unknown counts as yes. */
  owedStartsFit: boolean;
  /** The table drained last cycle, kept while it is still a candidate. */
  current?: string | null;
}

export interface VarietyDrainManyInput<T extends DrainTable> extends Omit<
  VarietyDrainInput<T>,
  'owedStartsFit' | 'current'
> {
  /** Owed starts the cap cannot fit now (drainShortfall): 0 releases nothing new. */
  shortfall: number;
  /** The tables released last cycle, each kept while it is still the top of its ladder. */
  current: ReadonlyArray<string>;
}

/** PURE. The one extra table to release this cycle, or null (the single-table view). */
export function varietyDrainTable<T extends DrainTable>(
  input: VarietyDrainInput<T>
): string | null {
  const { owedStartsFit: fits, current, ...rest } = input;
  return (
    varietyDrainTables({
      ...rest,
      shortfall: fits ? 0 : Math.max(1, input.owedGames.length),
      current: current ? [current] : [],
    })[0] ?? null
  );
}

/**
 * PURE. THE DRAIN SCALES WITH THE BACKLOG (2026-11-26). The extra tables to
 * release this cycle. Every table already released stays released while it is
 * still the top of its Horse-only ladder (A RELEASED TABLE STAYS RELEASED,
 * below). A NEW table is added only while the released tables are fewer than
 * the owed starts the cap cannot fit (drainShortfall), and at most one new
 * table per cycle, so releases ramp with the backlog instead of waiting for
 * each table to close. One table at a time freed one slot every few minutes
 * while nineteen games waited at a full cap (2026-11-26 10:12 CST); one new
 * table per cycle also spreads the leave sweeps (each costs a slower next deal
 * at that table) instead of starting many at once.
 */
export function varietyDrainTables<T extends DrainTable>(
  input: VarietyDrainManyInput<T>
): string[] {
  if (input.owedGames.length === 0) return [];
  const currentSet = new Set(input.current);
  const kept: string[] = [];
  const owed = new Set(input.owedGames);
  const seated = (t: T): number => {
    const n = input.seatedAt(String(t.id));
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const byGame = new Map<string, T[]>();
  for (const t of input.tables) {
    if (typeof t.id !== 'string' || typeof t.cluster_id !== 'string' || !t.cluster_id) continue;
    if (t.lifecycle === 'closed') continue;
    const list = byGame.get(t.cluster_id);
    if (list) list.push(t);
    else byGame.set(t.cluster_id, [t]);
  }
  const candidates: T[] = [];
  for (const [gameId, all] of byGame) {
    if (owed.has(gameId) || input.neverHeldGames.has(gameId)) continue;
    if (input.personWaitingGames.has(gameId)) continue;
    /* A game breaking a table is mid-move: it waits until the break is done. */
    if (all.some((t) => t.lifecycle === 'breaking')) continue;
    const live = all.filter((t) => (t.lifecycle ?? 'live') === 'live');
    const mains = live
      .filter((t) => t.role === 'main')
      .sort((a, b) => Number(a.main_index ?? 999) - Number(b.main_index ?? 999));
    const lowestMain = mains[0];
    const feeders = live
      .filter((t) => t.role === 'feeder')
      .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));
    const top = feeders.length > 0 ? feeders[0] : mains[mains.length - 1];
    if (!top || top === lowestMain || (top.role === 'main' && Number(top.main_index) === 1))
      continue;
    if (input.personSeatedAt(String(top.id))) continue;
    /* The game keeps playing: another of its tables is occupied. */
    if (!live.some((t) => t !== top && seated(t) > 0)) continue;
    /* A RELEASED TABLE STAYS RELEASED (2026-11-26). The table already being
       released is kept while any start is owed and it is still the top of a
       Horse-only ladder: also once it is empty, and also in a cycle where the
       owed starts fit again. Un-naming it for one cycle let the fleet walk
       Horses straight back in (production 2026-11-26 04:05-04:16 CST, NLH
       0.05/0.10 Classic Feeder: seven Horses left and four re-joined in twelve
       minutes, every re-join in a cycle the table was not named). */
    if (currentSet.has(top.id)) {
      kept.push(top.id);
      continue;
    }
    if (seated(top) === 0) continue;
    candidates.push(top);
  }
  /* A new table is released only when the cap has no free slot and the tables
     already released do not cover the owed starts (drainShortfall). */
  if (candidates.length === 0 || kept.length >= input.shortfall) return kept;
  candidates.sort(
    (a, b) =>
      seated(a) - seated(b) ||
      String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')) ||
      String(a.id).localeCompare(String(b.id))
  );
  return [...kept, candidates[0].id];
}

/**
 * How many owed starts the cap cannot fit now. Zero whenever owedStartsFit
 * says they fit (a free slot, an admitted owed start, a failed read): with a
 * free slot the owed start takes it, so emptying a table frees nothing. At a
 * cap with no free slot, every owed start is short.
 */
export function drainShortfall(room: Parameters<typeof owedStartsFit>[0]): number {
  return owedStartsFit(room) ? 0 : Math.max(0, room.owedStarts);
}

/**
 * Is there a free slot for an owed start? Counted tables + empty opening
 * feeders against the cap (the census fn_cash_hourly_feeder_admissible sums). An owed
 * start the hourly projection already admits means there is room (or the policy
 * is off), so nothing is drained. Unknown (a failed read) fits: nothing drains.
 */
export function owedStartsFit(room: {
  cap: number | null;
  counted: number | null;
  openingFeeders: number;
  owedStarts: number;
  anOwedStartAdmitted: boolean;
}): boolean {
  if (room.anOwedStartAdmitted) return true;
  if (room.cap === null || room.counted === null) return true;
  /* A FREE SLOT FITS THE NEXT OWED START (2026-11-26). The feeder opener's sum
     (counted + opening + every owed start <= cap) is the right question for
     opening ANOTHER table, and the wrong one for emptying one: with a free
     slot under the cap the owed start can take it now, and emptying a table
     frees nothing an owed game is waiting for. Production 2026-11-26 04:15
     CST: cap 10, 6 counted, 30 owed (too few Horses on shift to start them),
     and a table was being emptied all the same. Only a cap with no free slot
     releases a table. */
  if (room.owedStarts <= 0) return true;
  return room.counted + room.openingFeeders < room.cap;
}

let publishedDrain: { tableIds: readonly string[]; atMs: number } | null = null;

/** The fleet names the tables it is releasing, once per cycle (or none). */
export function publishVarietyDrain(
  tables: string | ReadonlyArray<string> | null,
  nowMs: number
): void {
  const ids = tables === null ? [] : typeof tables === 'string' ? [tables] : [...tables];
  publishedDrain = ids.length > 0 ? { tableIds: ids, atMs: nowMs } : null;
}

/**
 * HorseSessionRotator's question: which table's Horses go home this cycle?
 * A publication older than VARIETY_HOLD_FRESH_MS names nothing: a fleet that
 * has stopped cycling never keeps a table draining.
 */
export function varietyDrainingTables(nowMs: number = Date.now()): readonly string[] {
  if (!publishedDrain) return [];
  const age = nowMs - publishedDrain.atMs;
  return age >= 0 && age < VARIETY_HOLD_FRESH_MS ? publishedDrain.tableIds : [];
}

/** The first released table (the single-table view). */
export function varietyDrainingTable(nowMs: number = Date.now()): string | null {
  return varietyDrainingTables(nowMs)[0] ?? null;
}

/** Test seam. */
export function __resetVarietyDrain(): void {
  publishedDrain = null;
}
