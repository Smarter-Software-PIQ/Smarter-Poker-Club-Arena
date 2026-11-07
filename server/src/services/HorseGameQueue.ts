/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  HORSES STAND IN LINE AGAIN (Dan 2026-11-06)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Dan, verbatim: "HORSES SHOULD BE ON THE WAITING LIST... IT LOOKS FAKE WHEN
 * THERE ARE THE EXACT MAX AMOUNT OF PLAYERS ON EVERY GAME, AND ZERO PLAYERS ON
 * THE WAITING LIST."
 *
 * This reverses the 2026-09-02 "horses do not queue" rule for the GAME list
 * (`cash_game_waitlist`, the list a lobby row's Join door writes) and only
 * there. Table lists stay horse-free (pruneHorseWaitlist), so nothing about
 * how a table's own offer works changes.
 *
 * The 2026-08-26 lesson still binds: a queue behind open seats is a visible
 * lie ("Waiting 54" beside an OPEN seat map). So a game carries a horse queue
 * ONLY while every live table in it is full, and only on the FULL shape of
 * occupancyTargetFor. The queue is short (1-4), grows one arrival per game per
 * cycle the way people walk up to a list, and each horse gives up after a
 * while, so the names rotate.
 *
 * A human on the list empties the horse queue for that game (waitTarget is 0
 * whenever a human waits), so a person is never stuck behind horses that were
 * only there for show.
 *
 * Pure planning lives here; HorseFleetManager.syncHorseGameQueues does the
 * one read and the writes.
 */
import { horseHash, mix32 } from './HorseBehavior.js';

/** One full cluster table's ask, from the seeding loop. */
export interface HorseQueueAsk {
  gameId: string;
  waitTarget: number;
  /** Horses that could sit at this table this cycle (the loop's pool). */
  pool: readonly string[];
}

/** A live table of a cluster game, for the everything-is-full check. */
export interface QueueGameTable {
  gameId: string;
  maxPlayers: number;
  seated: number;
}

export interface QueuedHorseRow {
  id: string;
  game_id: string;
  user_id: string;
  created_at: string;
}

export interface HorseQueuePlan {
  /** Rows to mark 'cancelled' (the horse left the line). */
  cancel: string[];
  /** Rows to insert as 'waiting'. */
  add: Array<{ game_id: string; user_id: string }>;
}

/** How long a horse stays in line before it gives up, 25 to 55 minutes. */
export function queuePatienceMs(rowId: string): number {
  return (25 + (mix32(horseHash(`${rowId}:patience`)) % 31)) * 60_000;
}

/**
 * PURE. What the horse queues should look like after this cycle.
 *
 * - desired per game = the largest waitTarget asked for it, but ZERO unless
 *   every live table of the game is full, the game is not excluded (Lightning:
 *   "THERE SHOULDN'T BE A WAITING LIST", Dan 2026-10-24; disabled games), and
 *   no human is waiting on it.
 * - rows beyond desired are cancelled newest first, so the head of the line
 *   holds still; rows past their patience are cancelled too.
 * - at most ONE new horse per game per cycle, chosen from the asking tables'
 *   pools, never a horse already seated in that game, never a horse already in
 *   any game's line.
 */
export function planHorseQueues(input: {
  asks: readonly HorseQueueAsk[];
  tables: readonly QueueGameTable[];
  rows: readonly QueuedHorseRow[];
  excludedGameIds: ReadonlySet<string>;
  humanWaitingGameIds: ReadonlySet<string>;
  seatedByGame: ReadonlyMap<string, ReadonlySet<string>>;
  nowMs: number;
}): HorseQueuePlan {
  const allFull = new Map<string, boolean>();
  for (const t of input.tables) {
    const full = t.maxPlayers > 0 && t.seated >= t.maxPlayers;
    allFull.set(t.gameId, (allFull.get(t.gameId) ?? true) && full);
  }

  const desired = new Map<string, number>();
  const pools = new Map<string, string[]>();
  for (const a of input.asks) {
    if (!a.gameId || a.waitTarget <= 0) continue;
    desired.set(a.gameId, Math.max(desired.get(a.gameId) ?? 0, Math.floor(a.waitTarget)));
    const p = pools.get(a.gameId) ?? [];
    p.push(...a.pool);
    pools.set(a.gameId, p);
  }
  const wantFor = (gameId: string): number => {
    if (input.excludedGameIds.has(gameId)) return 0;
    if (input.humanWaitingGameIds.has(gameId)) return 0;
    if (allFull.get(gameId) !== true) return 0;
    return desired.get(gameId) ?? 0;
  };

  const cancel: string[] = [];
  const byGame = new Map<string, QueuedHorseRow[]>();
  const queued = new Set<string>();
  for (const r of input.rows) {
    const created = Date.parse(r.created_at);
    if (Number.isFinite(created) && input.nowMs - created >= queuePatienceMs(r.id)) {
      cancel.push(r.id);
      continue;
    }
    // One line at a time: a second row for a horse already queued goes.
    if (queued.has(r.user_id)) {
      cancel.push(r.id);
      continue;
    }
    queued.add(r.user_id);
    const list = byGame.get(r.game_id) ?? [];
    list.push(r);
    byGame.set(r.game_id, list);
  }

  // Games the loop knows about and games that already hold a horse line.
  const games = new Set<string>([...allFull.keys(), ...byGame.keys()]);
  const add: Array<{ game_id: string; user_id: string }> = [];
  for (const gameId of games) {
    // A game this cycle did not see (no live table in it) keeps its rows
    // untouched rather than being judged on nothing.
    if (!allFull.has(gameId)) continue;
    const want = wantFor(gameId);
    const list = (byGame.get(gameId) ?? []).sort(
      (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)
    );
    if (list.length > want) {
      for (const r of list.slice(want)) cancel.push(r.id);
      continue;
    }
    if (list.length === want) continue;
    const seated = input.seatedByGame.get(gameId) ?? new Set<string>();
    const pool = [...new Set(pools.get(gameId) ?? [])]
      .filter((id) => !seated.has(id) && !queued.has(id))
      .sort(
        (a, b) =>
          mix32(horseHash(`${a}:${gameId}:${Math.floor(input.nowMs / 60_000)}`)) -
          mix32(horseHash(`${b}:${gameId}:${Math.floor(input.nowMs / 60_000)}`))
      );
    const pick = pool[0];
    if (!pick) continue;
    queued.add(pick);
    add.push({ game_id: gameId, user_id: pick });
  }
  return { cancel, add };
}
