import { createHash } from 'node:crypto';
import { ploContinuationFor, type PloLightningDemand } from './PloLightningDemand.js';
import { secondTablePicked } from './HorseBehavior.js';
import plan from './horseUnionCashPlan.json' with { type: 'json' };
import { horseCashGameAllowed } from './HorseCashSchedule.js';

/** Maintained cash floor. One primary per game; selected games grow to two or three tables.
 * November 11 relaunch (owner): every plan game is scheduled around the clock
 * with no restriction on how many games are open at once, the 1/2 Holdem and
 * PLO games run full time again, and the weekly target is tripled.
 * No fee, wallet, human admission, tournament or Diamond policy changes.
 * A target is a forecast, not a hard ceiling on human-generated rake.
 */
export const HORSE_UNION_CASH_PLAN = plan;
export const HORSE_UNION_CASH_PLAN_START_MS = Date.parse('2026-11-04T06:00:00Z');
const windows = plan.windows as Record<string, { regular: number[]; weekend: number[] }>;
const games = new Map(plan.games.map((game) => [game.id, game]));
/** Lightning games horses start on their own (Dan 2026-11-05). */
export const LIGHTNING_HORSE_SEEDED: ReadonlySet<string> = new Set(
  (plan as { lightningHorseSeeded?: Array<{ id: string }> }).lightningHorseSeeded?.map(
    (game) => game.id
  ) ?? []
);
/**
 * A SEEDED LIGHTNING GAME STARTS FIRST (Dan 2026-11-13 14:56 Chicago).
 *
 * "THE 1/2 HORSES NEED TO BE PLAYING THE 1/2 LIGHTNING FOR HOLDEM AND PLO AND
 * WE NEED TO GET THE .50/1.00 LIGHTNING RUNNING FOR HOLDEM AND PLO."
 *
 * Being allowed to sit is not the same as being seated. The seeding walk
 * ranks an occupied Main 1 ahead of an empty one and every feeder last, and
 * since the player curve became a seat ceiling the walk stops when the host
 * is at it. Measured 15:10 Chicago: Lightning PLO4 .50/1 held one table, a
 * feeder, so it stood behind every other chair on the floor, and the four
 * seeded Main 1 tables stood behind every occupied Main 1.
 *
 * Until a horse-seeded Lightning game holds one full ring, ONE of its tables
 * (the fullest, then a Main before a feeder, then the lowest id) is seated
 * ahead of the ordinary order, beside an opening feeder. One table, so the
 * game forms one full ring that can turn into Lightning rather than several
 * thin feeders. The seat ceiling, the work schedule, bankroll and every other
 * admission rule still apply: this changes the order only.
 */
