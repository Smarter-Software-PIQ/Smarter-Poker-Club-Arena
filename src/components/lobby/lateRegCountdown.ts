/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  THE LOBBY CARD COUNTDOWN (Dan 2026-11-06)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Dan, on the Nightly 10K reading "Late Reg Open" while the 25 Chip Daily Rebuy
 * beside it counted down: "FIX IT SO IT ALWAYS SHOWS THE COUNT DOWN".
 *
 * `lateRegEndMs` (./lateRegWindow) is the STRICT deadline: it answers null
 * whenever it cannot prove one, and the Details tab, the at-table call to
 * action and the root-mounted starting ticker rely on that so they never print
 * an invented wall-clock time. A lobby card has a different job - it must keep
 * a clock running - so it reads this module instead. It lives apart from
 * lateRegWindow so the ticker's entry chunk does not carry it
 * (tests/unit/entryBundleStaysLean.test.ts).
 *
 * What the engine actually does, and therefore what this projects:
 *
 *  - An ordinary event closes entry at whichever comes first of its last entry
 *    level ending and its configured minutes (fn_tournament_late_registration_open).
 *  - An ADD-ON event ignores its minutes. When the last entry level ends the
 *    engine finishes the hands in play, then opens a fixed 60-second add-on
 *    window (TournamentManagerBase.addOnBreakDurationMs, owner 2026-10-31), and
 *    entry stays open until that window ends. Its end is stamped in
 *    `addon_period_ends_at` only when the window opens.
 *  - The hourly synchronized break (from :55 UTC, eligible MTTs only) and the
 *    daily 04:00-04:05 America/Chicago maintenance freeze both STOP the level
 *    clock; the engine re-anchors `level_started_at` when play resumes. The
 *    break is MEASURED, not read from the engine's five-minute constant:
 *    across 152 breaks on 2026-11-06/07 the first resumed hand finished a
 *    median 627 s after :55, and the Nightly 10K's level clock stopped from
 *    01:55:00 to 02:05:04 (level 6 began 02:15:04 after a 10-minute level 5).
 *    At 03:55 Chicago the break runs to the maintenance end (GameServer:
 *    "THE TOURNAMENT BREAK ENDS WHEN THE PLATFORM'S BREAK ENDS"), so the
 *    freeze adds nothing on top for an event that takes the break.
 *
 * So a level window is walked forward from its anchor, adding every future
 * pause it crosses; an add-on event counts to that boundary plus its minute,
 * then to the stamped end once there is one, labelled as the add-on phase.
 * A scheduled start that has not happened never supplies an estimate.
 */
import { tournamentEntryWindow } from '../../utils/tournamentEntryWindow';
import { blindLevelMinutes, parseBlindStructure } from './tournamentFigures';
import { mayTakeSynchronizedBreak } from '../../../server/src/tournament/breakEligibility';
import type { LobbyTournamentRow } from './lobbyEntries';

/** Mirrors TournamentManagerBase.addOnBreakDurationMs (owner 2026-10-31). */
export const ADD_ON_WINDOW_MS = 60_000;
/** The hourly synchronized break: starts :55 UTC; stops the level clock ~10 min (measured). */
const SYNC_BREAK_START_MINUTE = 55;
export const SYNC_BREAK_PAUSE_MS = 10 * 60_000;
/** The daily engine maintenance freeze: 04:00-04:05 America/Chicago. */
const MAINTENANCE_HOUR_CHICAGO = 4;
const MAINTENANCE_MS = 5 * 60_000;
const HOUR_MS = 3_600_000;
/** Never walk further than this looking for pauses (a two-day level window). */
const MAX_PAUSE_SCAN_HOURS = 48;

export type LateRegCountdownPhase = 'late_reg' | 'add_on';
export interface LateRegCountdown {
  endMs: number;
  phase: LateRegCountdownPhase;
}

type CountdownRow = LobbyTournamentRow;

const chicagoHour = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  hour: '2-digit',
  hourCycle: 'h23',
});

function isChicagoMaintenanceHour(utcHourStartMs: number): boolean {
  const hour = Number(
    chicagoHour.formatToParts(utcHourStartMs).find((part) => part.type === 'hour')?.value
  );
  return hour === MAINTENANCE_HOUR_CHICAGO;
}

function takesSynchronizedBreaks(t: CountdownRow): boolean {
  try {
    return mayTakeSynchronizedBreak(t);
  } catch {
    return false;
  }
}

/**
 * When `workMs` of level clock started at `startMs` runs out, adding every
 * clock-stopping pause that begins at or after `fromMs` and before the
 * (moving) end. Pauses already behind `fromMs` were absorbed by the engine's
 * re-anchor of `level_started_at`.
 */
