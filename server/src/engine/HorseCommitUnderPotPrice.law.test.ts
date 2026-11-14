/**
 * LAW (HU-NLH-016, 2026-11-13): commitUnderPot removes a fold only when the
 * call is priced in.
 *
 * The rule compared the stack with a pot that already held the bet being
 * faced, so "stack smaller than the pot" was true for every covering shove
 * whatever its size: with the flag on, a fold became a 38bb call into a 4bb
 * pot with any hand (47.5% needed), and hu_overshove_value won 117.8 bb/100
 * at 40bb against horses that had it on. The flag is default OFF and stays
 * OFF; this law holds the rule to its price for whoever turns it on.
 *
 * What the horse puts in (the call, or its stack when the call is all in for
 * less) against the pot that call wins (the bet included, less the part of
 * the bet a short stack cannot match) may need no more than
 * COMMIT_UNDER_POT_MAX_PRICE. Decided at commitUnderPotCall, the rule that
 * runs after every other layer.
 */
import { describe, expect, it } from 'vitest';
import {
  COMMIT_UNDER_POT_MAX_PRICE,
  commitUnderPotCall,
  type HorseGameStateV2,
} from './HorseLogic.js';
import type { SeatPlayer } from '../types.js';

const BB = 2;
const ON = { commitUnderPot: true };
const fold = { action: 'fold' as const, thinkTime: 1 };

/** Heads-up, the horse facing `betBB` into `potBeforeBB` with `stackBB` behind. */
function spot(potBeforeBB: number, betBB: number, stackBB: number, stage: 'flop' | 'turn') {
  const hero = {
    seat: 2,
    user_id: 'h',
    stack: stackBB * BB,
    bet: 0,
    is_folded: false,
  } as SeatPlayer;
  const villain = {
    seat: 1,
    user_id: 'v',
    stack: 100 * BB,
    bet: betBB * BB,
    is_folded: false,
  } as SeatPlayer;
  const gs = {
    players: [villain, hero],
    communityCards: [],
    pot: (potBeforeBB + betBB) * BB,
    currentBet: betBB * BB,
    stage,
    gameVariant: 'nlh',
    bigBlind: BB,
  } as unknown as HorseGameStateV2;
  return { hero, gs };
}

/** The equity the call needs: chips in against the pot those chips win. */
function price(potBeforeBB: number, betBB: number, stackBB: number): number {
  const committed = Math.min(betBB, stackBB);
  return committed / (potBeforeBB + 2 * committed);
}

describe('commitUnderPot removes a fold only at a price', () => {
  it('keeps the fold against a covering shove of many times the pot', () => {
    // 38bb into 4bb: the call needs 47.5% with any hand.
    const { hero, gs } = spot(4, 38, 38, 'flop');
    expect(commitUnderPotCall(fold, hero, gs, ON)).toBe(fold);
    // A pot-sized shove (33%) and a three-quarter-pot bet (30%) on either street.
    for (const stage of ['flop', 'turn'] as const) {
      const shove = spot(20, 20, 20, stage);
      expect(commitUnderPotCall(fold, shove.hero, shove.gs, ON)).toBe(fold);
      const bet = spot(20, 15, 30, stage);
      expect(commitUnderPotCall(fold, bet.hero, bet.gs, ON)).toBe(fold);
    }
  });

  it('still calls when the pot lays three to one or better', () => {
    // 4bb left into 30bb: 10.5%. All in.
    const short = spot(30, 4, 4, 'flop');
    expect(commitUnderPotCall(fold, short.hero, short.gs, ON).action).toBe('all_in');
    // A half-pot bet with less than a pot behind: exactly 25%.
    const half = spot(20, 10, 25, 'turn');
    expect(commitUnderPotCall(fold, half.hero, half.gs, ON)).toMatchObject({
      action: 'call',
      amount: 10 * BB,
    });
  });

  it('prices a call for less than the bet on what that call can win', () => {
    // 60bb into 40bb, the horse has 12bb: it matches 12 of the 60 and wins
    // 40 + 12, so 12 / 64 = 18.75%, not 12 / 112.
    const { hero, gs } = spot(40, 60, 12, 'flop');
    expect(price(40, 60, 12)).toBeCloseTo(0.1875, 6);
    expect(commitUnderPotCall(fold, hero, gs, ON).action).toBe('all_in');
    // 60bb into 20bb, the horse has 12bb: 12 / 44 = 27.3%. Folded.
    const dear = spot(20, 60, 12, 'flop');
    expect(commitUnderPotCall(fold, dear.hero, dear.gs, ON)).toBe(fold);
  });

  it('never removes a fold above the price, at any pot, bet and stack', () => {
    let fired = 0;
    let kept = 0;
    for (const stage of ['flop', 'turn'] as const)
      for (const potBefore of [2, 4, 6, 10, 16, 24, 40, 60])
        for (const bet of [1, 2, 3, 5, 8, 12, 20, 38, 60])
          for (const stack of [1, 2, 4, 8, 12, 18, 25, 38, 60, 100]) {
            const { hero, gs } = spot(potBefore, bet, stack, stage);
            const out = commitUnderPotCall(fold, hero, gs, ON);
            const needs = price(potBefore, bet, stack);
            const tag = `${stage} pot ${potBefore} bet ${bet} stack ${stack}`;
            if (out === fold) {
              kept += 1;
              // Under the pot and at the price, the fold is always removed.
              expect(stack < potBefore + bet && needs <= COMMIT_UNDER_POT_MAX_PRICE, tag).toBe(
                false
              );
              continue;
            }
            fired += 1;
            expect(needs, tag).toBeLessThanOrEqual(COMMIT_UNDER_POT_MAX_PRICE + 1e-9);
            // Never a call larger than what the pot lays.
            expect(Math.min(bet, stack), tag).toBeLessThan(potBefore + Math.min(bet, stack));
            expect(stack, tag).toBeLessThan(potBefore + bet);
            expect(out.action, tag).toBe(bet >= stack ? 'all_in' : 'call');
          }
    expect(fired).toBeGreaterThan(100);
    expect(kept).toBeGreaterThan(100);
  });

  it('the bound is a quarter, and the flag is off unless it is set', () => {
    expect(COMMIT_UNDER_POT_MAX_PRICE).toBe(0.25);
    const { hero, gs } = spot(30, 4, 4, 'flop');
    expect(commitUnderPotCall(fold, hero, gs, {})).toBe(fold);
  });
});
