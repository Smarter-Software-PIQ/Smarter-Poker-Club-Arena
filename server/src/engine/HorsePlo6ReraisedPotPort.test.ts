/**
 * PLO6 SIX-CARD PORT of the re-raised-pot modules (HorseOmahaReraisedPot.ts,
 * HorseOmahaOopReraisedPot.ts): SPEC-B H27 (premium), H28 (hole check), H29
 * (coordination), H30 (literal hole gates), options 3.22 to 3.26.
 *
 * Two claims. (1) With the omahaStrategyInPlo6 gate off, and in PLO4 / PLO5
 * with it on or off, every function answers exactly as before. (2) With the
 * gate on, six cards are served by the PLO6 classes of the calibration file.
 */
import { describe, expect, it } from 'vitest';
import type { Card, CardRank, CardSuit } from '../types.js';
import {
  COORDINATED_MAX_GAPS,
  omahaOopCoordinated,
  omahaOopReraisedCallCell,
  omahaReraiseByPositionCell,
  omahaReraisedFlopContinueCell,
  type OmahaFlopContinueInput,
  type OmahaOopReraisedInput,
  type OmahaReraiseByPositionInput,
} from './HorseOmahaOopReraisedPot.js';
import {
  omahaReraisedPostflopCell,
  omahaReraisedPreflopCell,
  omahaReraisedPremium,
  type OmahaReraisedInput,
} from './HorseOmahaReraisedPot.js';
import {
  OMAHA_STRATEGY_GAME_SCOPE_ADMISSION,
  OMAHA_STRATEGY_GAME_SCOPE_OFF,
  withOmahaStrategyGameScope,
} from './HorseOmahaStrategyGame.js';
import {
  PLO6_OMAHA_STRATEGY_CONSTANTS,
  plo6OopCoordinated,
  plo6ReraisedPremium,
} from './HorsePlo6StrategyCalibration.js';

