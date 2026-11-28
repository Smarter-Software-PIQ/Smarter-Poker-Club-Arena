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
 *
 * A start that failed for a reason of the game's own also stops the DRAIN
 * asking for a slot for it (2026-11-27, 7 PM CST seal; see drainOwedGames).
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
 * WHY THE WALK COULD NOT MAKE AN OWED START (2026-11-27, 7 PM CST seal).
 *   cap_blocked  the door refused the start for the hourly cap: a freed slot
 *                cures it. It rests nothing (the floor's answer, as before).
 *   own_reason   the cap admitted the table and nobody sat for a reason of the
 *                game's own (no Horse may sit there, the door refused for
 *                anything but the cap): a freed slot cures nothing. The game
 *                rests, and the drain stops freeing slots for it.
 * The call site knows which (HorseFleetManager's walk: the hourly admission
 * and the door's refusal reason); nothing here guesses it.
 */
export type VarietyStartFailure = 'cap_blocked' | 'own_reason';

/**
 * Which games rest, and which last failed for a reason of their own.
 * Process-local and deliberately forgetful: a restart or a new leader simply
 * asks every game again, which is the safe direction.
 *
 * The own-reason mark outlives the rest on purpose. The rest (5 min) lets
 * depth proceed; the mark keeps the drain from emptying a table for the game
 * every time the rest ends. Measured on the 7 PM CST seal (2026-11-27, 8:05
 * to 9:47 PM CST): two 5/10 fixed-limit games no Horse can fund were owed the
 * whole time; each rest emptied the owed list, a decided cycle with nothing
 * owed cleared the drain's memory, the released tables refilled, and when the
 * rest ended a new table was released: 11 releases in 102 minutes, every one
 * for a start that could not be made. The mark goes when the game starts,
 * when an attempt is refused only by the cap, or when the game is neither
 * owed nor resting (forgetAllBut). The game still gets its next try: it stays
 * on the published owed list, so the holds keep the next slot that frees by
 * itself for the owed games.
 */
export class VarietyStartMemory {
  private readonly failedAt = new Map<string, number>();
  private readonly ownReasonAt = new Map<string, number>();

  /** The walk reached this game's admitted start and seated nobody: why. */
  noteCouldNotStart(gameId: string, nowMs: number, cause: VarietyStartFailure): void {
    if (cause === 'cap_blocked') {
      this.ownReasonAt.delete(gameId);
      return;
    }
    this.failedAt.set(gameId, nowMs);
    this.ownReasonAt.set(gameId, nowMs);
  }

  noteStarted(gameId: string): void {
    this.failedAt.delete(gameId);
    this.ownReasonAt.delete(gameId);
  }

  resting(nowMs: number): ReadonlySet<string> {
    const out = new Set<string>();
    for (const [gameId, at] of this.failedAt) {
      if (nowMs - at < VARIETY_START_REST_MS && nowMs >= at) out.add(gameId);
      else this.failedAt.delete(gameId);
    }
    return out;
  }

  /** Games whose last start attempt failed for a reason of their own. */
  cannotStart(): ReadonlySet<string> {
    return new Set(this.ownReasonAt.keys());
  }

  /** Forget the own-reason mark of every game not in `games` (owed or resting now). */
  forgetAllBut(games: Iterable<string>): void {
    const keep = new Set(games);
    for (const gameId of [...this.ownReasonAt.keys()])
      if (!keep.has(gameId)) this.ownReasonAt.delete(gameId);
  }
}

/**
 * PURE. THE DRAIN FREES A SLOT ONLY FOR A START THE CAP IS BLOCKING
 * (2026-11-27, 7 PM CST seal). The owed games the drain may release a table
 * for: the published owed games minus those whose last start attempt failed
 * for a reason of their own (VarietyStartMemory.cannotStart). A freed slot
 * cannot cure such a failure, so emptying a table for it only churns the
 * floor. The holds are unchanged: the game stays on variety_owed_games, so a
 * slot that frees by itself still goes to an owed game, which is how it gets
 * its next try.
 */
export function drainOwedGames(input: {
  owedGames: ReadonlyArray<string>;
  cannotStart: ReadonlySet<string>;
}): string[] {
  return input.owedGames.filter((g) => !input.cannotStart.has(g));
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
    (move.reason === 'balance' &&
      move.swap_move_id == null &&
      moveWaitsForVariety(move.to_table_id, move.player_id)) ||
    aHorseMoveWaitsForTheDrain(move)
  );
}

