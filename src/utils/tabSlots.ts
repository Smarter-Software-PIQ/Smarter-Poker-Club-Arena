/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  tabSlots — which slot a table takes, and which tabs a rebuild may close
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Two decisions that used to live inline in MultiTablePage, where the only way
 * to test either was to open four tables by hand. Both had shipped a bug that a
 * unit test would have caught in a second, so they live here now — pure, and
 * pinned by tests/unit/tabSlots.test.ts. Same reasoning as swipeTarget.ts.
 *
 * WHY BOTH ARE IN ONE FILE: they are the same question asked twice. "Is this
 * tab holding something the player would lose?" A tab with a live seat holds
 * chips and an engine socket; a lobby tab and an unseated observer hold
 * nothing. Slot reuse and pruning both turn on that, and keeping the predicate
 * in one place is what stops them drifting apart again — they had.
 */

/**
 * IS THIS ROW A TOURNAMENT? — one derivation, used by every tab factory.
 *
 * Dan 2026-08-30, second pass. The rebuild computed this inline, passed it to
 * `gameCode(...)`, and then dropped it instead of putting it on the tab. Four
 * readers depend on the tab carrying it, and `undefined` reads as "cash" at
 * every one: the sit-out toast (promises a 5-minute seat hold to a player who
 * is actually being blinded off), Sit Out All's cash-seat count, the profit
 * chip (which Dan requires to ignore tournaments entirely), and the tile raise
 * slider's step unit.
 *
 * A row is a tournament if it says so OR if it belongs to one. `tournament_id`
 * alone is enough: a table can carry it without `game_type` being set.
 */
export interface TableRowLike {
  game_type?: string | null;
  tournament_id?: string | null;
}
export const isTournamentRow = (row: TableRowLike | null | undefined): boolean =>
  row?.game_type === 'tournament' || !!row?.tournament_id;

/** The subset of a tab these decisions read. Structural, so the container's
 *  richer `TableInstance` satisfies it without an import cycle. */
export interface SlotTab {
  id: string;
  /** Optional on purpose: see `isLobbyLike`. Absent means "a table". */
  kind?: 'table' | 'lobby' | 'hub';
  /** True only for a seat the server has confirmed. */
  seated?: boolean;
  /** A player-watch remains an observer even when our own seat leaves this table. */
  followPlayer?: unknown;
  /** The tournament this table belongs to, when known. See `findTournamentSeatTab`. */
  tournamentId?: string;
}

/** Lobby tabs carry a prefixed synthetic id as well as the flag; either proves it. */
export const LOBBY_TAB_PREFIX = 'lobby:';
export const isLobbyLike = (t: SlotTab): boolean =>
  t.kind === 'lobby' || t.id.startsWith(LOBBY_TAB_PREFIX);

/**
 * HUB TABS (Dan 2026-09-04): "when you click the + button from inside the
 * club lobby I should be able to go anywhere, it's basically opening up a new
 * browser tab internally, it shouldn't be limited to just poker."
 *
 * A hub tab is a World Hub page (Social, Media, Trivia, Training, the Hub
 * itself) rendered inside one of these slots. Like a lobby tab it holds no
 * seat and no chips, so it is never pruned and never counted as a live table.
 * UNLIKE a lobby tab it is not a parking space: TABLE_SEATED replaces the
 * oldest LOBBY tab, "+" focuses the LOBBY tab, and an observe reuses the LOBBY
 * tab - a page the player is reading in a hub tab is not free for any of
 * those to take. That is why `isLobbyLike` stays narrow and this is separate.
 */
export const HUB_TAB_PREFIX = 'hub:';
export const isHubLike = (t: SlotTab): boolean =>
  t.kind === 'hub' || t.id.startsWith(HUB_TAB_PREFIX);

/**
 * A tab that is a PAGE rather than a felt: lobby or hub. This is the predicate
 * for "is it a live table?" (`!isPageTab`) - every count, dock, alert, sound
 * and URL decision that used to ask `!isLobbyLike` asks this now, because a
 * hub tab is exactly as much not-a-table as a lobby tab is.
 */
export const isPageTab = (t: SlotTab): boolean => isLobbyLike(t) || isHubLike(t);

