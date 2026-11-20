/**
 * Law tests for lane RANGEADV (constructed spots only; no real hole cards, no hand ids needed).
 */
import { describe, expect, it } from 'vitest';
import { parseCardString as P } from './OmahaMathCoreEval.js';
import {
  boardRangeProfile,
  playbackCallEv,
  toRangeSpec,
  trackRanges,
  type NodeFreqFn,
  type TrackInput,
} from './OmahaMathCoreRangeTrack.js';

const noFreq: NodeFreqFn = () => null;
const half: NodeFreqFn = (_s, _st, facing) =>
  facing
    ? { wager: 0.1, fold: 0.5, source: 'test cell' }
    : { wager: 0.5, fold: 0, source: 'test cell' };

function base(over: Partial<TrackInput>): TrackInput {
  return {
    variant: 'plo4',
    hole: P('2c3d9hTs'),
    board: [],
    seats: [1, 2],
    heroSeat: 0,
    preflopBand: (s) =>
      s === 1
        ? { lo: 0, hi: 0.03, source: '4-bet test band' }
        : { lo: 0.1, hi: 0.6, source: 'call test band' },
    history: [],
    freq: noFreq,
    seed: 'law',
    size: 1200,
    pfRuns: 24,
    postRuns: 8,
    ...over,
  };
}

/** weight share of holdings with two or more aces */
function aaShare(t: NonNullable<ReturnType<typeof trackRanges>>, seat: number): number {
  const r = t.ranges.get(seat)!;
  const hc = t.pool.holeCount;
  let s = 0;
  for (let i = 0; i < t.pool.size; i++) {
    let a = 0;
    for (let k = 0; k < hc; k++) if (t.pool.cards[i * hc + k] >> 2 === 12) a++;
    if (a >= 2) s += r.w[i];
  }
  return s;
}

describe('RANGEADV range tracking (PLO4/PLO5 only)', () => {
  it('LAW: PLO6 (and any other hole count) is untouched: null', () => {
    expect(trackRanges(base({ variant: 'plo6', hole: P('2c3d9hTsJcQd') }))).toBeNull();
    expect(trackRanges(base({ variant: 'plo5', hole: P('2c3d9hTs') }))).toBeNull();
  });

  it('a top-3% preflop band (4-bet line) is AA-heavy; a call band is not', () => {
    const t = trackRanges(base({}))!;
    expect(t).not.toBeNull();
    // AAxx is ~2.5% of PLO4 holdings; a top-3% band must hold it at 10x its base rate or more
    expect(aaShare(t, 1)).toBeGreaterThan(0.25);
    expect(aaShare(t, 2)).toBeLessThan(0.08);
  });

  it('card removal: holding two aces cuts the AA weight of the 4-bet range', () => {
    const without = aaShare(trackRanges(base({}))!, 1);
    const withAA = aaShare(trackRanges(base({ hole: P('AcAd9hTs') }))!, 1);
    expect(withAA).toBeLessThan(without * 0.6);
  });

  it('a low connected flop gives the caller range advantage and nut advantage over the 4-bettor', () => {
    const board = P('5h6d7c');
    const t = trackRanges(base({ board }))!;
    const p = boardRangeProfile(t, board, t.ranges.get(2)!, t.ranges.get(1)!, 'law')!;
    // two pair or better: the caller's range holds well over 1.5x the 4-bettor's share on 5-6-7
    expect(p.strongA).toBeGreaterThan(1.5 * p.strongB);
    // and the caller's equity is far better here than on an A-K-2 flop
    const b2 = P('AhKd2c');
    const t2 = trackRanges(base({ board: b2 }))!;
    const q = boardRangeProfile(t2, b2, t2.ranges.get(2)!, t2.ranges.get(1)!, 'law')!;
    expect(p.rangeAdvantage).toBeGreaterThan(q.rangeAdvantage + 0.08);
  });

  it('an A-K high dry flop gives the 4-bettor the range advantage', () => {
    const board = P('AhKd2c');
    const t = trackRanges(base({ board }))!;
    const p = boardRangeProfile(t, board, t.ranges.get(1)!, t.ranges.get(2)!, 'law')!;
    expect(p.rangeAdvantage).toBeGreaterThan(0.05);
  });

  it('Bayes: a flop raise moves weight to stronger holdings; a check moves it down', () => {
    const board = P('5h6d7cKs');
    const hist = (action: 'raise' | 'check') => [
      {
        street: 'flop' as const,
        seat: 2,
        action,
        frac: action === 'raise' ? 1 : 0,
        facing: action === 'raise',
        players: 2,
      },
    ];
    const mean = (h: 'raise' | 'check' | null) => {
      const t = trackRanges(base({ board, history: h ? hist(h) : [], freq: half }))!;
      const r = t.ranges.get(2)!;
      let m = 0;
      for (let i = 0; i < t.pool.size; i++) m += r.w[i] * t.pool.strength[i];
      return m;
    };
    const prior = mean(null);
    expect(mean('raise')).toBeGreaterThan(prior + 0.05);
    expect(mean('check')).toBeLessThan(prior);
  });

  it('no measured node: no update, said in the steps', () => {
    const board = P('5h6d7c');
    const t = trackRanges(
      base({
        board,
        history: [{ street: 'flop', seat: 2, action: 'bet', frac: 1, facing: false, players: 2 }],
      })
    )!;
    expect(t.ranges.get(2)!.steps.join(' ')).toContain('no measured node');
    expect(toRangeSpec(t.ranges.get(2)!, 's2').label).toMatch(/Tracked EffN/);
  });

  it('play-back EV is computed, finite and bounded (experimental component)', () => {
    const run = trackRanges(base({ hole: P('7h8h9cTc') }))!;
    const a = playbackCallEv(
      run,
      P('7h8h9cTc'),
      run.ranges.get(1)!,
      60,
      20,
      300,
      0.7,
      'law',
      30,
      120
    )!;
    expect(a).not.toBeNull();
    expect(Number.isFinite(a.ev)).toBe(true);
    expect(a.stackOffShare).toBeGreaterThanOrEqual(0);
    expect(a.stackOffShare).toBeLessThanOrEqual(1);
    expect(a.ev).toBeGreaterThanOrEqual(-20);
    expect(
      playbackCallEv(run, P('7h8h9cTcJc'), run.ranges.get(1)!, 60, 20, 300, 0.7, 'law')
    ).toBeNull();
  });

  it('PLO5 works on the same path', () => {
    const board = P('4s5h6d');
    const t = trackRanges(
      base({ variant: 'plo5', hole: P('2c3d9hTsJc'), board, size: 700, pfRuns: 16 })
    )!;
    expect(t).not.toBeNull();
    expect(t.pool.holeCount).toBe(5);
    const p = boardRangeProfile(t, board, t.ranges.get(2)!, t.ranges.get(1)!, 'law5');
    expect(p).not.toBeNull();
  });

  it('never throws: an empty band falls back to the full range', () => {
    const t = trackRanges(base({ preflopBand: () => ({ lo: 0.5, hi: 0.5, source: 'empty' }) }))!;
    expect(t.ranges.get(1)!.effN).toBeGreaterThan(100);
  });
});
