/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  A GAME THAT FILLS ASKS FOR ITS LINE WHEN IT FILLS (Dan 2026-11-22)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Dan, verbatim: "All games should not be 'full with no waiting lists' in fact
 * there should always be one-seats open if there is no waiting lists ... MAKE
 * SURE THIS FUNCTIONALITY IS FULLY UPDATED AND CORRECTED."
 *
 * HorseLastChair keeps the fleet from buying a game's last chair without a
 * name for the list. A PERSON taking that chair is never refused (a rule about
 * the fleet must not cost anybody a seat), so the game went full with nobody
 * waiting until the next fleet cycle reached it - thirty seconds at best, and
 * never while that cycle was withheld or ran out of time before the table.
 *
 * THE FIX IS IN THE SEAT EVENT. The engine already hears the moment a chair is
 * taken: the player's own client reports its committed buy-in
 * (POST /seat_arrival, state `seated`), and a cash table adopts every new
 * roster at its hand boundary. Either one, when it finds the table full,
 * raises noteCashSeatCommitted; the fleet reads that one game fresh and, when
 * every live table of it is full and nobody is waiting, puts ONE horse on its
 * list straight away. No timer, no sweep: one event, one read, one row.
 *
 * WHICH HORSE. The one the last completed cycle found able to sit in this game
 * (its seating walk's own sittable pool: bankroll, wallet, duty, schedule,
 * every door rule) and that is still free: seated nowhere and not on this
 * list. The planner that chooses it is HorseGameQueue.planHorseQueues itself,
 * so the line obeys exactly the rules of the cycle's own sync: one name per
 * game, two or three comparable lists per horse, regulars first. The pool is
 * at most LINE_CONTEXT_MAX_AGE_MS old; older, nobody is added here and the
 * next cycle decides. Lightning games have no list (owner 2026-10-24) and are
 * never touched; an unread Lightning set adds nobody.
 *
 * A horse joining a list is the horse's input device (CLAUDE.md 10.5): the tap
 * a person makes on Join The Waiting List, the same row and the same FIFO.
 *
 * Pure: no clock, no reads, no writes. HorseFleetManager owns the wiring.
 *
 * NEVER refer to the horses as "bots" - they are HORSES only.
 */
import { fullGameWaitTarget } from './HorseBehavior.js';
import { planHorseQueues, type HorseQueueGameInfo, type QueuedHorseRow } from './HorseGameQueue.js';

/** The last completed cycle's answer to "who could sit in which game". */
export interface LineContext {
  builtAt: number;
  /** Horse ids the seating walk found sittable at a table of each game. */
  poolByGame: ReadonlyMap<string, readonly string[]>;
  /** Horses seated anywhere at the end of that cycle. */
  seatedAnywhere: ReadonlySet<string>;
  /** Variant and big blind of every game that cycle saw. */
  gameInfo: ReadonlyMap<string, HorseQueueGameInfo>;
  /** Games switched off that cycle. */
  disabledGameIds: ReadonlySet<string>;
}

/** Older than this, the pool is not trusted for a new name; the cycle decides. */
export const LINE_CONTEXT_MAX_AGE_MS = 3 * 60_000;

export interface ArrivalTable {
  id: string;
  lifecycle?: unknown;
  status?: unknown;
  is_deleted?: unknown;
  max_players?: unknown;
}

/**
 * PURE. Is this game full with nobody waiting? Every live or opening table of
 * it is full (a breaking or closed table gives nobody a chair and is not part
 * of the question), and nobody, person or horse, is waiting or holding a call.
 */
export function fullWithNobodyWaiting(input: {
  tables: ReadonlyArray<ArrivalTable>;
  seatedAt: (tableId: string) => number;
  namesOnList: number;
}): boolean {
  if (input.namesOnList > 0) return false;
  const live = input.tables.filter(
    (t) =>
      !t.is_deleted &&
      (t.lifecycle === 'live' || t.lifecycle === 'opening') &&
      t.status !== 'closed'
  );
  if (live.length === 0) return false;
  return live.every((t) => {
    const max = Math.floor(Number(t.max_players) || 0);
    return max > 0 && input.seatedAt(String(t.id)) >= max;
  });
}

/**
 * PURE. The one name to put on this game's list now, or null.
 *
 * `otherRows` are the candidates' own waiting rows on OTHER games, so the
 * planner can keep each horse within its two or three comparable lists.
 */
export function lineOnArrival(input: {
  gameId: string;
  tables: ReadonlyArray<ArrivalTable>;
  seatedByTable: ReadonlyMap<string, ReadonlySet<string>>;
  namesOnList: number;
  otherRows: readonly QueuedHorseRow[];
  context: LineContext | null;
  lightningGames: ReadonlySet<string> | null;
  nowMs: number;
  onDuty?: (horseId: string) => boolean;
}): { game_id: string; user_id: string } | null {
  const ctx = input.context;
  if (
    !ctx ||
    !(input.nowMs - ctx.builtAt >= 0 && input.nowMs - ctx.builtAt <= LINE_CONTEXT_MAX_AGE_MS)
  )
    return null;
  if (input.lightningGames === null || input.lightningGames.has(input.gameId)) return null;
  if (ctx.disabledGameIds.has(input.gameId)) return null;
  const seatedAt = (id: string) => input.seatedByTable.get(id)?.size ?? 0;
  if (!fullWithNobodyWaiting({ tables: input.tables, seatedAt, namesOnList: input.namesOnList }))
    return null;

  const seatedHere = new Set<string>();
  for (const s of input.seatedByTable.values()) for (const id of s) seatedHere.add(id);
  const seatedAnywhere = new Set<string>([...ctx.seatedAnywhere, ...seatedHere]);
  const live = input.tables.filter((t) => t.lifecycle === 'live' || t.lifecycle === 'opening');
  const first = live[0];
  const info = ctx.gameInfo.get(input.gameId);
  const plan = planHorseQueues({
    asks: [
      {
        gameId: input.gameId,
        waitTarget: fullGameWaitTarget(
          String(first?.id ?? input.gameId),
          Math.floor(Number(first?.max_players) || 0),
          input.nowMs
        ),
        /* The pool is up to LINE_CONTEXT_MAX_AGE_MS old: a horse seated since,
           or whose shift ended since, is not a waiter now. */
        pool: (ctx.poolByGame.get(input.gameId) ?? []).filter(
          (id) => !seatedAnywhere.has(id) && (!input.onDuty || input.onDuty(id))
        ),
        variant: info?.variant,
        bigBlind: info?.bigBlind,
      },
    ],
    tables: live.map((t) => ({
      gameId: input.gameId,
      maxPlayers: Math.floor(Number(t.max_players) || 0),
      seated: seatedAt(String(t.id)),
    })),
    rows: input.otherRows.filter((r) => r.game_id !== input.gameId),
    excludedGameIds: new Set<string>(),
    humanWaitingGameIds: new Set<string>(),
    seatedByGame: new Map([[input.gameId, seatedHere]]),
    nowMs: input.nowMs,
    gameInfo: ctx.gameInfo,
    seatedAnywhere,
    onDuty: input.onDuty,
  });
  return plan.add.find((a) => a.game_id === input.gameId) ?? null;
}