/**
 * NO HORSE IS MOVED ONTO A TABLE BEING RELEASED (review 2026-11-26). A cluster
 * balance move, a must-move or a seat change could seat a Horse at the very
 * table the drain is emptying. A Horse's move onto a published released table
 * waits (it stays pending and expires by its own clock); a person's move and a
 * break move never wait.
 */
function aHorseMoveWaitsForTheDrain(move: {
  reason: string;
  to_table_id: string;
  player_id: string;
}): boolean {
  if (move.reason === 'break' || !publishedDrain) return false;
  if (!varietyDrainingTables().includes(String(move.to_table_id))) return false;
  return publishedDrain.horses.has(String(move.player_id));
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
  /**
   * Seats at a table still owing hands in profit (2026-11-26). Among new
   * candidates the table whose Horses owe fewest goes first: it empties in
   * one sweep. Absent (or a failed read): no preference.
   */
  owingAt?: (tableId: string) => number;
}

export interface VarietyDrainManyInput<T extends DrainTable> extends Omit<
  VarietyDrainInput<T>,
  'owedStartsFit' | 'current'
> {
  /** Owed starts the cap cannot fit now (drainShortfall): 0 releases nothing new. */
  shortfall: number;
  /** The tables released last cycle, each kept while it is still the top of its ladder. */
  current: ReadonlyArray<string>;
  /**
   * May a NEW table be added this cycle? False until VARIETY_DRAIN_NEW_TABLE_MS
   * has passed since the last new release (the rotator's cycle). Default true.
   */
  mayAddNew?: boolean;
}

/**
 * THE RAMP IS THE ROTATOR'S PACE (review 2026-11-26). The fleet cycles every
 * 30 s but a released table's Horses go home on the rotator's 90 s cycle, so
 * "one new table per fleet cycle" released three tables per rotator cycle.
 * One new table per rotator cycle. Pinned equal to HorseSessionRotator's
 * CYCLE_MS by anExtraTableYieldsToAnOwedMain.law.test.ts.
 */
export const VARIETY_DRAIN_NEW_TABLE_MS = 90_000;

/**
 * How long a drain publication names tables (review 2026-11-26). Shorter than
 * the hold's 90 s: a fleet cycle that returned early must not leave the rotator
 * acting on a list built from an older waiting-list read for a whole minute
 * and a half. Two fleet cycles plus slack.
 */
export const VARIETY_DRAIN_FRESH_MS = 65_000;

/**
 * THE PACE HAS SLACK FOR THE FLEET'S OWN JITTER (review 2026-11-27). The fleet
 * stamps a new release mid-cycle and asks again three 30 s cycles later, so
 * the elapsed time is 90 s give or take how long each cycle's reads took. A
 * strict ">= 90 s" failed whenever the third cycle ran a few milliseconds
 * early and the new table waited a fourth cycle: the ramp ran at 120 s about
 * half the time. Ten seconds of slack keeps it at three cycles and can never
 * admit a second cycle (60 s).
 */
export const VARIETY_DRAIN_PACE_SLACK_MS = 10_000;

/** PURE. May a NEW table be released now, given when the last new one was? */
export function mayAddDrainTable(nowMs: number, lastNewAtMs: number): boolean {
  return nowMs - lastNewAtMs >= VARIETY_DRAIN_NEW_TABLE_MS - VARIETY_DRAIN_PACE_SLACK_MS;
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
  return varietyDrainDecision(input).tables;
}

/**
 * Why a decided owed cycle released what it did (2026-11-27). On the 1 AM CST
 * seal the drain released nothing for ten hours while 18 games were owed, and
 * the heartbeat could not say why: it took hand history to show that no game
 * had a second occupied table. The beat now carries the reason itself.
 *   nothing_owed    no owed start
 *   room_free       the cap has a free slot (or the room is unknown): emptying a table frees nothing
 *   no_extra_table  no game has a Horse-only extra table that may be released
 *   covered         the tables already being released cover the shortfall
 *   paced           a new table waits for the rotator's pace (one per cycle)
 *   kept            the tables already being released are kept, none added
 *   released        a new table was added this cycle
 */
