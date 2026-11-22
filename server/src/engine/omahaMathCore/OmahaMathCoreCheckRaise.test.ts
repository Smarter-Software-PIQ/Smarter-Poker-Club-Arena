// Laws for the measured check-raise cell (lane CORE-POOLED-9, criteria CRITERIA-CORE-POOLED-9-CHECK-RAISE-CELL sha 7c45130b).
import { describe, expect, it } from 'vitest';
import { parseCardString as P } from './OmahaMathCoreEval.js';
import {
  shrinkToward,
  trackRanges,
  type CheckRaiseCell,
  type NodeFreqFn,
  type PublicStreetAction,
  type TrackInput,
} from './OmahaMathCoreRangeTrack.js';
import { OMAHA_CHECK_RAISE_TABLE, omahaCheckRaiseCell } from './OmahaMathCoreCheckRaise.js';
import { OMAHA_MATH_CORE_ALLOWED_PROVENANCE } from './OmahaMathCoreTables.js';

const cells: NodeFreqFn = (_s, _st, facing) =>
  facing
    ? { wager: 0.15, fold: 0.4, nonValue: 0.2, source: 'test cell' }
    : { wager: 0.5, fold: 0, source: 'test cell' };
const act = (
  seat: number,
  action: PublicStreetAction['action'],
  frac: number,
  facing: boolean
) => ({
  street: 'flop' as const,
  seat,
  action,
  frac,
  facing,
  players: 2,
});
// hero 0 bets, opponent 2 had checked first: the check-raise spot
const checkRaise = [
  act(2, 'check', 0, false),
  act(0, 'bet', 0.5, false),
  act(2, 'raise', 0.9, true),
];
// opponent 2 bet first, hero 0 raised, opponent re-raised: not the spot (no check)
const noCheck = [act(2, 'bet', 0.5, false), act(0, 'raise', 0.9, true), act(2, 'raise', 0.9, true)];
const strong: CheckRaiseCell = {
  nFace: 100000,
  raise: 0.05,
  nShownAll: 5000,
  nvAll: 0.02,
  nShownBand: 2000,
  nvBand: 0.02,
};
function base(over: Partial<TrackInput>): TrackInput {
  return {
    variant: 'plo5',
    hole: P('2c3d9hTs4s'),
    board: P('5h6d7cKs'),
    seats: [2],
    heroSeat: 0,
    preflopBand: () => ({ lo: 0.1, hi: 0.6, source: 'call test band' }),
    history: checkRaise,
    freq: cells,
    seed: 'check-raise-law',
    size: 600,
    pfRuns: 24,
    postRuns: 8,
    ...over,
  };
}
const w = (t: ReturnType<typeof trackRanges>) => Array.from(t!.ranges.get(2)!.w);
const meanStrength = (t: NonNullable<ReturnType<typeof trackRanges>>) => {
  const r = t.ranges.get(2)!;
  let m = 0;
  for (let i = 0; i < t.pool.size; i++) m += r.w[i] * t.pool.strength[i];
  return m;
};

describe('measured check-raise cell: a check-raise of the hero own flop wager', () => {
  it('LAW: no cell function, or one that returns nothing, is the generic update bit for bit', () => {
    const old = trackRanges(base({}));
    expect(w(trackRanges(base({ checkRaise: () => undefined })))).toEqual(w(old));
  });
  it('LAW: outside the spot the cell is never used (no earlier check; wager not the hero own; turn)', () => {
    const fn = () => strong;
    expect(w(trackRanges(base({ history: noCheck, checkRaise: fn })))).toEqual(
      w(trackRanges(base({ history: noCheck })))
    );
    const otherWager = [
      act(2, 'check', 0, false),
      act(3, 'bet', 0.5, false),
      act(2, 'raise', 0.9, true),
    ];
    expect(w(trackRanges(base({ history: otherWager, checkRaise: fn })))).toEqual(
      w(trackRanges(base({ history: otherWager })))
    );
    const turn = checkRaise.map((a) => ({ ...a, street: 'turn' as const }));
    expect(w(trackRanges(base({ history: turn, checkRaise: fn })))).toEqual(
      w(trackRanges(base({ history: turn })))
    );
    const call = [act(2, 'check', 0, false), act(0, 'bet', 0.5, false), act(2, 'call', 0, true)];
    expect(w(trackRanges(base({ history: call, checkRaise: fn })))).toEqual(
      w(trackRanges(base({ history: call })))
    );
  });
  it('LAW: shrinkage is n/(n+30) to the level above; n = 0 is the level above exactly', () => {
    expect(shrinkToward(0, 0.9, 0.3)).toBe(0.3);
    expect(shrinkToward(30, 0.9, 0.3)).toBeCloseTo(0.6, 12);
    expect(shrinkToward(270, 0.1, 0.5)).toBeCloseTo((270 * 0.1 + 30 * 0.5) / 300, 12);
    const zero: CheckRaiseCell = {
      nFace: 0,
      raise: 0.9,
      nShownAll: 0,
      nvAll: 0.9,
      nShownBand: 0,
      nvBand: 0.9,
    };
    expect(w(trackRanges(base({ checkRaise: () => zero })))).toEqual(w(trackRanges(base({}))));
  });
  it('a rarer, more honest measured check-raise leaves a stronger range than the generic cell', () => {
    // on the flop board itself (the street the raise was made on)
    const flop = { board: P('5h6d7c') };
    const gen = meanStrength(trackRanges(base(flop))!);
    const cr = meanStrength(trackRanges(base({ ...flop, checkRaise: () => strong }))!);
    expect(cr).toBeGreaterThan(gen);
  });
  it('LAW: the table is public provenance, PLO4/PLO5 flop only, shares in [0,1]; PLO6 and other streets have none', () => {
    expect(OMAHA_MATH_CORE_ALLOWED_PROVENANCE.has(OMAHA_CHECK_RAISE_TABLE.provenance)).toBe(true);
    for (const [k, c] of Object.entries(OMAHA_CHECK_RAISE_TABLE.cells)) {
      expect(k.startsWith('plo5|') || k.startsWith('plo4|')).toBe(true);
      for (const x of [c.raise, c.nvAll, c.nvBand]) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(1);
      }
    }
    for (const pl of [2, 3, 6])
      for (const f of [0.3, 0.5, 0.7, 1.2]) {
        expect(omahaCheckRaiseCell('plo5', 'flop', pl, f, false)).toBeDefined();
        expect(omahaCheckRaiseCell('plo4', 'flop', pl, f, true)).toBeDefined();
        expect(omahaCheckRaiseCell('plo6', 'flop', pl, f, false)).toBeUndefined();
        expect(omahaCheckRaiseCell('plo5', 'turn', pl, f, false)).toBeUndefined();
      }
  });
});
