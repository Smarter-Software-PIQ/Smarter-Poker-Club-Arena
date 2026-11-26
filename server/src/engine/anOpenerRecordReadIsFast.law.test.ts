/**
 * LAW: READING THE OPENER'S OWN RECORD INSIDE THE OUT-OF-POSITION 3-BET RULE IS CHEAP (PLO-OWNER lead-7 2026-11-26).
 *
 * omahaOopReraiseRangeReadsOpenerRecord (PLO4 / PLO5 cash) and holdemOopReraiseRangeReadsOpenerRecord (NLH cash),
 * both default OFF, act only inside their parent rule (omaha / holdemOopReraiseRangeHoldsVsReraise): the priced
 * 3-bet reads the opener's own record of answering a 3-bet (HorseMind.openerResponseOf, one map read of the record
 * the decision already carries), shrinks it to its baseline (openerFourBetRead) and lets a rejected 3-bet stand at a
 * seeded frequency. They add no sample, no equity and no loop; this law holds that.
 *
 * The engine's own decide (HorseLogic.decide through oopAsk, seeded) on applicable spots (PLO4 and PLO5 at 100, 300
 * and 800 bb; NLH at 100, 200 and 300 bb), the opener carrying a record of sixty 3-bets faced, inside a HorseMind
 * sandbox that holds it the way the worker brings it: the parent rule with the record option on against the same
 * decisions with the parent rule alone. Every spot is one where the receipt shows the record was read (measured).
 * Measured 2026-11-26 (vitest, source build): see the printed lines (ratio about 1). The parent rule's own cost law
 * is anOopReraiseRangePriceIsFast.law.test.ts.
 * Measured the way theServerSuiteAssertsNoTightWallClockBound requires (src/testing/relativeCost.ts).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { measureRelativeCost } from '../testing/relativeCost.js';
import { enableBrainTelemetry } from './BrainTelemetry.js';
import { HorseMind } from './HorseMind.js';
import {
  OOP_OPENER_ID,
  oopAsk,
  oopDeal,
  type OopGame,
  type OopHandSpec,
} from './HorseOopReraiseRangeHolds.test-support.js';
import {
  addOpenerResponseEvidence,
  emptyOpenerResponse,
  type OpenerResponseCounters,
} from './HorseOpenerAnswersThreeBet.js';

const RATIO = 3;

const FIXTURE = JSON.parse(
  readFileSync(new URL('./HorseOopReraiseRangeHolds.fixture.json', import.meta.url), 'utf8')
) as { opts: Record<string, unknown> };
const BASE: Record<string, unknown> = { ...FIXTURE.opts, telemetry: false, observeMind: false };
enableBrainTelemetry();

/** An opener who faced sixty 3-bets in position and never 4-bet: the record the option reads. */
function neverFourBets(): OpenerResponseCounters {
  let r: OpenerResponseCounters | null = null;
  for (let k = 0; k < 60; k++) {
    const inc = emptyOpenerResponse();
    inc.inPosition = { opp: 1, fold: k % 2, call: 1 - (k % 2), raise: 0 };
    r = addOpenerResponseEvidence(r, inc);
  }
  return r!;
}

/** The decision inside a sandbox that carries the opener's record for the game, cash, at every table size. */
function askWithRecord(
  spec: OopHandSpec,
  opts: Record<string, unknown>,
  seed: number
): Record<string, unknown> {
  const sandbox = HorseMind.createSandbox();
  const record = neverFourBets();
  sandbox.pooledOpenerResponse = new Map(
    (['hu', 'short', 'full'] as const).map((size) => [
      `${spec.game}:cash:${size}|${OOP_OPENER_ID}`,
      record,
    ])
  );
  return HorseMind.runInSandbox(sandbox, () => oopAsk(spec, opts, [], seed).decision);
}

const recordRead = (d: Record<string, unknown>): string | null =>
  (d.oopReraiseRangeHolds as { openerRecord?: { source?: string } } | undefined)?.openerRecord
    ?.source ?? null;

function applicable(
  games: readonly OopGame[],
  depths: readonly number[],
  on: Record<string, unknown>,
  per: number
): { spec: OopHandSpec; seed: number }[] {
  const out: { spec: OopHandSpec; seed: number }[] = [];
  for (const game of games)
    for (const depthBB of depths) {
      let found = 0;
      for (let i = 0; i < 600 && found < per; i++) {
        const spec: OopHandSpec = {
          game,
          pos: 'bb_co',
          depthBB,
          hole: oopDeal(game, i),
          threeTo: null,
        };
        if (recordRead(askWithRecord(spec, on, 1000 + i)) !== 'measured') continue;
        out.push({ spec, seed: 1000 + i });
        found++;
      }
    }
  return out;
}

function lawFor(
  label: string,
  parent: string,
  option: string,
  games: readonly OopGame[],
  depths: readonly number[]
): void {
  it(`${option}: the parent rule with the record read costs a bounded multiple of the parent rule alone`, () => {
    const ON = { ...BASE, [parent]: true, [option]: true };
    const OFF = { ...BASE, [parent]: true, [option]: false };
    const spots = applicable(games, depths, ON, 4);
    expect(spots.length).toBe(games.length * depths.length * 4);
    // with the option off the same spots price with no record on the receipt
    for (const s of spots) expect(recordRead(askWithRecord(s.spec, OFF, s.seed))).toBeNull();
    const cost = measureRelativeCost(
      () => {
        for (const s of spots) askWithRecord(s.spec, ON, s.seed);
      },
      () => {
        for (const s of spots) askWithRecord(s.spec, OFF, s.seed);
      },
      { warmupRounds: 1, rounds: 5 }
    );
    console.info(
      `[opener record read, ${label}] on ${(cost.subjectMs / spots.length).toFixed(2)} ms, off ` +
        `${(cost.referenceMs / spots.length).toFixed(2)} ms per decision, ratio ${cost.ratio.toFixed(2)} ` +
        `(limit ${RATIO}, fastest of ${cost.rounds})`
    );
    expect(cost.ratio).toBeLessThan(RATIO);
  }, 300_000);
}

describe('LAW: reading the opener`s own record inside the out-of-position 3-bet rule is cheap', () => {
  lawFor(
    'PLO4 / PLO5',
    'omahaOopReraiseRangeHoldsVsReraise',
    'omahaOopReraiseRangeReadsOpenerRecord',
    ['plo4', 'plo5'],
    [100, 300, 800]
  );
  lawFor(
    'NLH',
    'holdemOopReraiseRangeHoldsVsReraise',
    'holdemOopReraiseRangeReadsOpenerRecord',
    ['nlh'],
    [100, 200, 300]
  );
});
