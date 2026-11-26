/**
 * LAW: THE HOLD'EM OPENING SIDE IS PRICED (holdemOpeningValueBetIsPriced, holdemOpeningBluffIsPriced; both default
 * OFF, read `=== true`; plo-lead7 2026-11-25; docs/horse-option-authority.d/holdemOpeningValueBetIsPriced.md and
 * holdemOpeningBluffIsPriced.md).
 *
 *  - his fold comes from his own record first, shrunk to the equilibrium anchor (no record: his fold equals the
 *    bettor's break-even price, so a pure bluff with no blockers is worth exactly nothing and never beats a check);
 *    his record dominates as it grows; the Horse population is never read;
 *  - who folds is the weakest share of his range read WITHOUT the Horse's cards; the Horse's cards change only how
 *    much of the remaining range folds (blockers);
 *  - a value bet needs his calling part to lose chips to it (equity against it above one half);
 *  - range advantage is a symmetric probability;
 *  - real audited nodes (the deciding Horse's own cards only): off the brain checks, each option alone bets with its
 *    receipt, the other option alone does not; a tournament copy of the same node is unchanged; draws nothing
 *    from the brain's random stream that the option-off decision does not.
 */
import { describe, expect, it } from 'vitest';
import FIX from './HorseHoldemOpeningIsPriced.fixture.json';
import {
  HOLDEM_OPENING_FOLD_ANCHOR,
  holdemFoldAndCallEquity,
  holdemFoldCutoff,
  holdemOpeningFoldReference,
  holdemOpeningPrice,
  holdemRangeAdvantage,
} from './HorseHoldemOpeningIsPriced.js';
import {
  holdemFillEquities,
  holdemLineRange,
  holdemPricedFold,
  type HoldemPricedRange,
} from './HorseHoldemValueAndCallsArePriced.js';
import {
  replayAt,
  replayProfiles,
  stateAt,
  type ComplaintAction,
  type ExtractedHand,
} from './HorseComplaintReplay.js';
import { restoreFastRandom, saveFastRandom } from './HorseEval.js';
import type { Card } from '../types.js';

