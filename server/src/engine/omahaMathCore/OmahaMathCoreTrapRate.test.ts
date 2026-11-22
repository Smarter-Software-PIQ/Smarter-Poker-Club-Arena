// Laws for the measured trap rate (lane CORE-POOLED-8, criteria CRITERIA-CORE-POOLED-8-PLO5-TRAP-RATE sha 1a322479).
import { describe, expect, it } from 'vitest';
import { parseCardString as P } from './OmahaMathCoreEval.js';
import {
  checkKeep,
  trackRanges,
  type NodeFreqFn,
  type TrackInput,
} from './OmahaMathCoreRangeTrack.js';
import { OMAHA_TRAP_RATE_TABLE, omahaTrapRate } from './OmahaMathCoreTrapRate.js';
import { OMAHA_MATH_CORE_ALLOWED_PROVENANCE } from './OmahaMathCoreTables.js';

const half: NodeFreqFn = (_s, _st, facing) =>
  facing
    ? { wager: 0.1, fold: 0.5, source: 'test cell' }
    : { wager: 0.5, fold: 0, source: 'test cell' };
const checkHist = [
  {
    street: 'flop' as const,
    seat: 2,
    action: 'check' as const,
    frac: 0,
    facing: false,
    players: 2,
  },
];
function base(over: Partial<TrackInput>): TrackInput {
  return {
    variant: 'plo5',
    hole: P('2c3d9hTs4s'),
    board: P('5h6d7cKs'),
    seats: [2],
    heroSeat: 0,
    preflopBand: () => ({ lo: 0.1, hi: 0.6, source: 'call test band' }),
    history: checkHist,
    freq: half,
    seed: 'trap-law',
    size: 600,
    pfRuns: 24,
    postRuns: 8,
    ...over,
  };
}
const meanStrength = (t: NonNullable<ReturnType<typeof trackRanges>>) => {
  const r = t.ranges.get(2)!;
  let m = 0;
  for (let i = 0; i < t.pool.size; i++) m += r.w[i] * t.pool.strength[i];
  return m;
};

describe('measured trap rate: a check keeps the trap share of strong holdings', () => {
  it('LAW: no trap function, or one that returns nothing, is the old update bit for bit', () => {
    const old = trackRanges(base({}))!;
    const none = trackRanges(base({ trap: () => undefined }))!;
    expect(Array.from(none.ranges.get(2)!.w)).toEqual(Array.from(old.ranges.get(2)!.w));
  });
  it('LAW: tau = 0 is the old check likelihood; with no bluff share a check never removes more than 1 - tau', () => {
    for (const pv of [0, 0.1, 0.5, 0.9, 1])
      for (const pb of [0, 0.2])
        expect(checkKeep(pv, pb, 0)).toBeCloseTo(Math.max(0, 1 - pv - pb), 12);
    for (const tau of [0, 0.15, 0.4, 1])
      for (const pv of [0, 0.3, 0.7, 1])
        expect(checkKeep(pv, 0, tau)).toBeGreaterThanOrEqual(tau - 1e-12);
  });
  it('a check with a trap rate keeps more strength than the old strip, never more than no update', () => {
    const prior = meanStrength(trackRanges(base({ history: [] }))!);
    const old = meanStrength(trackRanges(base({}))!);
    const trap = meanStrength(trackRanges(base({ trap: () => 0.4 }))!);
    expect(trap).toBeGreaterThan(old);
    expect(trap).toBeLessThanOrEqual(prior + 1e-9);
  });
  it('bets and raises are untouched by the trap rate', () => {
    const bet = [{ ...checkHist[0], action: 'bet' as const, frac: 0.5 }];
    const a = trackRanges(base({ history: bet }))!;
    const b = trackRanges(base({ history: bet, trap: () => 0.4 }))!;
    expect(Array.from(b.ranges.get(2)!.w)).toEqual(Array.from(a.ranges.get(2)!.w));
  });
  it('LAW: the table is public-showdown provenance, PLO4/PLO5 only, every tau a share; PLO6 has none', () => {
    expect(OMAHA_MATH_CORE_ALLOWED_PROVENANCE.has(OMAHA_TRAP_RATE_TABLE.provenance)).toBe(true);
    for (const [k, c] of Object.entries(OMAHA_TRAP_RATE_TABLE.cells)) {
      expect(k.startsWith('plo5|') || k.startsWith('plo4|')).toBe(true);
      expect(c.tau).toBeGreaterThanOrEqual(0);
      expect(c.tau).toBeLessThanOrEqual(1);
    }
    for (const st of ['flop', 'turn', 'river'] as const)
      for (const first of [true, false])
        for (const pl of [2, 3, 6]) {
          expect(omahaTrapRate('plo5', st, first, pl)).toBeDefined();
          expect(omahaTrapRate('plo4', st, first, pl)).toBeDefined();
          expect(omahaTrapRate('plo6', st, first, pl)).toBeUndefined();
        }
  });
});
