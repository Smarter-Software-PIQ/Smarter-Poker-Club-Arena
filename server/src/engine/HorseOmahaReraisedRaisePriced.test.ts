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
  RERAISE_THIRD_PLAYER_FOLD,
  OMAHA_RAISE_RANGE_COMPOSITION,
  heroShareOfPots,
  omahaMeasuredRangeEquity,
  omahaThreeWayPriced,
  omahaReraisedRaiseEv,
  omahaReraisedRaiseMultiwayPriced,
  omahaReraisedRaisePriced,
  reraiseResponseRatesForTheRaise,
  thirdPlayerFoldShare,
  thirdPlayerRaiseLevelOf,
  type OmahaReraisedOtherPlayer,
  type OmahaReraisedRaiseMultiwayInput,
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

describe('other players in the hand are priced in it (review of 59ea78d08f3, B1)', () => {
  // Synthetic cards and stacks, not a recorded hand. Hero faces a 3-bet that one player has already called.
  const caller = (over: Partial<OmahaReraisedOtherPlayer> = {}): OmahaReraisedOtherPlayer => ({
    kind: 'caller',
    bet: 36,
    stack: 164,
    band: [0.3, 0.86],
    inForPrice: true,
    afterHero: false,
    ...over,
  });
  const input = (
    hole: string,
    others: OmahaReraisedOtherPlayer[],
    row: number[] | null = null
  ): OmahaReraisedRaiseMultiwayInput => ({
    hole: cards(hole),
    dead: [] as Card[],
    preflopRaises: 2,
    call: 24,
    pot: 12 + 36 + 3 + others.reduce((a, o) => a + o.bet, 0),
    stack: 188,
    heroBet: 12,
    raiseTo: 12 + 24 + (12 + 36 + 3 + others.reduce((a, o) => a + o.bet, 0) + 24),
    raiserBet: 36,
    raiserStack: 164,
    pricing: {
      rate: 0.2,
      opportunities: 60,
      rateSource: 'measured',
      inPosition: true,
      othersIn: others.filter((o) => o.inForPrice).length,
      ...(others.some((o) => o.inForPrice)
        ? { othersInBands: others.filter((o) => o.inForPrice).map((o) => o.band) }
        : {}),
      raiserBehind: 164,
      rakeFraction: 0.02,
      heroAlreadyRaised: true,
      heroInvested: 12,
    },
    rates: reraiseResponseRatesForTheRaise(
      row ? reraiseResponseFromRow(row) : null,
      'threeBetFacesFourBet'
    )!,
    rakeCalled: 0.01,
    standing: 'call',
    others,
  });
  const round = (x: number) => Math.round(x * 100) / 100;

  it('THE DEFECT: a caller in for the price continues in most outcomes; he was priced as always folding', () => {
    const v = omahaReraisedRaiseMultiwayPriced(input('AsAhKsQh7d', [caller()]))!;
    const m = v.multiway!;
    // the measured fold share of a player who had called the 3-bet: 7 of 45 at the low end, 55 of 91 at the high
    expect(m.low.foldShares).toEqual([7 / 45]);
    expect(m.high.foldShares).toEqual([55 / 91]);
    expect(m.low.shareMultiway).toBeGreaterThan(0.7);
    expect(m.high.shareMultiway).toBeGreaterThan(0.3);
    expect(m.low.shareMultiway).toBeGreaterThan(m.high.shareMultiway);
    // every sample is one of: everyone folds, only the re-raiser continues, a third player continues
    for (const e of [m.low, m.high])
      expect(e.shareAllFold + e.shareHeadsUp + e.shareMultiway).toBeCloseTo(1, 12);
    expect(m.samples).toBe(1600);
  });
  it('with every third player folding (test override) the price is the heads-up price, his money dead in the pot', () => {
    const i = input('AsAhKsQh7d', [caller()]);
    const folded = omahaReraisedRaiseMultiwayPriced({
      ...i,
      thirdPlayerFoldOverride: { low: 1, high: 1 },
    })!;
    const { others: _o, ...headsUpInput } = i;
    void _o;
    const headsUp = omahaReraisedRaisePriced({
      ...headsUpInput,
      pricing: { ...i.pricing, othersIn: 0, othersInBands: undefined },
    })!;
    expect(folded.multiway!.low.shareMultiway).toBe(0);
    // two different runs of the sampler: equal within their sampling error
    expect(Math.abs(folded.evRaise - headsUp.evRaise)).toBeLessThan(
      4 * Math.max(folded.seSampling, headsUp.seSampling) + 1
    );
  });
  it('the raise is worth less when the caller is priced in than when he was priced as folding (aces, low stack-to-pot)', () => {
    const i = input('AsAhKsQh7d', [caller()]);
    const priced = omahaReraisedRaiseMultiwayPriced(i)!;
    const assumedFold = omahaReraisedRaiseMultiwayPriced({
      ...i,
      thirdPlayerFoldOverride: { low: 1, high: 1 },
    })!;
    expect(priced.multiway!.low.evRaise).not.toBeCloseTo(assumedFold.evRaise, 0);
  });
  it('a raise needs BOTH measured ends to clear the bar; the receipt carries the end nearer its bar', () => {
    for (const hole of ['AsAhKsQh7d', 'KsKhQsJh9d', 'JsTs9h8h7d', 'AsKsQhJhTd', '9s8s7h6h2d']) {
      for (const others of [
        [caller()],
        [
          caller(),
          caller({ kind: 'pending', bet: 2, stack: 198, band: [0, 1], inForPrice: false }),
        ],
        [caller({ kind: 'pendingRaiser', bet: 12, stack: 188, band: [0.4, 1], inForPrice: false })],
      ]) {
        const v = omahaReraisedRaiseMultiwayPriced(input(hole, others))!;
        const m = v.multiway!;
        expect(v.verdict === 'raise').toBe(m.low.verdict === 'raise' && m.high.verdict === 'raise');
        for (const e of [m.low, m.high]) {
          expect(e.verdict === 'raise').toBe(
            e.evRaise > 0 && e.edge > RERAISE_RAISE_SE_MULTIPLE * e.se
          );
          expect(e.se ** 2).toBeCloseTo(
            e.seSampling ** 2 + e.seRates ** 2 + e.seRealization ** 2,
            6
          );
          expect(e.seRates).toBeGreaterThanOrEqual(e.seThirdPlayers);
        }
        const b = m[m.binding];
        expect([v.evRaise, v.edge, v.se]).toEqual([b.evRaise, b.edge, b.se]);
        expect(m.low.edge - 2 * m.low.se <= m.high.edge - 2 * m.high.se).toBe(m.binding === 'low');
        // the same cards and spot give the same numbers; no random stream is drawn
        expect(omahaReraisedRaiseMultiwayPriced(input(hole, others))).toEqual(v);
      }
    }
  });
  it('pinned: aces against a 3-bet and a caller raise; a middling rundown stands', () => {
    const aces = omahaReraisedRaiseMultiwayPriced(input('AsAhKsQh7d', [caller()]))!;
    const rundown = omahaReraisedRaiseMultiwayPriced(input('9s8s7h6h2d', [caller()]))!;
    expect([
      aces.verdict,
      round(aces.evCall),
      round(aces.evRaise),
      round(aces.edge),
      round(aces.se),
    ]).toEqual(['raise', 21, 62.31, 41.31, 6.06]);
    expect([
      rundown.verdict,
      round(rundown.evCall),
      round(rundown.evRaise),
      round(rundown.edge),
      round(rundown.se),
    ]).toEqual(['stand', 4.93, -11.43, -16.36, 5.11]);
  });
  it('THE TIGHT RE-RAISER WHO NEVER FOLDS AND RE-RAISES OFTEN does not get the raise, with a caller in', () => {
    // a tight range (re-raise rate 0.046), 0 folds, 14 calls, 6 re-raises of 20, deeper stacks so a re-raise is possible
    const i = input('KsKhQsJh9d', [caller({ stack: 564 })], [20, 0, 14, 6, 0, 0, 0, 0]);
    const v = omahaReraisedRaiseMultiwayPriced({
      ...i,
      stack: 588,
      raiserStack: 564,
      pricing: { ...i.pricing, rate: 0.046, raiserBehind: 564 },
    })!;
    expect(v.verdict).toBe('stand');
    expect(v.pFold).toBe(0);
  });
  it('with nobody else in (evaluation only) the joint run gives the heads-up price: two implementations, one answer', () => {
    for (const hole of ['AsAhKsQh7d', 'KsKhQsJh9d', 'JsTs9h8h7d', '9s8s7h6h2d']) {
      const i = input(hole, []);
      const joint = omahaReraisedRaiseMultiwayPriced({ ...i, allowNoOthers: true })!;
      const { others: _o, ...h } = i;
      void _o;
      const headsUp = omahaReraisedRaisePriced(h)!;
      const tol = 4 * Math.max(joint.seSampling, headsUp.seSampling) + 1;
      expect(Math.abs(joint.evRaise - headsUp.evRaise), hole).toBeLessThan(tol);
      expect(Math.abs(joint.evCall - headsUp.evCall), hole).toBeLessThan(tol);
      expect(joint.multiway!.low).toEqual(joint.multiway!.high);
    }
  });
  it('a player already all in cannot fold: he is in every outcome', () => {
    const v = omahaReraisedRaiseMultiwayPriced(
      input('AsAhKsQh7d', [caller({ kind: 'allIn', bet: 20, stack: 0, inForPrice: true })])
    )!;
    const m = v.multiway!;
    expect(m.low.foldShares).toEqual([0]);
    expect(m.low.shareAllFold).toBe(0);
    expect(m.low).toEqual(m.high);
  });
  it('the depth-cost shift of the evaluation is off in the engine: zero is the same as absent', () => {
    const i = input('KsKhQsJh9d', [caller()]);
    expect(omahaReraisedRaiseMultiwayPriced({ ...i, depthCostShiftSe: 0 })).toEqual(
      omahaReraisedRaiseMultiwayPriced(i)
    );
  });
  it('not priceable: no other player, an empty band, nothing to call', () => {
    const i = input('AsAhKsQh7d', [caller()]);
    expect(omahaReraisedRaiseMultiwayPriced({ ...i, others: [] })).toBeNull();
    expect(
      omahaReraisedRaiseMultiwayPriced({ ...i, others: [caller({ band: [0.5, 0.5] })] })
    ).toBeNull();
    expect(omahaReraisedRaiseMultiwayPriced({ ...i, call: 0 })).toBeNull();
  });
  it('the measured table: every cell has spots, low is the lowest measured group and high the highest', () => {
    for (const level of ['fourBet', 'fiveBetOrLater'] as const)
      for (const kind of ['caller', 'pendingRaiser', 'pending'] as const) {
        const c = RERAISE_THIRD_PLAYER_FOLD[level][kind];
        expect(c.low.spots).toBeGreaterThan(0);
        expect(c.high.spots).toBeGreaterThan(0);
        expect(thirdPlayerFoldShare(c.low).fold).toBeLessThanOrEqual(
          thirdPlayerFoldShare(c.high).fold
        );
        expect(thirdPlayerFoldShare(c.low).variance).toBeGreaterThan(0);
      }
    expect(thirdPlayerRaiseLevelOf(2)).toBe('fourBet');
    expect(thirdPlayerRaiseLevelOf(3)).toBe('fiveBetOrLater');
  });
});

