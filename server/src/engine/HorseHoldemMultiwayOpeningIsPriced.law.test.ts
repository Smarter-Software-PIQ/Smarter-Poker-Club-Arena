/**
 * LAW: THE FIRST BET OF THE TURN OR RIVER AGAINST TWO OR MORE OPPONENTS IS PRICED
 * (holdemMultiwayOpeningBluffIsPriced, holdemMultiwayOpeningValueBetIsPriced; both default OFF, read `=== true`;
 * plo-lead7 2026-11-26; docs/horse-option-authority.d/holdemMultiwayOpeningBluffIsPriced.md and
 * holdemMultiwayOpeningValueBetIsPriced.md).
 *
 *  - every opponent must fold for a bluff to win, and the minimum defence is shared across the field: with no
 *    record the field's JOINT fold is the bettor's break-even B / (B + P), each of N opponents folding its N-th
 *    root, so a pure bluff with no blockers is worth nothing and never beats a check; one opponent's record moves
 *    the joint fold by the N-th root of his ratio (the geometric mean), never by a product of over-folds; the Horse
 *    population is never read;
 *  - who folds is the weakest share of each range read WITHOUT the Horse's cards; the Horse's cards change only how
 *    much of what is left folds (blockers);
 *  - a value size is one where the chips the callers add are won on balance (the share of the joint calling range
 *    the hand beats);
 *  - range advantage over the field is the lowest of the pairwise advantages (it must hold against everyone);
 *  - real audited multiway nodes (the deciding Horse's own cards only): off the brain checks, each option alone
 *    bets at one size on every seed with its receipt, the other option alone does not; a tournament copy and a
 *    heads-up copy of the same node are unchanged; identity never enters.
 */
import { describe, expect, it } from 'vitest';
import FIX from './HorseHoldemMultiwayOpeningIsPriced.fixture.json';
import {
  holdemMultiwayFieldFold,
  holdemMultiwayOpeningPrice,
  holdemMultiwayRangeAdvantage,
} from './HorseHoldemMultiwayOpeningIsPriced.js';
import {
  HOLDEM_OPENING_FOLD_ANCHOR,
  holdemOpeningFoldReference,
  holdemRangeAdvantage,
} from './HorseHoldemOpeningIsPriced.js';
import { holdemLineRange } from './HorseHoldemValueAndCallsArePriced.js';
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
const river = ['Kh', '9d', '4c', '2s', '7h'].map(c);
const turn = river.slice(0, 4);
const A = HOLDEM_OPENING_FOLD_ANCHOR;
const opp = (board: Card[], foldRef = A, band: [number, number] | null = null) => ({
  base: holdemLineRange([], board, band, []),
  foldRef,
  in: 0,
  stack: 1000,
});
const SPOT = { pot: 100, heroIn: 0, heroStack: 1000, r: 1 };
const SIZES = [33, 50, 75, 100];

