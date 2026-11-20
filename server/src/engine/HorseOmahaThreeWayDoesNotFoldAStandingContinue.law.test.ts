/**
 * Law (EMERG lane PREFLOP-AUDIT 2026-11-20; omahaPreflopJamFacingReraiseIsPriced, default OFF): the
 * three-way pricing facing a re-raise never replaces a standing call or raise with a fold. Its fold
 * verdict compared an exact zero with estimates minus two standard errors and priced deep out-of-position
 * aces below zero; in the 48h exact replay it folded aces to a single 3-bet 22 times and every class of
 * its 55 moves to a fold graded negative against the real cards. Between the call and the raise the
 * larger lower bound still decides, and a standing fold still needs a lower bound above zero to become a
 * call or a raise. Synthetic cards and public numbers only.
 */
import { describe, expect, it } from 'vitest';
import {
  omahaThreeWayPriced,
  reraiseResponseRatesForTheRaise,
} from './HorseOmahaReraisedRaisePriced.js';
import type { OmahaReraisedCallPricing } from './HorseOmahaOopReraisedPot.js';
import type { Card, CardRank, CardSuit } from '../types.js';

const SUIT: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (spec: string): Card[] =>
  (spec.match(/../g) ?? []).map((x) => ({ rank: x[0] as CardRank, suit: SUIT[x[1]] }));

// The Horse opened to 3.5 bb, was 3-bet to 13.5 bb heads-up: 10 bb to call into 21 bb (1 bb = 1 chip).
const spot = (
  hole: string,
  standing: 'fold' | 'call' | 'raise',
  stack: number,
  inPosition: boolean,
  rate: number
) => ({
  hole: cards(hole),
  dead: [] as Card[],
  preflopRaises: 2,
  call: 10,
  pot: 21,
  stack,
  heroBet: 3.5,
  raiseTo: 44.5,
  raiserBet: 13.5,
  raiserStack: stack,
  pricing: {
    rate,
    opportunities: 0,
    rateSource: 'population',
    inPosition,
    othersIn: 0,
    raiserBehind: stack,
    rakeFraction: 0.03,
    heroAlreadyRaised: true,
    heroInvested: 3.5,
  } as OmahaReraisedCallPricing,
  rates: reraiseResponseRatesForTheRaise(null, 'threeBetFacesFourBet')!,
  rakeCalled: 0.03,
  standing,
});
const HANDS = [
  'AsAh7d4c2s',
  'AsAhKd9c3s',
  'AsAd8h8c2s',
  'KsKh7d4c2s',
  'KsKhQdJc4s',
  'QsQhJdTc2s',
  'AsKdQsQd9h',
  '9h8h7s6s5d',
  'Ks9h7d4c2s',
  'JsTs9h8h3d',
];

describe('the three-way pricing does not fold a hand the standing rules continue with', () => {
  const all = HANDS.flatMap((hole) =>
    [120, 250, 600].flatMap((stack) =>
      [true, false].flatMap((ip) =>
        [0.06, 0.15, 0.3].flatMap((rate) =>
          (['call', 'raise'] as const).map((standing) => ({
            hole,
            standing,
            r: omahaThreeWayPriced(spot(hole, standing, stack, ip, rate)),
          }))
        )
      )
    )
  ).filter((x) => x.r !== null);
  it('prices the grid', () => {
    expect(all.length).toBeGreaterThan(200);
  });
  it('a standing call or raise is never replaced by a fold', () => {
    for (const { r } of all) expect(r!.verdict).not.toBe('fold');
  });
  it('the law bites: bare aces deep and out of position price below zero at every bound and still continue', () => {
    const below = all.filter(
      ({ r }) => r!.evCall < 0 && (r!.evRaise === null || r!.evRaise < 0) && r!.evCallLow < 0
    );
    expect(below.length).toBeGreaterThan(0);
    expect(below.some((x) => x.hole.startsWith('AsAh'))).toBe(true);
  });
  it('between the call and the raise the larger lower bound decides, the standing action on a tie', () => {
    for (const { r, standing, hole } of all) {
      if (r!.evRaiseLow === null) continue;
      // a standing re-raise of aces stands (next test)
      if (standing === 'raise' && hole.startsWith('AsA')) continue;
      const want =
        Math.abs(r!.evCallLow - r!.evRaiseLow) <= 1e-9
          ? standing
          : r!.evCallLow > r!.evRaiseLow
            ? 'call'
            : 'raise';
      expect(r!.verdict).toBe(want);
    }
  });
  it('a standing re-raise of aces stands, and aces are still priced upward from a call', () => {
    const aces = all.filter((x) => x.hole.startsWith('AsA'));
    expect(aces.length).toBeGreaterThan(50);
    for (const { r, standing } of aces) if (standing === 'raise') expect(r!.verdict).toBe('raise');
    // the guard bites: some standing aces re-raise has the call ahead at the lower bound
    expect(
      aces.some(
        ({ r, standing }) =>
          standing === 'raise' && r!.evRaiseLow !== null && r!.evCallLow > r!.evRaiseLow
      )
    ).toBe(true);
    // and it is one-directional: a standing call of aces is still raised where the raise is ahead
    expect(aces.some(({ r, standing }) => standing === 'call' && r!.verdict === 'raise')).toBe(
      true
    );
  });
  it('a standing fold still needs a lower bound above zero to continue', () => {
    for (const hole of HANDS) {
      const r = omahaThreeWayPriced(spot(hole, 'fold', 250, false, 0.15));
      if (!r || r.verdict === 'fold') continue;
      const low = r.verdict === 'call' ? r.evCallLow : r.evRaiseLow!;
      expect(low).toBeGreaterThan(0);
    }
  });
});
