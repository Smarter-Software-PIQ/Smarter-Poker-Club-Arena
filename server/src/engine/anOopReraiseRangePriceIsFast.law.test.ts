/**
 * LAW: THE OUT-OF-POSITION 3-BET RANGE RULE IS CHEAP WHERE IT APPLIES (PLO-OWNER lead-7, 2026-11-26).
 *
 * omahaOopReraiseRangeHoldsVsReraise prices a 3-bet with three equities and re-asks the Horse's own answer to the
 * 4-bet. In live shadow (build d07cd7d7, 2026-11-26 01:07-01:35Z) it re-decided in 60-90 ms where it applied, and
 * the shadow stage's breaker (HorseOptionShadowStage: 3 re-decisions over 50 ms in 20) switched it off on a worker.
 * Offline, on 1,467 applicable PLO4/PLO5 spots at 100, 300 and 800 bb, it took p50 38.9 / p95 71.1 / max 118.1 ms
 * with the option on, against under 1 ms for the same decisions off. The rejection samplers behind those equities
 * now run on card ids (HorseOmahaReraisedPot.omahaReraisedEquityInPercentileBand; the same numbers, law
 * anOopReraiseRangeEquityIsUnchanged.law.test.ts): p50 4.4 / p95 7.8 / max 16.4 ms on the same spots.
 *
 * Measured the way theServerSuiteAssertsNoTightWallClockBound requires: against other work on the same machine, in
 * alternating rounds, the fastest round of each kept (src/testing/relativeCost.ts).
 *   1. The id sampler against the Card sampler it replaces, on the same equities: at most RATIO_SAMPLER of its
 *      cost (measured 0.12 on Apple Silicon).
 *   2. A fixed set of applicable spots (PLO4 and PLO5, 100 / 300 / 800 bb) decided with the option on, against the
 *      same spots decided with it off: at most RATIO_DECISION times their cost (measured about 30 on this tree,
 *      7.3 against 0.25 ms per decision; about 265 with the Card sampler, 55.4 against 0.21 ms).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Card } from '../types.js';
import { enableBrainTelemetry } from './BrainTelemetry.js';
import { omahaPreflopPercentile } from './HorseEval.js';
import {
  omahaReraisedEquity,
  omahaReraisedEquityInPercentileBand,
} from './HorseOmahaReraisedPot.js';
import { OOP_RERAISE_OMAHA_SAMPLES } from './HorseOopReraiseRangeHolds.js';
import {
  oopAsk,
  oopDeal,
  type OopGame,
  type OopHandSpec,
} from './HorseOopReraiseRangeHolds.test-support.js';
import { measureRelativeCost } from '../testing/relativeCost.js';

const RATIO_SAMPLER = 0.4;
const RATIO_DECISION = 80;

const FIXTURE = JSON.parse(
  readFileSync(new URL('./HorseOopReraiseRangeHolds.fixture.json', import.meta.url), 'utf8')
) as { opts: Record<string, unknown> };
const BASE: Record<string, unknown> = { ...FIXTURE.opts, telemetry: false, observeMind: false };
const ON = { ...BASE, omahaOopReraiseRangeHoldsVsReraise: true };
const OFF = { ...BASE, omahaOopReraiseRangeHoldsVsReraise: false };
enableBrainTelemetry();

/** The first `per` seeded deals of each game and depth where the rule applies (the brain 3-bets, the rule prices). */
function applicableSpots(per: number): { spec: OopHandSpec; seed: number }[] {
  const out: { spec: OopHandSpec; seed: number }[] = [];
  for (const game of ['plo4', 'plo5'] as OopGame[])
    for (const depthBB of [100, 300, 800]) {
      let found = 0;
      for (let i = 0; i < 400 && found < per; i++) {
        const spec: OopHandSpec = {
          game,
          pos: 'bb_co',
          depthBB,
          hole: oopDeal(game, i),
          threeTo: null,
        };
        const d = oopAsk(spec, ON, [], 1000 + i).decision;
        if (!d.oopReraiseRangeHolds) continue;
        out.push({ spec, seed: 1000 + i });
        found++;
      }
    }
  return out;
}

describe('LAW: the out-of-position 3-bet range rule is cheap where it applies', () => {
  it('the id sampler costs a fraction of the Card sampler on the same equities', () => {
    const cases: { hole: Card[]; lo: number; hi: number }[] = [];
    for (const game of ['plo4', 'plo5'] as OopGame[])
      for (let i = 0; i < 6; i++) {
        const width = [0.01, 0.05, 0.2][i % 3]!;
        const hi = 1 - (i % 2) * 0.1;
        cases.push({ hole: oopDeal(game, 300 + i), lo: hi - width, hi });
      }
    const cost = measureRelativeCost(
      () => {
        for (const c of cases)
          omahaReraisedEquityInPercentileBand(c.hole, [], c.lo, c.hi, OOP_RERAISE_OMAHA_SAMPLES);
      },
      () => {
        for (const c of cases)
          omahaReraisedEquity(
            c.hole,
            [],
            [],
            (h) => {
              const p = omahaPreflopPercentile([...h], false);
              return p >= c.lo && p <= c.hi;
            },
            OOP_RERAISE_OMAHA_SAMPLES
          );
      },
      { warmupRounds: 1, rounds: 3 }
    );
    console.info(
      `[oop 3-bet sampler] id ${cost.subjectMs.toFixed(2)} ms, Card ${cost.referenceMs.toFixed(2)} ms, ` +
        `ratio ${cost.ratio.toFixed(3)} (limit ${RATIO_SAMPLER}, fastest of ${cost.rounds})`
    );
    expect(cost.ratio).toBeLessThan(RATIO_SAMPLER);
  }, 120_000);

  it('an applicable decision with the option on costs a bounded multiple of the same decision off', () => {
    const spots = applicableSpots(4);
    expect(spots.length).toBe(24);
    const cost = measureRelativeCost(
      () => {
        for (const s of spots) oopAsk(s.spec, ON, [], s.seed);
      },
      () => {
        for (const s of spots) oopAsk(s.spec, OFF, [], s.seed);
      },
      { warmupRounds: 1, rounds: 3 }
    );
    console.info(
      `[oop 3-bet decision] on ${(cost.subjectMs / spots.length).toFixed(2)} ms, off ` +
        `${(cost.referenceMs / spots.length).toFixed(2)} ms per decision, ratio ${cost.ratio.toFixed(2)} ` +
        `(limit ${RATIO_DECISION}, fastest of ${cost.rounds})`
    );
    expect(cost.ratio).toBeLessThan(RATIO_DECISION);
  }, 300_000);
});