/**
 * Only an unseated table observer can be reused. Lobby and Hub pages stay
 * reserved until the player manually closes them (owner October 30).
 *
 * `seated !== true` rather than `!seated` so an explicit `false` and an
 * as-yet-unknown `undefined` read the same, which is what the observer tab
 * (deliberately undefined) relies on.
 */
export const isFreeSlot = (t: SlotTab): boolean => !isPageTab(t) && t.seated !== true;

/**
 * WHICH SLOT A NEWLY OPENED TABLE TAKES.
 *
 * Dan 2026-08-30, verbatim: "WHEN I WENT INTO THE LOBBY TO CHANGE A TABLE, IT
 * DIDN'T CHANGE THE TABLE FOR THE LOBBY TABLE AND PAGE I WAS IN, IT CREATED A
 * NEW ACTION BAR AND ADDED IT IN THE FIRST SLOT LABELED MTT."
 *
 * The rule "watching a table never costs you a screen you are already using"
 * was written to protect SEATED screens. Applied to the screen the player
 * launched the gesture FROM, it produced the opposite of what they asked for:
 * they said "change this table" and got the new one parked in another slot
 * while the one in front of them did not move.
 *
 * Order, and why:
 *   'focus'   already open — watching a table twice is not a thing, and a
 *             duplicate would burn one of the four slots.
 *   'active'  the tab they are ON is free — take it, in place, same index.
 *             This is the case that was missing.
 *   'lobby'   some OTHER parked lobby tab is free — take that rather than grow.
 *   'append'  room left.
 *   'full'    say so out loud; silence is how "the button is broken" is born.
 *
 * Returns the slot index for every action but 'full', which returns -1.
 */
export type ObserveSlotAction = 'focus' | 'active' | 'lobby' | 'append' | 'full';

export interface ObserveSlot {
  action: ObserveSlotAction;
  index: number;
}

export function pickObserveSlot(
  tabs: readonly SlotTab[],
  activeIndex: number,
  tableId: string,
  maxTables: number
): ObserveSlot {
  const existing = tabs.findIndex((t) => t.id === tableId);
  if (existing !== -1) return { action: 'focus', index: existing };

  const active = tabs[activeIndex];
  if (active && isFreeSlot(active)) return { action: 'active', index: activeIndex };

  if (tabs.length < maxTables) return { action: 'append', index: tabs.length };
  return { action: 'full', index: -1 };
}

/**
 * WHICH TABS A SERVER-TRUTH REBUILD MAY CLOSE.
 *
 * Dan 2026-08-28 bug 1: a tab claiming a seat the server has since closed sits
 * frozen on a hand that will never finish — the "Connection Lost, Trying To Get
 * You Back" screen over an empty felt.
 *
 * The first version of this asked `kind === 'table' && seated === true`, and
 * the rebuild's OWN tabs were built without a `kind`. So every tab restored
 * after a page reload — which is every tab, in the case that matters — was
 * exempt from the prune that exists to close it, and the fix was inert exactly
 * where it was needed. Asking `!isLobbyLike` instead cannot rot that way: it
 * needs no field to be remembered by whoever writes the next tab factory.
 *
 * Never prunes a lobby tab (not a table) or an observer (holds no seat by
 * definition) — both are things the player deliberately opened.
 */
export function pruneStaleSeatedTabs<T extends SlotTab>(
  tabs: readonly T[],
  liveSeatIds: ReadonlySet<string>
): T[] {
  return tabs.flatMap((t) => {
    if (isLobbyLike(t) || t.seated !== true || liveSeatIds.has(t.id)) return [t];
    // Our seat may move while we are watching someone else at the same table.
    // Keep that explicit watch and let its own assignment feed follow the target.
    if (t.followPlayer)
      return [
        { ...t, seated: false, arrivedByMoveAt: undefined, holeCards: undefined, isMyTurn: false },
      ];
    return [];
  });
}

