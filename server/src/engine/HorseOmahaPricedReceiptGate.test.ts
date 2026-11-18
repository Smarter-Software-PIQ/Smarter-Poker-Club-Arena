/**
 * The worker receipt and the Omaha priced raise (owner 2026-11-17 11:49,
 * omahaTurnRiverRaiseIsPriced / omahaBigBetCallsArePriced, default OFF).
 *
 * The validator admits a PLO4/PLO5 cash turn or river raise that became the
 * call only for a decision whose own priced-raise option was on
 * (context.omahaPricedRaise). With the gate absent the validator is exactly
 * as before: the turn raise that became a call is still refused for a
 * request in which the Horse holds a non-nut combo draw
 * (HorseOmahaMadeHandDefense.test.ts, review note N4). The gate candidates
 * are built exactly as the PLO6 gate's: the delivered switch row, the
 * request's own options, the previous delivery while it counts.
 */
import { describe, expect, it } from 'vitest';
import { HorseLogic } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import { replayProfiles, stateAt, type ComplaintFixture } from './HorseComplaintReplay.js';
import {
  horseDecisionReceiptRefusal,
  horseDecisionReceiptRefusalForGates,
  omahaPricedRaiseGateCandidates,
} from './horseDecision/responseValidation.js';
import { omahaNutClassNow } from './HorseOmahaMadeHandDefense.js';
import type { Card, CardRank, CardSuit } from '../types.js';
import TOP_TWO_JAMS from './horseComplaints/plo5-top-two-pair-jams-over-a-turn-bet-on-the-straight-card.fixture.json';

/** Hand 59416584: top two pair in seat 5 (turn decision 19). */
const FB5 = TOP_TWO_JAMS as unknown as ComplaintFixture;
const SUITS: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (text: string): Card[] =>
  (text.match(/../g) ?? []).map((x) => ({ rank: x[0] as CardRank, suit: SUITS[x[1]] }));
const LIVE = replayProfiles('cash').find((p) => p.live)!;

function spot(hole?: string) {
  const fx = JSON.parse(JSON.stringify(FB5)) as ComplaintFixture;
  const node = fx.actions.find((a) => a.ord === 19)!;
  if (hole) fx.hole[String(node.seat)] = cards(hole);
  return stateAt(fx, node);
}

describe('the receipt gate of the Omaha priced raise', () => {
  const s = spot();
  seedFastRandom(7);
  HorseMind.reset();
  const d = structuredClone(
    HorseLogic.decide(s.hero, s.gs, LIVE.style, LIVE.mods, {
      mind: false,
      telemetry: false,
      omahaBeatenMadeHandDefense: true,
    })
  );
  // The same turn, 212 owed, a non-nut in-position combo draw.
  const draw = spot('4h5h2d6cJs');

  it('a raise that became the call is refused for a non-nut hand without the gate, and admitted with it', () => {
    expect({ action: d.action, amount: d.amount }).toEqual({ action: 'call', amount: 212 });
    expect(omahaNutClassNow(draw.hero, draw.gs)).toBe(false);
    const ctx = { player: draw.hero, gameState: draw.gs };
    expect(horseDecisionReceiptRefusal(structuredClone(d), 'plo5', ctx)).toBe('policy_graph');
    expect(
      horseDecisionReceiptRefusal(structuredClone(d), 'plo5', { ...ctx, omahaPricedRaise: false })
    ).toBe('policy_graph');
    expect(
      horseDecisionReceiptRefusal(structuredClone(d), 'plo5', { ...ctx, omahaPricedRaise: true })
    ).toBeNull();
  });

  it('the gate admits only the exact chips of the call', () => {
    const owes300 = (() => {
      const fx = JSON.parse(JSON.stringify(FB5)) as ComplaintFixture;
      const node = fx.actions.find((a) => a.ord === 19)!;
      fx.hole[String(node.seat)] = cards('4h5h2d6cJs');
      const pn = node.publicNode!;
      pn.pot += 300 - (pn.toCall ?? 0);
      pn.toCall = 300;
      pn.currentBet = 300;
      return stateAt(fx, node);
    })();
    expect(
      horseDecisionReceiptRefusal(structuredClone(d), 'plo5', {
        player: owes300.hero,
        gameState: owes300.gs,
        omahaPricedRaise: true,
      })
    ).toBe('policy_graph');
  });

  it('under the candidate gates: admitted when the worker may have run either option on, refused otherwise', () => {
    const ctx = { player: draw.hero, gameState: draw.gs };
    expect(
      horseDecisionReceiptRefusalForGates(structuredClone(d), 'plo5', ctx, [false], [false])
    ).toBe('policy_graph');
    expect(horseDecisionReceiptRefusalForGates(structuredClone(d), 'plo5', ctx, [false], [])).toBe(
      'policy_graph'
    );
    expect(
      horseDecisionReceiptRefusalForGates(structuredClone(d), 'plo5', ctx, [false], [false, true])
    ).toBeNull();
  });

  it('the candidates: the request alone, a switch row, and the previous delivery', () => {
    expect(omahaPricedRaiseGateCandidates(undefined, null)).toEqual([false]);
    expect(omahaPricedRaiseGateCandidates({ omahaTurnRiverRaiseIsPriced: true }, null)).toEqual([
      true,
    ]);
    expect(omahaPricedRaiseGateCandidates({ omahaBigBetCallsArePriced: true }, null)).toEqual([
      true,
    ]);
    // a truthy non-boolean is not on
    expect(omahaPricedRaiseGateCandidates({ omahaTurnRiverRaiseIsPriced: 1 }, null)).toEqual([
      false,
    ]);
    // a configuration that does not parse leaves the request's own value
    expect(omahaPricedRaiseGateCandidates({}, { nonsense: true })).toEqual([false]);
  });
});
