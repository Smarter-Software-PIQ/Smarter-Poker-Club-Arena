/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  LATE REGISTRATION WINDOW — extracted from lobbyEntries (2026-09-01)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * WHY THIS IS ITS OWN FILE.
 *
 * TournamentStartingTicker mounts at the app root, outside <Routes>, so every
 * module it imports lands in the ENTRY chunk that every player downloads
 * before first paint. It needed exactly one function from lobbyEntries, and
 * that single named import dragged the whole 1,482-line lobby module and its
 * dependency tree into the initial bundle: measured at +12kB gzipped on the
 * entry chunk, paid by every visitor whether or not they ever open a lobby.
 *
 * The function depends on the blind-structure parser and the dependency-free
 * entry-window display projection. Both readers import this small module. lobbyEntries re-exports it so existing
 * callers are unchanged. The row type is imported type-only, which TypeScript
 * erases, so nothing at runtime crosses back.
 */
import { tournamentEntryWindow } from '../../utils/tournamentEntryWindow';
import { blindLevelMinutes, parseBlindStructure } from './tournamentFigures';
import type { LobbyTournamentRow } from './lobbyEntries';

/**
 * When late registration closes: the level window's estimated end or the
 * configured clock deadline, WHICHEVER COMES FIRST - the same rule as
 * fn_tournament_late_registration_open. Never the later of the two.
 */
export function lateRegEndMs(t: LobbyTournamentRow): number | null {
  if (t.add_on_available === true) {
    const end = Date.parse(t.addon_period_ends_at ?? '');
    const start = Date.parse(t.addon_period_started_at ?? '');
    if (t.addon_from_start === true && end - start > 60000) return null;
    return t.prize_pool_finalized !== true && Number.isFinite(end) ? end : null;
  }
  const window = tournamentEntryWindow(t);
  const begun = Date.parse(t.started_at ?? '');
  const minutes = window.mode === 'closed' ? undefined : window.minutes;
  const clock =
    minutes !== undefined && minutes > 0 && Number.isFinite(begun) ? begun + minutes * 60000 : null;
  if (window.mode === 'minutes') return clock;
  if (window.mode !== 'levels' || window.current >= window.cap) return null;
  // An unreadable level clock is "could not tell", not the minute deadline:
  // the level window may still close first.
  const levels = levelWindowEndMs(t, window.cap, window.current);
  if (levels === null) return null;
  return clock === null ? levels : Math.min(levels, clock);
}

function levelWindowEndMs(t: LobbyTournamentRow, cap: number, current: number): number | null {
  const structure = parseBlindStructure(t.blind_structure);
  // A newly started event can publish its actual start before its first level
  // clock. Only level zero shares that confirmed boundary; later levels need
  // their own timestamp, and a scheduled start never supplies one.
  const levelBegun = Date.parse(
    t.level_started_at ?? (t.current_level === 0 ? t.started_at : null) ?? ''
  );
  if (!structure || cap > structure.length || !Number.isFinite(levelBegun)) return null;
  let end = levelBegun;
  for (let index = current; index < cap; index++) {
    const minutes = blindLevelMinutes(structure, index + 1);
    if (!Number.isFinite(minutes) || minutes <= 0) return null;
    end += minutes * 60000;
  }
  return end;
}

/**
 * THE LOBBY CARD COUNTDOWN. Dan 2026-11-06, on the Nightly 10K (rebuy and
 * add-on) reading "Late Reg Open" while the 25 Chip Daily Rebuy beside it
 * counted down: "FIX IT SO IT ALWAYS SHOWS THE COUNT DOWN".
 *
 * `lateRegEndMs` above is the strict deadline: it answers null whenever it
 * cannot prove one, and the Details tab and the at-table call to action rely
 * on that so they never print an invented wall-clock time. A lobby card has a
 * different job - it must keep a clock running. So this starts from the strict
 * deadline and, only where that is null while late registration is still
 * ahead, falls back to the best estimate the row supports:
 *  - an add-on event has no `addon_period_ends_at` until its add-on minute
 *    begins, so before that it counts to the level/clock boundary that opens
 *    the add-on minute (whichever of the two closes first);
 *  - a level clock with no stamp yet (the seating gap after the start, or a
 *    row read between writes) is estimated from the actual start plus the
 *    levels already played;
 *  - an unreadable blind structure falls back to the configured minutes.
 * A scheduled start that has not happened never supplies an estimate, and a
 * finalized pool or a passed boundary still shows nothing.
 */
export function lateRegCountdownEndMs(t: LobbyTournamentRow): number | null {
  const strict = lateRegEndMs(t);
  if (strict !== null) return strict;
  if (t.prize_pool_finalized === true) return null;
  const window = tournamentEntryWindow(t);
  if (window.mode === 'closed') return null;
  if (window.mode === 'levels' && window.current >= window.cap) return null;
  const begun = Date.parse(t.started_at ?? '');
  if (!Number.isFinite(begun)) return null;
  // An add-on event's minute is opened by the LAST ENTRY LEVEL ending
  // (TournamentManagerBase opens it "after level <late_reg_levels>"); its
  // configured minutes never close entry. Measured 2026-11-07: the Nightly
  // 10K's 90-minute clock ran out at 02:30 UTC with entry still open until
  // level 9 ended, so counting to the clock showed "Late Reg Open" again.
  const addOn = t.add_on_available === true;
  const clock =
    !addOn && window.minutes !== undefined && window.minutes > 0
      ? begun + window.minutes * 60000
      : null;
  if (window.mode === 'minutes') return clock;
  const levels = estimatedLevelWindowEndMs(t, window.cap, window.current, begun);
  if (levels === null) return clock;
  return clock === null ? levels : Math.min(levels, clock);
}

function estimatedLevelWindowEndMs(
  t: LobbyTournamentRow,
  cap: number,
  current: number,
  begun: number
): number | null {
  const structure = parseBlindStructure(t.blind_structure);
  if (!structure || cap > structure.length) return null;
  const minutesOf = (index: number): number | null => {
    const m = blindLevelMinutes(structure, index + 1);
    return Number.isFinite(m) && m > 0 ? m : null;
  };
  let end = Date.parse(t.level_started_at ?? '');
  if (!Number.isFinite(end)) {
    end = begun;
    for (let index = 0; index < current; index++) {
      const m = minutesOf(index);
      if (m === null) return null;
      end += m * 60000;
    }
  }
  for (let index = current; index < cap; index++) {
    const m = minutesOf(index);
    if (m === null) return null;
    end += m * 60000;
  }
  return end;
}