export type VarietyDrainWhy =
  | 'nothing_owed'
  | 'room_free'
  | 'no_extra_table'
  | 'covered'
  | 'paced'
  | 'kept'
  | 'released';

export function varietyDrainDecision<T extends DrainTable>(
  input: VarietyDrainManyInput<T>
): { tables: string[]; why: VarietyDrainWhy } {
  if (input.owedGames.length === 0) return { tables: [], why: 'nothing_owed' };
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
    /* An empty live feeder stays the top on purpose (reviewed 2026-11-26): it
       either fills, and is then released, or closes by itself and frees its
       slot. Releasing the highest Main beside it would drain two tables for
       one slot. Pinned by "a released table stays released: empty...". */
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
  /* A released table that has already emptied is off the census and covers no
     owed start (review 2026-11-26): only kept tables with Horses still seated
     count against the shortfall. New tables are added at the rotator's pace
     (mayAddNew), never faster than its Horses can leave. */
  const stillSeated = kept.filter((id) => {
    const n = input.seatedAt(id);
    return Number.isFinite(n) && n > 0;
  }).length;
  if (candidates.length === 0 || stillSeated >= input.shortfall || input.mayAddNew === false) {
    const why: VarietyDrainWhy =
      input.shortfall <= 0
        ? kept.length > 0
          ? 'kept'
          : 'room_free'
        : stillSeated >= input.shortfall
          ? 'covered'
          : candidates.length === 0
            ? kept.length > 0
              ? 'kept'
              : 'no_extra_table'
            : 'paced';
    return { tables: kept, why };
  }
  const owing = (x: T) => {
    const n = input.owingAt?.(String(x.id)) ?? 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  candidates.sort(
    (a, b) =>
      owing(a) - owing(b) ||
      seated(a) - seated(b) ||
      String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')) ||
      String(a.id).localeCompare(String(b.id))
  );
  return { tables: [...kept, candidates[0].id], why: 'released' };
}

/**
 * WHAT ONE FLEET CYCLE DOES WITH THE DRAIN (review 2026-11-27). PURE.
 *
 * A cycle DECIDES only when it is seating (not withheld) and the waiting list
 * and the Lightning set were both read. A decided cycle publishes and
 * remembers exactly what varietyDrainDecision returned.
 *
 * A cycle that does not decide releases nothing new. While a start is owed it
 * HOLDS the tables already being released (never one with a person seated):
 * they stay out of the walk and the seat calls, stay published and stay
 * remembered. A withheld cycle publishes no owed games (varietyOwedGamesThisCycle),
 * so it is judged on the plan's own owed starts.
 *
 * Why it broke: the fleet computed "decided" from the two reads alone. A
 * withheld cycle (the decision lane behind, or not ready) usually reads both
 * fine, so it counted as decided with an empty decision: the memory was
 * cleared and every released table un-published, the opposite of "a withheld
 * cycle forgets nothing". The guard written for it sat behind "decided ||"
 * and only ran when the reads had also failed.
 */
export function drainCycleOutcome(input: {
  /** Seating is withheld this cycle (HorseFleetPolicy.withheldReason). */
  withheld: boolean;
  /** The waiting list and the Lightning set were both read this cycle. */
  readsComplete: boolean;
  /** Owed games this cycle may release for (drainOwedGames over the published list; 0 in a withheld cycle). */
  owedThisCycle: number;
  /** The same over the plan's own owed games, withheld or not. */
  owedInPlan: number;
  /** varietyDrainDecision's tables; empty when the decision did not run. */
  decision: ReadonlyArray<string>;
  /** The tables remembered from the last cycle that changed the memory. */
  remembered: ReadonlyArray<string>;
  personSeatedAt: (tableId: string) => boolean;
}): { decided: boolean; held: string[]; released: string[]; memory: string[] } {
  const decided = !input.withheld && input.readsComplete;
  const owed = input.withheld ? input.owedInPlan > 0 : input.owedThisCycle > 0;
  const held = !decided && owed ? input.remembered.filter((id) => !input.personSeatedAt(id)) : [];
  const released = decided ? [...input.decision] : held;
  const memory = decided || !owed ? [...input.decision] : [...input.remembered];
  return { decided, held, released, memory };
}

/**
 * WHEN EACH OWED GAME WAS FIRST SEEN OWED (review follow-up 2026-11-27). PURE.
 *
 * The heartbeat carries it as detail.variety_owed_since ({gameId: ISO time}),
 * so the live check times a wait that began before the release from its true
 * start instead of labelling it a minimum. The memory survives across cycles.
 * A seating (not withheld) cycle keeps the first-seen time of every game it
 * publishes as owed, stamps `nowIso` on a game newly owed, and forgets a game
 * it no longer publishes. A withheld cycle publishes no owed games and
 * forgets nothing (the same rule as drainCycleOutcome).
 */
export function varietyOwedSince(input: {
  withheld: boolean;
  owedGames: ReadonlyArray<string>;
  previous: Readonly<Record<string, string>>;
  /** Times carried over a restart (carriedOwedSince). The process's own
   *  memory wins; a game no longer owed keeps nothing. */
  carried?: Readonly<Record<string, string>>;
  nowIso: string;
}): Record<string, string> {
  if (input.withheld) return { ...input.previous };
  const out: Record<string, string> = {};
  for (const game of input.owedGames) {
    out[game] = input.previous[game] ?? input.carried?.[game] ?? input.nowIso;
  }
  return out;
}

/**
 * A WAITING GAME KEEPS ITS CLOCK THROUGH A RELEASE (2026-11-28). PURE.
 *
 * Why it broke: the first-owed memory lived only in the fleet process, and
 * the fleet restarts at every release (every 3 hours). A clock kept in memory
 * cannot measure a wait that spans the restart of that memory: on the 1 AM
 * CST release of 2026-11-28 all nine waiting games read 1:05:15 AM, the first
 * cycle after boot, and their true waits were lost exactly when the live
 * check reads them.
 *
 * The heartbeat already carries the memory (detail.variety_owed_since), so
 * the newest beat written before this boot IS the memory of the process that
 * stopped. The fleet reads that one row once at boot and hands it here; the
 * times that pass go to varietyOwedSince as `carried`, which keeps one only
 * for a game owed on the first seating cycle (a game with no occupied table
 * then, as it had none on the stopped process's last beat).
 *
 * Guards. Everything that fails one is ignored, and the game then gets the
 * first-cycle time, which is what every game got before this:
 *   - the beat is at most VARIETY_OWED_CARRY_MAX_AGE_MS old when the first
 *     seating cycle runs, and not from the future;
 *   - the value is a map of game id to a full ISO time;
 *   - a time is not after `nowMs` and not older than
 *     VARIETY_OWED_CARRY_CEILING_MS.
 * This feeds the heartbeat only. No decision reads a first-owed time.
 */
/**
 * The longest stop a wait is believed to have run through. Measured on the
 * ten restarts from 2026-11-26 10 PM to 2026-11-28 1 AM CST: the last beat
 * before the stop to the first beat after it was 431 to 460 seconds. Twenty
 * minutes is 2.6 times the longest, so a slow release still carries, and a
 * stop longer than that (a failed release, an outage) is long enough for the
 * floor to have changed while nothing was watching, so nothing is carried.
 */
export const VARIETY_OWED_CARRY_MAX_AGE_MS = 20 * 60_000;
/**
 * The oldest first-owed time believed. It exists to refuse a nonsense date,
 * not to end real waits: a game owed for longer than this starts its clock
 * again at the release that crosses it.
 */
export const VARIETY_OWED_CARRY_CEILING_MS = 90 * 24 * 60 * 60_000;

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:?\d{2})$/;

