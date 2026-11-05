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
        return hour >= start && hour < end;
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

export function horseUnionCashTableAllowed(
  table: CashPlanTable,
  playingHumans: number,
  nowMs: number,
  primaryTables: ReadonlySet<string>
): boolean {
  if (table.tournament_id != null || table.is_spins === true) return true;
  if (table.union_id !== plan.unionId && table.club_id !== plan.unionId) return true;
  if (!Number.isFinite(nowMs)) return false;
  if (nowMs < HORSE_UNION_CASH_PLAN_START_MS) return true;
  // The human exception never overrides forbidden variants or the stake ceiling.
  if (!horseCashGameAllowed(table, nowMs)) return false;
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