const c = (s: string): Card => ({
  rank: (s[0] === 'T' ? '10' : s[0]) as Card['rank'],
  suit: ({ c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' } as const)[
    s[1] as 'c' | 'd' | 'h' | 's'
  ],
});
const board = ['Kh', '9d', '4c', '2s', '7h'].map(c);

describe('the opening side is priced: the math', () => {
  it('no record reads the equilibrium anchor; his record dominates as it grows', () => {
    expect(holdemOpeningFoldReference(0, 0)).toBeCloseTo(HOLDEM_OPENING_FOLD_ANCHOR, 12);
    // at the anchor his fold to a bet B into P is the bettor's break-even B / (B + P)
    expect(holdemPricedFold(holdemOpeningFoldReference(0, 0), 50, 100)).toBeCloseTo(50 / 150, 9);
    const small = holdemOpeningFoldReference(8, 10);
    const big = holdemOpeningFoldReference(800, 1000);
    expect(small).toBeGreaterThan(HOLDEM_OPENING_FOLD_ANCHOR);
    expect(big).toBeGreaterThan(small);
    expect(big).toBeCloseTo(0.8, 1);
    expect(holdemOpeningFoldReference(-3, Number.NaN)).toBeCloseTo(HOLDEM_OPENING_FOLD_ANCHOR, 12);
  });

  it('with no record a bluff with no blockers is worth nothing: it never prices above a check', () => {
    // the Horse holds two cards that are not in his range's strength order at all (no overlap with his calling part)
    const hero = [c('3d'), c('5d')];
    const range = holdemLineRange(hero, board, null, []);
    const base = holdemLineRange([], board, null, []);
    holdemFillEquities(range, hero, board, 7);
    const spot = {
      pot: 100,
      heroIn: 0,
      villainIn: 0,
      heroStack: 1000,
      villainStack: 1000,
      foldRef: HOLDEM_OPENING_FOLD_ANCHOR,
      r: 1,
    };
    const p = holdemOpeningPrice(spot, range, base, [33, 50, 75, 100]);
    for (const b of p.bets) {
      expect(b.value).toBe(false);
      // EV of a near-pure bluff at the anchor is the blocker edge only: tiny
      expect(Math.abs(b.ev - (b.fold - b.foldBase) * (spot.pot + b.to))).toBeLessThan(
        spot.pot * 0.05
      );
    }
  });

  it('who folds is read without the Horse cards; the Horse cards move only the share (blockers)', () => {
    const base = holdemLineRange([], board, null, []);
    const cut = holdemFoldCutoff(base, 0.4);
    const g0 = holdemFoldAndCallEquity(base, cut);
    expect(g0.fold).toBeCloseTo(0.4, 6);
    // a Horse holding two kings removes top pair from his calling part: more of what is left folds
    const kk = [c('Kd'), c('Ks')];
    const r = holdemLineRange(kk, board, null, []);
    const g = holdemFoldAndCallEquity(r, cut);
    expect(g.fold).toBeGreaterThan(0.4);
    // a Horse holding two deuces of no value blocks nothing of his calling part
    const low = [c('3h'), c('3c')];
    const r2 = holdemLineRange(low, board, null, []);
    expect(holdemFoldAndCallEquity(r2, cut).fold).toBeLessThan(g.fold);
  });

  it('a value bet needs his calling part to lose chips to it', () => {
    const hero = [c('Kd'), c('Kc')]; // top set
    const range = holdemLineRange(hero, board, null, []);
    const base = holdemLineRange([], board, null, []);
    holdemFillEquities(range, hero, board, 7);
    const p = holdemOpeningPrice(
      {
        pot: 100,
        heroIn: 0,
        villainIn: 0,
        heroStack: 1000,
        villainStack: 1000,
        foldRef: HOLDEM_OPENING_FOLD_ANCHOR,
        r: 1,
      },
      range,
      base,
      [33, 50, 75, 100]
    );
    for (const b of p.bets) expect(b.value).toBe(b.callEquity > 0.5);
    expect(p.bets.some((b) => b.value && b.ev > p.check)).toBe(true);
  });

  it('range advantage is a symmetric probability', () => {
    const a = holdemLineRange([], board, [0.6, 1], []);
    const b = holdemLineRange([], board, null, []);
    const ab = holdemRangeAdvantage(a, b, board);
    const ba = holdemRangeAdvantage(b, a, board);
    expect(ab).toBeGreaterThan(0.5);
    expect(ab + ba).toBeCloseTo(1, 9);
    expect(holdemRangeAdvantage(b, b, board)).toBeCloseTo(0.5, 9);
  });
});

interface FixNode {
  hand: ExtractedHand;
  ord: number;
  street: string;
  option: string;
  expect: string;
}
const nodes = (FIX as unknown as { nodes: FixNode[] }).nodes;
const PROD = (FIX as unknown as { productionOpts: Record<string, unknown> }).productionOpts;
const prof = replayProfiles('cash')[0];
const SEEDS = [1, 7, 42];
const OTHER: Record<string, string> = {
  holdemOpeningValueBetIsPriced: 'holdemOpeningBluffIsPriced',
  holdemOpeningBluffIsPriced: 'holdemOpeningValueBetIsPriced',
};

describe('the opening side is priced: real audited nodes', () => {
  for (const n of nodes) {
    it(`${n.hand.handId} ${n.street}: off checks, ${n.option} bets with its receipt`, () => {
      const rng = saveFastRandom();
      try {
        const node = n.hand.actions.find((a) => a.ord === n.ord) as ComplaintAction;
        const st = stateAt(n.hand, node);
        const off = replayAt(st, prof, SEEDS, PROD);
        expect(off.kinds).toEqual({ check: SEEDS.length });
        for (const v of [false, 1, 'true'])
          expect(replayAt(st, prof, SEEDS, { ...PROD, [n.option]: v }).kinds).toEqual(off.kinds);
        const on = replayAt(st, prof, SEEDS, { ...PROD, [n.option]: true });
        expect(on.kinds).toEqual({ raise: SEEDS.length });
        expect(on.receipts[n.expect]).toBe(SEEDS.length);
        // same state, same seeds: the same size on every seed (no draw decides it)
        expect(new Set(on.sizesBb).size).toBe(1);
        // the other option alone does not make this bet
        const other = replayAt(st, prof, SEEDS, { ...PROD, [OTHER[n.option]]: true });
        expect(other.receipts[n.expect] ?? 0).toBe(0);
        // tournaments are out of scope
        const t = stateAt(n.hand, node);
        (t.gs as unknown as { gameMode: string }).gameMode = 'tournament';
        const tOn = replayAt(t, prof, SEEDS, { ...PROD, [n.option]: true });
        expect(tOn.receipts[n.expect] ?? 0).toBe(0);
      } finally {
        restoreFastRandom(rng);
      }
    });
  }
});

export type { HoldemPricedRange };
