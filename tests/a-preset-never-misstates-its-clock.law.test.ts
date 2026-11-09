import { describe, expect, it } from 'vitest';
import {
  PREBUILT_STRUCTURES,
  PRESET_CLOCK_SUPPORT,
  offerablePrebuiltStructures,
  prebuiltLadder,
  prebuiltLateRegLevels,
  prebuiltStartingChips,
  presetClockIsPreserved,
  parsePrebuiltStructureKey,
  prebuiltStructureKey,
  MIN_LATE_ENTRY_BB,
} from '../src/config/prebuiltStructures';

/**
 * A preset is never offered to a creator while production would rewrite its
 * stated duration. Measured against the live database 2026-11-09: the 5 minute
 * floor in fn_ca_minimum_tournament_levels raises a 3 minute ladder, and the
 * cap in fn_ca_lock_structure_clock cuts anything above 8 minutes (10 when the
 * event is pinned). A control labelled "30 minute levels" that produces eight
 * minute levels misstates the game to whoever sits down.
 */
describe('a preset never misstates its clock', () => {
  it('offers only the presets production preserves', () => {
    expect(offerablePrebuiltStructures(false).map((s) => s.id)).toEqual(['turbo', 'regular']);
  });

  it('offers Deep Stack only where the event is pinned', () => {
    expect(presetClockIsPreserved('deep_stack', false)).toBe(false);
    expect(presetClockIsPreserved('deep_stack', true)).toBe(true);
    expect(offerablePrebuiltStructures(true).map((s) => s.id)).toEqual([
      'turbo',
      'regular',
      'deep_stack',
    ]);
  });

  it('never offers a preset the clock floor or cap would rewrite', () => {
    for (const id of ['hyper_turbo', 'super_deep', 'slow_regular'] as const) {
      expect(PRESET_CLOCK_SUPPORT[id]).toBe('rewritten');
      expect(presetClockIsPreserved(id, false)).toBe(false);
      expect(presetClockIsPreserved(id, true)).toBe(false);
    }
  });

  it('keeps one fixed duration across every playable level of every preset', () => {
    for (const spec of PREBUILT_STRUCTURES) {
      const played = prebuiltLadder(spec.id).filter((row) => !row.isBreak);
      expect(played.length).toBeGreaterThan(0);
      for (const row of played) expect(row.durationMinutes).toBe(spec.minutes);
    }
  });

  it('opens every preset at 25/50 so nothing is clamped into a repeat', () => {
    for (const spec of PREBUILT_STRUCTURES) {
      const rows = prebuiltLadder(spec.id);
      expect([rows[0].smallBlind, rows[0].bigBlind]).toEqual([25, 50]);
      const played = rows.filter((row) => !row.isBreak);
      for (let i = 1; i < played.length; i += 1) {
        expect(played[i].bigBlind).toBeGreaterThan(played[i - 1].bigBlind);
      }
    }
  });

  it('closes registration while a late entry still has a tournament to play', () => {
    for (const spec of PREBUILT_STRUCTURES) {
      const chips = prebuiltStartingChips(spec.id);
      const played = prebuiltLadder(spec.id).filter((row) => !row.isBreak);
      const cutoff = played[prebuiltLateRegLevels(spec.id) - 1];
      expect(Math.floor(chips / cutoff.bigBlind)).toBeGreaterThanOrEqual(MIN_LATE_ENTRY_BB);
    }
  });

  it('gives every preset breaks that carry no blinds', () => {
    for (const spec of PREBUILT_STRUCTURES) {
      for (const row of prebuiltLadder(spec.id).filter((r) => r.isBreak)) {
        expect([row.smallBlind, row.bigBlind, row.ante]).toEqual([0, 0, 0]);
      }
    }
  });
});

describe('a prebuilt key never collides with a legacy ramp', () => {
  it('namespaces every stored key so existing values keep their own ladder', () => {
    // 'turbo', 'regular' and 'hyper_turbo' are prebuilt ids AND legacy stored
    // values. A bare id would silently re-point every table and schedule
    // holding 'turbo' or 'hyper_turbo' at a different ladder.
    for (const legacy of ['slow', 'standard', 'turbo', 'hyper_turbo']) {
      expect(parsePrebuiltStructureKey(legacy)).toBeNull();
    }
    for (const spec of PREBUILT_STRUCTURES) {
      const key = prebuiltStructureKey(spec.id);
      expect(key.startsWith('prebuilt:')).toBe(true);
      expect(parsePrebuiltStructureKey(key)).toBe(spec.id);
    }
  });

  it('reads nothing unexpected as a prebuilt structure', () => {
    for (const value of [null, undefined, 42, '', 'prebuilt:', 'prebuilt:nope', {}]) {
      expect(parsePrebuiltStructureKey(value)).toBeNull();
    }
  });
});
