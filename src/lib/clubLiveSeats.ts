/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  WHO OF THIS CLUB IS AT A TABLE RIGHT NOW (2026-11-12)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Dan, 2026-11-12, Player Management: Active Now puts "the players that are
 * on a table at the top, and just online watching under the live players",
 * the order should move as it happens, and the row should say which table.
 *
 * The roster RPC answers is_seated once, at read time. A seat is taken or
 * left with no roster row change, and table_seats is not published to
 * Realtime (14.5M writes; see GlobalWaitlistListener), so the live answer is
 * READ, the same way presence is: every open roster asks this once a minute
 * while the tab is visible, on the same PRESENCE_RECHECK_MS clock the
 * presence watcher uses, and never re-reads the roster for it. That keeps
 * Dan's 2026-10-25 ruling ("once every 180 seconds is fine, nothing sooner")
 * for the roster read itself: a seat answer is a presence answer, not a
 * roster refresh.
 *
 * What counts as "at a table" is exactly what ca_club_roster_rows counts: an
 * open seat (left_at null) on a waiting or running table, where either the
 * seat is stamped with this club or the table belongs to this club. Deleted
 * tables are skipped. The answer comes from `ca_club_live_seats`, the roster's
 * own door, and carries the player's public profile so the Live Now strip
 * can print every seated member of the club, including the ones beyond the
 * loaded roster page.
 */
import { supabase } from './supabase';
import { PRESENCE_RECHECK_MS } from './profilePresence';
import { reportError } from '../utils/errorReporter';

export interface LiveSeat {
  user_id: string;
  table_id: string;
  tournament_id: string | null;
  name: string;
  stakes: string;
  is_tournament: boolean;
  alias: string;
  username: string;
  avatar_url: string | null;
}

/** One row of public.ca_club_live_seats. */
type LiveSeatRow = {
  user_id: string;
  table_id: string;
  tournament_id: string | null;
  name: string | null;
  stakes: string | null;
  is_tournament: boolean | null;
  alias: string | null;
  username: string | null;
  avatar_url: string | null;
  joined_at: string | null;
};

/** The one door, `ca_club_live_seats(p_club_id)`, shared with the roster. */
export const LIVE_SEATS_RPC = 'ca_club_live_seats';

function toSeat(row: LiveSeatRow): LiveSeat | null {
  if (!row.user_id || !row.table_id) return null;
  return {
    user_id: row.user_id,
    table_id: row.table_id,
    tournament_id: row.tournament_id,
    name: row.name?.trim() || 'Live Table',
    stakes: row.stakes || '',
    is_tournament: row.is_tournament ?? !!row.tournament_id,
    alias: row.alias?.trim() || row.username?.trim() || '',
    username: row.username ?? '',
    avatar_url: row.avatar_url || null,
  };
}

/**
 * Every open seat of this club's tables, newest seat first. Read through
 * `ca_club_live_seats`, the roster's own authority (migration 20261112231056):
 * the same viewer rule as ca_club_members_page, and the same rule that a
 * reserved certification identity is never listed to a person, so the strip
 * can never show a seat the roster hides.
 */
export async function readClubLiveSeats(clubId: string): Promise<LiveSeat[]> {
  const { data, error } = await supabase.rpc(LIVE_SEATS_RPC, { p_club_id: clubId });
  if (error) throw new Error(error.message || 'Could not read live seats.');
  const seen = new Set<string>();
  const out: LiveSeat[] = [];
  for (const row of (data || []) as LiveSeatRow[]) {
    const seat = toSeat(row);
    if (!seat) continue;
    const key = `${seat.user_id}:${seat.table_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(seat);
  }
  return out;
}

export type LiveSeatAnswer = ReadonlyMap<string, LiveSeat[]>;
type Listener = (answer: LiveSeatAnswer, seats: readonly LiveSeat[]) => void;

interface ClubWatch {
  listeners: Set<Listener>;
  timer: ReturnType<typeof setInterval> | null;
  seq: number;
  last: { answer: LiveSeatAnswer; seats: LiveSeat[] } | null;
}

const clubs = new Map<string, ClubWatch>();
let visibilityBound = false;

function tabHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

function byUser(seats: readonly LiveSeat[]): LiveSeatAnswer {
  const map = new Map<string, LiveSeat[]>();
  for (const seat of seats) {
    const list = map.get(seat.user_id);
    if (list) list.push(seat);
    else map.set(seat.user_id, [seat]);
  }
  return map;
}

async function ask(clubId: string): Promise<void> {
  const watch = clubs.get(clubId);
  if (!watch) return;
  const seq = ++watch.seq;
  let seats: LiveSeat[] | null = null;
  try {
    seats = await readClubLiveSeats(clubId);
  } catch (e) {
    reportError(e, 'clubLiveSeats.ask');
  }
  // A later ask has answered, or nobody is watching any more: say nothing.
  if (clubs.get(clubId) !== watch || watch.seq !== seq || seats === null) return;
  watch.last = { answer: byUser(seats), seats };
  for (const listener of watch.listeners) listener(watch.last.answer, watch.last.seats);
}

function recheckAll(): void {
  if (tabHidden()) return;
  for (const clubId of clubs.keys()) void ask(clubId);
}

function onVisibilityChange(): void {
  if (!tabHidden()) recheckAll();
}

/**
 * Watch who of this club is seated now. The listener is called with the seats
 * by player and the flat list whenever the club is (re-)asked. Returns the
 * unsubscribe. One read per club per minute, however many watchers.
 */
export function watchClubLiveSeats(clubId: string, listener: Listener): () => void {
  let watch = clubs.get(clubId);
  if (!watch) {
    watch = { listeners: new Set(), timer: null, seq: 0, last: null };
    clubs.set(clubId, watch);
    watch.timer = setInterval(() => {
      if (!tabHidden()) void ask(clubId);
    }, PRESENCE_RECHECK_MS);
    void ask(clubId);
  } else if (watch.last) {
    listener(watch.last.answer, watch.last.seats);
  }
  watch.listeners.add(listener);
  if (!visibilityBound && typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange);
    visibilityBound = true;
  }
  const owner = watch;
  return () => {
    if (!owner.listeners.delete(listener)) return;
    if (owner.listeners.size > 0) return;
    if (owner.timer !== null) clearInterval(owner.timer);
    if (clubs.get(clubId) === owner) clubs.delete(clubId);
    if (clubs.size === 0 && visibilityBound && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      visibilityBound = false;
    }
  };
}

/** Ask again now (a roster read just happened; a seat signal arrived). */
export function recheckClubLiveSeats(clubId: string): void {
  if (clubs.has(clubId) && !tabHidden()) void ask(clubId);
}

/** Test seam: drop every watch. */
export function resetClubLiveSeatsForTests(): void {
  for (const watch of clubs.values()) if (watch.timer !== null) clearInterval(watch.timer);
  clubs.clear();
  if (visibilityBound && typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', onVisibilityChange);
  }
  visibilityBound = false;
}
