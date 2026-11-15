/**
 * The filter for a `clubs` read keyed by a route's club param.
 *
 * A RENAMED CLUB KEEPS ITS OLD SLUG (2026-11-14). `resolveClubIdFilter` turns
 * a slug into a filter on the slug column, which finds nothing for a slug the
 * club no longer holds: /clubs/club-jaqk/settings, /rules and the lobby read
 * no club after club-jaqk became the-felt-society. A slug therefore goes through
 * `resolveClubUUID`, the one resolver that asks the clubs table first and the
 * rename history second, and the read filters by the id it answers. An id or
 * a six-digit club code is immutable and keeps its own column with no lookup.
 *
 * This lives beside the resolver rather than inside it on purpose: it calls
 * the resolver through its exports, so a test that replaces the resolver
 * replaces this lookup with it.
 */
import { isUUID, resolveClubIdFilter, resolveClubUUID } from './clubIdResolver';

export async function resolveClubLookupFilter(
  clubIdParam: string,
  signal?: AbortSignal
): Promise<ReturnType<typeof resolveClubIdFilter>> {
  const filter = resolveClubIdFilter(clubIdParam);
  if (filter.column !== 'slug') return filter;
  const clubUUID = await resolveClubUUID(clubIdParam, signal);
  // An unknown slug stays a slug read: it finds no row, as before, rather
  // than handing a non-UUID to the uuid column.
  return isUUID(clubUUID) ? { column: 'id', value: clubUUID } : filter;
}
