import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { addOnClockHold, resetAddOnLevelClockForTests } from '../src/utils/addOnLevelClock';
import { resetMaintenanceLevelClockForTests } from '../src/utils/maintenanceLevelClock';
import { tournamentService } from '../src/services/TournamentService';

/* LAW (Dan 2026-11-18): "WHEN THE ADD ON PERIOD STARTS AND HANDS ARE PAUSED,
   THE NEXT LEVEL STAYS PAUSED UNTIL THE REBUY PERIOD IS OVER... IT CURRENTLY
   KEEPS RUNNING UNTIL THE ADD ON STARTS. IT SHOULDN'T DO THAT, IT SHOULD PAUSE
   AND WAIT FOR ALL HANDS TO FINISH AND THE REBUY PERIOD END, BEFORE THE NEXT
   LEVEL STARTS." */

const MIN = 60_000;
const t0 = Date.parse('2026-11-18T01:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();
const structure = Array.from({ length: 12 }, (_, i) => ({
  level: i + 1,
  smallBlind: 100 * (i + 1),
  bigBlind: 200 * (i + 1),
  ante: 0,
  durationMinutes: 10,
}));

/** An event whose entry closes on a level: the cap is reached at level index 6. */
const levelEvent = (over: Record<string, unknown> = {}) =>
  ({
    id: 'levels',
    status: 'RUNNING',
    started_at: iso(t0),
    current_level: 6,
    level_started_at: iso(t0 + 60 * MIN),
    late_reg_levels: 6,
    add_on_available: true,
    prize_pool_finalized: false,
    addon_from_start: false,
    addon_period_started_at: null,
    addon_period_ends_at: null,
    blind_structure: structure,
    ...over,
  }) as never;

/** An event whose entry closes on the clock, 30 minutes in, mid-level. */
const minutesEvent = (over: Record<string, unknown> = {}) =>
  ({
    id: 'minutes',
    status: 'RUNNING',
    started_at: iso(t0),
    current_level: 2,
    level_started_at: iso(t0 + 26 * MIN), // four of ten minutes played at the boundary
    late_reg_mins: 30,
    add_on_available: true,
    prize_pool_finalized: false,
    addon_from_start: false,
    addon_period_started_at: null,
    addon_period_ends_at: null,
    blind_structure: structure,
    ...over,
  }) as never;

const remaining = (row: never, now: number) =>
  tournamentService.getCurrentLevelState(row, now).timeRemainingSeconds;

beforeEach(() => {
  resetAddOnLevelClockForTests();
  resetMaintenanceLevelClockForTests();
});

describe('the add-on phase stops the level clock a player reads', () => {
  it('before the entry boundary the clock runs', () => {
    const row = minutesEvent();
    expect(addOnClockHold(row, t0 + 29 * MIN).phase).toBe('none');
    expect(remaining(row, t0 + 28 * MIN)).toBe(8 * 60);
    expect(remaining(row, t0 + 29 * MIN)).toBe(7 * 60);
  });

  it('holds through the drain: hands are finishing, the level is not being spent', () => {
    const row = minutesEvent();
    // The boundary passed at 30:00 with six minutes of the level left.
    for (const now of [t0 + 30 * MIN, t0 + 30 * MIN + 45_000, t0 + 32 * MIN]) {
      expect(addOnClockHold(row, now).phase).toBe('drain');
      expect(remaining(row, now)).toBe(6 * 60);
    }
  });

  it('holds through the paid minute at the same instant, with no jump when it opens', () => {
    // Every table parked 90 seconds after the boundary; the minute opened then.
    const row = minutesEvent({
      addon_period_started_at: iso(t0 + 31.5 * MIN),
      addon_period_ends_at: iso(t0 + 32.5 * MIN),
    });
    const hold = addOnClockHold(row, t0 + 32 * MIN);
    expect(hold.phase).toBe('minute');
    expect(remaining(row, t0 + 31.5 * MIN + 1)).toBe(6 * 60);
    expect(remaining(row, t0 + 32.4 * MIN)).toBe(6 * 60);
  });

  it('after the minute, waits for the re-anchor instead of dipping and jumping back', () => {
    const held = minutesEvent({
      addon_period_started_at: iso(t0 + 31.5 * MIN),
      addon_period_ends_at: iso(t0 + 32.5 * MIN),
    });
    expect(remaining(held, t0 + 32.4 * MIN)).toBe(6 * 60);
    // The minute is over; this row has not been re-read yet.
    expect(addOnClockHold(held, t0 + 32.5 * MIN + 2000).phase).toBe('releasing');
    expect(remaining(held, t0 + 32.5 * MIN + 2000)).toBe(6 * 60);
    // The engine re-anchored the level for the six minutes it gave back.
    const resumed = minutesEvent({
      level_started_at: iso(t0 + 32.5 * MIN - 4 * MIN),
      addon_period_started_at: iso(t0 + 31.5 * MIN),
      addon_period_ends_at: iso(t0 + 32.5 * MIN),
      prize_pool_finalized: true,
    });
    expect(addOnClockHold(resumed, t0 + 32.5 * MIN + 3000).phase).toBe('none');
    expect(remaining(resumed, t0 + 33.5 * MIN)).toBe(5 * 60);
  });

  it('a row never re-read is trusted again after the grace, not held for ever', () => {
    const held = minutesEvent({
      addon_period_started_at: iso(t0 + 31.5 * MIN),
      addon_period_ends_at: iso(t0 + 32.5 * MIN),
    });
    remaining(held, t0 + 32 * MIN);
    expect(addOnClockHold(held, t0 + 32.5 * MIN + 11_000).phase).toBe('none');
  });

  it('a level boundary holds the new level whole until the add-on is over', () => {
    const row = levelEvent();
    // Level index 6 began at 60:00 and reached the cap: the drain began with it.
    expect(addOnClockHold(row, t0 + 61 * MIN).phase).toBe('drain');
    expect(remaining(row, t0 + 61 * MIN)).toBe(10 * 60);
    const minute = levelEvent({
      addon_period_started_at: iso(t0 + 61 * MIN),
      addon_period_ends_at: iso(t0 + 62 * MIN),
    });
    expect(remaining(minute, t0 + 61.9 * MIN)).toBe(10 * 60);
  });

  it('holds nothing for an event with no add-on, a finished add-on, or one not running', () => {
    expect(addOnClockHold(minutesEvent({ add_on_available: false }), t0 + 31 * MIN).phase).toBe(
      'none'
    );
    expect(addOnClockHold(minutesEvent({ prize_pool_finalized: true }), t0 + 31 * MIN).phase).toBe(
      'none'
    );
    expect(addOnClockHold(minutesEvent({ status: 'COMPLETED' }), t0 + 31 * MIN).phase).toBe('none');
    // A level past the cap means play went on: the row is the clock.
    expect(addOnClockHold(levelEvent({ current_level: 7 }), t0 + 75 * MIN).phase).toBe('none');
  });

  it('every level clock reads through it, and the dock says the drain is a pause', () => {
    const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
    expect(src('src/utils/maintenanceLevelClock.ts')).toContain(
      'return addOnClockNow(row, maintenanceClockNow(row, nowMs));'
    );
    const hud = src('src/components/tournament/TournamentHUD.tsx');
    expect(hud).toContain("if (addOn.phase === 'drain') return { kind: 'break', endsAtMs: null };");
    // A viewer who missed the frame that opens the minute re-reads while the
    // drain lasts, so the dock cannot sit on Last Hand until the safety read.
    expect(hud).toContain(
      'return { key: `addon-drain:${slot}`, atMs: slot * ADD_ON_DRAIN_REREAD_MS };'
    );
  });
});