/**
 * ═══ ONE TOURNAMENT, ONE CHAIR, ONE TAB ═════════════════════════════════════
 *
 * Owner report 2026-11-14: in an MTT on desktop, a balance / table-break move
 * SOMETIMES opened the destination as a NEW tab, as if "+" had been pressed,
 * and left the old table open to watch. The move must re-point the tab the
 * player is sitting in.
 *
 * The move is learned from several independent sources: the engine socket
 * (TablePage -> movedToTableId), the own-seat INSERT on table_seats, the
 * tournament seat poll (TABLE_SEATED) and the server-truth seat rebuild. Only
 * the first two knew it was a move. The other two saw "a live seat with no
 * tab" and appended one, and whichever source landed first decided the
 * outcome - hence "sometimes". During the move the server also briefly holds
 * BOTH chairs (the destination is written before the source is closed), so a
 * rebuild that read in that window kept the old tab as well.
 *
 * The rule every path now asks: a player holds exactly one chair per
 * tournament. A new own seat in tournament T re-points the tab that holds the
 * player's chair in T - in place, same slot - and never adds one.
 */

/**
 * The tab holding the player's own chair in `tournamentId`, other than the
 * destination itself; -1 when there is none. A player-watch is never the
 * chair (it follows somebody else), and neither is a page or an unseated
 * observer. `tournamentOf` lets a caller that has read the table rows supply
 * the tournament for a tab that has not been told its own yet.
 */
export function findTournamentSeatTab<T extends SlotTab>(
  tabs: readonly T[],
  destinationId: string,
  tournamentId: string | null | undefined,
  tournamentOf: (tab: T) => string | null | undefined = (tab) => tab.tournamentId
): number {
  if (!tournamentId) return -1;
  return tabs.findIndex(
    (t) =>
      t.id !== destinationId &&
      !isPageTab(t) &&
      t.seated === true &&
      !t.followPlayer &&
      (t.tournamentId || tournamentOf(t)) === tournamentId
  );
}

export interface LiveSeatRow {
  tableId: string;
  tournamentId?: string | null;
  /** table_seats.joined_at; the newest live seat in a tournament is the chair. */
  joinedAt?: string | null;
}

/**
 * Live seats that are NOT the player's chair: an older live seat in a
 * tournament where a newer one exists is the source of a move the server has
 * not finished closing. Unknown join times supersede nothing.
 */
export function supersededTournamentSeats(seats: readonly LiveSeatRow[]): Set<string> {
  const newest = new Map<string, { tableId: string; at: number }>();
  const unknown = new Set<string>();
  for (const seat of seats) {
    if (!seat.tournamentId) continue;
    const at = seat.joinedAt ? Date.parse(seat.joinedAt) : NaN;
    if (!Number.isFinite(at)) {
      unknown.add(seat.tournamentId);
      continue;
    }
    const best = newest.get(seat.tournamentId);
    if (!best || at > best.at) newest.set(seat.tournamentId, { tableId: seat.tableId, at });
  }
  const superseded = new Set<string>();
  for (const seat of seats) {
    if (!seat.tournamentId || unknown.has(seat.tournamentId)) continue;
    const best = newest.get(seat.tournamentId);
    if (best && best.tableId !== seat.tableId) superseded.add(seat.tableId);
  }
  return superseded;
}

/**
 * Re-point, in place, each tab whose tournament chair moved to a live seat
 * that has no tab yet. Returns the tabs and the ids that were moved away from
 * (so a caller does not report them as closed or re-open them).
 */
export function followTournamentMoves<T extends SlotTab>(
  tabs: readonly T[],
  chairs: readonly { tableId: string; tournamentId?: string | null }[],
  repoint: (tab: T, destinationId: string) => T,
  tournamentOf?: (tab: T) => string | null | undefined
): { tabs: T[]; movedFrom: string[] } {
  const chairIds = new Set(chairs.map((c) => c.tableId));
  let next = tabs.slice();
  const movedFrom: string[] = [];
  for (const chair of chairs) {
    if (!chair.tournamentId || next.some((t) => t.id === chair.tableId)) continue;
    const index = findTournamentSeatTab(next, chair.tableId, chair.tournamentId, tournamentOf);
    if (index < 0 || chairIds.has(next[index].id)) continue;
    movedFrom.push(next[index].id);
    next = next.map((t, i) => (i === index ? repoint(t, chair.tableId) : t));
  }
  return { tabs: next, movedFrom };
}