export function shiftPastPauses(
  startMs: number,
  workMs: number,
  fromMs: number,
  syncBreaks: boolean
): number {
  let end = startMs + workMs;
  let hour = Math.floor(fromMs / HOUR_MS) * HOUR_MS;
  for (let scanned = 0; scanned < MAX_PAUSE_SCAN_HOURS && hour < end; scanned++) {
    const breakStart = hour + SYNC_BREAK_START_MINUTE * 60_000;
    if (syncBreaks && breakStart >= fromMs && breakStart < end) end += SYNC_BREAK_PAUSE_MS;
    const nextHour = hour + HOUR_MS;
    // An event that takes the 03:55 break is already stopped through the
    // freeze; only one that does not take breaks loses the freeze on top.
    if (!syncBreaks && nextHour >= fromMs && nextHour < end && isChicagoMaintenanceHour(nextHour))
      end += MAINTENANCE_MS;
    hour = nextHour;
  }
  return end;
}

/**
 * When the event's entry levels end, walking the clock forward from what the
 * row proves and adding the pauses still ahead of `now`.
 */
export function estimatedLevelWindowEndMs(
  t: CountdownRow,
  cap: number,
  current: number,
  now: number
): number | null {
  const structure = parseBlindStructure(t.blind_structure);
  if (!structure || cap > structure.length) return null;
  const minutesOf = (index: number): number | null => {
    const m = blindLevelMinutes(structure, index + 1);
    return Number.isFinite(m) && m > 0 ? m * 60_000 : null;
  };
  const begun = Date.parse(t.started_at ?? '');
  const syncBreaks = takesSynchronizedBreaks(t);

  let anchor = Date.parse(t.level_started_at ?? '');
  if (!Number.isFinite(anchor)) {
    // No level stamp yet (the seating gap right after the start, or a row read
    // between writes): the current level began at the actual start plus the
    // levels before it. A scheduled start never supplies one.
    if (!Number.isFinite(begun)) return null;
    anchor = begun;
    for (let index = 0; index < current; index++) {
      const ms = minutesOf(index);
      if (ms === null) return null;
      anchor += ms;
    }
  }
  let work = 0;
  for (let index = current; index < cap; index++) {
    const ms = minutesOf(index);
    if (ms === null) return null;
    work += ms;
  }

  // ON ITS OWN BREAK. The level clock stopped when the break began and the
  // engine will re-anchor it at the release, so the time already played in
  // this level is anchor -> break start, and play resumes at the break's end.
  if (t.on_break === true) {
    const breakEnds = Date.parse(t.break_ends_at ?? '');
    const hourStart = Math.floor(now / HOUR_MS) * HOUR_MS;
    let breakStart = hourStart + SYNC_BREAK_START_MINUTE * 60_000;
    if (breakStart > now) breakStart -= HOUR_MS;
    const played = Math.max(0, Math.min(breakStart - anchor, minutesOf(current) ?? 0));
    const resume = Math.max(
      now,
      breakStart + SYNC_BREAK_PAUSE_MS,
      Number.isFinite(breakEnds) ? breakEnds : 0
    );
    return shiftPastPauses(resume, work - played, resume + 1, syncBreaks);
  }
  return shiftPastPauses(anchor, work, now, syncBreaks);
}

/**
 * The countdown a lobby card shows, or null when late registration has no
 * deadline left to count to (closed, finalized, never started, or an add-on
 * event whose hands are still draining past the estimate).
 */
export function lateRegCountdown(t: LobbyTournamentRow, now: number): LateRegCountdown | null {
  const row = t as CountdownRow;
  if (row.prize_pool_finalized === true) return null;
  const window = tournamentEntryWindow(row);
  if (window.mode === 'closed') return null;
  const begun = Date.parse(row.started_at ?? '');
  if (!Number.isFinite(begun)) return null;

  if (row.add_on_available === true) {
    const end = Date.parse(row.addon_period_ends_at ?? '');
    const start = Date.parse(row.addon_period_started_at ?? '');
    // A legacy early offer is not the closing minute; the engine replaces it
    // after the drain, so it is ignored like an unstamped window.
    const legacyEarlyOffer = row.addon_from_start === true && end - start > ADD_ON_WINDOW_MS;
    if (Number.isFinite(end) && !legacyEarlyOffer) {
      return end > now ? { endMs: end, phase: 'add_on' } : null;
    }
    if (window.mode !== 'levels') return null;
    if (window.current >= window.cap) {
      // The entry levels are over and the hands are draining: the window
      // opens about now, and the boundary was the current level's anchor.
      const boundary = Date.parse(row.level_started_at ?? '');
      if (!Number.isFinite(boundary)) return null;
      const estimate = boundary + ADD_ON_WINDOW_MS;
      return estimate > now ? { endMs: estimate, phase: 'late_reg' } : null;
    }
    const levels = estimatedLevelWindowEndMs(row, window.cap, window.current, now);
    return levels === null ? null : { endMs: levels + ADD_ON_WINDOW_MS, phase: 'late_reg' };
  }

  const clock =
    window.minutes !== undefined && window.minutes > 0 ? begun + window.minutes * 60_000 : null;
  if (window.mode === 'minutes') {
    return clock !== null && clock > now ? { endMs: clock, phase: 'late_reg' } : null;
  }
  if (window.current >= window.cap) return null;
  const levels = estimatedLevelWindowEndMs(row, window.cap, window.current, now);
  const end = levels === null ? clock : clock === null ? levels : Math.min(levels, clock);
  return end !== null && end > now ? { endMs: end, phase: 'late_reg' } : null;
}
