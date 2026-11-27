/**
 * LAW: THE PLO SHADOW DIRECTION IS CHEAP (PLO-OWNER lead-8 lane acttool, 2026-11-27).
 *
 * A changed staged PLO re-decision now counts its direction and its street x size cell
 * (HorseOptionShadowStage.optionShadowStagePloDirectionKeys). It runs after the answer and only for a changed receipt,
 * so it can never be on a decision's response time; it must still stay a small fraction of the staged re-decision it
 * follows (live: avg 6.6 ms, so a few microseconds is nothing). Measured the way
 * theServerSuiteAssertsNoTightWallClockBound requires (src/testing/relativeCost.ts): against building the receipt
 * itself and its same/changed counters (optionShadowReceiptOf + optionShadowCounterKeys), on the same decisions, the
 * direction and cell may cost at most RATIO times that (measured 14.4 on Apple Silicon, 2026-11-27).
 */
import { describe, expect, it } from 'vitest';
import { optionShadowCounterKeys, optionShadowReceiptOf } from './HorseOptionShadow.js';
import { optionShadowStagePloDirectionKeys } from './HorseOptionShadowStage.js';
import { measureRelativeCost } from '../testing/relativeCost.js';

const RATIO = 60;

/** A six-handed PLO river: checks, a bet, two calls, then a raise the hero faces, with a long history behind it. */
function riverState(i: number) {
  const history: Array<{ stage: string; seat: number; action: string; amount: number }> = [];
  for (const st of ['preflop', 'flop', 'turn'])
    for (let s = 1; s <= 6; s++)
      history.push({ stage: st, seat: s, action: s % 2 ? 'call' : 'check', amount: 10 });
  history.push({ stage: 'river', seat: 2, action: 'check', amount: 0 });
  history.push({ stage: 'river', seat: 3, action: 'bet', amount: 60 + (i % 40) });
  return {
    stage: 'river',
    pot: 240 + 60 + (i % 40),
    players: [1, 2, 3, 4, 5, 6].map((seat) => ({ seat, bet: seat === 3 ? 60 + (i % 40) : 0 })),
    actionHistory: history,
  };
}

describe('LAW: the PLO shadow direction is cheap', () => {
  it('direction + cell cost at most RATIO times the receipt and its counters', () => {
    const N = 400;
    const states = Array.from({ length: N }, (_, i) => riverState(i));
    const hero = { seat: 1, bet: 0 };
    const input = (i: number) => ({
      option: 'omahaFacingBetPriorIsPeopleMeasured',
      flippedTo: true,
      actual: { action: 'fold' },
      would: { action: 'call', amount: 60 + (i % 40) },
      street: 'river',
      variant: 'plo4',
      format: 'cash' as const,
      personDealt: i % 3 === 0,
      personLive: i % 3 === 0,
    });
    const receipts = states.map((_, i) => optionShadowReceiptOf(input(i)));
    let sink = 0;
    const cost = measureRelativeCost(
      () => {
        for (let i = 0; i < N; i++)
          sink += optionShadowStagePloDirectionKeys(receipts[i]!, hero, states[i]).length;
      },
      () => {
        for (let i = 0; i < N; i++)
          sink += optionShadowCounterKeys(optionShadowReceiptOf(input(i))).length;
      }
    );
    expect(sink).toBeGreaterThan(0);
    expect(optionShadowStagePloDirectionKeys(receipts[0]!, hero, states[0])).toContain(
      'option_shadow_omahaFacingBetPriorIsPeopleMeasured_cell_river_facing_lt40_fold_to_call_seen'
    );
    console.log(`PLO shadow direction relative cost ${cost.ratio.toFixed(2)} (bound ${RATIO})`);
    expect(cost.ratio).toBeLessThanOrEqual(RATIO);
  });
});
