/**
 * The PLO6-AUDIT-005 rule is countable live: at the real node of production
 * hand 58751512 (decision 10, the opener facing a four-bet for half its stack
 * with two players still to act) the receipt fires by default and never with
 * the rule off. The token-price receipts are pinned in
 * HorseTokenCallPriceDecision.test.ts.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { HorseMind } from './HorseMind.js';
import { replayHand, type ComplaintFixture } from './HorseComplaintReplay.js';
import FIXTURE from './horseComplaints/plo6-opener-calls-a-four-bet-for-half-its-stack-with-action-behind.fixture.json';

const FX = FIXTURE as unknown as ComplaintFixture;

describe('the action-behind rule reports itself (PLO6-AUDIT-005)', () => {
  afterEach(() => HorseMind.reset());

  const fires = (opts?: Record<string, unknown>) => {
    const [node] = replayHand(FX, { ords: [10], opts });
    return node.profiles.map((p) => p.receipts.omaha_preflop_action_behind ?? 0);
  };

  it('default: every profile counts the rule at the node', () => {
    expect(fires().every((n) => n > 0)).toBe(true);
  });

  it('control: with the rule off nothing is counted', () => {
    expect(fires({ omahaPreflopCallWithActionBehind: false }).every((n) => n === 0)).toBe(true);
  });
});
