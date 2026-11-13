/**
 * Cross-variant reach of the token-price call bar (PLO6-AUDIT-010).
 *
 * DERIVED FIXTURES, NOT PRODUCTION ORIGINALS. No PLO4 or PLO5 hand with a
 * token-priced fold was available, so the real PLO6 node of production hand
 * 58466632 (decision 17: flop 8h Ac 3h, 7.95 behind, 14.56 to call into
 * 66.18, an effective price near 0.12) is replayed as PLO4 and PLO5 with
 * chosen hole cards. That exercises the real shared decision path, each
 * game's own hand evaluation, the effective-price boundary and the scope
 * exclusions. It is development evidence about the code path. It says nothing
 * about how often the spot arises in those games.
 *
 * Hi-lo is excluded by tokenCallPriceApplies and pinned at the helper
 * (HorseTokenCallPrice.test.ts). No PLO8 case is here: at this node PLO8
 * never folds with the rule on or off, so such a case could not fail.
 *
 * What a 120-hand sweep of this node showed, and these cases pin: in PLO4 and
 * PLO5 the old bar already calls almost every hand here, so the rule changes
 * little there; its effect is concentrated in PLO6, where the old bar folded
 * most hands at this price.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { HorseMind } from './HorseMind.js';
import { replayHand, type ComplaintFixture } from './HorseComplaintReplay.js';
import FIXTURE from './fixtures/horse-plo6-token-priced-call-58466632.json';
import type { Card, CardRank, CardSuit } from '../types.js';

const FX = FIXTURE as unknown as ComplaintFixture;
const ORD = 17;
const SEAT = 3;
const OFF = { tokenCallPrice: false };
const SUITS: Record<string, CardSuit> = { h: 'hearts', d: 'diamonds', c: 'clubs', s: 'spades' };
const cards = (text: string): Card[] =>
  text.split(' ').map((c) => ({ rank: c[0] as CardRank, suit: SUITS[c[1]] }));

function derived(
  variant: string,
  hole: string,
  edit?: (fixture: ComplaintFixture & { fmt: string }, node: Record<string, unknown>) => void
) {
  const fx = structuredClone(FX) as ComplaintFixture & { fmt: string };
  (fx as { variant: string }).variant = variant;
  fx.hole = { [String(SEAT)]: cards(hole) } as unknown as typeof FX.hole;
  for (const a of fx.actions) {
    const node = a.publicNode as unknown as Record<string, unknown> | undefined;
    if (!node) continue;
    node.variant = variant;
    if (a.ord === ORD && edit) edit(fx, node);
  }
  return fx;
}

function actions(fx: ComplaintFixture, opts?: Record<string, unknown>) {
  const [node] = replayHand(fx, { ords: [ORD], opts });
  return node.profiles.map((p) => p.actions as Record<string, number>);
}

const folds = (a: Record<string, number>[]) => a.reduce((n, x) => n + (x.fold ?? 0), 0);

describe('the token-price call bar in PLO4 and PLO5 (derived fixtures, PLO6-AUDIT-010)', () => {
  afterEach(() => HorseMind.reset());

  it.each([
    ['plo4', '2d Qs 7d Kh'],
    ['plo5', '6d Qs 4d 9c Jd'],
    ['plo5', 'Kd 7s 4c 7d Td'],
  ] as const)(
    '%s %s: the old bar folds it at some seeds; the scaled bar never folds it',
    (variant, hole) => {
      const fx = derived(variant, hole);
      expect(folds(actions(fx, OFF))).toBeGreaterThan(0);
      expect(folds(actions(fx))).toBe(0);
    }
  );

  it.each([
    ['plo4', 'Kd Qd 9s 2c'],
    ['plo4', 'As Ad 7c 2d'],
    ['plo5', 'Kd Qd 9s 2c 5s'],
    ['plo5', 'As Ad 7c 2d Jd'],
  ] as const)('%s %s: the rule never adds a fold', (variant, hole) => {
    const fx = derived(variant, hole);
    expect(folds(actions(fx))).toBeLessThanOrEqual(folds(actions(fx, OFF)));
  });

  it.each([
    ['plo4', '2d Qs 7d Kh'],
    ['plo5', '6d Qs 4d 9c Jd'],
  ] as const)(
    '%s %s: at a price of 0.15 or more the action is the same with the rule on or off',
    (variant, hole) => {
      // 40 behind: the whole 14.56 is owed, 18% of the final pot.
      const fx = derived(variant, hole, (_f, node) => {
        (node.seats as number[][]).find((s) => s[0] === SEAT)![1] = 40;
      });
      expect(actions(fx)).toEqual(actions(fx, OFF));
    }
  );

  it.each([
    ['plo4', '2d Qs 7d Kh'],
    ['plo5', '6d Qs 4d 9c Jd'],
  ] as const)('%s %s: a tournament is out of scope', (variant, hole) => {
    const fx = derived(variant, hole, (fixture) => {
      fixture.fmt = 'tour';
      for (const a of fixture.actions) {
        const node = a.publicNode as unknown as Record<string, unknown> | undefined;
        if (node) node.mode = 'tournament';
      }
    });
    expect(actions(fx)).toEqual(actions(fx, OFF));
  });
});