const SUIT: Record<string, CardSuit> = { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' };
const cards = (spec: string): Card[] =>
  (spec.match(/../g) ?? []).map((x) => ({ rank: x[0] as CardRank, suit: SUIT[x[1]] }));
const gateOn = <T>(fn: () => T): T => withOmahaStrategyGameScope({ plo6: true }, fn);
const gateOff = <T>(fn: () => T): T =>
  withOmahaStrategyGameScope(OMAHA_STRATEGY_GAME_SCOPE_OFF, fn);

// Premium by the PLO4/PLO5 text read on six cards (some four ranks a rundown,
// the hand double-suited), not by the PLO6 text (the rundown cards are four suits).
const SPLIT_PREMIUM = cards('KdQcJhTs5s2h');
// Four cards that are themselves the rundown, two-plus-two suited.
const TRUE_PREMIUM = cards('KsQsJhTh5d2c');
// Six cards, one group, no ace, one one-rank gap.
const SIX_RUNDOWN = cards('9s8s7h6h5d3c');
// Two groups: high cards with low cards.
const TWO_GROUPS = cards('KsQd9h5c4s2d');

const flat = { hiLo: false, multiBoard: false, bombPot: false, tournament: false };
const callInput = (
  variant: string,
  hole: Card[],
  o: Partial<OmahaOopReraisedInput> = {}
): OmahaOopReraisedInput => ({
  variant,
  hole,
  dead: [],
  outOfPosition: true,
  preflopRaises: 2,
  toCall: 17,
  stack: 193,
  pot: 34,
  band: null,
  ...flat,
  allInOrFold: false,
  ...o,
});
const positionInput = (variant: string, hole: Card[]): OmahaReraiseByPositionInput => ({
  variant,
  hole,
  preflopRaises: 1,
  outOfPosition: true,
  earlyPosition: false,
  blindVersusBlind: false,
  ...flat,
  allInOrFold: false,
});
const flopInput = (variant: string, hole: Card[], board: Card[]): OmahaFlopContinueInput => ({
  variant,
  hole,
  board,
  dead: [],
  preflopRaises: 2,
  heroLastPreflopRaiser: false,
  toCall: 40,
  stack: 150,
  pot: 100,
  ...flat,
});
const preInput = (
  variant: string,
  hole: Card[],
  o: Partial<OmahaReraisedInput> = {}
): OmahaReraisedInput => ({
  variant,
  street: 'preflop',
  hole,
  board: [],
  preflopRaises: 3,
  action: 'call',
  toCall: 20,
  stack: 400,
  pot: 60,
  ...flat,
  allInOrFold: false,
  ...o,
});

describe('gate off: six cards are outside every cell and every class is the old one', () => {
  it('the scope default, the OFF scope and the validator admission scope all refuse PLO6', () => {
    const probes = () => ({
      premiumSplit: omahaReraisedPremium(SPLIT_PREMIUM),
      premiumTrue: omahaReraisedPremium(TRUE_PREMIUM),
      coordinated: omahaOopCoordinated(SIX_RUNDOWN),
      call: omahaOopReraisedCallCell(callInput('plo6', SIX_RUNDOWN)),
      position: omahaReraiseByPositionCell(positionInput('plo6', SPLIT_PREMIUM)),
      flop: omahaReraisedFlopContinueCell(flopInput('plo6', SIX_RUNDOWN, cards('KhQd2c'))),
      pre: omahaReraisedPreflopCell(preInput('plo6', TWO_GROUPS)),
    });
    const expected = {
      // The PLO4/PLO5 text on six cards (H27: the class that is too wide).
      premiumSplit: true,
      premiumTrue: true,
      coordinated: null,
      call: null,
      position: null,
      flop: null,
      pre: null,
    };
    expect(probes()).toEqual(expected);
    expect(gateOff(probes)).toEqual(expected);
    expect(withOmahaStrategyGameScope(OMAHA_STRATEGY_GAME_SCOPE_ADMISSION, probes)).toEqual(
      expected
    );
  });
});

describe('PLO4 and PLO5: the gate changes nothing', () => {
  const four = [cards('KsQsJhTh'), cards('AsKdQs7d'), cards('9s8s7h5h'), cards('KsKh7s7h')];
  const five = [cards('KsQsJhTh2c'), cards('AsKdQs7d3c'), cards('9s8s7h6h4d'), cards('KdQcJhTs5s')];
  it('classes and cells answer the same with the gate on and off', () => {
    const all = () =>
      [...four.map((h) => ['plo4', h] as const), ...five.map((h) => ['plo5', h] as const)].map(
        ([v, h]) => ({
          premium: omahaReraisedPremium(h),
          coordinated: omahaOopCoordinated(h),
          call: omahaOopReraisedCallCell(callInput(v, h)),
          fourBetCall: omahaOopReraisedCallCell(
            callInput(v, h, { preflopRaises: 3, toCall: 51, stack: 376, pot: 102 })
          ),
          position: omahaReraiseByPositionCell(positionInput(v, h)),
          flop: omahaReraisedFlopContinueCell(flopInput(v, h, cards('Kc8d3h'))),
          pre: omahaReraisedPreflopCell(preInput(v, h)),
          post: omahaReraisedPostflopCell(
            preInput(v, h, {
              street: 'flop',
              board: cards('Kc8d3h'),
              toCall: 150,
              stack: 150,
              pot: 300,
            })
          ),
        })
      );
    const off = gateOff(all);
    expect(gateOn(all)).toEqual(off);
    expect(off.some((r) => r.call !== null)).toBe(true);
    expect(off.some((r) => r.pre !== null)).toBe(true);
  });
  it('the four- and five-card rows are untouched; the six-card row is the calibration entry', () => {
    expect(COORDINATED_MAX_GAPS).toEqual({ 4: 1, 5: 2 });
    expect(PLO6_OMAHA_STRATEGY_CONSTANTS.COORDINATED_MAX_GAPS.value).toBe(3);
  });
});

describe('gate on: the PLO6 classes (SPEC-B H27, H29)', () => {
  it('premium is the same-cards definition: narrower than the PLO4/PLO5 text on six cards', () => {
    gateOn(() => {
      expect(omahaReraisedPremium(SPLIT_PREMIUM)).toBe(false);
      expect(omahaReraisedPremium(TRUE_PREMIUM)).toBe(true);
      expect(omahaReraisedPremium(cards('AsAh7d2c9h4s'))).toBe(true);
      for (const h of [SPLIT_PREMIUM, TRUE_PREMIUM, SIX_RUNDOWN, TWO_GROUPS])
        expect(omahaReraisedPremium(h)).toBe(plo6ReraisedPremium(h));
    });
    expect(gateOff(() => omahaReraisedPremium(SPLIT_PREMIUM))).toBe(true);
  });
  it('a coordinated six-card hand without an ace reads coordinated (it read null before)', () => {
    expect(gateOff(() => omahaOopCoordinated(SIX_RUNDOWN))).toBeNull();
    gateOn(() => {
      expect(omahaOopCoordinated(SIX_RUNDOWN)).toBe('rundown');
      expect(omahaOopCoordinated(SIX_RUNDOWN)).toBe(plo6OopCoordinated(SIX_RUNDOWN));
      // Three one-rank gaps: inside the six-card row, outside a row of 0.
      expect(omahaOopCoordinated(cards('Ts8s6h4h3d2c'))).toBe(
        plo6OopCoordinated(cards('Ts8s6h4h3d2c'))
      );
      expect(omahaOopCoordinated(TWO_GROUPS)).toBeNull();
    });
  });
});

describe('gate on: the cells serve PLO6 with six cards (3.22 to 3.26)', () => {
  it('3.24 call cell: two groups fold without an estimate; a six-card rundown is priced, not folded as uncoordinated', () => {
    gateOn(() => {
      const weak = omahaOopReraisedCallCell(callInput('plo6', TWO_GROUPS));
      expect(weak).toMatchObject({ fold: true, reason: 'uncoordinated', equity: null });
      const run = omahaOopReraisedCallCell(callInput('plo6', SIX_RUNDOWN));
      expect(run).not.toBeNull();
      expect(run!.coordination).toBe('rundown');
      expect(run!.reason).not.toBe('uncoordinated');
      expect(run!.equity).not.toBeNull();
      // Wrong hole count for the game: outside the cell.
      expect(omahaOopReraisedCallCell(callInput('plo6', cards('9s8s7h6h5d')))).toBeNull();
      expect(omahaOopReraisedCallCell(callInput('plo5', SIX_RUNDOWN))).toBeNull();
      expect(
        omahaOopReraisedCallCell(callInput('plo6', SIX_RUNDOWN, { bombPot: true }))
      ).toBeNull();
      expect(
        omahaOopReraisedCallCell(callInput('plo6', SIX_RUNDOWN, { tournament: true }))
      ).toBeNull();
    });
  });
  it('3.22 / 3.23 re-raise cell: the PLO6 premium decides', () => {
    gateOn(() => {
      expect(omahaReraiseByPositionCell(positionInput('plo6', SPLIT_PREMIUM))).toEqual({
        reraise: false,
        reason: 'not_premium',
      });
      expect(omahaReraiseByPositionCell(positionInput('plo6', TRUE_PREMIUM))).toEqual({
        reraise: true,
        reason: 'premium_structure',
      });
      expect(omahaReraiseByPositionCell(positionInput('plo6', cards('KsQsJhTh5d')))).toBeNull();
    });
  });
  it('3.25 flop cell: served, PLO5 classes (one pair and a weak draw folds; a set continues)', () => {
    gateOn(() => {
      expect(
        omahaReraisedFlopContinueCell(flopInput('plo6', cards('KsQd9h5c4s2d'), cards('Kc8d3h')))
      ).toEqual({ fold: true, reason: 'no_equity_shape' });
      expect(
        omahaReraisedFlopContinueCell(flopInput('plo6', cards('8s8h9h5c4s2d'), cards('Kc8d3h')))
      ).toEqual({ fold: false, reason: 'two_pair_or_better' });
    });
  });
  it('3.26 preflop cell: six cards served; the postflop cell stays PLO4/PLO5', () => {
    gateOn(() => {
      // Kings, suits on other cards: not premium by the PLO6 text, not committed: fold.
      expect(omahaReraisedPreflopCell(preInput('plo6', cards('KsKh9d5d4c2c')))).toMatchObject({
        fold: true,
        cell: 'preflop',
        equity: null,
      });
      // Two kings each with a suited partner: premium, untouched.
      expect(omahaReraisedPreflopCell(preInput('plo6', cards('Ks5sKh9h2d3c')))).toBeNull();
      // Five cards in a PLO6 game: outside the cell (H28).
      expect(omahaReraisedPreflopCell(preInput('plo6', cards('KsKh9d5d4c')))).toBeNull();
      expect(
        omahaReraisedPreflopCell(preInput('plo6', TWO_GROUPS, { tournament: true }))
      ).toBeNull();
      expect(
        omahaReraisedPostflopCell(
          preInput('plo6', cards('KsQd9h5c4s2d'), {
            street: 'flop',
            board: cards('Kc8d3h'),
            toCall: 150,
            stack: 150,
            pot: 300,
          })
        )
      ).toBeNull();
    });
  });
});
