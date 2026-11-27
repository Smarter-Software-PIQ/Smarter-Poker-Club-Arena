/**
 * LAW (PLO-OWNER lead-8 lane preflop, 2026-11-27): omahaReraisedPotFoldReraiseIsPriced (default OFF).
 *
 * Having made the first raise and facing exactly a cold 3-bet of it preflop in PLO4/PLO5 cash, out of position and
 * heads-up against the re-raiser, a standing FOLD is priced
 * against the pot-size re-raise and becomes it only when EV(re-raise) > max(EV(call), 0) + deadband + the sampling
 * error of the price on the verdict of
 * HorseOmahaReraisedPotPriced, the re-raiser read from his OWN record, then the people-only prior, then the
 * equilibrium anchor. Synthetic cards and synthetic players only.
 *
 *  1. Every change is a fold that became the largest legal re-raise (or the all-in it amounts to), and at every
 *     such decision the priced re-raise beats the call and the fold by more than the deadband; every fold it leaves
 *     standing is one the price does not clear. It is never a call: a call of a 3-bet or a 4-bet is not made here.
 *  2. The price follows the opponent, not a class: against a measured wide 3-bettor far more folds become
 *     re-raises than against a measured tight one, and against a tight one the weakest opens stay folded.
 *  3. A standing call or re-raise is never touched; in position, multiway (callers in, players to act), facing a
 *     4-bet or more, facing a limp-re-raise, or when the first raise was another player's, nothing changes.
 *  4. Off (absent, false, a truthy non-boolean) every decision is byte for byte the one it was; a tournament is
 *     outside the spot.
 *  5. The prior is the people prior: no record reads 0.156 for the re-raise rate and 0.028 for the fold to a 4-bet
 *     (people folded 1 of 277); only the thin 5-bet cell leans on the indifference fold. The price must clear its
 *     own sampling error as well as the deadband.
 *  6. The receipt validator admits the largest legal raise-to only.
 *  7. COST (src/testing/relativeCost.ts): the applicable decisions with the option on cost a bounded multiple of
 *     the same decisions with its sibling omahaReraisedPotReraiseIsPriced on, which prices the same verdict
 *     (measured about 1.0; offline on 600 applicable preflop states of the compiled build the siblings ran p50 3.3 /
 *     p95 9.1 / max 24.0 ms; this option's own measurement is in its authority doc).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { HorseDecideOpts } from './HorseLogic.js';
import { HorseMind, readScopeOf } from './HorseMind.js';
import { enableBrainTelemetry } from './BrainTelemetry.js';
import { withoutMeasurements } from './HorseDeclaredWork.test-support.js';
import { indifferenceFold } from './HorsePreflopIndifferenceAnchor.js';
import {
  RERAISED_POT_PEOPLE_PRIOR,
  omahaReraisedPotPricedAdmitsRaise,
  reraisedPotFoldReraiseSamplingMargin,
  reraisedPotFoldToReraiseOf,
  reraisedPotPotRaise,
  reraisedPotPricedDecision,
  reraisedPotPricedSpot,
  reraisedPotRaiseRateOf,
} from './HorseOmahaReraisedPotPricedRule.js';
import { reraisedPotVerdict } from './HorseOmahaReraisedPotPriced.js';
import {
  RR_LIVE_OPTS,
  RR_RAISER,
  rrDecide,
  rrHands,
  rrSetRead,
  rrSpot,
  type RrSpotKind,
} from './HorseOmahaReraisedPotPriced.test-support.js';
import { measureRelativeCost } from '../testing/relativeCost.js';

enableBrainTelemetry();
afterEach(() => {
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

const OFF: HorseDecideOpts = { ...RR_LIVE_OPTS };
const ON = { ...RR_LIVE_OPTS, omahaReraisedPotFoldReraiseIsPriced: true } as HorseDecideOpts;
const WIDE: [number, number] = [54, 60];
const TIGHT: [number, number] = [2, 60];
type Variant = 'plo4' | 'plo5';

/** The option's own price at the spot: the people-prior spot and the verdict against the pot re-raise. */
function priced(hole: string, kind: RrSpotKind, read: [number, number], variant: Variant) {
  const { hero, gs } = rrSpot(hole, kind, { variant });
  rrSetRead(variant, read[0], read[1]);
  HorseMind.setDecisionScope(readScopeOf(variant, 6), variant, 'cash');
  try {
    const found = reraisedPotPricedSpot(hero, gs, true, true);
    if (!found) return null;
    const pr = reraisedPotPotRaise(found.spot, found.heroBet, gs);
    if (!pr) return null;
    const v = reraisedPotVerdict(found.spot, hero.cards ?? [], [], pr.risk);
    return v && v.evRaise !== null ? { v, pr, gs, found } : null;
  } finally {
    HorseMind.setDecisionScope(null);
  }
}
const clears = (p: NonNullable<ReturnType<typeof priced>>) => {
  const raiser = p.found.spot.opponents[0]!;
  const hisCall = Math.max(0, Math.min(p.pr.risk - p.found.spot.call, raiser.behind));
  const calledPot = p.found.spot.pot + p.found.spot.call + 2 * hisCall;
  return (
    (p.v.evRaise as number) >
    Math.max(p.v.evCall, 0) +
      p.v.deadband +
      reraisedPotFoldReraiseSamplingMargin(calledPot, raiser.foldToReraise)
  );
};
const isRaise = (a: string) => a === 'raise' || a === 'all_in';

