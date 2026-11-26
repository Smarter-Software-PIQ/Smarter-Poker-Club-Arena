/**
 * A call the class cell keeps is not priced (re-review of 10150eebe3e, note N1).
 *
 * In PLO4/PLO5 the priced test of a re-raised-pot call can only overturn a
 * class fold, so omahaOopReraisedCallCell runs its 400-sample equity only when
 * the class cell folds. For a class keep it returns exactly what main returns:
 * the class verdict, no pricing object, and no priced sampler run. The samplers
 * (omahaReraisedEquity, and omahaReraisedEquityInPercentileBand, the same equity
 * against a percentile band on card ids since 2026-11-26; both take the sample
 * count fifth) are wrapped here and their calls counted by sample count: the
 * class cell samples OOP_EQUITY_SAMPLES, the priced test
 * RERAISE_CALL_EQUITY_SAMPLES.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./HorseOmahaReraisedPot.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('./HorseOmahaReraisedPot.js')>();
  return {
    ...real,
    omahaReraisedEquity: vi.fn(real.omahaReraisedEquity),
    omahaReraisedEquityInPercentileBand: vi.fn(real.omahaReraisedEquityInPercentileBand),
  };
});

import {
  omahaReraisedEquity,
  omahaReraisedEquityInPercentileBand,
} from './HorseOmahaReraisedPot.js';
import {
  OOP_EQUITY_SAMPLES,
  RERAISE_CALL_EQUITY_SAMPLES,
  omahaOopReraisedCallCell,
  omahaOopReraisedClassCell,
  type OmahaOopReraisedInput,
} from './HorseOmahaOopReraisedPot.js';
import type { Card, CardRank, CardSuit } from '../types.js';

const SUIT: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (spec: string): Card[] =>
  (spec.match(/../g) ?? []).map((x) => ({ rank: x[0] as CardRank, suit: SUIT[x[1]] }));
const sampler = vi.mocked(omahaReraisedEquity);
const bandSampler = vi.mocked(omahaReraisedEquityInPercentileBand);
/** How many sampler runs (either sampler) asked for each sample count since the last reset. */
const runs = () => {
  const by: Record<number, number> = {};
  for (const c of [...sampler.mock.calls, ...bandSampler.mock.calls])
    by[c[4] as number] = (by[c[4] as number] ?? 0) + 1;
  return by;
};
/** Out of position, the given raise count; the harshest pricing inputs (two others in, a 0.02 re-raiser). */
const spot = (hole: string, preflopRaises: number, stack: number): OmahaOopReraisedInput => {
  const fourBet = preflopRaises >= 3;
  return {
    variant: hole.length === 10 ? 'plo5' : 'plo4',
    hole: cards(hole),
    dead: [],
    outOfPosition: true,
    preflopRaises,
    toCall: fourBet ? 51 : 17,
    stack,
    pot: fourBet ? 102 : 34,
    band: null,
    hiLo: false,
    multiBoard: false,
    bombPot: false,
    tournament: false,
    allInOrFold: false,
    priced: {
      rate: 0.02,
      opportunities: 100,
      rateSource: 'measured',
      inPosition: false,
      othersIn: 2,
      raiserBehind: stack,
      rakeFraction: 0.05,
      heroAlreadyRaised: false,
      heroInvested: 0,
    },
  };
};

beforeEach(() => {
  sampler.mockClear();
  bandSampler.mockClear();
});

describe('a class keep: the verdict of main, and the priced sampler never runs', () => {
  it('the two sample counts differ, so the runs can be told apart', () => {
    expect([OOP_EQUITY_SAMPLES, RERAISE_CALL_EQUITY_SAMPLES]).toEqual([300, 400]);
  });
  it.each([
    ['suited aces facing a 4-bet (kept unexamined)', spot('AsAh7s6h', 3, 376), 'aces_suited', {}],
    [
      'a double-suited rundown facing a 3-bet',
      spot('9s8s7h6h', 2, 193),
      'strong_range',
      { 300: 1 },
    ],
    ['bare aces facing a 3-bet', spot('AsAd7h2c', 2, 193), 'strong_range', { 300: 1 }],
    ['a PLO5 rundown facing a 3-bet', spot('Ts9s8h7h6d', 2, 193), 'strong_range', { 300: 1 }],
    ['a short-stack commitment', spot('AsKd9h8c5s', 2, 40), 'commitment', { 300: 1 }],
  ] as const)('%s', (_name, input, reason, expectedRuns) => {
    const v = omahaOopReraisedCallCell(input)!;
    // only the class cell's own sampler run (none for suited aces); never the priced one
    expect(runs()).toEqual(expectedRuns);
    expect(runs()[RERAISE_CALL_EQUITY_SAMPLES]).toBeUndefined();
    // main's shape exactly: the class verdict's seven fields, nothing added
    expect([v.fold, v.reason]).toEqual([false, reason]);
    expect(Object.keys(v).sort()).toEqual([
      'coordination',
      'dominatedKeyCard',
      'equity',
      'fold',
      'price',
      'reason',
      'required',
      'sprAfter',
    ]);
    expect(v).toEqual(omahaOopReraisedClassCell(input));
    // and it does not depend on the pricing inputs at all
    expect(omahaOopReraisedCallCell({ ...input, priced: undefined })).toEqual(v);
  });
});

describe('a class fold: the priced sampler runs once and decides', () => {
  it('an uncoordinated hand facing a 3-bet: no class sample, one priced sample, a priced verdict', () => {
    const v = omahaOopReraisedCallCell(spot('AsKd7h4c2s', 2, 193))!;
    expect(runs()).toEqual({ [RERAISE_CALL_EQUITY_SAMPLES]: 1 });
    expect([v.fold, v.reason, v.classReason]).toEqual([true, 'priced_fold', 'uncoordinated']);
    expect(v.pricing).toBeDefined();
  });
  it('a coordinated hand short of the class bar facing a 4-bet: one class sample, then one priced sample', () => {
    const input = spot('QsJsTh9h', 3, 376);
    expect(omahaOopReraisedClassCell(input)!.reason).toBe('short_of_price');
    sampler.mockClear();
    const v = omahaOopReraisedCallCell(input)!;
    expect(runs()).toEqual({ [OOP_EQUITY_SAMPLES]: 1, [RERAISE_CALL_EQUITY_SAMPLES]: 1 });
    expect(v.classReason).toBe('short_of_price');
    expect(v.reason === 'priced_fold' || v.reason === 'priced_call').toBe(true);
    expect(v.fold).toBe(v.reason === 'priced_fold');
  });
});
