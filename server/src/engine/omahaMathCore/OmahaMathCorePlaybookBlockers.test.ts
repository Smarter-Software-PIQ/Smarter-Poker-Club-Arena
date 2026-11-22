/**
 * Law: blockers move the opponent's fold share and the bettor's bluff share (lane PLAYBOOK).
 * Constructed spots only (no recorded cards). PLO4 and PLO5.
 */
import { describe, expect, it } from 'vitest';
import { parseCardString } from './OmahaMathCoreEval.js';
import {
  blockerAdjustedBluffShare,
  blockerAdjustedFold,
  clearPlaybookBlockerCache,
  segmentSurvival,
} from './OmahaMathCorePlaybookBlockers.js';

const MONO_RIVER = parseCardString('Ks9s5s2d7h'); // three spades: the ace of spades makes the nut flush
const FULL = { lo: 0, hi: 1 };

describe('omahaMathCore PLAYBOOK blockers', () => {
  it('no hero cards: every segment survives whole, fold share unchanged', () => {
    const r = blockerAdjustedFold([], MONO_RIVER, 4, FULL, 0.6, 'law-1');
    expect(r.p).toBeCloseTo(0.6, 9);
  });

  // Same hand with and without the ace of spades: only the nut-flush card differs.
  const WITH_AS4 = parseCardString('AsQhJd4c');
  const WITHOUT_AS4 = parseCardString('AhQhJd4c');
  const WITH_AS5 = parseCardString('AsQhJd4c3h');
  const WITHOUT_AS5 = parseCardString('AhQhJd4c3c');

  it('PLO4: the nut-flush card raises the fold share of an opponent who continues with his top 10%', () => {
    const a = blockerAdjustedFold(WITH_AS4, MONO_RIVER, 4, FULL, 0.9, 'law-2');
    const b = blockerAdjustedFold(WITHOUT_AS4, MONO_RIVER, 4, FULL, 0.9, 'law-2');
    expect(a.p).toBeGreaterThan(b.p);
    expect(a.p).toBeGreaterThan(0.9);
    expect(a.source).toContain('blockers: fold 0.9');
  });

  it('PLO5: the nut-flush card raises the fold share the same way', () => {
    const a = blockerAdjustedFold(WITH_AS5, MONO_RIVER, 5, FULL, 0.9, 'law-3');
    const b = blockerAdjustedFold(WITHOUT_AS5, MONO_RIVER, 5, FULL, 0.9, 'law-3');
    expect(a.p).toBeGreaterThan(b.p);
  });

  it('the strongest 5% (nut flushes) survives less when the hero holds the nut-flush card', () => {
    const a = segmentSurvival(
      WITH_AS4,
      MONO_RIVER,
      4,
      FULL,
      [
        { lo: 0, hi: 0.05 },
        { lo: 0.05, hi: 1 },
      ],
      'law-4'
    );
    expect(a.survival[0]).not.toBeNull();
    expect(a.survival[0]!).toBeLessThan(a.survival[1]!);
  });

  it('bluff-catching: the nut-flush card raises the bluff share of a bettor whose value is his top 10%', () => {
    const v = { lo: 0, hi: 0.1 };
    const bl = { lo: 0.7, hi: 1 };
    const a = blockerAdjustedBluffShare(WITH_AS4, MONO_RIVER, 4, FULL, v, bl, 1 / 3, 'law-5');
    const b = blockerAdjustedBluffShare(WITHOUT_AS4, MONO_RIVER, 4, FULL, v, bl, 1 / 3, 'law-5');
    expect(a.alpha).toBeGreaterThan(b.alpha);
    expect(a.alpha).toBeGreaterThan(1 / 3);
  });

  it('preflop, bad input and degenerate shares return the input unchanged, never throw', () => {
    expect(blockerAdjustedFold(parseCardString('AsQhJd4c'), [], 4, FULL, 0.5, 'law-6').p).toBe(0.5);
    expect(
      blockerAdjustedFold(parseCardString('AsQhJd4c'), MONO_RIVER, 9, FULL, 0.5, 'law-6').p
    ).toBe(0.5);
    expect(
      blockerAdjustedFold(parseCardString('AsQhJd4c'), MONO_RIVER, 4, FULL, 0, 'law-6').p
    ).toBe(0);
    expect(
      blockerAdjustedFold(parseCardString('AsQhJd4c'), MONO_RIVER, 4, FULL, Number.NaN, 'law-6').p
    ).toBe(0);
  });

  it('deterministic for a seed and within the latency budget on the river', () => {
    clearPlaybookBlockerCache();
    const hero = parseCardString('AsQhJd4c3h');
    const t0 = performance.now();
    const a = blockerAdjustedFold(hero, MONO_RIVER, 5, FULL, 0.55, 'law-7');
    const ms = performance.now() - t0;
    clearPlaybookBlockerCache();
    const b = blockerAdjustedFold(hero, MONO_RIVER, 5, FULL, 0.55, 'law-7');
    expect(a.p).toBe(b.p);
    expect(ms).toBeLessThan(250);
  });
});
