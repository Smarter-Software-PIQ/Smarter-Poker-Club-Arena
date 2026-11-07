import { describe, expect, it } from 'vitest';
import {
  ADD_ON_WINDOW_MS,
  SYNC_BREAK_PAUSE_MS,
  lateRegCountdown,
  shiftPastPauses,
} from '../../src/components/lobby/lateRegCountdown';
import { lateRegEndMs } from '../../src/components/lobby/lateRegWindow';
import {
  mttPhaseText,
  tournamentStatus,
  type LobbyEntry,
  type LobbyTournamentRow,
} from '../../src/components/lobby/lobbyEntries';
import { tournamentClockLine } from '../../src/components/lobby/LobbyTable';

/*
 * Dan 2026-11-06: "FIX IT SO IT ALWAYS SHOWS THE COUNT DOWN", then "FULLY
 * BUILD, FIX AND ENHANCE ALL OF THESE". Fixtures are the production Nightly
 * 10K (66eb539e) as it was read on the night: mtt-v2, synchronized breaks on,
 * 10-minute levels, 9 entry levels, 90 late-reg minutes, rebuy and add-on.
 */
const tenLevels = JSON.stringify(
  Array.from({ length: 40 }, (_, i) => ({ level: i + 1, durationMinutes: 10 }))
);
const at = (iso: string) => Date.parse(iso);
const nightly = (over: Record<string, unknown> = {}) =>
  ({
    id: '66eb539e',
    name: 'Nightly 10K (NLH)',
    game_type: 'NLH',
    buy_in_amount: 35,
    buy_in_fee: 0,
    guaranteed_prize: 10000,
    start_time: '2026-11-07T01:00:00+00:00',
    status: 'RUNNING',
    current_players: 75,
    max_players: null,
    starting_chips: 10000,
    format_contract: 'mtt-v2',
    tournament_type: 'MTT',
    synchronized_breaks: true,
    started_at: '2026-11-07T01:00:00+00:00',
    late_reg_mins: 90,
    late_reg_levels: 9,
    rebuy_levels: 9,
    prize_pool_finalized: false,
    current_level: 3,
    level_started_at: '2026-11-07T01:35:01.264+00:00',
    blind_structure: tenLevels,
    add_on_available: true,
    addon_from_start: false,
    addon_period_started_at: null,
    addon_period_ends_at: null,
    on_break: false,
    break_ends_at: null,
    ...over,
  }) as unknown as LobbyTournamentRow;

const entryOf = (raw: LobbyTournamentRow): LobbyEntry =>
  ({
    id: raw.id,
    kind: 'mtt',
    name: raw.name,
    status: 'late_reg',
    statusLabel: 'Late Reg Open',
    startTime: raw.start_time,
    raw,
  }) as unknown as LobbyEntry;