export function carriedOwedSince(input: {
  /** The newest heartbeat written before this process booted: its beat_at and
   *  its detail.variety_owed_since, as read. Null: no beat, or the read failed. */
  heartbeat: { beatAt: unknown; owedSince: unknown } | null;
  nowMs: number;
}): Record<string, string> {
  const out: Record<string, string> = {};
  const hb = input.heartbeat;
  if (!hb || typeof hb.beatAt !== 'string' || !ISO_TIME.test(hb.beatAt)) return out;
  const beatMs = Date.parse(hb.beatAt);
  if (!Number.isFinite(beatMs)) return out;
  const age = input.nowMs - beatMs;
  if (!(age >= 0 && age <= VARIETY_OWED_CARRY_MAX_AGE_MS)) return out;
  const map = hb.owedSince;
  if (map === null || typeof map !== 'object' || Array.isArray(map)) return out;
  for (const [game, value] of Object.entries(map as Record<string, unknown>)) {
    if (!game || typeof value !== 'string' || !ISO_TIME.test(value)) continue;
    const ms = Date.parse(value);
    if (!Number.isFinite(ms)) continue;
    if (ms > input.nowMs || ms < input.nowMs - VARIETY_OWED_CARRY_CEILING_MS) continue;
    out[game] = new Date(ms).toISOString();
  }
  return out;
}