describe('main pot and side pots (heroShareOfPots)', () => {
  it('a short all-in wins only the main pot; hero wins the side pot from the re-raiser', () => {
    // hero 100, re-raiser 100, short all-in 20, 5 dead: main 20 x 3 + 5 = 65, side 80 x 2 = 160
    const seats = (hero: number, z: number, short: number) => [
      { c: 100, live: true, score: hero },
      { c: 100, live: true, score: z },
      { c: 20, live: true, score: short },
    ];
    expect(heroShareOfPots(seats(3, 2, 1), 5)).toEqual({ won: 225, pot: 225 });
    expect(heroShareOfPots(seats(2, 1, 3), 5)).toEqual({ won: 160, pot: 225 });
    expect(heroShareOfPots(seats(1, 2, 3), 5)).toEqual({ won: 0, pot: 225 });
    expect(heroShareOfPots(seats(2, 2, 1), 5)).toEqual({ won: 112.5, pot: 225 });
  });
  it('money of a player who folded stays in the pot and wins nothing', () => {
    const r = heroShareOfPots(
      [
        { c: 100, live: true, score: 1 },
        { c: 36, live: false, score: 9 },
        { c: 100, live: true, score: 0 },
      ],
      3
    );
    expect(r).toEqual({ won: 239, pot: 239 });
  });
});

