/**
 * The priced call of a re-raise (HorseOmahaOopReraisedPot.omahaReraisedCallEv /
 * omahaReraisedCallRealization / omahaReraiserRangeWidth). Owner 2026-11-17
 * 15:30 Chicago: no blanket rule; the call of a 3-bet or more folds only when
 * EV(call) < 0 = EV(fold).
 *
 * The fixture holds anonymised spots of the 2026-11-15..17 PLO5 audit
 * (journaled decisions replayed through the worker runtime): no cards and no
 * player or hand ids, pot normalised to 100 after the call, equity and range
 * width as the replay computed them. MC = reviewer judged the recorded fold
 * wrong; PR = reviewer judged the recorded fold correct. `expect` is the priced
 * verdict; four MC spots stay folds (out of position, deep: the measured
 * realization), recorded as such, not tuned.
 */
import { describe, expect, it } from 'vitest';
import {
  omahaReraisedCallEv,
  omahaReraisedCallRealization,
  omahaReraiserRangeWidth,
  type OmahaReraisedCallPricing,
} from './HorseOmahaOopReraisedPot.js';
import fixture from './HorseOmahaReraisedCallPriced.fixture.json' with { type: 'json' };

interface Case {
  id: string;
  set: string;
  equity: number;
  width: number;
  call: number;
  pot: number;
  stack: number;
  raiserBehind: number;
  inPosition: boolean;
  othersIn: number;
  rakeFraction: number;
  heroAlreadyRaised: boolean;
  expect: 'call' | 'fold';
}
const pricingOf = (c: Case): OmahaReraisedCallPricing => ({
  rate: 0.2,
  opportunities: 100,
  rateSource: 'measured',
  inPosition: c.inPosition,
  othersIn: c.othersIn,
  // The fixture's equity is heads-up against the re-raiser (as the replay of
  // 2026-11-17 computed it), so its other players carry the heads-up dilution.
  ...(c.othersIn > 0 ? { headsUpDiluted: c.othersIn } : {}),
  raiserBehind: c.raiserBehind,
  rakeFraction: c.rakeFraction,
  heroAlreadyRaised: c.heroAlreadyRaised,
  heroInvested: 0,
});

describe('recorded spots (anonymised): the verdict is the sign of EV(call)', () => {
  for (const c of (fixture as { cases: Case[] }).cases)
    it(`${c.id} (${c.set}) ${c.expect}`, () => {
      const v = omahaReraisedCallEv(c.equity, c.width, c.call, c.pot, c.stack, pricingOf(c));
      expect(v.evCall < 0 ? 'fold' : 'call').toBe(c.expect);
      expect(v.required).toBeCloseTo(
        c.call / (v.realization * (c.pot + c.call) * (1 - c.rakeFraction)),
        9
      );
      // hero having raised earlier is an input of the receipt, never of the price
      const flipped = omahaReraisedCallEv(c.equity, c.width, c.call, c.pot, c.stack, {
        ...pricingOf(c),
        heroAlreadyRaised: !c.heroAlreadyRaised,
      });
      expect(flipped.evCall).toBe(v.evCall);
    });
  it('2026-11-18 (REALIZATION.md): the same spots with the other players uncharged, as a raiser still to act now is: four preserve folds become calls (reported, not tuned)', () => {
    // The fixture does not record whether its other players had called the
    // price or were raisers still to act. Priced as the second kind (no charge,
    // measured -0.09, SE 0.09), these are the verdicts. PR = the reviewer judged
    // the recorded fold correct: PR-1, PR-4, PR-5 and PR-7 are calls on this
    // arithmetic. The journal counterfactual of the same change overturns 42
    // class folds, 7 of them folds the audit judged correct.
    const uncharged = Object.fromEntries(
      (fixture as { cases: Case[] }).cases
        .filter((c) => c.othersIn > 0)
        .map((c) => {
          const { headsUpDiluted: _dropped, ...p } = pricingOf(c);
          void _dropped;
          const v = omahaReraisedCallEv(c.equity, c.width, c.call, c.pot, c.stack, p);
          return [c.id, v.evCall < 0 ? 'fold' : 'call'];
        })
    );
    expect(uncharged).toEqual({
      'PR-1': 'call',
      'PR-3': 'fold',
      'PR-4': 'call',
      'PR-5': 'call',
      'PR-6': 'fold',
      'PR-7': 'call',
    });
  });
});

describe('the pieces', () => {
  it('realization: an all-in call realizes everything; depth costs more out of position; another player costs nothing on equity taken against him (measured -0.03, SE 0.06) and 0.35 as dilution of heads-up equity', () => {
    expect(omahaReraisedCallRealization(false, 0, 2)).toBe(1);
    expect(omahaReraisedCallRealization(false, 0, 2, 2)).toBe(1);
    expect(omahaReraisedCallRealization(true, 2, 0)).toBeCloseTo(1 - 0.15 * (2 / 4), 12);
    expect(omahaReraisedCallRealization(false, 5, 0)).toBeCloseTo(1 - 0.7 * (5 / 10), 12);
    expect(omahaReraisedCallRealization(true, 2, 1, 1)).toBeCloseTo(1 - 0.075 - 0.35, 12);
    expect(omahaReraisedCallRealization(true, 0.5, 2, 2)).toBeCloseTo(
      1 - 0.15 * 0.2 - 0.5 * 0.7,
      12
    );
    for (const spr of [0.5, 1, 2, 5, 10]) {
      expect(omahaReraisedCallRealization(true, spr, 0)).toBeGreaterThan(
        omahaReraisedCallRealization(false, spr, 0)
      );
      expect(omahaReraisedCallRealization(true, spr, 1)).toBe(
        omahaReraisedCallRealization(true, spr, 0)
      );
      expect(omahaReraisedCallRealization(true, spr, 1, 1)).toBeLessThan(
        omahaReraisedCallRealization(true, spr, 0)
      );
    }
    expect(omahaReraisedCallRealization(false, 10, 0)).toBeLessThan(
      omahaReraisedCallRealization(false, 2, 0)
    );
  });
  it('range width: grows with the measured rate and narrows for a 4-bet', () => {
    expect(omahaReraiserRangeWidth(0.3, 2)).toBeGreaterThan(omahaReraiserRangeWidth(0.05, 2));
    expect(omahaReraiserRangeWidth(0.3, 3)).toBeLessThan(omahaReraiserRangeWidth(0.3, 2));
  });
  it('no size threshold: the same equity and price fold or call by depth and position only through EV', () => {
    const base: Case = {
      id: 'x',
      set: 'x',
      equity: 0.5,
      width: 0.4,
      call: 33.3,
      pot: 66.7,
      stack: 133.3,
      raiserBehind: 100,
      inPosition: true,
      othersIn: 0,
      rakeFraction: 0.05,
      heroAlreadyRaised: false,
      expect: 'call',
    };
    const ip = omahaReraisedCallEv(0.5, 0.4, 33.3, 66.7, 133.3, pricingOf(base));
    const scaled = omahaReraisedCallEv(0.5, 0.4, 333, 667, 1333, {
      ...pricingOf(base),
      raiserBehind: 1000,
    });
    expect(Math.sign(ip.evCall)).toBe(Math.sign(scaled.evCall));
    expect(scaled.evCall).toBeCloseTo(ip.evCall * 10, 6);
  });
});
