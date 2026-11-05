/**
 * THE DAILY WINDOW, ENGINE SIDE (owner, 2026-11-03).
 *
 * Every game closes 4:00 to 6:00 AM Chicago every day; tournaments start only
 * 6:00 AM to 11:00 PM; Spins and Sit & Gos stop at 3:00 AM so none is running
 * when the games close. The database row smarter_private.daily_window_policy
 * (migration *_daily_window_policy_and_tournament_hours) is the source of
 * truth and refuses every new entry itself; these constants let the engine
 * stop OPENING new Spin and Sit & Go boards in the same hours.
 * dailyWindow.test.ts proves they equal the migration's values.
 */

export const DAILY_WINDOW = {
  timeZone: 'America/Chicago',
  spinSngStop: '03:00',
  windowStart: '04:00',
  windowEnd: '06:00',
  firstTournamentStart: '06:00',
  lastTournamentStart: '23:00',
} as const;

/** HH:MM of `at` on the Chicago wall clock (DST-safe). */
export function chicagoClock(at: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: DAILY_WINDOW.timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const hh = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const mm = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${hh}:${mm}`;
}

/**
 * True when a timed tournament may START at `at`: 6:00 AM to 11:00 PM Chicago,
 * both ends included, the same bounds the database's schedule writer and
 * one-off creator enforce. Every engine spawner asks before it creates.
 */
export function tournamentStartAllowed(at: Date): boolean {
  const t = chicagoClock(at);
  return t >= DAILY_WINDOW.firstTournamentStart && t <= DAILY_WINDOW.lastTournamentStart;
}

/**
 * THE ONE CARVE-OUT (owner 2026-11-04): the Midway Union's 12:30 AM Chicago
 * Midnight Free Buy starts after 11:00 PM, every day. Nothing else does, and
 * no other room's event of the same name: the Diamond Arena keeps the close.
 * The database policy holds the same single exception.
 */
export const DAILY_WINDOW_CARVE_OUT = {
  unionId: 'fade0000-0000-0000-0000-000000000001',
  name: 'Midnight Free Buy (NLH)',
  start: '00:30',
} as const;

/** True only for the Midway Union's Midnight Free Buy starting at 00:30 Chicago. */
export function dailyWindowCarveOut(
  event: { clubId?: string | null; unionId?: string | null; name?: unknown },
  at: Date
): boolean {
  const c = DAILY_WINDOW_CARVE_OUT;
  return (
    (event.unionId === c.unionId || event.clubId === c.unionId) &&
    String(event.name ?? '').trim() === c.name &&
    chicagoClock(at) === c.start
  );
}

/** False from 3:00 AM until 6:00 AM Chicago: no new Spin or Sit & Go board opens. */
export function spinSngBoardsOpen(at: Date): boolean {
  const t = chicagoClock(at);
  return !(t >= DAILY_WINDOW.spinSngStop && t < DAILY_WINDOW.windowEnd);
}
