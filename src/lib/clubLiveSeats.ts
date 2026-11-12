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
 * tables are skipped. The seat row carries the player's public profile so the
 * Live Now strip can print every seated member of the club, including the
 * ones beyond the loaded roster page.
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

type SeatRow = {
  user_id: string | null;
  table_id: string;
  club_id: string | null;
  joined_at: string | null;
  tables: {
    id: string;
    name: string | null;
    stakes: string | null;
    tournament_id: string | null;
    status: string | null;
    is_deleted: boolean | null;
    club_id: string | null;
  } | null;
  profiles: {
    alias: string | null;
    username: string | null;
    display_name: string | null;
    arena_avatar_url: string | null;
    avatar_url: string | null;
    status: string | null;
  } | null;
};

const SELECT =
  'user_id, table_id, club_id, joined_at, ' +
  'tables!table_seats_table_id_fkey!inner(id, name, stakes, tournament_id, status, is_deleted, club_id), ' +
  'profiles!fk_table_seats_user_id_profiles(alias, username, display_name, arena_avatar_url, avatar_url, status)';

function toSeat(row: SeatRow): LiveSeat | null {
  const table = row.tables;
  if (!row.user_id || !table || table.is_deleted === true) return null;
  if (row.profiles?.status === 'deleted') return null;
  const alias =
    row.profiles?.alias?.trim() ||
    row.profiles?.display_name?.trim() ||
    row.profiles?.username?.trim() ||
    '';
  return {
    user_id: row.user_id,
    table_id: row.table_id,
    tournament_id: table.tournament_id,
    name: table.name || 'Live Table',
    stakes: table.stakes || '',
    is_tournament: !!table.tournament_id,
    alias,
    username: row.profiles?.username ?? '',
    avatar_url: row.profiles?.arena_avatar_url || row.profiles?.avatar_url || null,
  };
}

/** Every open seat of this club's members, newest seat first per player. */
export async function readClubLiveSeats(clubId: string): Promise<LiveSeat[]> {
  const live = ['waiting', 'running'];
  const [stamped, owned] = await Promise.all([
    supabase
      .from('table_seats')
      .select(SELECT)
      .eq('club_id', clubId)
      .is('left_at', null)
      .in('tables.status', live)
      .order('joined_at', { ascending: false }),
    supabase
      .from('table_seats')
      .select(SELECT)
      .is('club_id', null)
      .is('left_at', null)
      .eq('tables.club_id', clubId)
      .in('tables.status', live)
      .order('joined_at', { ascending: false }),
  ]);
  if (stamped.error) throw new Error(stamped.error.message || 'Could not read live seats.');
  if (owned.error) throw new Error(owned.error.message || 'Could not read live seats.');
  const seen = new Set<string>();
  const out: LiveSeat[] = [];
  for (const row of [
    ...((stamped.data || []) as unknown as SeatRow[]),
    ...((owned.data || []) as unknown as SeatRow[]),
  ]) {
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
