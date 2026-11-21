/**
 * Lane CORE-POOLED-3 latency law (Nov 21; CRITERIA-CORE-POOLED-2-LATENCY criterion 1): with omahaMathCore on, a
 * decision the core does not own costs no core work. On a street whose flag is off (the real HorseLogic.decide path,
 * every recorded PLO5 turn and river decision, only the PLO5 flop flag on) and in PLO6, hold'em, a tournament or a
 * bomb pot (the Rule, every street flag on, the recorded PLO5 flop states with that one fact changed)
 * decideOmahaMathCore is never called, the equity sampler (buildPool, equityVsPools, equityVsPoolsEquityLane) is
 * called no more often than with the core off, and the decision is the one the core was handed. Controls: the same
 * flop states unchanged do reach decideOmahaMathCore and the sampler, so the counters count.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HorseDecideOpts, HorseGameStateV2 } from '../HorseLogic.js';
import {
  LIVE_OPTIONS,
  decideRecorded,
  type RecordedDecision,
} from '../HorseOmahaPricedRules.test-support.js';
import RECORDED from '../HorseOmahaPricedRules.fixture.json';
import { OMAHA_MATH_CORE_ALL_STREETS, omahaMathCoreRule } from './OmahaMathCoreRule.js';

const calls = vi.hoisted(() => ({ core: 0, sampler: 0 }));
vi.mock('./OmahaMathCore.js', async (original) => {
  const m = await original<typeof import('./OmahaMathCore.js')>();
  return {
    ...m,
    decideOmahaMathCore: (...a: Parameters<typeof m.decideOmahaMathCore>) => {
      calls.core++;
      return m.decideOmahaMathCore(...a);
    },
  };
});
vi.mock('./OmahaMathCoreEquity.js', async (original) => {
  const m = await original<typeof import('./OmahaMathCoreEquity.js')>();
  return {
    ...m,
    buildPool: (...a: Parameters<typeof m.buildPool>) => {
      calls.sampler++;
      return m.buildPool(...a);
    },
    equityVsPools: (...a: Parameters<typeof m.equityVsPools>) => {
      calls.sampler++;
      return m.equityVsPools(...a);
    },
    equityVsPoolsEquityLane: (...a: Parameters<typeof m.equityVsPoolsEquityLane>) => {
      calls.sampler++;
      return m.equityVsPoolsEquityLane(...a);
    },
  };
});

const RECORDS = RECORDED as unknown as RecordedDecision[];
const FLOP = RECORDS.filter((r) => r.street === 'flop');
const LATER = RECORDS.filter((r) => r.street === 'turn' || r.street === 'river');
const FLOP_ONLY = {
  ...LIVE_OPTIONS,
  omahaMathCore: true,
  omahaMathCorePlo5Flop: true,
} as HorseDecideOpts;
const EVERY_STREET = { omahaMathCore: true, ...OMAHA_MATH_CORE_ALL_STREETS } as never;

beforeEach(() => {
  calls.core = 0;
  calls.sampler = 0;
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('a decision the math core does not own costs no core work', () => {
  it('control: a recorded PLO5 flop decision with the flop flag on reaches the core and the sampler', () => {
    expect(FLOP.length).toBeGreaterThanOrEqual(10);
    const { decision } = decideRecorded(FLOP[0], FLOP_ONLY, 1);
    expect(decision.omahaMathCore).toBeDefined();
    expect(calls.core).toBe(1);
    expect(calls.sampler).toBeGreaterThan(0);
  });

  it('street flag off: every recorded PLO5 turn and river decision, real decide path, only the flop flag on', () => {
    expect(LATER.length).toBeGreaterThanOrEqual(40);
    // a clock that does not move: the decision records carry timings, and the two arms are compared whole
    vi.spyOn(performance, 'now').mockReturnValue(0);
    for (const r of LATER) {
      calls.core = 0;
      calls.sampler = 0;
      const off = decideRecorded(r, LIVE_OPTIONS, 1).decision;
      const samplerOff = calls.sampler;
      expect(calls.core).toBe(0);
      calls.sampler = 0;
      const on = decideRecorded(r, FLOP_ONLY, 1).decision;
      expect(calls.core, `hand ${r.n} ${r.street}`).toBe(0);
      expect(calls.sampler, `hand ${r.n} ${r.street}`).toBe(samplerOff);
      expect(on.omahaMathCore).toBeUndefined();
      // the whole record but thinkTime (the pacing delay is not part of the acted decision)
      expect({ ...on, thinkTime: 0 }).toEqual({ ...off, thinkTime: 0 });
    }
  });

  const cases: [string, (gs: HorseGameStateV2) => HorseGameStateV2][] = [
    ['PLO6', (gs) => ({ ...gs, gameVariant: 'plo6' }) as HorseGameStateV2],
    ["hold'em", (gs) => ({ ...gs, gameVariant: 'holdem' }) as HorseGameStateV2],
    ['a tournament', (gs) => ({ ...gs, gameMode: 'tournament' }) as HorseGameStateV2],
    ['a bomb pot', (gs) => ({ ...gs, bombPot: true }) as HorseGameStateV2],
    // lane CORE-POOLED-5: Diamond Arena is closed; the core is never consulted on a Diamond table
    ['a Diamond table', (gs) => ({ ...gs, asset: 'diamonds' }) as HorseGameStateV2],
  ];
  it('control: the Rule with every street flag on works on each recorded PLO5 flop state', () => {
    for (const r of FLOP) {
      const { decision, state } = decideRecorded(r, LIVE_OPTIONS, 1);
      calls.core = 0;
      omahaMathCoreRule(decision, state.hero, state.gs, EVERY_STREET, (d) => d);
      expect(calls.core, `hand ${r.n}`).toBe(1);
    }
  });
  for (const [name, change] of cases)
    it(`${name}: the Rule with every street flag on hands the same decision back and never calls the core or the sampler`, () => {
      for (const r of FLOP) {
        const { decision, state } = decideRecorded(r, LIVE_OPTIONS, 1);
        calls.core = 0;
        calls.sampler = 0;
        let legalized = 0;
        const out = omahaMathCoreRule(decision, state.hero, change(state.gs), EVERY_STREET, (d) => {
          legalized++;
          return d;
        });
        expect(out, `hand ${r.n}`).toBe(decision);
        expect(legalized).toBe(0);
        expect(calls).toEqual({ core: 0, sampler: 0 });
      }
    });
});
