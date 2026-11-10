import { ploContinuationFor, type PloLightningDemand } from './PloLightningDemand.js';
import { secondTablePicked } from './HorseBehavior.js';
import plan from './horseUnionCashPlan.json' with { type: 'json' };
import { horseCashGameAllowed } from './HorseCashSchedule.js';

/** Maintained cash floor, November 4 owner direction. One Main 1 per game.
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
     game is taken and allows at most two tables per game; it inherits its
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
  const higherStakes = Number(table.small_blind) > 0.5 || Number(table.big_blind) > 1;
  if (higherStakes && Number.isFinite(playingHumans) && playingHumans > 0) return true;
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

/**
 * The second table of each game whose Main 1 horses may sit at (Dan
 * 2026-11-06). At most ONE per game - a feeder or a Main 2, live or opening,
 * lowest id - so the fleet can never multiply a slot past the two tables the
 * cluster tick allows. `primaryAllowed` is the caller's own answer for the
 * game's Main 1, so the second table follows it exactly, and only while the
 * game is picked for a second table (secondTablePicked).
 */
export function horseCashPlanSecondTables(
  tables: ReadonlyArray<CashPlanTable>,
  primaryTables: ReadonlySet<string>,
  primaryAllowed: (primary: CashPlanTable) => boolean,
  nowMs: number = Date.now()
): ReadonlySet<string> {
  const primaryByGame = new Map<string, CashPlanTable>();
  for (const t of tables) {
    if (typeof t.id === 'string' && primaryTables.has(t.id) && typeof t.cluster_id === 'string')
      primaryByGame.set(t.cluster_id, t);
  }
  const chosen = new Map<string, string>();
  for (const t of tables) {
    if (typeof t.id !== 'string' || typeof t.cluster_id !== 'string') continue;
    if (primaryTables.has(t.id)) continue;
    if (t.lifecycle !== 'live' && t.lifecycle !== 'opening') continue;
    if (!(t.role === 'feeder' || (t.role === 'main' && Number(t.main_index) === 2))) continue;
    const current = chosen.get(t.cluster_id);
    if (current === undefined || t.id < current) chosen.set(t.cluster_id, t.id);
  }
  const out = new Set<string>();
  for (const [gameId, tableId] of chosen) {
    const primary = primaryByGame.get(gameId);
    // Only while the game is picked for two tables (the tick's own rule,
    // HorseBehavior.secondTablePicked); once it is not, the second table's
    // horses leave through the rotator and must-move empties the rest.
    if (
      primary &&
      secondTablePicked(
        gameId,
        nowMs,
        Number(primary.big_blind) || null,
        typeof primary.game_variant === 'string' ? primary.game_variant : null
      ) &&
      primaryAllowed(primary)
    )
      out.add(tableId);
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
