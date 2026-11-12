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
 * ONLY while every live table in it is full, independent of its desired
 * occupancy shape. The queue is short (up to five), grows one arrival per game per
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
import { homeQueueRank } from './HorseRegulars.js';

/** One full cluster table's ask, from the seeding loop. */
export interface HorseQueueAsk {
  gameId: string;
  waitTarget: number;
  /** Horses that could sit at this table this cycle (the loop's pool). */
  pool: readonly string[];
  /** The game's variant and big blind, so its regulars stand in its line first. */
  variant?: unknown;
  bigBlind?: unknown;
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

/** What makes two games "the same game at nearby stakes" for a list. */
export interface HorseQueueGameInfo {
  variant: string | null;
  bigBlind: number | null;
}

/** How long a horse stays in line before it gives up, 25 to 55 minutes. */
export function queuePatienceMs(rowId: string): number {
  return (25 + (mix32(horseHash(`${rowId}:patience`)) % 31)) * 60_000;
}

/* ── SEVERAL LISTS AT ONCE (owner 2026-11-07) ────────────────────────────────
   "Real players join the lists for two or three games at a time and drop the
   others once seated." People already can: cash_game_waitlist_one_open is
   unique per (game, player) and nothing caps how many games a person lists
   for (fn_cash_game_join inserts one row per game). A horse now does the same,
   inside the same rules: one row per game (the index refuses a second), at
   most two or three games, and only games a player would list together - the
   same variant family at nearby stakes. */

/** Lists a horse will put its name on at once: two or three, fixed per horse. */
export function horseListCap(horseId: string): number {
  return 2 + (mix32(horseHash(`${horseId}:lists`)) % 2);
}

/** PLO4/5/6 are one pot-limit Omaha family; every other variant is its own. */
export function variantFamily(variant: string | null | undefined): string | null {
  const v = String(variant ?? '')
    .trim()
    .toLowerCase();
  if (!v) return null;
  if (v === 'plo' || v === 'plo4' || v === 'plo5' || v === 'plo6') return 'omaha';
  return v;
}

/** Nearby stakes: the bigger big blind is at most twice the smaller. */
export const LIST_STAKES_RATIO = 2;

/** Would a player list for both of these games at once? Unknown is "no". */
export function comparableGames(
  a: HorseQueueGameInfo | undefined,
  b: HorseQueueGameInfo | undefined
): boolean {
  if (!a || !b) return false;
  const fa = variantFamily(a.variant);
  if (fa === null || fa !== variantFamily(b.variant)) return false;
  const x = Number(a.bigBlind);
  const y = Number(b.bigBlind);
  if (!(x > 0) || !(y > 0) || !Number.isFinite(x) || !Number.isFinite(y)) return false;
  return Math.max(x, y) <= LIST_STAKES_RATIO * Math.min(x, y) + 1e-9;
}

/**
 * PURE. What the horse queues should look like after this cycle.
 *
 * - desired per game = the largest waitTarget asked for it while every live
 *   table of the game is full; ZERO when the game is excluded (Lightning:
 *   "THERE SHOULDN'T BE A WAITING LIST", Dan 2026-10-24; disabled games) or a
 *   human is waiting on it.
 * - A NEWLY OPENED TABLE FILLS FROM THE LIST (owner 2026-11-07). A game that
 *   is no longer full (a second table opened, a chair came free) KEEPS its
 *   line and adds nobody: the cluster tick calls those names one at a time,
 *   in list order, through fn_offer_open_seat, and each horse answers its
 *   call (claimOfferedSeats) as a person does. The line used to be cleared
 *   the moment the game had an open chair, so the horses that were waiting
 *   vanished and the fleet filled the new table with others all at once.
 * - rows beyond desired are cancelled newest first, so the head of the line
 *   holds still; rows past their patience are cancelled too.
 * - SEVERAL LISTS: a horse holds rows on up to horseListCap games, all of them
 *   comparable (comparableGames). A row past the cap or for an incomparable
 *   game is cancelled, oldest kept.
 * - SEATED ANYWHERE, IT LEAVES ITS OTHER LISTS: a horse seated at any table
 *   leaves the lists of every other game now (the same row change a person's
 *   fn_cash_game_leave_waitlist makes). The row of the game it sat in is left
 *   for the tick, which marks it 'seated'. A seated horse joins no list.
 * - at most ONE new horse per game per cycle, chosen from the asking tables'
 *   pools, never a horse already seated in that game or on its list.
 */
export function planHorseQueues(input: {
  asks: readonly HorseQueueAsk[];
  tables: readonly QueueGameTable[];
  rows: readonly QueuedHorseRow[];
  excludedGameIds: ReadonlySet<string>;
  humanWaitingGameIds: ReadonlySet<string>;
  seatedByGame: ReadonlyMap<string, ReadonlySet<string>>;
  nowMs: number;
  /** Variant and big blind per game; a game missing here is never comparable. */
  gameInfo?: ReadonlyMap<string, HorseQueueGameInfo>;
  /** Horses seated at any open table, any game. */
  seatedAnywhere?: ReadonlySet<string>;
  /** Is this horse on duty (HorseWorkSchedule)? An off-duty horse leaves every
   *  line now and joins none (owner 2026-11-12). Absent: everyone is. */
  onDuty?: (userId: string) => boolean;
}): HorseQueuePlan {
  const gameInfo = input.gameInfo ?? new Map<string, HorseQueueGameInfo>();
  const seatedAnywhere = input.seatedAnywhere ?? new Set<string>();
  const allFull = new Map<string, boolean>();
  for (const t of input.tables) {
    const full = t.maxPlayers > 0 && t.seated >= t.maxPlayers;
    allFull.set(t.gameId, (allFull.get(t.gameId) ?? true) && full);
  }

  const desired = new Map<string, number>();
  const pools = new Map<string, string[]>();
  const gameKind = new Map<string, { variant: unknown; bigBlind: unknown }>();
  for (const a of input.asks) {
    if (a.gameId && a.variant !== undefined && !gameKind.has(a.gameId))
      gameKind.set(a.gameId, { variant: a.variant, bigBlind: a.bigBlind });
    if (!a.gameId || a.waitTarget <= 0) continue;
    desired.set(a.gameId, Math.max(desired.get(a.gameId) ?? 0, Math.floor(a.waitTarget)));
    const p = pools.get(a.gameId) ?? [];
    p.push(...a.pool);
    pools.set(a.gameId, p);
  }

  const cancel: string[] = [];
  const byGame = new Map<string, QueuedHorseRow[]>();
  /** The games each horse is listed for after this cycle's decisions. */
  const linesOf = new Map<string, string[]>();
  const fits = (userId: string, gameId: string): boolean => {
    const lines = linesOf.get(userId) ?? [];
    if (lines.includes(gameId)) return false;
    if (lines.length >= horseListCap(userId)) return false;
    return lines.every((g) => comparableGames(gameInfo.get(g), gameInfo.get(gameId)));
  };
  /* A horse that gives up on one line looks for another (2026-11-07): it is
     the first choice for any OTHER game's line this cycle, the way a player
     tired of one list puts their name down somewhere else. */
  const leftGame = new Map<string, string>();
  // Oldest first, so the lines a horse keeps are the ones it joined first.
  const rows = [...input.rows].sort(
    (a, b) =>
      (Date.parse(a.created_at) || 0) - (Date.parse(b.created_at) || 0) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
  for (const r of rows) {
    const created = Date.parse(r.created_at);
    if (Number.isFinite(created) && input.nowMs - created >= queuePatienceMs(r.id)) {
      cancel.push(r.id);
      leftGame.set(r.user_id, r.game_id);
      continue;
    }
    // Off duty (shift over, rest day, cap played out): it leaves the line.
    if (input.onDuty && !input.onDuty(r.user_id)) {
      cancel.push(r.id);
      continue;
    }
    // Seated in this game: the tick marks the row 'seated'; it is no longer a
    // place in line and is neither counted nor touched here.
    if (input.seatedByGame.get(r.game_id)?.has(r.user_id)) continue;
    // Seated anywhere else: it leaves this list now.
    if (seatedAnywhere.has(r.user_id)) {
      cancel.push(r.id);
      continue;
    }
    if (!fits(r.user_id, r.game_id)) {
      cancel.push(r.id);
      continue;
    }
    linesOf.set(r.user_id, [...(linesOf.get(r.user_id) ?? []), r.game_id]);
    const list = byGame.get(r.game_id) ?? [];
    list.push(r);
    byGame.set(r.game_id, list);
  }

  const dropLine = (r: QueuedHorseRow) => {
    cancel.push(r.id);
    linesOf.set(
      r.user_id,
      (linesOf.get(r.user_id) ?? []).filter((g) => g !== r.game_id)
    );
  };

  // Games the loop knows about and games that already hold a horse line.
  const games = new Set<string>([...allFull.keys(), ...byGame.keys()]);
  const add: Array<{ game_id: string; user_id: string }> = [];
  for (const gameId of [...games].sort()) {
    // A game this cycle did not see (no live table in it) keeps its rows
    // untouched rather than being judged on nothing.
    if (!allFull.has(gameId)) continue;
    const list = (byGame.get(gameId) ?? []).sort(
      (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)
    );
    if (input.excludedGameIds.has(gameId) || input.humanWaitingGameIds.has(gameId)) {
      for (const r of list) dropLine(r);
      continue;
    }
    // Not full: the list is being called into the open chair. Keep, add none.
    if (allFull.get(gameId) !== true) continue;
    // A timed-out/withheld fleet walk is no evidence that existing demand
    // disappeared. Preserve the actual line until an explicit ask or expiry.
    const want = desired.get(gameId) ?? Math.max(1, list.length);
    if (list.length > want) {
      for (const r of list.slice(want)) dropLine(r);
      continue;
    }
    if (list.length === want) continue;
    const seated = input.seatedByGame.get(gameId) ?? new Set<string>();
    const minute = Math.floor(input.nowMs / 60_000);
    const movingOn = (id: string) => {
      const from = leftGame.get(id);
      return from !== undefined && from !== gameId ? 0 : 1;
    };
    /* REGULARS (2026-11-07): a game's own regulars put their names down
       first. A ranking, never a filter, so the line grows exactly as before. */
    const kind = gameKind.get(gameId);
    const home = (id: string) => (kind ? homeQueueRank(id, kind.variant, kind.bigBlind) : 0);
    const pool = [...new Set(pools.get(gameId) ?? [])]
      .filter(
        (id) =>
          !seated.has(id) &&
          !seatedAnywhere.has(id) &&
          leftGame.get(id) !== gameId &&
          fits(id, gameId)
      )
      .sort(
        (a, b) =>
          movingOn(a) - movingOn(b) ||
          home(a) - home(b) ||
          mix32(horseHash(`${a}:${gameId}:${minute}`)) -
            mix32(horseHash(`${b}:${gameId}:${minute}`))
      );
    const pick = pool[0];
    if (!pick) continue;
    linesOf.set(pick, [...(linesOf.get(pick) ?? []), gameId]);
    add.push({ game_id: gameId, user_id: pick });
  }
  return { cancel, add };
}