describe('omahaReraisedPotFoldReraiseIsPriced: a standing fold becomes the pot re-raise only where the price clears', () => {
  for (const variant of ['plo5', 'plo4'] as const)
    for (const kind of ['oopHu'] as const)
      it(`${variant} ${kind}: every change is fold -> the largest legal re-raise at a cleared price; never a call`, () => {
        const hands = rrHands(48, variant === 'plo4' ? 4 : 5, 20261127);
        let changed = 0;
        let kept = 0;
        for (const read of [WIDE, TIGHT, [0, 0] as [number, number]])
          for (const h of hands) {
            const off = rrDecide(h, kind, OFF, 7, { variant }, read);
            const on = rrDecide(h, kind, ON, 7, { variant }, read);
            if (off.d.action !== 'fold') {
              // a standing call or re-raise is never touched
              expect([h, on.d.action, on.d.amount]).toEqual([h, off.d.action, off.d.amount]);
              continue;
            }
            const p = priced(h, kind, read, variant);
            expect(on.d.action).not.toBe('call');
            if (on.d.action === 'fold') {
              kept++;
              if (p) expect([h, read, clears(p)]).toEqual([h, read, false]);
              continue;
            }
            changed++;
            expect(isRaise(on.d.action)).toBe(true);
            expect(p).not.toBeNull();
            expect([h, read, clears(p!)]).toEqual([h, read, true]);
            if (on.d.action === 'raise') expect(on.d.amount).toBe(p!.gs.maxRaiseTo);
            else expect(p!.pr.allIn).toBe(true);
            expect(on.fires).toContain('omaha_reraised_pot_priced_fold_reraised');
          }
        expect(changed + kept).toBeGreaterThan(0);
      }, 240_000);
});

describe('the price follows the opponent: his own record, not a class of hand', () => {
  it('against a measured wide 3-bettor more folds become re-raises than against a measured tight one (PLO5, out of position)', () => {
    const hands = rrHands(80, 5, 77);
    const count = (read: [number, number]) =>
      hands.filter(
        (h) =>
          rrDecide(h, 'oopHu', OFF, 7, {}, read).d.action === 'fold' &&
          isRaise(rrDecide(h, 'oopHu', ON, 7, {}, read).d.action)
      ).length;
    const wide = count(WIDE);
    const tight = count(TIGHT);
    expect(wide).toBeGreaterThan(0);
    expect(tight).toBeLessThan(wide);
    // the priced re-raise is worth more against the wide range for nearly every hand
    let higher = 0;
    for (const h of hands) {
      const a = priced(h, 'oopHu', WIDE, 'plo5');
      const b = priced(h, 'oopHu', TIGHT, 'plo5');
      if (a && b && (a.v.evRaise as number) > (b.v.evRaise as number)) higher++;
    }
    expect(higher).toBeGreaterThan(hands.length * 0.6);
  }, 240_000);
});