describe('lateRegCountdown - the Nightly 10K on 2026-11-07', () => {
  it('counts through the 01:55 break to the add-on minute (actual close 02:47:49)', () => {
    const now = at('2026-11-07T01:40:00Z');
    // Levels 4-9 are 60 minutes of clock from 01:35:01; the 01:55 break stops
    // it for the measured ten minutes; then the 60-second add-on minute.
    expect(lateRegCountdown(nightly(), now)).toEqual({
      endMs: at('2026-11-07T01:35:01.264Z') + 60 * 60_000 + SYNC_BREAK_PAUSE_MS + ADD_ON_WINDOW_MS,
      phase: 'late_reg',
    });
    // 02:46:01, against the real window 02:46:49 - 02:47:49. Ignoring the
    // break said 02:36:01, and the strict deadline still says nothing.
    expect(lateRegCountdown(nightly(), now)!.endMs).toBe(at('2026-11-07T02:46:01.264Z'));
    expect(lateRegEndMs(nightly())).toBeNull();
  });

  it('a break already behind the anchor is not counted twice', () => {
    // Level 7 began 02:25:05, after the 01:55 break was re-anchored away.
    const row = nightly({ current_level: 7, level_started_at: '2026-11-07T02:25:05.302Z' });
    expect(lateRegCountdown(row, at('2026-11-07T02:34:19Z'))!.endMs).toBe(
      at('2026-11-07T02:45:05.302Z') + ADD_ON_WINDOW_MS
    );
  });

  it('on its own break, counts from the resume, not the frozen level clock', () => {
    const row = nightly({
      current_level: 5,
      level_started_at: '2026-11-07T01:55:00Z',
      on_break: true,
      break_ends_at: '2026-11-07T02:01:30Z',
    });
    // Nothing of level 5 was played; play resumes ~02:05 (measured 02:05:04).
    expect(lateRegCountdown(row, at('2026-11-07T01:58:00Z'))!.endMs).toBe(
      at('2026-11-07T02:05:00Z') + 40 * 60_000 + ADD_ON_WINDOW_MS
    );
  });

  it('keeps counting while the entry levels drain into the add-on minute', () => {
    const row = nightly({ current_level: 9, level_started_at: '2026-11-07T02:45:05Z' });
    expect(lateRegCountdown(row, at('2026-11-07T02:45:30Z'))).toEqual({
      endMs: at('2026-11-07T02:46:05Z'),
      phase: 'late_reg',
    });
    // A drain longer than the estimate has nothing honest left to count.
    expect(lateRegCountdown(row, at('2026-11-07T02:46:30Z'))).toBeNull();
  });

  it('labels the stamped add-on minute as the add-on phase, then closes', () => {
    const row = nightly({
      current_level: 9,
      level_started_at: '2026-11-07T02:45:05Z',
      addon_period_started_at: '2026-11-07T02:46:49.575Z',
      addon_period_ends_at: '2026-11-07T02:47:49.575Z',
    });
    expect(lateRegCountdown(row, at('2026-11-07T02:47:00Z'))).toEqual({
      endMs: at('2026-11-07T02:47:49.575Z'),
      phase: 'add_on',
    });
    expect(lateRegCountdown(row, at('2026-11-07T02:47:50Z'))).toBeNull();
  });

  it('a legacy early add-on offer is not mistaken for the closing minute', () => {
    const row = nightly({
      addon_from_start: true,
      addon_period_started_at: '2026-11-07T01:00:00Z',
      addon_period_ends_at: '2026-11-07T01:30:00Z',
    });
    expect(lateRegCountdown(row, at('2026-11-07T01:40:00Z'))!.phase).toBe('late_reg');
  });

  it('never estimates from a start that has not happened, or a finalized pool', () => {
    const now = at('2026-11-07T01:40:00Z');
    expect(lateRegCountdown(nightly({ started_at: null, level_started_at: null }), now)).toBeNull();
    expect(lateRegCountdown(nightly({ prize_pool_finalized: true }), now)).toBeNull();
  });
});

