/**
 * LAW: THE OPENER'S ANSWER TO AN OUT-OF-POSITION 3-BET HAS AN INDIFFERENCE PRIOR (horse.openerAnswersPriorVersion 2;
 * PLO lead-7 lane plo-preflop, 2026-11-26).
 *
 * OPENER_ANSWERS_PRIOR (2026-11-24.v1) was fitted on people and Horses pooled from hand_history, the mis-playing field a
 * prior must not be anchored to. Version 2 takes the answer at the indifference points of the 3-bet faced
 * (HorsePreflopIndifferenceAnchor): fold = s/(1+s) at the 3-bet's risk over the pot, the 4-bet share = the hands
 * ahead of the Horse's own 3-bet range plus a pot 4-bet's bluffs, the rest calls. Asserted: version 1 (and an absent
 * anchor) is exactly the fitted table as before; version 2 is the indifference answer whatever the game or depth; the
 * opener's own record dominates either prior as its sample grows, with the same shrinkage.
 */
import { describe, expect, it } from 'vitest';
import {
  HORSE_OOP_THREE_BET_WIDTH,
  OPENER_ANSWERS_PRIOR,
  OPENER_ANSWERS_PRIOR_MASS,
  openerAnswersThreeBetRead,
} from './HorseOopReraiseRangeHolds.js';
import { preflopAnswerToReraise } from './HorsePreflopIndifferenceAnchor.js';

const ANCHOR = { size: 2, openWidth: 0.6, threeBetWidth: HORSE_OOP_THREE_BET_WIDTH.plo5 };

describe('the opener answers prior', () => {
  it('version 1: the fitted table, exactly as before', () => {
    for (const effBB of [100, 200, 400, 800]) {
      const r = openerAnswersThreeBetRead('plo5', effBB, null)!;
      const r2 = openerAnswersThreeBetRead('plo5', effBB, null, null)!;
      expect(r2).toEqual(r);
      expect(r.source).toBe('population');
    }
    expect(openerAnswersThreeBetRead('plo4', 300, null)!.fold).toBe(
      OPENER_ANSWERS_PRIOR.plo4['250_500'].fold
    );
  });

  it('version 2: the indifference answer to the pot 3-bet (two thirds fold), the same at every depth', () => {
    const want = preflopAnswerToReraise(2, 0.6, HORSE_OOP_THREE_BET_WIDTH.plo5, 2);
    for (const effBB of [100, 200, 400, 800]) {
      const r = openerAnswersThreeBetRead('plo5', effBB, null, ANCHOR)!;
      expect(r.fold).toBeCloseTo(2 / 3, 12);
      expect(r.fold).toBeCloseTo(want.fold, 12);
      expect(r.call).toBeCloseTo(want.call, 12);
      expect(r.raise).toBeCloseTo(want.raise, 12);
      expect(r.prior).toBe('plo5:indifference');
    }
  });

  it('his own record outweighs the prior as its sample grows (an opener who never folds a 3-bet)', () => {
    for (const n of [6, 30, 300]) {
      const r = openerAnswersThreeBetRead('plo5', 300, { mean: 0, n }, ANCHOR)!;
      expect(r.fold).toBeCloseTo(
        ((2 / 3) * OPENER_ANSWERS_PRIOR_MASS) / (n + OPENER_ANSWERS_PRIOR_MASS),
        12
      );
      expect(r.source).toBe('measured');
    }
  });
});
