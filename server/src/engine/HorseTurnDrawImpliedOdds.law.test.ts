/**
 * LAW: a real Hold'em turn draw facing a wager is credited the river bet the
 * stacks behind can pay (turnDrawImpliedBonus, 2026-11-08), not a flat 0.04,
 * and V68's no-room rule still withholds it.
 *
 * The Nov 7 flop/turn audit found Q-J of hearts on K-7-2-4 with the flush
 * draw folding to a 0.7-pot turn bet almost every time. Reproduced on the real
 * HorseLogic.decide (1/2 cash, 100bb, heads-up single-raised pot, the hero
 * called a flop c-bet and faces 20 into 28, heads-up production rake 5%):
 * 280 folds and 8 calls in 300 seeds. The call bar was the bluff-catcher's,
 * and the draw's implied allowance was 0.04 whatever was behind. It pins:
 *  1. The completion share is the draw's outs over 46, turn only.
 *  2. The allowance grows with what the stacks can pay, is capped at a
 *     0.7-pot river bet called at minimum defence, and is zero with nothing
 *     behind.
 *  3. Q-J of hearts continues (calls or raises) at least 40% of the time,
 *     the ablated brain at most 15%; the nut flush draw is unchanged.
 *  4. With under 1.5 pots behind (V68 no room to be paid) the decision is
 *     exactly the ablated brain's, as it is for PLO4 and for a hand with no
 *     draw.
 * A red law means draws fold to turn bets the stacks would pay them for, or
 * an implied allowance is being granted where the stacks cannot pay it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { HorseLogic, turnDrawCompletingShare, turnDrawImpliedBonus } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import {
  c,
  DECISION_TIME_MS,
  flopTurnState,
  FT_SEEDS,
  type FlopTurnSpot,
} from './HorseFlopTurnBluff.test-support.js';
import type { HorseDecideOpts } from './HorseLogic.js';

const H = 'hearts';
const D = 'diamonds';
const S = 'spades';
const C = 'clubs';
const SEEDS = FT_SEEDS.slice(0, 120);
const KH_7H_2C_4D = [c('K', H), c('7', H), c('2', C), c('4', D)];

function continueRate(spot: FlopTurnSpot, opts: HorseDecideOpts = {}) {
  const actions: string[] = [];
  for (const s of SEEDS) {
    const { hero, gs } = flopTurnState(spot);
    // Heads-up production rake (rakeSpec: 10%, heads-up pots at 5%).
    (gs as { rakeConfig?: unknown }).rakeConfig = { percent: 10, cap: 3 };
    seedFastRandom(s);
    actions.push(
      HorseLogic.decide(
        hero,
        gs,
        'balanced',
        {},
        {
          observeMind: false,
          decisionTimeMs: DECISION_TIME_MS,
          ...opts,
        }
      ).action
    );
  }
  return {
    actions,
    rate: actions.filter((a) => a !== 'fold').length / actions.length,
  };
}

const qj = (over: Partial<FlopTurnSpot> = {}): FlopTurnSpot => ({
  name: 'qj-hearts-fd',
  variant: 'nlh',
  hole: [c('Q', H), c('J', H)],
  board: KH_7H_2C_4D,
  line: 'facingBarrel',
  ...over,
});

afterEach(() => HorseMind.reset());

describe('LAW: turn draw implied odds', () => {
  it('1. the completion share is the outs over 46, on the turn only', () => {
    expect(turnDrawCompletingShare([c('Q', H), c('J', H)], KH_7H_2C_4D)).toBeCloseTo(9 / 46, 10);
    // open-ender: 6-5 on 7-4-K-2 completes with any 3 or 8
    expect(
      turnDrawCompletingShare([c('6', S), c('5', S)], [c('7', D), c('4', C), c('K', H), c('2', H)])
    ).toBeCloseTo(8 / 46, 10);
    expect(turnDrawCompletingShare([c('Q', S), c('J', D)], KH_7H_2C_4D)).toBe(0);
    expect(turnDrawCompletingShare([c('Q', H), c('J', H)], KH_7H_2C_4D.slice(0, 3))).toBe(0);
  });

  it('2. the allowance is what the stacks can pay, capped at a 0.7-pot river bet', () => {
    const hole = [c('Q', H), c('J', H)];
    const deep = turnDrawImpliedBonus(hole, KH_7H_2C_4D, 166, 68);
    const bet = 0.7 * 68;
    expect(deep).toBeCloseTo(((9 / 46) * ((bet * 68) / (68 + bet))) / 68, 10);
    expect(deep).toBeGreaterThan(0.04);
    expect(turnDrawImpliedBonus(hole, KH_7H_2C_4D, 1000, 68)).toBeCloseTo(deep, 10);
    expect(turnDrawImpliedBonus(hole, KH_7H_2C_4D, 10, 68)).toBeLessThan(deep);
    expect(turnDrawImpliedBonus(hole, KH_7H_2C_4D, 0, 68)).toBe(0);
  });

  it('3. Q-J of hearts continues against a 0.7-pot turn bet; the nut draw is unchanged', () => {
    const on = continueRate(qj());
    const off = continueRate(qj(), { turnDrawImpliedOdds: false });
    expect(on.rate).toBeGreaterThanOrEqual(0.4);
    expect(off.rate).toBeLessThanOrEqual(0.15);
    const nutOn = continueRate(qj({ hole: [c('A', H), c('5', H)] }));
    const nutOff = continueRate(qj({ hole: [c('A', H), c('5', H)] }), {
      turnDrawImpliedOdds: false,
    });
    expect(nutOn.actions).toEqual(nutOff.actions);
  }, 120_000);

  it('4. no room to be paid, PLO4 and a hand without a draw decide as the ablated brain', () => {
    for (const spot of [
      qj({ behind: 100 }), // 72 behind after the call, under 1.5 x 68
      qj({
        variant: 'plo4',
        hole: [c('Q', H), c('J', H), c('9', S), c('8', D)],
      }),
      qj({ hole: [c('9', S), c('9', D)] }),
    ]) {
      expect(continueRate(spot).actions).toEqual(
        continueRate(spot, { turnDrawImpliedOdds: false }).actions
      );
    }
  }, 120_000);
});