/**
 * The reason a beat carries (detail.variety_drain_why): the decision's own
 * reason, plus the cycle states the decision never sees.
 *   withheld        seating withheld this cycle
 *   undecided       an owed cycle that could not read what the decision needs
 *   room_unknown    the cap or the census read failed (treated as fitting,
 *                   never reported as a free slot)
 *   start_admitted  the cap is full but an owed start is already admitted, so
 *                   nothing more is released (review 2026-11-27: this read as
 *                   "room_free" beside cash_room {cap 17, counted 17})
 *   owed_cannot_start  starts are owed, but every owed game's last start
 *                   failed for a reason of its own (drainOwedGames): no slot
 *                   is freed for them (2026-11-27, 7 PM CST seal)
 */
export type VarietyDrainBeatWhy =
  | VarietyDrainWhy
  | 'withheld'
  | 'undecided'
  | 'room_unknown'
  | 'start_admitted'
  | 'owed_cannot_start';

/** PURE. */
export function drainWhyForBeat(input: {
  withheld: boolean;
  owedThisCycle: number;
  /** The owed games the drain may release for (drainOwedGames). */
  owedCapBlocked: number;
  decided: boolean;
  why: VarietyDrainWhy | null;
  room: { cap?: number | null; counted?: number | null } | null;
  anOwedStartAdmitted: boolean;
}): VarietyDrainBeatWhy {
  if (input.withheld) return 'withheld';
  if (input.owedThisCycle === 0) return 'nothing_owed';
  if (input.owedCapBlocked === 0) return 'owed_cannot_start';
  if (!input.decided || !input.why) return 'undecided';
  if (input.why !== 'room_free') return input.why;
  const cap = input.room?.cap ?? null;
  const counted = input.room?.counted ?? null;
  if (cap == null || counted == null) return 'room_unknown';
  if (input.anOwedStartAdmitted && counted >= cap) return 'start_admitted';
  return 'room_free';
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

let publishedDrain: {
  tableIds: readonly string[];
  horses: ReadonlySet<string>;
  atMs: number;
} | null = null;

/**
 * The fleet names the tables it is releasing, once per cycle (or none), with
 * its Horse ids, so the engine's move door can keep Horses off them.
 */
export function publishVarietyDrain(
  tables: string | ReadonlyArray<string> | null,
  nowMs: number,
  horses: ReadonlySet<string> = new Set()
): void {
  const ids = tables === null ? [] : typeof tables === 'string' ? [tables] : [...tables];
  publishedDrain = ids.length > 0 ? { tableIds: ids, horses, atMs: nowMs } : null;
}

/**
 * HorseSessionRotator's question: which table's Horses go home this cycle?
 * A publication older than VARIETY_HOLD_FRESH_MS names nothing: a fleet that
 * has stopped cycling never keeps a table draining.
 */
export function varietyDrainingTables(nowMs: number = Date.now()): readonly string[] {
  if (!publishedDrain) return [];
  const age = nowMs - publishedDrain.atMs;
  return age >= 0 && age < VARIETY_DRAIN_FRESH_MS ? publishedDrain.tableIds : [];
}

/** The first released table (the single-table view). */
export function varietyDrainingTable(nowMs: number = Date.now()): string | null {
  return varietyDrainingTables(nowMs)[0] ?? null;
}

/** Test seam. */
export function __resetVarietyDrain(): void {
  publishedDrain = null;
}