describe('only heads-up against the re-raiser, only in its own spot, inert when off', () => {
  const strip = (d: unknown) =>
    JSON.stringify(withoutMeasurements(d), (k, v) => (k === 'thinkTime' ? 0 : v));

  it('multiway (a squeeze with players to act) nothing changes', () => {
    for (const variant of ['plo5', 'plo4'] as const)
      for (const h of rrHands(24, variant === 'plo4' ? 4 : 5, 5)) {
        const a = rrDecide(h, 'bbVsSbSqueezeMw', OFF, 7, { variant }, WIDE);
        const b = rrDecide(h, 'bbVsSbSqueezeMw', ON, 7, { variant }, WIDE);
        expect(strip(b.d)).toBe(strip(a.d));
      }
  }, 120_000);

  it('absent, false and a truthy non-boolean are byte-identical', () => {
    for (const kind of ['bbVsSbSqueezeMw', 'oopHu', 'ipHu', 'oopHuFiveBet'] as const)
      for (const h of rrHands(6, 5, 3)) {
        const a = rrDecide(h, kind, OFF, 7, {}, WIDE);
        for (const v of [false, 'yes', 1]) {
          const b = rrDecide(
            h,
            kind,
            { ...OFF, omahaReraisedPotFoldReraiseIsPriced: v } as unknown as HorseDecideOpts,
            7,
            {},
            WIDE
          );
          expect(strip(b.d)).toBe(strip(a.d));
          expect(b.fires.sort()).toEqual(a.fires.sort());
        }
      }
  }, 120_000);

  it('in position against the re-raiser nothing changes', () => {
    for (const variant of ['plo5', 'plo4'] as const)
      for (const h of rrHands(32, variant === 'plo4' ? 4 : 5, 21))
        for (const read of [WIDE, TIGHT, [0, 0] as [number, number]]) {
          const a = rrDecide(h, 'ipHu', OFF, 7, { variant }, read);
          const b = rrDecide(h, 'ipHu', ON, 7, { variant }, read);
          expect(strip(b.d)).toBe(strip(a.d));
        }
  }, 120_000);

  it("a limp-re-raise is not a cold 3-bet, and a re-raise of another player's raise is not the Horse's own: neither is priced", () => {
    const which = { call: false, reraise: false, foldReraise: true };
    const ctx = { mind: true, telemetry: false };
    const fold = { action: 'fold', thinkTime: 1 } as never;
    let pricedCold = 0;
    for (const variant of ['plo5', 'plo4'] as const)
      for (const h of rrHands(12, variant === 'plo4' ? 4 : 5, 33)) {
        const { hero, gs } = rrSpot(h, 'oopHu', { variant });
        rrSetRead(variant, WIDE[0], WIDE[1]);
        HorseMind.setDecisionScope(readScopeOf(variant, 6), variant, 'cash');
        try {
          const cold = reraisedPotPricedDecision(fold, hero, gs, which, ctx);
          expect(cold.receipt).toMatch(/^fold_rerais/);
          pricedCold++;
          const raises = (gs.actionHistory ?? []).filter((a) => a.action === 'raise');
          const his = raises[raises.length - 1]!;
          // the same spot, but the re-raiser had limped before the Horse raised
          const limped = {
            ...gs,
            actionHistory: [
              { ...his, action: 'call', amount: gs.bigBlind, isFullRaise: undefined },
              ...(gs.actionHistory ?? []),
            ],
          } as typeof gs;
          expect(reraisedPotPricedDecision(fold, hero, limped, which, ctx).receipt).toBeNull();
          // the same spot, but the first raise of the hand was another player's
          const other = {
            ...gs,
            actionHistory: (gs.actionHistory ?? []).map((a) =>
              a === raises[0] ? { ...a, seat: 1 } : a
            ),
          } as typeof gs;
          expect(reraisedPotPricedDecision(fold, hero, other, which, ctx).receipt).toBeNull();
        } finally {
          HorseMind.setDecisionScope(null);
        }
      }
    expect(pricedCold).toBe(24);
  }, 120_000);

  it('facing a 4-bet or more (the 5-bet node) nothing changes', () => {
    for (const variant of ['plo5', 'plo4'] as const)
      for (const h of rrHands(24, variant === 'plo4' ? 4 : 5, 15))
        for (const read of [WIDE, TIGHT]) {
          const a = rrDecide(h, 'oopHuFiveBet', OFF, 7, { variant }, read);
          const b = rrDecide(h, 'oopHuFiveBet', ON, 7, { variant }, read);
          expect(strip(b.d)).toBe(strip(a.d));
        }
  }, 120_000);

  it('a tournament is outside the spot', () => {
    for (const h of rrHands(12, 5, 9)) {
      const a = rrDecide(h, 'oopHu', OFF, 7, { tournament: true }, WIDE);
      const b = rrDecide(h, 'oopHu', ON, 7, { tournament: true }, WIDE);
      expect(strip(b.d)).toBe(strip(a.d));
    }
  }, 120_000);
});