describe('lateRegCountdown - ordinary events and the daily freeze', () => {
  it('an ordinary event still closes at the earlier of its levels and its minutes', () => {
    const row = nightly({ add_on_available: false, late_reg_mins: 60 });
    expect(lateRegCountdown(row, at('2026-11-07T01:40:00Z'))!.endMs).toBe(
      at('2026-11-07T02:00:00Z')
    );
  });

  it('an event that does not take breaks loses the 04:00 Chicago freeze to its level clock', () => {
    // 04:00 CST is 10:00 UTC on 2026-11-07. Six 10-minute levels from 09:35.
    const row = nightly({
      add_on_available: false,
      late_reg_mins: 0,
      synchronized_breaks: false,
      late_reg_levels: 6,
      current_level: 0,
      started_at: '2026-11-07T09:30:00Z',
      level_started_at: '2026-11-07T09:35:00Z',
    });
    expect(lateRegCountdown(row, at('2026-11-07T09:40:00Z'))!.endMs).toBe(
      at('2026-11-07T10:40:00Z')
    );
  });

  it('follows Chicago daylight time for the freeze (04:00 CDT is 09:00 UTC)', () => {
    expect(
      shiftPastPauses(at('2026-07-10T08:30:00Z'), 60 * 60_000, at('2026-07-10T08:30:00Z'), false)
    ).toBe(at('2026-07-10T09:35:00Z'));
    expect(
      shiftPastPauses(at('2026-07-10T09:30:00Z'), 60 * 60_000, at('2026-07-10T09:30:00Z'), false)
    ).toBe(at('2026-07-10T10:30:00Z'));
  });

  it('a break-taking event is stopped through the freeze by its 03:55 break, not twice', () => {
    // 03:55 CST = 09:55 UTC: one ten-minute stop covers the 10:00 freeze.
    expect(
      shiftPastPauses(at('2026-11-07T09:30:00Z'), 60 * 60_000, at('2026-11-07T09:30:00Z'), true)
    ).toBe(at('2026-11-07T10:40:00Z'));
  });
});

describe('the lobby text reads the countdown', () => {
  it('Late Reg Ends In, then Add-On Ends In, then Add-On Starting only in a long drain', () => {
    expect(mttPhaseText(entryOf(nightly()), at('2026-11-07T01:40:00Z'))).toBe(
      'Late Reg Ends In 66:02'
    );
    const stamped = nightly({
      current_level: 9,
      level_started_at: '2026-11-07T02:45:05Z',
      addon_period_triggered: true,
      addon_period_started_at: '2026-11-07T02:46:49.575Z',
      addon_period_ends_at: '2026-11-07T02:47:49.575Z',
    });
    expect(mttPhaseText(entryOf(stamped), at('2026-11-07T02:47:00Z'))).toBe('Add-On Ends In 0:50');
    const draining = nightly({ current_level: 9, level_started_at: '2026-11-07T02:45:05Z' });
    expect(mttPhaseText(entryOf(draining), at('2026-11-07T02:46:30Z'))).toBe('Add-On Starting');
  });

  it('the row clock treats the add-on countdown as a late-reg clock and the drain as no clock', () => {
    const stamped = nightly({
      current_level: 9,
      level_started_at: '2026-11-07T02:45:05Z',
      addon_period_triggered: true,
      addon_period_started_at: '2026-11-07T02:46:49.575Z',
      addon_period_ends_at: '2026-11-07T02:47:49.575Z',
    });
    expect(tournamentClockLine(entryOf(stamped), at('2026-11-07T02:47:00Z'))).toEqual({
      tone: 'late',
      text: 'Add-On Ends In 0:50',
    });
    const draining = nightly({ current_level: 9, level_started_at: '2026-11-07T02:45:05Z' });
    expect(tournamentClockLine(entryOf(draining), at('2026-11-07T02:46:30Z'))).toBeNull();
  });
});

describe('the board status follows the add-on window', () => {
  it('stays Late Reg Open through the drain and the add-on minute, then Running', () => {
    const draining = nightly({ current_level: 9, level_started_at: '2026-11-07T02:45:05Z' });
    expect(tournamentStatus(draining, at('2026-11-07T02:46:30Z'))).toEqual({
      key: 'late_reg',
      label: 'Late Reg Open',
    });
    const stamped = nightly({
      current_level: 9,
      level_started_at: '2026-11-07T02:45:05Z',
      addon_period_triggered: true,
      addon_period_started_at: '2026-11-07T02:46:49.575Z',
      addon_period_ends_at: '2026-11-07T02:47:49.575Z',
    });
    expect(tournamentStatus(stamped, at('2026-11-07T02:47:00Z')).key).toBe('late_reg');
    expect(tournamentStatus(stamped, at('2026-11-07T02:47:50Z'))).toEqual({
      key: 'running',
      label: 'Running',
    });
  });
});
