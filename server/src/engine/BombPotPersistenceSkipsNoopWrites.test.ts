/**
 * Regression tests: Bomb-pot scheduler persistence and table player-count
 * updates skip no-op writes on `public.tables` (a 154-column table in
 * `supabase_realtime`, ~28.4 ms of WAL decode CPU per UPDATE).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BOMB_POT_CLEAR_CHANGED_FILTER,
  BombPotScheduler,
  canonicalBombPotPersistKey,
  type BombPotSchedulerSettings,
} from './BombPotScheduler.js';

function timedSettings(
  overrides: Partial<BombPotSchedulerSettings> = {}
): BombPotSchedulerSettings {
  return {
    enabled: true,
    triggerMode: 'timed',
    frequency: 10,
    intervalSeconds: 1800, // 30 minutes
    minPlayers: 3,
    ...overrides,
  };
}

describe('BombPotScheduler avoids no-op persistence diffs on timed and bomb_pot_only tables', () => {
  it('keeps exportState and persist key identical across fluctuating player counts during the timed idle window', () => {
    const scheduler = new BombPotScheduler(() => 0.0);
    const settings = timedSettings();
    const t0 = Date.parse('2026-11-19T18:00:00.000Z');

    // Hand 1 establishes nextDueAtMs (+30 min) — real state transition.
    const d1 = scheduler.noteHandStart(settings, 1, 6, t0);
    expect(d1.isBombPot).toBe(false);
    const due1 = scheduler.nextBombDueAt(settings);
    expect(due1).toBe(t0 + 1_800_000);
    const keyAfterHand1 = canonicalBombPotPersistKey(
      { ...scheduler.exportState(), b: null },
      new Date(due1!).toISOString()
    );

    // Hands 2..5 in the 27-minute idle window with seat count changing every hand
    // (6 -> 4 -> 5 -> 3 -> 6). Nothing about the timed schedule moved.
    for (const [idx, count] of [4, 5, 3, 6].entries()) {
      const now = t0 + (idx + 1) * 60_000;
      const d = scheduler.noteHandStart(settings, (idx % 6) + 1, count, now);
      expect(d.isBombPot).toBe(false);
      const due = scheduler.nextBombDueAt(settings);
      const key = canonicalBombPotPersistKey(
        { ...scheduler.exportState(), b: null },
        due !== null ? new Date(due).toISOString() : null
      );
      expect(key).toBe(keyAfterHand1);
    }

    // Entering the 3-minute arm window (at +27m01s): armedHands is drawn and
    // nextBombDueAt retires to null — MUST produce a new key immediately.
    const armNow = t0 + 27 * 60_000 + 1_000;
    const dArm = scheduler.noteHandStart(settings, 2, 5, armNow);
    expect(dArm.isBombPot).toBe(false);
    expect(scheduler.armedHandsUntilDue()).toBe(1);
    expect(scheduler.nextBombDueAt(settings)).toBeNull();
    const keyArmed = canonicalBombPotPersistKey({ ...scheduler.exportState(), b: null }, null);
    expect(keyArmed).not.toBe(keyAfterHand1);

    // Next hand fires the bomb and schedules the next 30-minute cycle — MUST write.
    const fireNow = armNow + 30_000;
    const dFire = scheduler.noteHandStart(settings, 3, 5, fireNow);
    expect(dFire.isBombPot).toBe(true);
    const dueNext = scheduler.nextBombDueAt(settings);
    expect(dueNext).toBe(fireNow + 1_800_000);
    const keyAfterFire = canonicalBombPotPersistKey(
      { ...scheduler.exportState(), b: null },
      new Date(dueNext!).toISOString()
    );
    expect(keyAfterFire).not.toBe(keyArmed);
    expect(keyAfterFire).not.toBe(keyAfterHand1);
  });

  it('matches the loaded Postgres row on Hand 1 after restart despite jsonb key order and +00:00 timestamp format', () => {
    const t0 = Date.parse('2026-11-19T18:00:00.000Z');
    const dueMs = t0 + 1_800_000; // 2026-11-19T18:30:00.000Z
    // Postgres returns jsonb keys in canonical order and timestamptz with +00:00.
    const loadedFromPg = {
      a: null,
      b: null,
      d: dueMs,
      h: 0,
      l: null,
      m: null,
      n: 0,
      o: 0,
      p: false,
      r: null,
      x: false,
    };
    const loadedDueAtFromPg = '2026-11-19T18:30:00+00:00';

    const baselineKey = canonicalBombPotPersistKey(loadedFromPg, loadedDueAtFromPg);

    const scheduler = new BombPotScheduler();
    scheduler.restoreState(loadedFromPg);
    const settings = timedSettings();

    // Hand 1 after restart, 10 minutes before due, with 5 players dealt in.
    const decision = scheduler.noteHandStart(settings, 4, 5, t0 + 1_200_000);
    expect(decision.isBombPot).toBe(false);
    const dueAfterHand1 = scheduler.nextBombDueAt(settings);
    const keyAfterHand1 = canonicalBombPotPersistKey(
      { ...scheduler.exportState(), b: null },
      dueAfterHand1 !== null ? new Date(dueAfterHand1).toISOString() : null
    );
    expect(keyAfterHand1).toBe(baselineKey);
  });

  it('keeps exportState identical across fluctuating player counts in bomb_pot_only mode', () => {
    const scheduler = new BombPotScheduler();
    const settings = timedSettings({ triggerMode: 'bomb_pot_only', minPlayers: 3 });

    scheduler.noteHandStart(settings, 1, 6, 1000);
    const key1 = canonicalBombPotPersistKey({ ...scheduler.exportState(), b: null }, null);

    scheduler.noteHandStart(settings, 2, 4, 2000);
    const key2 = canonicalBombPotPersistKey({ ...scheduler.exportState(), b: null }, null);

    scheduler.noteHandStart(settings, 3, 2, 3000);
    const key3 = canonicalBombPotPersistKey({ ...scheduler.exportState(), b: null }, null);

    expect(key2).toBe(key1);
    expect(key3).toBe(key1);
  });

  it('still tracks dealtInCount accurately for once_per_orbit countdowns', () => {
    const scheduler = new BombPotScheduler();
    const settings = timedSettings({ triggerMode: 'once_per_orbit', minPlayers: 3 });

    scheduler.noteHandStart(settings, 1, 6, 1000);
    expect(scheduler.exportState().n).toBe(6);
    expect(scheduler.handsUntilDue(settings)).toBe(6);

    scheduler.noteHandStart(settings, 2, 4, 2000);
    expect(scheduler.exportState().n).toBe(4);
    expect(scheduler.handsUntilDue(settings)).toBe(3);
  });
});

describe('canonicalBombPotPersistKey', () => {
  it('returns literal "null" when both state and dueAt are empty (compatible with existing tests)', () => {
    expect(canonicalBombPotPersistKey(null, null)).toBe('null');
    expect(canonicalBombPotPersistKey(undefined, undefined)).toBe('null');
  });

  it('distinguishes a legacy non-null bomb_pot_next_due_at from empty so disabling still clears it', () => {
    const legacyKey = canonicalBombPotPersistKey(null, '2026-11-19T18:30:00+00:00');
    const clearedKey = canonicalBombPotPersistKey(null, null);
    expect(legacyKey).not.toBe(clearedKey);
  });
});

describe('realtime no-op write guards are wired into engine and client table writers', () => {
  it('ServerTableEngineDealing seeds bombPotSchedPersistedJson from tableInfo and guards null clears', () => {
    const dealingSrc = readFileSync(
      join(process.cwd(), 'src/engine/ServerTableEngineDealing.ts'),
      'utf8'
    );
    expect(dealingSrc).toContain('canonicalBombPotPersistKey(');
    expect(dealingSrc).toContain('this.tableInfo.bomb_pot_sched_state ?? null');
    expect(dealingSrc).toContain('this.tableInfo.bomb_pot_next_due_at ?? null');
    expect(dealingSrc).toContain('query = query.or(BOMB_POT_CLEAR_CHANGED_FILTER)');
    expect(BOMB_POT_CLEAR_CHANGED_FILTER).toBe(
      'bomb_pot_sched_state.not.is.null,bomb_pot_next_due_at.not.is.null'
    );
  });

  it('TableService.updatePlayerCount guards against writing unchanged current_players', () => {
    const tableServiceSrc = readFileSync(
      join(process.cwd(), '../src/services/TableService.ts'),
      'utf8'
    );
    expect(tableServiceSrc).toContain(
      '.or(`current_players.is.null,current_players.neq.${count}`)'
    );
  });
});