describe('the prior is the people prior, anchored to the indifference fold', () => {
  it('no record reads the person-level people rate; his own record outweighs it within a dozen opportunities', () => {
    HorseMind.reset();
    HorseMind.setDecisionScope(readScopeOf('plo5', 6), 'plo5', 'cash');
    expect(reraisedPotRaiseRateOf(RR_RAISER, 'plo5', 6, true, true)).toBeCloseTo(0.156, 6);
    HorseMind.setDecisionScope(null);
    rrSetRead('plo5', 9, 12);
    HorseMind.setDecisionScope(readScopeOf('plo5', 6), 'plo5', 'cash');
    const q = RERAISED_POT_PEOPLE_PRIOR.threeBetRate;
    expect(reraisedPotRaiseRateOf(RR_RAISER, 'plo5', 6, true, true)).toBeCloseTo(
      (9 + q.people * q.peopleMass) / (12 + q.peopleMass),
      6
    );
    // memory off: the prior alone
    expect(reraisedPotRaiseRateOf(RR_RAISER, 'plo5', 6, false, true)).toBeCloseTo(0.156, 6);
  });

  it('the fold to the re-raise with no record: people showed 1 fold in 277 4-bets (person mean 0.028), and the thin 5-bet cell leans on the indifference fold', () => {
    HorseMind.reset();
    const q4 = RERAISED_POT_PEOPLE_PRIOR.threeBetFacesFourBetFold;
    const f4 = reraisedPotFoldToReraiseOf(RR_RAISER, 'threeBetFacesFourBet', true, {
      anchorSize: 2,
    });
    expect(q4.anchorMass).toBe(0);
    expect(f4).toBeCloseTo(0.028, 9);
    const q5 = RERAISED_POT_PEOPLE_PRIOR.fourBetFacesFiveBetFold;
    const f5 = reraisedPotFoldToReraiseOf(RR_RAISER, 'fourBetFacesFiveBet', true, {
      anchorSize: 2,
    });
    expect(f5).toBeCloseTo(
      (indifferenceFold(2) * q5.anchorMass + q5.people * q5.peopleMass) /
        (q5.anchorMass + q5.peopleMass),
      9
    );
    // the legacy read (the sibling options) is untouched by the new parameter
    expect(reraisedPotFoldToReraiseOf(RR_RAISER, 'threeBetFacesFourBet', true)).toBeCloseTo(
      (0.45 * 6 + 0.187 * 2) / 8,
      9
    );
  });

  it('the sampling margin: half a standard deviation unit over the root of the samples, of the called pot, on the called branch', () => {
    expect(reraisedPotFoldReraiseSamplingMargin(100, 0)).toBeCloseTo(50 / Math.sqrt(360), 9);
    expect(reraisedPotFoldReraiseSamplingMargin(100, 0.5)).toBeCloseTo(25 / Math.sqrt(360), 9);
    expect(reraisedPotFoldReraiseSamplingMargin(0, 0)).toBe(0);
  });
});

describe('receipt admission', () => {
  it('admits the largest legal raise-to only', () => {
    const { hero, gs } = rrSpot('KdAsTc2sQd', 'oopHu');
    expect(omahaReraisedPotPricedAdmitsRaise(hero, gs, gs.maxRaiseTo)).toBe(true);
    expect(omahaReraisedPotPricedAdmitsRaise(hero, gs, (gs.maxRaiseTo ?? 0) - 1)).toBe(false);
  });
});

describe('LAW: the fold-against-re-raise price is cheap where it applies', () => {
  it('applicable decisions with omahaReraisedPotFoldReraiseIsPriced on cost a bounded multiple of the sibling price on the same spots', () => {
    const SIB = { ...RR_LIVE_OPTS, omahaReraisedPotReraiseIsPriced: true } as HorseDecideOpts;
    const spots: { hole: string; kind: RrSpotKind; variant: Variant; stack: number }[] = [];
    for (const variant of ['plo4', 'plo5'] as const)
      for (const stack of [200, 600, 1600])
        for (const kind of ['oopHu'] as RrSpotKind[]) {
          const hand = rrHands(40, variant === 'plo4' ? 4 : 5, 500 + stack).find((h) =>
            rrDecide(h, kind, ON, 11, { variant, stack }, WIDE).fires.some((f) =>
              f.startsWith('omaha_reraised_pot_priced_fold_rerais')
            )
          );
          if (hand) spots.push({ hole: hand, kind, variant, stack });
        }
    expect(spots.length).toBeGreaterThanOrEqual(4);
    const run = (opts: HorseDecideOpts) => () => {
      for (const s of spots)
        rrDecide(s.hole, s.kind, opts, 11, { variant: s.variant, stack: s.stack }, WIDE);
    };
    const cost = measureRelativeCost(run(ON), run(SIB), { warmupRounds: 1, rounds: 5 });
    console.info(
      `[fold re-raise price] on ${cost.subjectMs.toFixed(2)} ms, sibling ${cost.referenceMs.toFixed(2)} ms, ratio ${cost.ratio.toFixed(2)} over ${spots.length} spots`
    );
    expect(cost.ratio).toBeLessThan(4);
  }, 240_000);
});
