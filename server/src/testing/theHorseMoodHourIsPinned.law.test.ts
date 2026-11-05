/**
 * LAW: THE HORSE MOOD HOUR IS PINNED FOR THE SUITE, AND ONLY FOR THE SUITE.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { HorseLogic, HORSE_MOOD_TEST_CLOCK_KEY } from '../engine/HorseLogic.js';
import { PINNED_HORSE_MOOD_CLOCK_MS } from './theHorseMoodHourIsPinned.js';

describe('the horse mood hour', () => {
  it('is pinned by the suite setup under the key HorseLogic reads', () => {
    expect(HORSE_MOOD_TEST_CLOCK_KEY).toBe('__smarterPokerHorseMoodClockMs');
    expect((globalThis as Record<string, unknown>)[HORSE_MOOD_TEST_CLOCK_KEY]).toBe(
      PINNED_HORSE_MOOD_CLOCK_MS
    );
    const config = readFileSync('vitest.config.ts', 'utf8');
    expect(config).toContain("'./src/testing/theHorseMoodHourIsPinned.ts'");
  });

  it('makes the default mood read the pinned hour, while an explicit time still wins', () => {
    const { moodOf } = (
      HorseLogic as unknown as { __testables: { moodOf: (id: string, t?: number) => number } }
    ).__testables;
    expect(moodOf('horse-a')).toBe(moodOf('horse-a', PINNED_HORSE_MOOD_CLOCK_MS));
    const later = PINNED_HORSE_MOOD_CLOCK_MS + 7 * 3_600_000;
    const ids = Array.from({ length: 20 }, (_, i) => `horse-${i}`);
    expect(ids.some((id) => moodOf(id, later) !== moodOf(id))).toBe(true);
  });

  it('is never set outside the test setup', () => {
    const engine = readFileSync('src/engine/HorseLogic.ts', 'utf8');
    expect(engine).not.toMatch(/__smarterPokerHorseMoodClockMs\s*=/);
    expect(engine).not.toMatch(/\[HORSE_MOOD_TEST_CLOCK_KEY\]\s*=/);
  });
});
