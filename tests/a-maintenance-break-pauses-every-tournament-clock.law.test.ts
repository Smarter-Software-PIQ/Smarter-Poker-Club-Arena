import { beforeEach, describe, expect, it } from 'vitest';
import {
  levelClockNow,
  maintenanceClockFrozen,
  MAINTENANCE_LAST_HAND_LEAD_MS,
  noteMaintenanceClock,
  resetMaintenanceLevelClockForTests,
} from '../src/utils/maintenanceLevelClock';
import { tournamentService } from '../src/services/TournamentService';

/* LAW (Dan 2026-11-05): "IF THERE IS A MAINTENANCE BREAK IT NEEDS TO PAUSE ALL
   THE TOURNAMENT CLOCKS AS WELL, THEY SHOULD NOT BE RUNNING DURING A
   MAINTENANCE PAUSE." */

const MIN = 60_000;
const announced = Date.parse('2026-11-05T23:20:00.953Z');
const freeze = announced + MAINTENANCE_LAST_HAND_LEAD_MS;
const anchor = new Date(freeze - 4 * MIN).toISOString(); // 4 of 10 minutes played
const row = {
  id: 't1',
  status: 'RUNNING',
  started_at: new Date(freeze - 30 * MIN).toISOString(),
  current_level: 3,
  level_started_at: anchor,
  blind_structure: Array.from({ length: 10 }, (_, i) => ({
    level: i + 1,
    smallBlind: 100 * (i + 1),
    bigBlind: 200 * (i + 1),
    ante: 0,
    durationMinutes: 10,
  })),
} as never;

const state = (phase: string, active = true, breakStartedAtMs: number | null = freeze) => ({
  active,
  phase,
  breakStartedAtMs,
  breakId: announced,
});
const remaining = (now: number) =>
  tournamentService.getCurrentLevelState(row, now).timeRemainingSeconds;

describe('a maintenance break pauses every tournament clock', () => {
  beforeEach(() => resetMaintenanceLevelClockForTests());

  it('runs through the last-hand phase, then stops at the countdown start', () => {
    noteMaintenanceClock(state('last_hand', true, null), freeze - MIN);
    expect(maintenanceClockFrozen()).toBe(false);
    expect(remaining(freeze - MIN)).toBe(7 * 60);

    noteMaintenanceClock(state('counting_down'), freeze + 10_000);
    expect(maintenanceClockFrozen()).toBe(true);
    expect(remaining(freeze + 10_000)).toBe(6 * 60);
    expect(remaining(freeze + 4 * MIN)).toBe(6 * 60);
    noteMaintenanceClock(state('finalizing'), freeze + 5 * MIN);
    expect(remaining(freeze + 5 * MIN)).toBe(6 * 60);
  });

  it('derives the stop from the announcement when the engine has not sent it', () => {
    noteMaintenanceClock(state('counting_down', true, null), freeze + 30_000);
    expect(remaining(freeze + 3 * MIN)).toBe(6 * 60);
  });

  it('resumes where it stopped after the release, with no jump, until the row is re-read', () => {
    noteMaintenanceClock(state('counting_down'), freeze);
    expect(remaining(freeze + MIN)).toBe(6 * 60);
    noteMaintenanceClock(state('idle', false), freeze + 5 * MIN);
    expect(maintenanceClockFrozen()).toBe(false);
    // Same pre-freeze anchor: measured with the frozen five minutes removed.
    expect(remaining(freeze + 5 * MIN)).toBe(6 * 60);
    expect(remaining(freeze + 6 * MIN)).toBe(5 * 60);
    // The thaw's shifted anchor arrives: the real clock, same answer.
    const shifted = {
      ...(row as object),
      level_started_at: new Date(Date.parse(anchor) + 5 * MIN).toISOString(),
    } as never;
    expect(
      tournamentService.getCurrentLevelState(shifted, freeze + 6 * MIN).timeRemainingSeconds
    ).toBe(5 * 60);
    // The old anchor no longer gets credit once the shift has been seen.
    expect(remaining(freeze + 6 * MIN)).toBe(0);
  });

  it('never touches an event that is not running or is on its own break', () => {
    noteMaintenanceClock(state('counting_down'), freeze);
    expect(levelClockNow({ id: 'x', status: 'REGISTERING' }, freeze + MIN)).toBe(freeze + MIN);
    noteMaintenanceClock(state('idle', false), freeze + 5 * MIN);
    const onBreak = { id: 'b', status: 'RUNNING', on_break: true, level_started_at: anchor };
    expect(levelClockNow(onBreak, freeze + 6 * MIN)).toBe(freeze + 6 * MIN);
  });

  it('a later break starts a fresh freeze', () => {
    noteMaintenanceClock(state('counting_down'), freeze);
    noteMaintenanceClock(state('idle', false), freeze + 5 * MIN);
    const next = freeze + 60 * MIN;
    noteMaintenanceClock({ ...state('counting_down', true, next), breakId: next - 2 * MIN }, next);
    expect(levelClockNow(row as never, next + MIN)).toBe(next);
  });
});
