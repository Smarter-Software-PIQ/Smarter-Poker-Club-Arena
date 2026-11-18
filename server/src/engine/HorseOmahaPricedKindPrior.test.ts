/**
 * The opponent-kind prior of the Omaha priced rules (priced2, 2026-11-18).
 *
 * All nine priced families on lost 6 to 8 bb/100 at Horse-only tables
 * (archive plo-handoff-review-01a1cbbd/priced-01BNteGZ/ALLON-DIAGNOSIS-20261118.md):
 * the bluff prior measured on PERSONS' bets was applied to HORSE bettors and
 * moved by a person-referenced bet-rate factor with a stated exponent. These
 * tests fail the build if a Horse bettor is ever priced on a person's prior or
 * reference rate, if the read steps at zero opportunities, if the re-raise of
 * a raise is charged twice, or if a spot nothing can price falls open.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  OMAHA_PRICED_MEASURED_BLUFF,
  OMAHA_PRICED_MEASURED_BLUFF_HORSE,
  omahaOpponentKindOf,
  omahaPricedBluffFactor,
  omahaPricedBluffReferenceRatio,
  omahaPricedKindPrior,
  omahaPricedRecentred,
  withOmahaPricedMode,
} from './HorseOmahaPricedMode.js';
import {
  OMAHA_PRICED_NO_READ,
  omahaPricedCardImpactRead,
  omahaPricedFacingBetRead,
  omahaPricedRaise,
  omahaPricedRaiseAloneEv,
  omahaPricedRead,
} from './HorseOmahaPricedRules.js';
import { omahaFacingBetEvSpot } from './HorseOmahaFacingBetEv.js';
import { omahaPricedDrawRaiseBarred, omahaPricedDrawRaiseRule } from './HorseOmahaPricedWiring.js';
import { omahaDrawRaiseBarOf } from './HorseOmahaBigDrawAggression.js';
import { HorseMind } from './HorseMind.js';
import {
  LIVE_OPTIONS,
  allPriced,
  decideAt,
  pricedSpot,
  type PricedSpot,
} from './HorseOmahaPricedRules.test-support.js';
import type { HorseDecision, SeatPlayer } from '../types.js';

afterEach(() => {
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

const POP = { bet: 0.35, foldToBet: 0.4 };
const stat = (mean: number, n: number) => ({ mean, n, engaged: null, excess: 0 });
const pooledOf = (bet: number, fold: number, n: number) =>
  ({
    hands: n,
    measured: false,
    betCheckedTo: stat(bet, n),
    foldToBet: stat(fold, n),
    riverCall: stat(0.3, n),
  }) as never;
// omahaPricedPriorsByOpponentKind on (the batch's gate of every kind prior; off: the #11212 tables)
const BOTH = { rangeContinuous: true, bluffShareFromBetRate: true, priorsByKind: true };

describe('who the opponent is', () => {
  it('the engine roster of persons decides, else the seat flag, else nobody says', () => {
    const players = [
      { user_id: 'a', is_horse: true },
      { user_id: 'b', is_horse: false },
      { user_id: 'c' },
    ];
    expect(omahaOpponentKindOf({ humanUserIds: ['a'], players }, 'a')).toBe('person');
    expect(omahaOpponentKindOf({ humanUserIds: ['a'], players }, 'b')).toBe('horse');
    expect(omahaOpponentKindOf({ players }, 'a')).toBe('horse');
    expect(omahaOpponentKindOf({ players }, 'b')).toBe('person');
    expect(omahaOpponentKindOf({ players }, 'c')).toBeNull();
    expect(omahaOpponentKindOf(null, 'a')).toBeNull();
    expect(omahaOpponentKindOf({ players }, null)).toBeNull();
  });
  it('each kind has its own measured prior; a Horse never reads the person table', () => {
    expect(omahaPricedKindPrior('horse').bluff).toBe(OMAHA_PRICED_MEASURED_BLUFF_HORSE);
    expect(omahaPricedKindPrior('person').bluff).toBe(OMAHA_PRICED_MEASURED_BLUFF);
    // the measurement: a Horse's large turn and river bets hold fewer bluffs than a person's
    for (const st of ['turn', 'river'] as const)
      expect(OMAHA_PRICED_MEASURED_BLUFF_HORSE[st].big).toBeLessThan(
        OMAHA_PRICED_MEASURED_BLUFF[st].big
      );
    expect(omahaPricedKindPrior(null).bluffElasticity).toBe(1.5);
  });
});

describe('the read starts at the kind prior: continuous at zero opportunities', () => {
  it('with no opportunity every figure is exactly the kind prior, and the bet ratio is 1', () => {
    for (const kind of ['horse', 'person'] as const) {
      const K = omahaPricedKindPrior(kind);
      const none = omahaPricedRead(null, POP, null, kind);
      const foldRef = kind === 'horse' ? POP.foldToBet : K.foldToBet.pooled;
      expect(none.foldToBet).toBeCloseTo(foldRef, 12);
      expect(none.betRatio).toBeCloseTo(1, 12);
      expect(none.kind).toBe(kind);
      // a vanishing amount of evidence reads the same (no step at the first opportunity)
      // (a statRead posterior with almost no opportunity is its own prior, the Horse envelope mean)
      const e = 1e-9;
      const tiny = omahaPricedRead(
        pooledOf((0.9 * e + POP.bet * 6) / (e + 6), (0.05 * e + POP.foldToBet * 6) / (e + 6), e),
        POP,
        null,
        kind
      );
      expect(tiny.foldToBet!).toBeCloseTo(foldRef, 6);
      expect(tiny.betRatio!).toBeCloseTo(1, 6);
    }
  });
  it('each opportunity moves the read a little, many move it fully', () => {
    for (const kind of ['horse', 'person'] as const) {
      let last = omahaPricedRead(null, POP, null, kind).betRatio!;
      for (let n = 1; n <= 300; n++) {
        // a statRead posterior of a player who bets 0.7 of the time, shrunk toward the Horse mean
        const mean = (0.7 * n + POP.bet * 6) / (n + 6);
        const r = omahaPricedRead(pooledOf(mean, 0.4, n), POP, null, kind).betRatio!;
        expect(r).toBeGreaterThan(last);
        // one opportunity of six pseudo-opportunities: at most (0.7 - prior) / 7 of the reference
        expect(r - last).toBeLessThan(0.2);
        last = r;
      }
      const ref = kind === 'horse' ? POP.bet : omahaPricedKindPrior(kind).betCheckedTo.pooled;
      expect(last).toBeGreaterThan((0.97 * 0.7) / ref);
    }
  });
  it('a Horse betting exactly at the Horse mean reads 1; the person reference never applies to it', () => {
    const atMean = pooledOf(POP.bet, POP.foldToBet, 40);
    expect(omahaPricedRead(atMean, POP, null, 'horse').betRatio).toBeCloseTo(1, 12);
    expect(omahaPricedBluffReferenceRatio(stat(POP.bet, 40), POP.bet, 'horse')).toBeCloseTo(1, 12);
    // the same posterior of a person is re-centred on the person rate before it is read
    const p = omahaPricedRecentred(stat(POP.bet, 40), POP.bet, 0.312);
    expect(p).toBeCloseTo(POP.bet + (6 / 46) * (0.312 - POP.bet), 12);
    expect(omahaPricedRead(atMean, POP, null, 'person').betRatio).toBeCloseTo(p / 0.312, 12);
  });
  it('the bet-rate factor moves with each kind`s measured elasticity', () => {
    expect(omahaPricedBluffFactor(1.3, 'horse')).toBeCloseTo(1.3 ** -0.1, 12);
    expect(omahaPricedBluffFactor(1.3, 'person')).toBeCloseTo(1.3 ** 0.38, 12);
    expect(omahaPricedBluffFactor(1.3)).toBeCloseTo(1.3 ** 1.5, 12);
    expect(omahaPricedBluffFactor(null, 'horse')).toBe(1);
  });
  it('the card-impact read starts at the kind prior too (no step from the stated 0.45 or 0.42)', () => {
    const h = omahaPricedCardImpactRead(omahaPricedRead(null, POP, null, 'horse'), 'river');
    expect(h.measured).toBe(true);
    expect(h.continueRate).toBeCloseTo(1 - POP.foldToBet, 12);
    expect(h.betCheckedTo).toBeCloseTo(POP.bet * (0.363 / 0.352), 12);
    expect(h.bluffShare).toBeCloseTo(0.17, 12);
    const p = omahaPricedCardImpactRead(omahaPricedRead(null, POP, null, 'person'), 'turn');
    expect(p.betCheckedTo).toBeCloseTo(0.343, 12);
    expect(p.bluffShare).toBeCloseTo(0.3, 12);
    // an unknown kind keeps the merged read
    expect(omahaPricedCardImpactRead(OMAHA_PRICED_NO_READ, 'turn').betCheckedTo).toBe(0.343);
  });
});

describe('a whole facing-bet decision prices a Horse on the Horse prior and a person on the person prior', () => {
  const SPOT: PricedSpot = { hole: 'Kh3h2c8s4s', board: '9dQdJh7h', potBefore: 216, bet: 160 };
  const asKind = (kind: 'horse' | 'person') => {
    const st = pricedSpot(SPOT);
    const bettor = st.gs.players.find((p: SeatPlayer) => p.seat === 1)!;
    st.gs.humanUserIds = kind === 'person' ? [bettor.user_id] : [];
    return { st, bettor };
  };
  it('the spot reads the bettor`s kind table and the verdict scales it by his own ratio only', () => {
    for (const kind of ['horse', 'person'] as const) {
      const { st } = asKind(kind);
      withOmahaPricedMode(BOTH, () => {
        const spot = omahaFacingBetEvSpot(st.hero, st.gs)!;
        const flipped = asKind(kind === 'horse' ? 'person' : 'horse').st;
        const other = omahaFacingBetEvSpot(flipped.hero, flipped.gs)!;
        // same cards, same line, same size: only the bluff table differs, and the Horse's is lower here
        expect(spot.valueShare).toBeCloseTo(other.valueShare, 12);
        if (kind === 'horse') expect(spot.priorBluff).toBeLessThan(other.priorBluff);
        else expect(spot.priorBluff).toBeGreaterThan(other.priorBluff);
        // with no opportunity the prior is not scaled at all, whoever he is
        const read = omahaPricedRead(null, POP, null, kind);
        const v = omahaPricedRaise(st.hero, st.gs, {
          read,
          bettorRead: omahaPricedFacingBetRead(null, read),
        })!;
        expect(v.call.bluffShare).toBeCloseTo(spot.priorBluff, 12);
      });
    }
  });
  it('the decision itself runs for both kinds with every priced option on, and is legal', () => {
    for (const kind of ['horse', 'person'] as const) {
      const { st } = asKind(kind);
      const d = decideAt(
        Object.assign(st, { fresh: () => asKind(kind).st }),
        {
          ...LIVE_OPTIONS,
          ...allPriced(true),
          omahaPricedMix: false,
          omahaPairedBoardBetIsPriced: false,
        },
        7
      );
      expect(['fold', 'call', 'raise', 'all_in']).toContain(d.action);
    }
  });
});

describe('the re-raise of a raise is counted once (review N1)', () => {
  const base = { win: 100, his: 50, put: 80, rake: 0, real: 1 };
  it('the reviewer`s example: 0.75 continue, the top 0.26 beats the Horse, the other 0.49 loses to it', () => {
    const ev = omahaPricedRaiseAloneEv({
      ...base,
      continues: 0.75,
      continuing: { win: 0.49 / 0.75, tie: 0 },
      again: 0.26,
      reraisers: { win: 0, tie: 0 },
    });
    // folds win the pot; the 0.49 it beats pay the raise; the 0.26 that beat it re-raise and it gives up its raise
    expect(ev).toBeCloseTo(0.25 * 100 + 0.49 * 150 - 0.26 * 80, 9);
  });
  it('with nobody re-raising, or a hand that holds against the re-raisers, it is the plain called value', () => {
    const plain = 0.25 * 100 + 0.75 * (0.6 * 150 - 0.4 * 80);
    expect(
      omahaPricedRaiseAloneEv({
        ...base,
        continues: 0.75,
        continuing: { win: 0.6, tie: 0 },
        again: 0,
        reraisers: null,
      })
    ).toBeCloseTo(plain, 9);
    const nuts = 0.25 * 100 + 0.75 * 150;
    expect(
      omahaPricedRaiseAloneEv({
        ...base,
        continues: 0.75,
        continuing: { win: 1, tie: 0 },
        again: 0.26,
        reraisers: { win: 1, tie: 0 },
      })
    ).toBeCloseTo(nuts, 9);
  });
});

describe('a spot nothing can price falls closed: the categorical rule acts as with the option off (review N4)', () => {
  it('a draw raise into three players: the bar decides, not the priced comparison', () => {
    const st = pricedSpot({ hole: 'Ah5h2c3s4d', board: '9dQdJh7h', potBefore: 216, bet: 100 });
    const seat1 = st.gs.players.find((p: SeatPlayer) => p.seat === 1)!;
    for (const seat of [2, 3]) {
      const there = st.gs.players.find((p: SeatPlayer) => p.seat === seat);
      if (there)
        Object.assign(there, { is_folded: false, is_sitting_out: false, is_all_in: false });
      else st.gs.players.push({ ...seat1, seat, user_id: `extra-${seat}`, bet: 0 });
    }
    expect(omahaDrawRaiseBarOf(st.hero, st.gs)).not.toBeNull();
    const opts = {
      omahaNoDrawRaiseOutOfPosition: true,
      omahaDrawRaiseIsPriced: true,
      omahaPricedPriorsByOpponentKind: true,
    };
    const raise: HorseDecision = {
      action: 'raise',
      amount: st.gs.maxRaiseTo as number,
      thinkTime: 1,
    };
    expect(omahaPricedDrawRaiseBarred(st.hero, st.gs, opts as never)).toBeNull();
    expect(omahaPricedDrawRaiseRule(raise, st.hero, st.gs, opts as never)).toBeNull();
  });
});
