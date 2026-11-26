/**
 * LAW: THE HOLD'EM TOURNAMENT BLUFF PRICE IS CHEAP WHERE IT APPLIES (plo-lead7 tourney-postflop, 2026-11-26).
 *
 * holdemTournamentRiverBluffIsPriced / holdemTournamentTurnBluffIsPriced price every legal bet size against his line
 * range and, on a live pay jump, read the Horse's bubble factor once per decision (IcmModel bubbleFactor, three ICM
 * equities each). Offline on the compiled build (lane harness tlatency.mjs, heads-up tournament league spots where
 * the brain checked, 25 and 60 bb, chip EV and a priced three-left bubble, ICM caches emptied before every timed
 * call): ON p95 2.2-2.5 ms and max 6.4 ms over 2,500+ spots, against 0.6-1.8 ms p95 off. The live shadow breaker
 * disables an option at 50 ms.
 *
 * Measured the way theServerSuiteAssertsNoTightWallClockBound requires: against other work on the same machine, in
 * alternating rounds, the fastest round of each kept (src/testing/relativeCost.ts). The real audited tournament
 * nodes of HorseHoldemTournamentLateIsPriced.fixture.json, each as recorded (chip EV) and on a priced bubble whose
 * context carries every seat's stack and identity (nine-handed, ten left, nine paid), decided with the option of
 * the node's street on, against the same decisions with it off: at most RATIO_DECISION times their cost.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  replayAt,
  replayProfiles,
  stateAt,
  type ComplaintAction,
  type ExtractedHand,
} from './HorseComplaintReplay.js';
import { measureRelativeCost } from '../testing/relativeCost.js';

const RATIO_DECISION = 12;

const FIX = JSON.parse(
  readFileSync(new URL('./HorseHoldemTournamentLateIsPriced.fixture.json', import.meta.url), 'utf8')
) as {
  nodes: { hand: ExtractedHand; ord: number; option: string }[];
  productionOpts: Record<string, unknown>;
};
const prof = replayProfiles('tournament')[0];

function spots() {
  const out: { st: ReturnType<typeof stateAt>; option: string }[] = [];
  for (const n of FIX.nodes) {
    const node = n.hand.actions.find((a) => a.ord === n.ord) as ComplaintAction;
    out.push({ st: stateAt(n.hand, node), option: n.option });
    const bub = stateAt(n.hand, node);
    const gs = bub.gs as unknown as {
      players: { user_id: string; stack: number }[];
      tournament: Record<string, unknown>;
    };
    const stacks = gs.players.map((p) => Math.max(1, Number(p.stack)));
    while (stacks.length < 10) stacks.push(stacks[0]!);
    gs.tournament = {
      ...gs.tournament,
      schemaVersion: 1,
      contextStatus: 'complete',
      contextIssues: [],
      playersLeft: 10,
      spotsPaid: 9,
      payoutPct: [30, 20, 14, 10, 8, 6, 5, 4, 3],
      nearBubble: true,
      inMoney: false,
      isPko: false,
      isMysteryBounty: false,
      satellite: false,
      stacks,
      stackByUser: Object.fromEntries(gs.players.map((p, i) => [p.user_id, stacks[i]])),
    };
    out.push({ st: bub, option: n.option });
  }
  return out;
}

describe('LAW: the tournament bluff price is cheap where it applies', () => {
  it('an applicable decision with the option on costs a bounded multiple of the same decision off', () => {
    const all = spots();
    expect(all.length).toBeGreaterThanOrEqual(6);
    // the bubble copies take the priced path (a bubble factor read), never the stand-down
    let priced = 0;
    for (const s of all.filter((_, i) => i % 2 === 1)) {
      const r = replayAt(s.st, prof, [1, 7], { ...FIX.productionOpts, [s.option]: true });
      expect(r.receipts.holdem_tourney_bluff_payout_unpriced ?? 0).toBe(0);
      priced +=
        (r.receipts.holdem_tourney_river_bluff_bet ?? 0) +
        (r.receipts.holdem_tourney_turn_bluff_bet ?? 0);
      priced += r.receipts.holdem_tourney_bluff_no_edge ?? 0;
    }
    console.info(`[tournament bluff decision] bubble copies priced ${priced}`);
    const cost = measureRelativeCost(
      () => {
        for (const s of all)
          replayAt(s.st, prof, [1, 7], { ...FIX.productionOpts, [s.option]: true });
      },
      () => {
        for (const s of all) replayAt(s.st, prof, [1, 7], FIX.productionOpts);
      },
      { warmupRounds: 1, rounds: 3 }
    );
    console.info(
      `[tournament bluff decision] on ${cost.subjectMs.toFixed(2)} ms, off ${cost.referenceMs.toFixed(2)} ms for ` +
        `${all.length * 2} decisions, ratio ${cost.ratio.toFixed(2)} (limit ${RATIO_DECISION}, fastest of ${cost.rounds})`
    );
    expect(cost.ratio).toBeLessThan(RATIO_DECISION);
  }, 300_000);
});