describe('omahaPreflopJamFacingReraiseIsPriced: fold, call and raise priced against measured ranges (hand #60156608)', () => {
  // Made-up suits; the shape of the hand the owner complained of and of a double-suited rundown.
  const HIGH = cards('AsKdQsQd9h');
  const RUNDOWN = cards('9h8h7s6s5d');
  const pricing = (rate: number): OmahaReraisedCallPricing =>
    ({
      rate,
      opportunities: 0,
      rateSource: 'population',
      inPosition: true,
      othersIn: 0,
      raiserBehind: 249.56,
      rakeFraction: 0.03,
      heroAlreadyRaised: true,
      heroInvested: 16,
    }) as OmahaReraisedCallPricing;
  const spot = (hole: Card[], standing: 'fold' | 'call' | 'raise') => ({
    hole,
    dead: [],
    preflopRaises: 3,
    call: 34.5,
    pot: 73.5,
    stack: 226.7,
    heroBet: 16,
    raiseTo: 154,
    raiserBet: 50.5,
    raiserStack: 249.56,
    pricing: pricing(0.046),
    rates: reraiseResponseRatesForTheRaise(null, 'fourBetFacesFiveBet')!,
    rakeCalled: 0.03,
    standing,
  });
  it('the measured compositions are counts (shown hands of people after the 3-bet, the 4-bet, the 5-bet or later)', () => {
    for (const k of [2, 3, 4] as const) {
      const c = OMAHA_RAISE_RANGE_COMPOSITION[k];
      expect(c.n).toBeGreaterThan(50);
      expect(c.aces + c.kings).toBeLessThanOrEqual(c.n);
    }
    // a raise later in the street is made with aces more often
    const share = (k: 2 | 3 | 4) =>
      OMAHA_RAISE_RANGE_COMPOSITION[k].aces / OMAHA_RAISE_RANGE_COMPOSITION[k].n;
    expect(share(4)).toBeGreaterThan(share(3));
    expect(share(3)).toBeGreaterThan(share(2));
  });
  it('the equity is against the parts of the range: high cards lose most of it to aces, a rundown keeps it', () => {
    const high = omahaMeasuredRangeEquity(HIGH, [], 3, 0.046)!;
    const run = omahaMeasuredRangeEquity(RUNDOWN, [], 3, 0.046)!;
    expect(high.parts[0]).toBeLessThan(0.42); // against two aces
    expect(run.parts[0]).toBeGreaterThan(high.parts[0] + 0.05);
    expect(high.se).toBeGreaterThan(0);
    expect(high.shares[0] + high.shares[1] + high.shares[2]).toBeCloseTo(1, 9);
  });
  it('all three actions are priced and the largest lower-bound EV is played (the 5-bet of #60156608 becomes a call)', () => {
    const r = omahaThreeWayPriced(spot(HIGH, 'raise'))!;
    expect(r).not.toBeNull();
    expect(r.evRaiseLow).not.toBeNull();
    const best = Math.max(0, r.evCallLow, r.evRaiseLow!);
    const chosen = r.verdict === 'fold' ? 0 : r.verdict === 'call' ? r.evCallLow : r.evRaiseLow!;
    expect(chosen).toBe(best);
    expect(r.verdict).toBe('call');
    // the call is realized below 1 with chips behind (measured realization, never 100 percent)
    expect(r.realizationCall).toBeLessThan(1);
    // the lower bound is below the estimate
    expect(r.evCallLow).toBeLessThan(r.evCall);
    expect(r.evRaiseLow!).toBeLessThan(r.evRaise!);
  });
  it('the standing action stands on a tie and a standing raise needs a priced raise', () => {
    const r = omahaThreeWayPriced({ ...spot(HIGH, 'raise'), raiseTo: null })!;
    expect(r.evRaiseLow).toBeNull();
    // with no raise priced the verdict can only be fold or call; the decision wrapper then keeps a standing raise
    expect(['fold', 'call']).toContain(r.verdict);
  });
  it('a short call that leaves nothing behind is not this pricing (closed all-in call untouched)', () => {
    expect(omahaThreeWayPriced({ ...spot(HIGH, 'call'), stack: 30 })).toBeNull();
  });
  it('the same cards and spot give the same receipt (no random stream)', () => {
    expect(JSON.stringify(omahaThreeWayPriced(spot(RUNDOWN, 'call')))).toBe(
      JSON.stringify(omahaThreeWayPriced(spot(RUNDOWN, 'call')))
    );
  });
});
