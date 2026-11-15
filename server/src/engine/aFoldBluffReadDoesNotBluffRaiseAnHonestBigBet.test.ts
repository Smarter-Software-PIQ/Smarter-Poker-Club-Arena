/**
 * LATER LAYERS KEEP THE STYLE READ, rule 3 (2026-11-15).
 *
 * The river bluff-raise gate (V64 overFolder64: bluffMod > 1.05) was opened by
 * the styleFoldBluff multiplier alone, before the big-bet honesty read was
 * consulted: against a river folder whose big bets show down as value the
 * Horse bluff-raised the very bet the honesty layer respects, and turning
 * honesty on removed none of those raises (reproduction claim 3 on
 * a796551420a5). Now, with both options on, the multiplier cannot open that
 * gate against a bet the honesty predicate (HorseOpponentStyle.bigBetRespect
 * > 0) calls credibly value. Either option alone, a bettor whose big bets are
 * bluffs, and the Horse's own bets when checked to are unchanged. Option off:
 * byte-identical to the commit before.
 *
 * Spot: cash heads-up, Kh9d3s7c2d, villain bets 70 into 100 on the river,
 * hero Ad5c (ace high, flush-suit blocker). Villain folds rivers (call 3/30).
 */
import { describe, expect, it } from 'vitest';
import { HorseMind } from './HorseMind.js';
import { bigBetRespect, postflopFoldBluffScale } from './HorseOpponentStyle.js';
import {
  checkedTo,
  install,
  riverBigBet,
  VILLAIN,
  type Villain,
} from './HorseOpponentStyle.contexts.test-support.js';
import {
  decide,
  largeBucket,
  pinAll,
  riverFolderWhoBetsValue,
  riverFolderWhoBluffs,
  seeds,
  supply,
  tally,
} from './laterLayersKeepTheStyleRead.test-support.js';

const FOLD_BLUFF = { styleFoldBluff: true };
const HONESTY = { styleBigBetHonesty: true };
const BOTH = { styleFoldBluff: true, styleBigBetHonesty: true };
const setup = (v: Villain, strong: number) => {
  install(v, 'cash');
  supply(120);
  largeBucket(strong);
};
const river = (v: () => Villain, strong: number, opts: Record<string, unknown>) =>
  seeds(200).map((s) => {
    setup(v(), strong);
    return decide(riverBigBet('cash', 'Ad5c', 70), opts, s);
  });
const ownBet = (opts: Record<string, unknown>) =>
  seeds(100).map((s) => {
    setup(riverFolderWhoBetsValue(), 9);
    return decide(checkedTo('cash', '7c6c', 'river'), opts, s);
  });
// Captured on a668406c (before the change).
const BASE = {
  foldAll: 'd0a8b97d13b094027d542339',
  foldBluffRaises: '51a32e4443f64ed89cd03d1a',
  ownBet: '2332867c11e7bbc6014d7214',
};

describe('a fold-bluff read does not bluff-raise an honest big bet', () => {
  it('the two reads, as installed: the multiplier alone crosses the gate and the bet reads as value', () => {
    setup(riverFolderWhoBetsValue(), 9);
    HorseMind.setDecisionScope('holdem:full', 'nlh', 'cash');
    const style = HorseMind.styleRead(VILLAIN);
    const older = HorseMind.exploit(VILLAIN, true, {}).bluffMod;
    const mul = postflopFoldBluffScale(style, 'river') ?? 1;
    const honest = bigBetRespect(style, {
      street: 'river',
      potFraction: 0.7,
      isRaise: false,
      heroHasBlocker: true,
    });
    HorseMind.setDecisionScope(null);
    expect(older).toBeLessThanOrEqual(1.05);
    expect(older * mul).toBeGreaterThan(1.05);
    expect(honest).toBeGreaterThan(0);
  });

  it('option off, and either option alone: byte-identical to the commit before', () => {
    expect(pinAll(river(riverFolderWhoBetsValue, 9, {}))).toBe(BASE.foldAll);
    expect(pinAll(river(riverFolderWhoBetsValue, 9, HONESTY))).toBe(BASE.foldAll);
    expect(pinAll(river(riverFolderWhoBetsValue, 9, FOLD_BLUFF))).toBe(BASE.foldBluffRaises);
    expect(pinAll(ownBet({}))).toBe(BASE.ownBet);
  });

  it('with both on, the honest river bet is no longer bluff-raised', () => {
    // Before: all_in 14 of 200, the honesty receipt on 0 of them.
    const ds = river(riverFolderWhoBetsValue, 9, BOTH);
    expect(tally(ds)).toEqual({ fold: 200 });
    const held = ds.filter(
      (d) => d.fires.style_fold_bluff_held_by_big_bet_honesty_seen === 1
    ).length;
    expect(held).toBe(ds.filter((d) => d.fires.v64_river_raise_needs_two_pair === 1).length);
    expect(held).toBeGreaterThan(0);
  });

  it("a bettor whose big bets are bluffs, and the Horse's own bet when checked to, are unchanged with both on", () => {
    expect(pinAll(river(riverFolderWhoBluffs, 2, BOTH))).toBe(BASE.foldAll);
    expect(pinAll(ownBet(BOTH))).toBe(BASE.ownBet);
  });
});
