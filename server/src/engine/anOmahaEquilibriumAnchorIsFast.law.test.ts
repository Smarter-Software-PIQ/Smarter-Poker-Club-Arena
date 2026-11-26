/**
 * LAW: THE EQUILIBRIUM-ANCHORED PRIOR IS CHEAP WHERE IT APPLIES (PLO-OWNER lead-7, 2026-11-26).
 *
 * omahaFacingBetPriorIsEquilibriumAnchored replaces one number of the facing-bet verdict (the bettor's non-value
 * share) with arithmetic on the price and his own shown bets; with telemetry on it prices the spot once more on the
 * population prior for its "changed" receipt, on exact counts the verdict has already made. Measured on 986 real
 * heads-up turn and river decisions where it applies (plo-defence/BUILD.md): p50 1.29 / p95 2.53 / max 11.3 ms with
 * the option on against 1.21 / 2.27 / 11.3 ms off; added p95 0.43 ms.
 *
 * Measured relative to other work on the same machine, as theServerSuiteAssertsNoTightWallClockBound requires
 * (src/testing/relativeCost.ts: alternating rounds, the fastest of each kept): the ten audited decisions of the
 * real-hands fixture decided with the option on cost under RATIO of the same decisions with it off (measured
 * about 1.1).
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { replayAt, replayProfiles, stateAt } from './HorseComplaintReplay.js';
import { measureRelativeCost } from '../testing/relativeCost.js';

const RATIO = 2;

describe('LAW: the equilibrium-anchored prior is cheap where it applies', () => {
  it('applicable decisions with the option on cost a bounded multiple of the same decisions with it off', () => {
    const fixture = JSON.parse(
      gunzipSync(
        readFileSync(join(__dirname, 'HorseOmahaEquilibriumAnchor.realHands.fixture.json.gz'))
      ).toString('utf8')
    ) as { spots: Array<{ hand: { actions: Array<{ ord: number }> }; ord: number }> };
    const spots = fixture.spots.map((s) => {
      const st = stateAt(s.hand as never, s.hand.actions.find((a) => a.ord === s.ord) as never);
      const prof = replayProfiles((st as { pn: { mode: string } }).pn.mode as never).find(
        (p: { live?: boolean }) => p.live
      )!;
      return { st, prof };
    });
    const run = (on: boolean): number => {
      let priced = 0;
      for (const { st, prof } of spots) {
        const r = replayAt(st as never, prof as never, [1], {
          omahaFacingBetEv: true,
          ...(on ? { omahaFacingBetPriorIsEquilibriumAnchored: true } : {}),
        } as never) as { receipts: Record<string, number> };
        if (r.receipts.omaha_equilibrium_anchor_priced) priced++;
      }
      return priced;
    };
    // the option applies to every one of them, and to none with it off
    expect(run(true)).toBe(spots.length);
    expect(run(false)).toBe(0);
    const cost = measureRelativeCost(
      () => void run(true),
      () => void run(false),
      { warmupRounds: 1, rounds: 5 }
    );
    console.info(
      `[equilibrium anchor] on ${cost.subjectMs.toFixed(2)} ms, off ${cost.referenceMs.toFixed(2)} ms for ` +
        `${spots.length} decisions, ratio ${cost.ratio.toFixed(3)} (limit ${RATIO}, fastest of ${cost.rounds})`
    );
    expect(cost.ratio).toBeLessThan(RATIO);
  }, 120_000);
});