export const LIGHTNING_STARTER_PLAYERS = 6;
export function lightningStarterTables(
  tables: ReadonlyArray<CashPlanTable>,
  seatedAt: (tableId: string) => number,
  seeded: ReadonlySet<string> = LIGHTNING_HORSE_SEEDED
): ReadonlySet<string> {
  const count = (t: CashPlanTable): number => {
    const n = seatedAt(String(t.id ?? ''));
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const byGame = new Map<string, CashPlanTable[]>();
  for (const t of tables) {
    if (typeof t.id !== 'string' || typeof t.cluster_id !== 'string') continue;
    if (!seeded.has(t.cluster_id)) continue;
    if (t.lifecycle === 'closed' || t.lifecycle === 'breaking') continue;
    const list = byGame.get(t.cluster_id) ?? [];
    list.push(t);
    byGame.set(t.cluster_id, list);
  }
  const out = new Set<string>();
  for (const list of byGame.values()) {
    const total = list.reduce((sum, t) => sum + count(t), 0);
    if (total >= LIGHTNING_STARTER_PLAYERS) continue;
    const first = [...list].sort(
      (a, b) =>
        count(b) - count(a) ||
        Number(a.role !== 'main') - Number(b.role !== 'main') ||
        Number(a.main_index ?? 999) - Number(b.main_index ?? 999) ||
        String(a.id).localeCompare(String(b.id))
    )[0];
    if (first) out.add(String(first.id));
  }
  return out;
}

const chicagoClock = new Intl.DateTimeFormat('en-US', {
  timeZone: plan.timeZone,
  weekday: 'short',
  hour: 'numeric',
  hourCycle: 'h23',
});

export type CashPlanTable = {
  id?: unknown;
  club_id?: unknown;
  union_id?: unknown;
  tournament_id?: unknown;
  is_spins?: unknown;
  cluster_id?: unknown;
  role?: unknown;
  main_index?: unknown;
  game_variant?: unknown;
  small_blind?: unknown;
  big_blind?: unknown;
  lifecycle?: unknown;
  last_human_seen_at?: unknown;
};

/** Main numbering is not unique in the database. Select one stable chair
 * group per game from the caller's complete floor read, including drifted
 * duplicate Main 1 rows. The rotator converges through normal departures.
 */
export function horseCashPlanPrimaryTables(
  tables: ReadonlyArray<CashPlanTable>
): ReadonlySet<string> {
  const chosen = new Map<string, string>();
  for (const table of tables) {
    if (
      table.role !== 'main' ||
      Number(table.main_index) !== 1 ||
      table.lifecycle === 'closed' ||
      table.lifecycle === 'breaking' ||
      typeof table.id !== 'string' ||
      typeof table.cluster_id !== 'string'
    )
      continue;
    const current = chosen.get(table.cluster_id);
    if (current === undefined || table.id < current) chosen.set(table.cluster_id, table.id);
  }
  return new Set(chosen.values());
}

export function scheduledHorseCashGames(nowMs: number): ReadonlySet<string> {
  if (!Number.isFinite(nowMs)) return new Set();
  const parts = chicagoClock.formatToParts(new Date(nowMs));
  const hour = Number(parts.find((part) => part.type === 'hour')?.value);
  const day = parts.find((part) => part.type === 'weekday')?.value;
  const weekend = day === 'Fri' || day === 'Sat';
  return new Set(
    plan.games
      .filter((game) => {
        const [start, end] = windows[game.window][weekend ? 'weekend' : 'regular'];
        // A window whose start is after its end runs through midnight
        // (Dan 2026-11-05: Classic 1/2 runs 9 AM to 4 AM). Equal ends never run.
        return start > end ? hour >= start || hour < end : hour >= start && hour < end;
      })
      .map((game) => game.id)
  );
}

/** Only an occupied, playing human chair satisfies the higher-stakes exception.
 * A spectator, waiting list, sitting-out player or departing seat does not.
 * Stack zero can still be a human all-in in the current hand.
 */
export function playingHumansAtCashTable(
  seats: ReadonlyArray<{ user_id: string; is_sitting_out?: unknown; leave_pending?: unknown }>,
  horseIds: ReadonlySet<string>
): number {
  return seats.filter(
    (seat) =>
      !!seat.user_id &&
      !horseIds.has(seat.user_id) &&
      seat.is_sitting_out !== true &&
      seat.leave_pending !== true
  ).length;
}

/** A GAME DOES NOT BREAK RIGHT AWAY AFTER A HUMAN LEAVES (Dan 2026-11-11:
 * "GAMES SHOULD NEVER BREAK RIGHT AWAY AFTER A HUMAN LEAVES... 20-30 MINUTE
 * MINIMUM TIME TO BREAK A GAME"). The plan remembers, per table, when it last
 * saw a playing human; for that table's own 20-30 minute dwell after the last
 * one leaves, the higher-stakes human exception stays granted, so the horses
 * play on and the fleet keeps seating instead of the table emptying on the
 * cycle after a departure. Deterministic per table so the floor does not
 * break every game on one clock. The memory is in-process: a restart forgets
 * it, which only shortens the dwell across a deploy, never play itself. */
export const HUMAN_DEPARTURE_DWELL_MIN_MINUTES = 20;
export const HUMAN_DEPARTURE_DWELL_MAX_MINUTES = 30;
const lastPlayingHumanSeenMs = new Map<string, number>();

export function humanDepartureDwellMinutes(tableId: string): number {
  const hex = createHash('md5').update(`${tableId}:human_departure_dwell`).digest('hex');
  const span = HUMAN_DEPARTURE_DWELL_MAX_MINUTES - HUMAN_DEPARTURE_DWELL_MIN_MINUTES + 1;
  return HUMAN_DEPARTURE_DWELL_MIN_MINUTES + (parseInt(hex.slice(0, 8), 16) % span);
}

export function notePlayingHumansSeen(tableId: string, nowMs: number): void {
  if (!tableId || !Number.isFinite(nowMs)) return;
  const prior = lastPlayingHumanSeenMs.get(tableId);
  if (prior === undefined || nowMs > prior) lastPlayingHumanSeenMs.set(tableId, nowMs);
  if (lastPlayingHumanSeenMs.size > 5000) {
    for (const [id, seen] of lastPlayingHumanSeenMs) {
      if (nowMs - seen > 6 * 3_600_000) lastPlayingHumanSeenMs.delete(id);
    }
  }
}

/** The engine's memory OR the table row's own durable stamp
 * (tables.last_human_seen_at, written by the seat-event trigger), whichever
 * is later - so a restart, reconnect or table transfer cannot erase or
 * shorten the dwell. */
export function lastPlayingHumanSeenMsFor(table: CashPlanTable): number | null {
  const mem = lastPlayingHumanSeenMs.get(String(table.id ?? ''));
  const raw = table.last_human_seen_at;
  const persisted =
    typeof raw === 'string' ? Date.parse(raw) : raw instanceof Date ? raw.getTime() : NaN;
  const best = Math.max(
    mem ?? Number.NEGATIVE_INFINITY,
    Number.isFinite(persisted) ? persisted : Number.NEGATIVE_INFINITY
  );
  return Number.isFinite(best) ? best : null;
}

export function minutesSinceLastPlayingHumanFor(
  table: CashPlanTable,
  nowMs: number
): number | null {
  const seen = lastPlayingHumanSeenMsFor(table);
  return seen === null || !Number.isFinite(nowMs) ? null : (nowMs - seen) / 60000;
}

export function withinHumanDepartureDwellFor(table: CashPlanTable, nowMs: number): boolean {
  const minutes = minutesSinceLastPlayingHumanFor(table, nowMs);
  return (
    minutes !== null && minutes >= 0 && minutes < humanDepartureDwellMinutes(String(table.id ?? ''))
  );
}

/** Tests only: the dwell memory is module state. */
export function resetHumanPresenceMemoryForTest(): void {
  lastPlayingHumanSeenMs.clear();
}

/** LIGHTNING GAMES ALWAYS RUN (Dan 2026-11-05): "lightning tables must always
 * run, they are feeder games until enough players are playing, then they turn
 * to lightning games ONLY WHEN THERE IS ENOUGH PLAYERS. there should never be
 * a on off timer for these games! ever!!" Every table of a Lightning-enabled
 * Cluster (cash_games.lightning_enabled), Main or Feeder, is outside the
 * clock schedule. The Cluster controller alone decides feeder versus
 * Lightning by player count. Forbidden variants and the stake ceiling still
 * apply; they are not a timer.
 */
export function horseUnionCashTableAllowed(
  table: CashPlanTable,
  playingHumans: number,
  nowMs: number,
  primaryTables: ReadonlySet<string>,
  lightningGames: ReadonlySet<string> | null = null,
  lightningHumanGames: ReadonlySet<string> | null = null,
  secondTables: ReadonlySet<string> | null = null,
  existingSeat = false,
  continuation: PloLightningDemand | null = null
): boolean {
  if (table.tournament_id != null || table.is_spins === true) return true;
  /* A GAME'S SECOND TABLE (Dan 2026-11-06: "THERE SHOULD BE SOME GAMES WITH
     TWO TABLES RUNNING"). The cluster tick opens it only when every seat of a
     game is taken and allows up to three tables per Classic game; it inherits its
     Main 1's answer, computed by horseCashPlanSecondTables. Forbidden variants
     and the stake ceiling still apply. */
  if (
    secondTables !== null &&
    secondTables.has(String(table.id ?? '')) &&
    Number.isFinite(nowMs) &&
    horseCashGameAllowed(table, nowMs)
  ) {
    return true;
  }
  if (table.union_id !== plan.unionId && table.club_id !== plan.unionId) return true;
  if (!Number.isFinite(nowMs)) return false;
  if (nowMs < HORSE_UNION_CASH_PLAN_START_MS) return true;
  // The human exception never overrides forbidden variants or the stake ceiling.
  if (!horseCashGameAllowed(table, nowMs)) return false;
  // LIGHTNING (Dan 2026-11-05): "THERE IS NO CAP OR CLOCK THAT SHOULD BE
  // WATCHING THIS, JUST HAVE AND LAUNCH FEWER LIGHTNING GAMES ... NO
  // LIGHTNING GAMES GET STARTED BY HORSES IN A FEW GAMES STAKES, UNLESS HUMANS
  // SIT DOWN, IF A HUMAN SITS DOWN, THEN MORE HORSES CAN SIT AS WELL". Every
  // Lightning game stays enabled and open to people. Horses START only the
  // plan's `lightningHorseSeeded` games, at any hour and on any table. Every
  // other Lightning game is started by a person: while one is playing at any
  // of its tables, horses may sit at any of them; when none is, horses do not
  // seed it. No per-game cap and no clock.
  if (lightningGames !== null && lightningGames.has(String(table.cluster_id ?? ''))) {
    const gameId = String(table.cluster_id ?? '');
    // November 9: a person starts 1/2 PLO; their departure never ends the
    // other participants' sessions. Admission still needs demand. Existing
    // bankroll, session and safe table-boundary exits retain their authority.
    if (existingSeat && gameId === 'c79d8ec2-2281-411d-b4e1-42b5610849e2') return true;
    if (ploContinuationFor(gameId, continuation)) return true;
    if (LIGHTNING_HORSE_SEEDED.has(gameId)) return true;
    return lightningHumanGames !== null && lightningHumanGames.has(gameId);
  }
  const tableKey = String(table.id ?? '');
  if (Number.isFinite(playingHumans) && playingHumans > 0) notePlayingHumansSeen(tableKey, nowMs);
  const higherStakes = Number(table.small_blind) > 0.5 || Number(table.big_blind) > 1;
  if (higherStakes && Number.isFinite(playingHumans) && playingHumans > 0) return true;
  // The human exception outlives the last playing human by this table's own
  // 20-30 minute dwell (Dan 2026-11-11): a game never breaks right away
  // after a human leaves.
  if (higherStakes && withinHumanDepartureDwellFor(table, nowMs)) return true;
  const gameId = String(table.cluster_id ?? '');
  const game = games.get(gameId);
  // Named game and Main 1 prevent the fleet multiplying a slot into feeders
  // or duplicate mains. Lower-stakes scheduled games need no human present.
  return (
    !!game &&
    table.game_variant === game.variant &&
    Number(table.small_blind) === game.smallBlind &&
    Number(table.big_blind) === game.bigBlind &&
    table.role === 'main' &&
    Number(table.main_index) === 1 &&
    primaryTables.has(String(table.id ?? '')) &&
    scheduledHorseCashGames(nowMs).has(gameId)
  );
}

/** Secondary tables inherit their primary's admission policy.
 *
 * ZERO RESTRICTIONS ON THE GAMES THAT CAN BE OPEN (Dan 2026-11-11): every live
 * or opening secondary table (feeder, Main 2 and up) of a game is admitted
 * whenever its Main 1 is, Classic and Lightning alike; the second/third-table
 * picks were the retired rake throttle and migration 20261112154904 removes
 * every count cap from the tick. How many tables exist is the tick's OPEN rule
 * (demand) alone. Only while the Lightning set is unknown (null) is the
 * previous single pick-gated secondary kept, so an unread pool is never fed
 * blind. Stable
 * main/feeder ordering prevents duplicate rows multiplying the allowance. */
export function horseCashPlanSecondTables(
  tables: ReadonlyArray<CashPlanTable>,
  primaryTables: ReadonlySet<string>,
  primaryAllowed: (primary: CashPlanTable) => boolean,
  nowMs: number = Date.now(),
  lightningGames: ReadonlySet<string> | null = new Set()
): ReadonlySet<string> {
  const primaryByGame = new Map<string, CashPlanTable>();
  for (const t of tables) {
    if (typeof t.id === 'string' && primaryTables.has(t.id) && typeof t.cluster_id === 'string')
      primaryByGame.set(t.cluster_id, t);
  }
  const chosen = new Map<string, CashPlanTable[]>();
  for (const t of tables) {
    if (typeof t.id !== 'string' || typeof t.cluster_id !== 'string') continue;
    if (primaryTables.has(t.id)) continue;
    if (t.lifecycle !== 'live' && t.lifecycle !== 'opening') continue;
    if (!(t.role === 'feeder' || (t.role === 'main' && Number(t.main_index) >= 2))) continue;
    const current = chosen.get(t.cluster_id) ?? [];
    current.push(t);
    chosen.set(t.cluster_id, current);
  }
  const out = new Set<string>();
  for (const [gameId, candidates] of chosen) {
    const primary = primaryByGame.get(gameId);
    if (!primary || !primaryAllowed(primary)) continue;
    const known = lightningGames !== null;
    // Keep established mains ahead of their feeder, with stable tie breaking.
    candidates.sort(
      (a, b) =>
        Number(a.role !== 'main') - Number(b.role !== 'main') ||
        Number(a.main_index ?? 0) - Number(b.main_index ?? 0) ||
        String(a.id).localeCompare(String(b.id))
    );
    if (known) {
      for (const table of candidates) out.add(String(table.id));
      continue;
    }
    // Lightning set unread: only while the game is picked for a second table
    // (HorseBehavior.secondTablePicked), the conservative pre-relaunch rule.
    if (
      secondTablePicked(
        gameId,
        nowMs,
        Number(primary.big_blind) || null,
        typeof primary.game_variant === 'string' ? primary.game_variant : null
      )
    )
      out.add(String(candidates[0].id));
  }
  return out;
}

/**
 * A TABLE THE CLUSTER TICK BREAKS IS NOT WALKED OUT OF (owner 2026-11-07).
 *
 * When a game stops being picked for a second table, horseCashPlanSecondTables
 * drops that table and the rotator used to stand every horse at it up in the
 * same pass - the table emptied at once, as if everybody quit together. The
 * cluster tick now BREAKS such a table the way a card room does
 * (20261107195847): 'table_break_started', then 'break' moves onto open chairs
 * in roster order, the same notice people get, and anyone without a chair
 * stays dealt in and is first for the next one.
 *
 * So a horse at a table of a game horses may play (its Main 1 is allowed), a
 * table that is not the Main 1 and is live, opening or already breaking,
 * stays seated and is moved by the break. Forbidden variants and the stake
 * ceiling still send it home (horseCashGameAllowed), and Lightning games are
 * never in here (their tables are the Lightning pool). No new leave: a horse
 * held here leaves only through the moves the tick plans (a forced move keeps
 * its stack) or through the ordinary rotation door, engine.leaveTable, which
 * applies the hit-and-run rule to every voluntary leave.
 */
export function horseCashPlanTablesAwaitingBreak(
  tables: ReadonlyArray<CashPlanTable>,
  primaryTables: ReadonlySet<string>,
  primaryAllowed: (primary: CashPlanTable) => boolean,
  lightningGames: ReadonlySet<string> | null,
  nowMs: number = Date.now()
): ReadonlySet<string> {
  const primaryByGame = new Map<string, CashPlanTable>();
  for (const t of tables) {
    if (typeof t.id === 'string' && primaryTables.has(t.id) && typeof t.cluster_id === 'string')
      primaryByGame.set(t.cluster_id, t);
  }
  const allowedGame = new Map<string, boolean>();
  const out = new Set<string>();
  for (const t of tables) {
    if (typeof t.id !== 'string' || typeof t.cluster_id !== 'string') continue;
    if (primaryTables.has(t.id)) continue;
    if (lightningGames === null || lightningGames.has(t.cluster_id)) continue;
    if (t.lifecycle !== 'live' && t.lifecycle !== 'opening' && t.lifecycle !== 'breaking') continue;
    if (!Number.isFinite(nowMs) || !horseCashGameAllowed(t, nowMs)) continue;
    const primary = primaryByGame.get(t.cluster_id);
    if (!primary) continue;
    let ok = allowedGame.get(t.cluster_id);
    if (ok === undefined) {
      ok = primaryAllowed(primary);
      allowedGame.set(t.cluster_id, ok);
    }
    if (ok) out.add(t.id);
  }
  return out;
}

/** The Lightning games in which a person is playing right now, at any of
 * their tables (a seat is the Lightning pool's anchor, so a pooled person is
 * counted here too). Sitting-out and departing chairs do not start a game.
 * Every table of a game must be in `tables` for its answer to be complete. */
export function lightningGamesWithPlayingHumans(
  tables: ReadonlyArray<{ id?: unknown; cluster_id?: unknown }>,
  seatsByTable: ReadonlyMap<
    string,
    ReadonlyArray<{ user_id: string; is_sitting_out?: unknown; leave_pending?: unknown }>
  >,
  horseIds: ReadonlySet<string>,
  lightningGames: ReadonlySet<string> | null
): ReadonlySet<string> | null {
  if (lightningGames === null) return null;
  const started = new Set<string>();
  for (const table of tables) {
    const gameId = String(table.cluster_id ?? '');
    if (!gameId || !lightningGames.has(gameId) || started.has(gameId)) continue;
    const seats = seatsByTable.get(String(table.id ?? '')) ?? [];
    if (playingHumansAtCashTable(seats, horseIds) > 0) started.add(gameId);
  }
  return started;
}
