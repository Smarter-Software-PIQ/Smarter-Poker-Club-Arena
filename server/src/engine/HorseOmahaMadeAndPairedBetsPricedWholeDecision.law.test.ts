/**
 * LAW (PLO-OWNER lead-5, Turn 5b, 2026-11-22): omahaMadeAndPairedBetsArePricedOnHisResponse (R5) through the
 * WHOLE decision (HorseLogic.decide), PLO4 and PLO5 cash, turn and river, the Horse first to act or checked to.
 *
 *  1. Option off: no R5 receipt fires in any decision.
 *  2. Option on: the three HorseLogic call sites are wired. R5 receipts fire in the whole decision, a bet the
 *     price checks comes out as a check, and a bet the price keeps comes out as that bet.
 *  3. WHEN R5 CANNOT PRICE THE SPOT (here: the opponent is all in) IT DOES NOT DECIDE IT: the rule returns
 *     null, fires `omaha_made_paired_bet_on_his_response_unpriced_legacy`, and the whole decision is the
 *     option-off decision, action and amount (the legacy bet-or-check path ran). Before Turn 5b the rule
 *     returned the proposed bet as final at all three sites and the legacy check never ran.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { HorseDecision } from '../types.js';
import { disarmBrainTelemetryForTest, drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { seedFastRandom } from './HorseEval.js';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import {
  omahaMadeAndPairedBetMemoClear,
  omahaMadeAndPairedBetOnHisResponseRule,
  omahaMadeAndPairedBetOnHisResponseVerdict,
} from './HorseOmahaMadeAndPairedBetsPriced.js';
import {
  LIVE,
  LIVE_OPTIONS,
  pricedSpot,
  type PricedSpot,
} from './HorseOmahaPricedRules.test-support.js';

const RANKS = '23456789TJQKA';
const SUITS = 'shdc';
/** A seeded hand of `n` cards that avoids the board. */
const handOf = (seed: number, n: number, board: string): string => {
  let x = (seed * 2654435761) >>> 0;
  const hole: string[] = [];
  const taken = new Set(board.match(/../g) ?? []);
  while (hole.length < n) {
    x = (x * 1664525 + 1013904223) >>> 0;
    const c = RANKS[(x >>> 8) % 13]! + SUITS[(x >>> 20) % 4]!;
    if (taken.has(c)) continue;
    taken.add(c);
    hole.push(c);
  }
  return hole.join('');
};
const BOARDS = ['Qh9h3d5c', 'Qh9h3d9c', 'Td8h4cTs7d', 'Qh9h3d5c2s', 'KsKd7h4c2d', 'As8d8c3h'];
const R5 = 'omaha_made_paired_bet_on_his_response_';
const OFF: HorseDecideOpts = { ...LIVE_OPTIONS };
const ON: HorseDecideOpts = { ...LIVE_OPTIONS, omahaMadeAndPairedBetsArePricedOnHisResponse: true };

const stateOf = (spot: PricedSpot, n: 4 | 5, opponentAllIn: boolean) => {
  const now = pricedSpot(spot).fresh();
  if (n === 4) (now.gs as { gameVariant: string }).gameVariant = 'plo4';
  if (opponentAllIn)
    for (const p of now.gs.players ?? []) if (p.seat !== now.hero.seat) p.is_all_in = true;
  return now;
};
const decide = (spot: PricedSpot, n: 4 | 5, opts: HorseDecideOpts, opponentAllIn: boolean) => {
  const now = stateOf(spot, n, opponentAllIn);
  HorseMind.reset();
  enableBrainTelemetry();
  drainFires();
  seedFastRandom(5);
  const d = HorseLogic.decide(now.hero, now.gs, LIVE.style, LIVE.mods, {
    observeMind: false,
    decisionTimeMs: 1794938400000,
    telemetry: true,
    ...opts,
  } as never) as HorseDecision;
  const fires = drainFires()
    .map((f) => f.feature)
    .filter((f) => f.startsWith(R5));
  return { d: { action: d.action, amount: d.amount ?? null }, fires };
};
const spots = (n: 4 | 5): PricedSpot[] => {
  const out: PricedSpot[] = [];
  for (const board of BOARDS)
    for (const inPosition of [false, true])
      for (const heroBet of [false, true])
        for (let h = 1; h <= 20; h++)
          out.push({
            hole: handOf(h * 13 + n, n, board),
            board,
            potBefore: 200,
            bet: 0,
            inPosition,
            heroBetFlop: heroBet,
            heroBetTurn: heroBet,
          });
  return out;
};

afterEach(() => {
  disarmBrainTelemetryForTest();
  drainFires();
  omahaMadeAndPairedBetMemoClear();
  HorseMind.reset();
});

describe('LAW: R5 through the whole decision, and the legacy path when it cannot price', () => {
  for (const n of [5, 4] as const)
    it(`PLO${n} cash turn and river: off fires nothing; on, the call sites decide (kept bets stay bets, checked bets become checks)`, () => {
      let offFires = 0;
      let onDecisions = 0;
      let keptBets = 0;
      let checkedBets = 0;
      for (const spot of spots(n)) {
        const off = decide(spot, n, OFF, false);
        const on = decide(spot, n, ON, false);
        offFires += off.fires.length;
        if (on.fires.length === 0) continue;
        onDecisions++;
        // one receipt per decision, whatever the number of overlapping sites
        expect(on.fires).toHaveLength(1);
        if (on.fires[0] === `${R5}kept` && off.d.action === 'bet' && on.d.action === 'bet')
          keptBets++;
        if (on.fires[0] === `${R5}checked` && off.d.action === 'bet' && on.d.action === 'check')
          checkedBets++;
      }
      expect(offFires).toBe(0);
      expect(onDecisions).toBeGreaterThanOrEqual(60);
      expect(keptBets).toBeGreaterThanOrEqual(20);
      expect(checkedBets).toBeGreaterThanOrEqual(1);
    });

  for (const n of [5, 4] as const)
    it(`PLO${n} cash, a spot R5 cannot price (the opponent is all in): the whole decision is the option-off decision`, () => {
      let unpriced = 0;
      const differs: string[] = [];
      for (const spot of spots(n)) {
        const off = decide(spot, n, OFF, true);
        const on = decide(spot, n, ON, true);
        expect(off.fires).toEqual([]);
        // it cannot price: it never claims a priced verdict
        expect(on.fires.filter((f) => f !== `${R5}unpriced_legacy`)).toEqual([]);
        if (on.fires.length > 0) unpriced++;
        if (on.d.action !== off.d.action || on.d.amount !== off.d.amount)
          differs.push(`${spot.hole}|${spot.board}: off ${off.d.action} on ${on.d.action}`);
      }
      expect(unpriced).toBeGreaterThanOrEqual(40);
      expect(differs).toEqual([]);
    });

  it('the rule itself returns null when it cannot price, so each call site falls through to its legacy check', () => {
    let seen = 0;
    for (const n of [5, 4] as const)
      for (const spot of spots(n).slice(0, 40)) {
        const now = stateOf(spot, n, true);
        const bet: HorseDecision = { action: 'bet', amount: 100, thinkTime: 0 };
        omahaMadeAndPairedBetMemoClear();
        expect(omahaMadeAndPairedBetOnHisResponseVerdict(now.hero, now.gs, ON, 100)).toBeNull();
        expect(omahaMadeAndPairedBetOnHisResponseRule(bet, now.hero, now.gs, ON)).toBeNull();
        seen++;
      }
    expect(seen).toBe(80);
  });
});