describe('the multiway opening bet is priced: the math', () => {
  it('no record: the field folds jointly at the break-even, each opponent at its N-th root', () => {
    for (const n of [2, 3, 5]) {
      const f = holdemMultiwayFieldFold(new Array(n).fill(A), 50, 100);
      expect(f.joint).toBeCloseTo(50 / 150, 9);
      for (const x of f.each) expect(x).toBeCloseTo(Math.pow(50 / 150, 1 / n), 9);
    }
    // never the product of heads-up fold rates
    expect(holdemMultiwayFieldFold([A, A, A], 100, 100).joint).toBeGreaterThan(0.5 ** 3 + 0.3);
  });

  it("one opponent's record moves the joint fold by the N-th root of his ratio, never by the whole ratio", () => {
    const over = holdemOpeningFoldReference(900, 1000); // a measured over-folder
    const ratio = over / A;
    const two = holdemMultiwayFieldFold([over, A], 33, 100).joint;
    const three = holdemMultiwayFieldFold([over, A, A], 33, 100).joint;
    const price = 33 / 133;
    expect(two).toBeCloseTo(price * Math.sqrt(ratio), 9);
    expect(three).toBeCloseTo(price * Math.cbrt(ratio), 9);
    expect(three).toBeLessThan(two);
    expect(two).toBeLessThan(price * ratio);
    // his record dominates his own fold as it grows; a caller's record lowers the joint fold
    const caller = holdemOpeningFoldReference(50, 1000);
    expect(holdemMultiwayFieldFold([caller, A], 33, 100).joint).toBeLessThan(price);
    expect(holdemOpeningFoldReference(0, 0)).toBeCloseTo(A, 12);
  });

  it('with no record a bluff with no blockers is worth nothing: it never prices far above nothing', () => {
    const hero = [c('3d'), c('5d')];
    const p = holdemMultiwayOpeningPrice(SPOT, hero, river, [opp(river), opp(river)], SIZES)!;
    expect(p.bets.length).toBe(SIZES.length);
    for (const b of p.bets) {
      expect(b.value).toBe(false);
      expect(b.foldBase).toBeCloseTo(b.to / (b.to + SPOT.pot), 9);
      // the price of a near-pure bluff at the anchor is the blocker edge only
      expect(Math.abs(b.ev - (b.fold - b.foldBase) * (SPOT.pot + b.to))).toBeLessThan(
        SPOT.pot * 0.06
      );
    }
  });

  it('the Horse cards move only how much of the field folds (blockers)', () => {
    const field = [opp(river), opp(river)];
    const kk = holdemMultiwayOpeningPrice(SPOT, [c('Kd'), c('Ks')], river, field, [75])!.bets[0];
    const low = holdemMultiwayOpeningPrice(SPOT, [c('3h'), c('3c')], river, field, [75])!.bets[0];
    expect(kk.foldBase).toBeCloseTo(low.foldBase, 12);
    // two kings remove top pair from both calling parts: more of what is left folds
    expect(kk.fold).toBeGreaterThan(kk.foldBase);
    expect(kk.fold).toBeGreaterThan(low.fold);
  });

  it('a value size is one where the chips the callers add are won on balance; more callers need more', () => {
    const field2 = [opp(river), opp(river)];
    const set = holdemMultiwayOpeningPrice(SPOT, [c('Kd'), c('Kc')], river, field2, SIZES)!;
    for (const b of set.bets) expect(b.value).toBe(b.calledGain > 1e-9);
    expect(set.bets.some((b) => b.value && b.ev > set.check)).toBe(true);
    // the chance to beat every caller falls as the field grows
    const field4 = [opp(river), opp(river), opp(river), opp(river)];
    const mid2 = holdemMultiwayOpeningPrice(SPOT, [c('Kd'), c('Qc')], river, field2, [75])!;
    const mid4 = holdemMultiwayOpeningPrice(SPOT, [c('Kd'), c('Qc')], river, field4, [75])!;
    expect(mid4.equity).toBeLessThan(mid2.equity);
    expect(mid4.bets[0].callEquity).toBeLessThan(mid2.bets[0].callEquity);
  });

  it('the turn is priced per river card, by the cards alone: the same spot prices the same', () => {
    const field = [opp(turn), opp(turn), opp(turn)];
    const a = holdemMultiwayOpeningPrice(SPOT, [c('Ah'), c('Qh')], turn, field, SIZES)!;
    const b = holdemMultiwayOpeningPrice(SPOT, [c('Ah'), c('Qh')], turn, field, SIZES)!;
    expect(a).toEqual(b);
    expect(a.equity).toBeGreaterThan(0);
    expect(a.equity).toBeLessThan(1);
    // out of scope: one opponent, the flop, a dead-card clash
    expect(
      holdemMultiwayOpeningPrice(SPOT, [c('Ah'), c('Qh')], turn, [opp(turn)], SIZES)
    ).toBeNull();
    expect(
      holdemMultiwayOpeningPrice(SPOT, [c('Ah'), c('Qh')], turn.slice(0, 3), field, SIZES)
    ).toBeNull();
    expect(holdemMultiwayOpeningPrice(SPOT, [c('Kh'), c('Qh')], turn, field, SIZES)).toBeNull();
  });

  it('range advantage over the field is the lowest pairwise advantage', () => {
    const strong = holdemLineRange([], river, [0.6, 1], []);
    const any = holdemLineRange([], river, null, []);
    const ab = holdemRangeAdvantage(strong, any, river);
    expect(holdemMultiwayRangeAdvantage(strong, [any], river)).toBeCloseTo(ab, 9);
    expect(holdemMultiwayRangeAdvantage(strong, [any, any], river)).toBeCloseTo(ab, 9);
    expect(ab).toBeGreaterThan(0.5);
    // one opponent whose range outscores the Horse's takes the advantage away
    expect(holdemMultiwayRangeAdvantage(any, [any, strong], river)).toBeLessThan(0.5);
    expect(holdemMultiwayRangeAdvantage(strong, [any, strong], river)).toBeCloseTo(0.5, 9);
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
  holdemMultiwayOpeningValueBetIsPriced: 'holdemMultiwayOpeningBluffIsPriced',
  holdemMultiwayOpeningBluffIsPriced: 'holdemMultiwayOpeningValueBetIsPriced',
};

describe('the multiway opening bet is priced: real audited nodes', () => {
  it('the fixture holds bluffs and value bets on the turn and the river', () => {
    expect(nodes.length).toBeGreaterThanOrEqual(8);
    expect(new Set(nodes.map((n) => n.option)).size).toBe(2);
    expect(new Set(nodes.map((n) => n.street))).toEqual(new Set(['turn', 'river']));
  });
  for (const n of nodes) {
    it(`${n.hand.handId} ${n.street} ord ${n.ord}: off checks, ${n.option} bets with its receipt`, () => {
      const rng = saveFastRandom();
      try {
        const node = n.hand.actions.find((a) => a.ord === n.ord) as ComplaintAction;
        const st = stateAt(n.hand, node);
        const live = st.gs.players.filter((p) => p.seat !== st.hero.seat && !p.is_folded);
        expect(live.length).toBeGreaterThanOrEqual(2);
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
        // the heads-up options never make it either (they are silent multiway)
        const hu = replayAt(st, prof, SEEDS, {
          ...PROD,
          holdemOpeningBluffIsPriced: true,
          holdemOpeningValueBetIsPriced: true,
        });
        expect(hu.kinds).toEqual(off.kinds);
        // tournaments are out of scope
        const t = stateAt(n.hand, node);
        (t.gs as unknown as { gameMode: string }).gameMode = 'tournament';
        const tOn = replayAt(t, prof, SEEDS, { ...PROD, [n.option]: true });
        expect(tOn.receipts[n.expect] ?? 0).toBe(0);
        // heads-up is out of scope: with all but one opponent folded the option is silent
        const h = stateAt(n.hand, node);
        const others = h.gs.players.filter((p) => p.seat !== h.hero.seat && !p.is_folded);
        for (const p of others.slice(1)) p.is_folded = true;
        const hOn = replayAt(h, prof, SEEDS, { ...PROD, [n.option]: true });
        expect(hOn.receipts[n.expect] ?? 0).toBe(0);
        // identity never enters: other names, the Horse flag flipped on every opponent, the same answer
        const x = stateAt(n.hand, node);
        for (const p of x.gs.players)
          if (p.seat !== x.hero.seat) {
            const q = p as unknown as Record<string, unknown>;
            q.is_horse = !q.is_horse;
            q.username = `someone-${p.seat}`;
          }
        const xOn = replayAt(x, prof, SEEDS, { ...PROD, [n.option]: true });
        expect(xOn.kinds).toEqual(on.kinds);
        expect(xOn.sizesBb).toEqual(on.sizesBb);
      } finally {
        restoreFastRandom(rng);
      }
    });
  }
});
