/**
 * The priced call-or-raise facing a re-raise (HorseOmahaReraisedRaisePriced, option
 * omahaReraisedCallVsRaisePriced, default OFF).
 *
 * The fixture holds anonymised spots of the 2026-11-15..17 PLO5 audit: the decisions the CALL-VS-RAISE analysis
 * classed raise-better or call-better on all 18 of its sensitivity corners, re-decided through the worker runtime
 * with the option on and each opponent's re-raise response record reconstructed from earlier hands only. No cards and
 * no player or hand ids: the public arithmetic input and the per-band sums of the sampler's run. `expect` is the
 * engine's verdict, recorded, not tuned. The decision path itself (option off identity, PLO6, tournaments,
 * Lightning) is in HorseOmahaOopReraisedPot.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '../types.js';
import type { OmahaReraisedCallPricing } from './HorseOmahaOopReraisedPot.js';
import { reraiseResponseFromRow } from './HorseOmahaReraiseResponse.js';
import {
  RERAISE_RAISE_SE_MULTIPLE,
  omahaReraisedRaiseEv,
  omahaReraisedRaisePriced,
  reraiseResponseRatesForTheRaise,
  type OmahaReraisedRaiseSamples,
  type OmahaReraisedRaiseSpot,
} from './HorseOmahaReraisedRaisePriced.js';
import fixture from './HorseOmahaReraisedRaisePriced.fixture.json' with { type: 'json' };

interface Case {
  id: string;
  set: string;
  spot: OmahaReraisedRaiseSpot;
  samples: OmahaReraisedRaiseSamples;
  expect: 'raise' | 'stand';
  edge: number | null;
  se: number | null;
}
const CASES = (fixture as unknown as { cases: Case[] }).cases;
const SUITS: Record<string, Card['suit']> = { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' };
const cards = (spec: string): Card[] =>
  (spec.match(/../g) ?? []).map((c) => ({ rank: c[0], suit: SUITS[c[1]] }) as Card);

describe('recorded spots (anonymised): the verdict is the priced one', () => {
  for (const c of CASES)
    it(`${c.id} (${c.set}) ${c.expect}`, () => {
      const v = omahaReraisedRaiseEv(c.spot, c.samples)!;
      expect(v.verdict).toBe(c.expect);
      if (c.edge !== null) expect(v.edge).toBeCloseTo(c.edge, 2);
      if (c.se !== null) expect(v.se).toBeCloseTo(c.se, 2);
      // the bar's standard error is the root of its three parts (review of 59ea78d08f3, B3)
      expect(v.se ** 2).toBeCloseTo(v.seSampling ** 2 + v.seRates ** 2 + v.seRealization ** 2, 6);
      // his fold share is his own (B2): zero with no folds of his at the node
      if (c.spot.rates.counts.fold === 0) expect(v.pFold).toBe(0);
      // the rule, restated: a raise needs EV(raise) > 0 and an edge above twice its sampling error
      expect(v.verdict === 'raise').toBe(
        v.evRaise > 0 && v.edge > RERAISE_RAISE_SE_MULTIPLE * v.se
      );
      expect(v.edge).toBeCloseTo(v.evRaise - (c.spot.standing === 'call' ? v.evCall : 0), 9);
    });
  it('by set: 13 of the 22 heads-up raise-better spots raise; the 5 heads-up spots of the review sample raise', () => {
    const tally = (set: string) => {
      const xs = CASES.filter((c) => c.set === set).map(
        (c) => omahaReraisedRaiseEv(c.spot, c.samples)!.verdict
      );
      return [xs.filter((v) => v === 'raise').length, xs.length];
    };
    expect(tally('heads-up raise-better')).toEqual([13, 22]);
    expect(tally('review sample, heads-up')).toEqual([5, 5]);
  });
  it('B2, 59853778:6 (a 5-bet faced, no record of him, all in below 0.5 equity): with no fold share from the prior the raise has a negative edge and stands', () => {
    const c = CASES.find((x) => x.id === 'B2-01')!;
    const v = omahaReraisedRaiseEv(c.spot, c.samples)!;
    expect([v.verdict, v.pFold, v.equityCallBand! < 0.5]).toEqual(['stand', 0, true]);
    expect(v.edge).toBeLessThan(0);
    expect(Math.round((v.edge / 2) * 10) / 10).toBe(-6.9);
  });
});

describe('the arithmetic', () => {
  const raised = CASES.find((c) => c.expect === 'raise' && c.spot.pricing.othersIn === 0)!;
  it('never a raise at EV(raise) <= 0, whatever the call is worth; a standing fold is beaten at EV 0', () => {
    const losing = omahaReraisedRaiseEv(
      { ...raised.spot, rates: { ...raised.spot.rates, fold: 0, call: 1, raise: 0 } },
      { ...raised.samples, sum: [0, 0, 0], sumSq: [0, 0, 0] }
    )!;
    expect(losing.evRaise).toBeLessThan(0);
    expect(losing.verdict).toBe('stand');
    const fromFold = omahaReraisedRaiseEv({ ...raised.spot, standing: 'fold' }, raised.samples)!;
    expect(fromFold.edge).toBeCloseTo(fromFold.evRaise, 9);
  });
  it('fold equity is his own: with the same samples a higher fold share raises EV(raise) by that share of the pot', () => {
    const base = omahaReraisedRaiseEv(raised.spot, raised.samples)!;
    const r = raised.spot.rates;
    const more = omahaReraisedRaiseEv(
      { ...raised.spot, rates: { ...r, fold: r.fold + 0.1, call: r.call - 0.1 } },
      raised.samples
    )!;
    expect(more.evRaise - base.evRaise).toBeCloseTo(0.1 * (raised.spot.pot - base.evWhenCalled), 6);
  });
  it('nobody has chips left once the raise is called: no re-raise share; his re-raising band calls', () => {
    const allIn = CASES.find((c) => omahaReraisedRaiseEv(c.spot, c.samples)!.sprRaise === 0)!;
    const v = omahaReraisedRaiseEv(allIn.spot, allIn.samples)!;
    expect(v.pReraise).toBe(0);
    expect(v.pCall).toBeCloseTo(allIn.spot.rates.call + allIn.spot.rates.raise, 12);
    expect(v.equityReraiseBand).toBeNull();
    expect(v.evContinue).toBeNull();
    expect(v.equityCallBand).toBeCloseTo(
      (allIn.samples.sum[1] + allIn.samples.sum[2]) / (allIn.samples.n[1] + allIn.samples.n[2]),
      12
    );
  });
  it('the raise is priced at its effective size: what the re-raiser cannot match is returned', () => {
    const s = raised.spot;
    const v = omahaReraisedRaiseEv({ ...s, raiserStack: 40 }, raised.samples)!;
    expect(v.added).toBeCloseTo(s.raiserBet + 40 - s.heroBet, 9);
    expect(v.added).toBeLessThan(s.raiseTo - s.heroBet);
    // he is all in by calling: nothing behind, no re-raise share
    expect([v.sprRaise, v.pReraise]).toEqual([0, 0]);
  });
  it('not priceable: nothing to call, a raise no bigger than the call, rates that are not three shares of one', () => {
    const s = raised.spot;
    expect(omahaReraisedRaiseEv({ ...s, call: 0 }, raised.samples)).toBeNull();
    expect(omahaReraisedRaiseEv({ ...s, raiseTo: s.heroBet + s.call }, raised.samples)).toBeNull();
    expect(
      omahaReraisedRaiseEv({ ...s, rates: { ...s.rates, fold: 0.5 } }, raised.samples)
    ).toBeNull();
    expect(
      omahaReraisedRaiseEv(s, { ...raised.samples, n: [0, 0, 0], sum: [0, 0, 0], sumSq: [0, 0, 0] })
    ).toBeNull();
  });
});

describe('through the sampler (synthetic cards, not a recorded hand)', () => {
  // Kings double-suited, out of position, having opened and 3-bet... facing a 4-bet of 147 more into 294, 900 behind
  // him: the shape of the spots the analysis found, with made-up cards.
  const pricing = (rate: number): OmahaReraisedCallPricing => ({
    rate,
    opportunities: 100,
    rateSource: 'measured',
    inPosition: false,
    othersIn: 0,
    raiserBehind: 700,
    rakeFraction: 0.01,
    heroAlreadyRaised: true,
    heroInvested: 58,
  });
  const spot = (rate: number, row: number[] | null) => ({
    hole: cards('KsKhQs9h4d'),
    dead: [] as Card[],
    preflopRaises: 3,
    call: 147,
    pot: 294,
    stack: 842,
    heroBet: 58,
    raiseTo: 646,
    raiserBet: 205,
    raiserStack: 700,
    pricing: pricing(rate),
    rates: reraiseResponseRatesForTheRaise(
      row ? reraiseResponseFromRow(row) : null,
      'fourBetFacesFiveBet'
    )!,
    rakeCalled: 0.005,
    standing: 'call' as const,
  });
  const round = (x: number) => Math.round(x * 100) / 100;
  it('against a wide re-raiser who never folds a 4-bet: the priced verdict and its numbers (pinned; the edge is real but, on a record of 20, under twice its error once the rates and the realization are counted)', () => {
    const v = omahaReraisedRaisePriced(spot(0.3, [0, 0, 0, 0, 20, 0, 18, 2]))!;
    expect([v.verdict, round(v.evCall), round(v.evRaise), round(v.edge), round(v.se)]).toEqual([
      'stand',
      46.71,
      87.76,
      41.05,
      23.63,
    ]);
    // one run of the sampler: the bands' samples add up to it, and the same cards give the same numbers
    expect(v.samples.n[0] + v.samples.n[1] + v.samples.n[2]).toBe(1600);
    expect(omahaReraisedRaisePriced(spot(0.3, [0, 0, 0, 0, 20, 0, 18, 2]))).toEqual(v);
  });
  it('THE TIGHT-OPPONENT CELL: the same hand against a tight range that never folds and re-raises 30% must NOT raise', () => {
    // population-width range (re-raise rate 0.046), 0 folds, 14 calls, 6 re-raises of 20: the analysis's counter-risk
    const v = omahaReraisedRaisePriced(spot(0.046, [0, 0, 0, 0, 20, 0, 14, 6]))!;
    expect([v.verdict, round(v.evCall), round(v.evRaise), round(v.edge), round(v.se)]).toEqual([
      'stand',
      36.83,
      41.31,
      4.48,
      30.84,
    ]);
    expect(v.verdict).toBe('stand');
    expect(v.pFold).toBeLessThan(0.03);
  });
  it('an unknown opponent: the prior gives his call and re-raise shares, and no fold share (B2)', () => {
    const v = omahaReraisedRaisePriced(spot(0.2, null))!;
    expect(v.pFold).toBe(0);
    expect(v.pCall).toBeCloseTo(0.913, 12);
    expect(v.pReraise).toBeCloseTo(0.087, 12);
    expect(v.spot.rates.source).toBe('population');
  });
  it('B3: the rates part of the error shrinks as his record grows', () => {
    const thin = omahaReraisedRaisePriced(spot(0.3, [0, 0, 0, 0, 4, 0, 3, 1]))!;
    const thick = omahaReraisedRaisePriced(spot(0.3, [0, 0, 0, 0, 80, 0, 60, 20]))!;
    expect(thick.seRates).toBeLessThan(thin.seRates);
  });
});
