import type { LobbyEntry } from './lobbyEntries';
import { featuredNow } from '../../lib/featuredOnItsDay';

/**
 * TOURNAMENT FAVORITES NEVER JUMP THE CLOCK (Dan 2026-11-05).
 *
 * "WHY WOULD TOURNAMENTS THAT ARE STARTING IN 22 HOURS EVER BE DISPLAYED
 *  BEFORE TOURNAMENTS STARTING IN 22 MINUTES?! FAVORITES THAT START MORE THEN
 *  24 HOURS OUT, SHOULD NOT BE DISPLAYED."
 *
 * Since the star follows the schedule (migration 20261105183133), one star
 * lights every future edition of that schedule. The old favorite tier floated
 * all of them above tonight's board: tomorrow's and the next day's editions sat
 * on top, tonight's events were pushed down, and on the ALL tab the ten-event
 * cap was filled by future editions so tonight's events vanished.
 *
 * The rules, superseding the October 31 favorite tier for scheduled MTTs:
 *   1. A scheduled MTT keeps its place in the board's chosen order (by default
 *      the start clock). A star marks it; it never promotes it. Host pins of
 *      today still float (featuredOnItsDay.ts).
 *   2. A starred MTT that has not started and starts more than 18 hours from
 *      now is not displayed at all (Dan: "FAVORITES ONLY SHOW WHEN THEY ARE
 *      18 HOURS AWAY FROM STARTING, NOT 24").
 *   3. Seat-first formats (Spins, Sit N Gos) have no start clock to jump, so
 *      their favorites keep floating below the host pins.
 */
/** Dan 2026-11-05 (17:07 Chicago): 18 hours, superseding the 24 he first gave. */
export const FAVORITE_DISPLAY_HORIZON_MS = 18 * 60 * 60 * 1000;

/** True when this row is a starred MTT that starts more than 18 hours out. */
export function isFavoriteBeyondHorizon(
  entry: LobbyEntry,
  favoriteIds: ReadonlySet<string>,
  now: number = Date.now()
): boolean {
  if (entry.kind !== 'mtt' || !favoriteIds.has(entry.id) || !entry.startTime) return false;
  if (entry.status === 'running' || entry.status === 'late_reg') return false;
  const start = new Date(entry.startTime).getTime();
  return Number.isFinite(start) && start - now > FAVORITE_DISPLAY_HORIZON_MS;
}

/** Drop starred MTTs beyond the 18 hour horizon; same array when none apply. */
export function withoutFavoritesBeyondHorizon(
  rows: LobbyEntry[],
  favoriteIds: ReadonlySet<string>,
  now: number = Date.now()
): LobbyEntry[] {
  if (favoriteIds.size === 0) return rows;
  const kept = rows.filter((entry) => !isFavoriteBeyondHorizon(entry, favoriteIds, now));
  return kept.length === rows.length ? rows : kept;
}

/** A favorite floats only in a seat-first format; a scheduled MTT never does. */
function floatsAsFavorite(entry: LobbyEntry, favoriteIds: ReadonlySet<string>): boolean {
  return entry.kind !== 'cash' && entry.kind !== 'mtt' && favoriteIds.has(entry.id);
}

/** Stable priority over an already sorted schedule; cash stars never rank rows. */
export function prioritizeTournamentFavorites(
  rows: LobbyEntry[],
  favoriteIds: ReadonlySet<string>,
  currentPins?: ReadonlySet<LobbyEntry>
): LobbyEntry[] {
  const pins =
    currentPins ??
    featuredNow(rows, (entry) => ({
      pinned: entry.kind !== 'cash' && entry.featured,
      started: entry.status === 'running' || entry.status === 'late_reg',
      startTime: entry.startTime,
      clubId: (entry.raw as { club_id?: string | null }).club_id,
      name: entry.name,
    }));
  const pinned: LobbyEntry[] = [];
  const favorites: LobbyEntry[] = [];
  const rest: LobbyEntry[] = [];
  for (const entry of rows) {
    if (entry.kind !== 'cash' && pins.has(entry)) pinned.push(entry);
    else if (floatsAsFavorite(entry, favoriteIds)) favorites.push(entry);
    else rest.push(entry);
  }
  return pinned.length || favorites.length ? pinned.concat(favorites, rest) : rows;
}

/** An MTT whose registration has closed: status Running, nobody can enter. */
export function isRegistrationClosedMtt(entry: LobbyEntry): boolean {
  return entry.kind === 'mtt' && entry.status === 'running';
}

/**
 * Dan 2026-11-05: "REGISTRATION CLOSED, 'RUNNING' TOURNAMENTS SHOULD ALWAYS
 * 100% OF THE TIME BE ON THE BOTTOM." Applied after every sort, pin and
 * favorite tier, so nothing can float one back up. Stable; the same array is
 * returned when nothing moves.
 */
export function runningLast(rows: LobbyEntry[]): LobbyEntry[] {
  if (!rows.some(isRegistrationClosedMtt)) return rows;
  const open: LobbyEntry[] = [];
  const closed: LobbyEntry[] = [];
  for (const row of rows) (isRegistrationClosedMtt(row) ? closed : open).push(row);
  if (open.every((row, index) => row === rows[index])) return rows;
  return open.concat(closed);
}
