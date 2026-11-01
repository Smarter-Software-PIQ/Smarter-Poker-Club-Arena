import type { LobbyEntry } from './lobbyEntries';
import { featuredNow } from '../../lib/featuredOnItsDay';

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
    else if (entry.kind !== 'cash' && favoriteIds.has(entry.id)) favorites.push(entry);
    else rest.push(entry);
  }
  return pinned.length || favorites.length ? pinned.concat(favorites, rest) : rows;
}
