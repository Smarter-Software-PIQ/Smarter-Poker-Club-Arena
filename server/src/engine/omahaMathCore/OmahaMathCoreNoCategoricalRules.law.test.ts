/**
 * LAW (lane UNBLOCK 2026-11-19, for the batch that carries BOTH omahaMathCore and omahaNoCategoricalRules;
 * place in server/src/engine/omahaMathCore/): with omahaMathCore + omahaNoCategoricalRules on, in PLO4/PLO5
 * cash the action HorseLogic.decide returns is the core's EV choice on every replayed decision (the core is
 * the last word: nothing after it changes the action), and the core's choice is the arg-max of its own EV
 * table. A second file (OmahaMathCoreNoCategoricalRulesFallback.law.test.ts) mocks the core to throw and
 * checks that on the fallback no categorical receipt fires.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { drainFires, enableBrainTelemetry } from '../BrainTelemetry.js';
import { seedFastRandom } from '../HorseEval.js';
import { HorseLogic, type HorseDecideOpts } from '../HorseLogic.js';
import { HorseMind } from '../HorseMind.js';
import {
  LIVE,
  LIVE_OPTIONS,
  recordedState,
  type RecordedDecision,
} from '../HorseOmahaPricedRules.test-support.js';
import RECORDED from '../HorseOmahaPricedRules.fixture.json';

afterEach(() => {
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});
const RECORDS = RECORDED as unknown as RecordedDecision[];
const ON: HorseDecideOpts = { ...LIVE_OPTIONS, omahaMathCore: true, omahaNoCategoricalRules: true };
function four(r: RecordedDecision): RecordedDecision {
  return { ...r, variant: 'plo4', hole: (r.hole.match(/.{2}/g) ?? []).slice(0, 4).join('') };
}

describe('omahaMathCore + omahaNoCategoricalRules: the executed action is the core EV choice', () => {
  for (const [label, deal] of [
    ['plo5', (r: RecordedDecision) => r],
    ['plo4', four],
  ] as const)
    it(`${label}: every recorded decision`, () => {
      enableBrainTelemetry();
      const misses: string[] = [];
      for (const r of RECORDS) {
        HorseMind.reset();
        const st = recordedState(deal(r)) as unknown as { hero: never; gs: never };
        drainFires();
        seedFastRandom(1);
        const d = HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
          telemetry: true,
          observeMind: false,
          decisionTimeMs: 1794938400000,
          ...ON,
        } as never);
        const core = d.omahaMathCore;
        if (!core?.applied || !core.core) {
          misses.push(
            `hand ${r.n} seat ${r.seat}: core not applied (${core?.error ?? 'no receipt'})`
          );
          continue;
        }
        const best = core.core.evs.reduce((a, b) => (b.ev > a.ev ? b : a));
        if (best.ev - core.core.choice.ev > 1e-9)
          misses.push(`hand ${r.n}: choice is not the EV max`);
        if (d.action !== core.action || (d.amount ?? null) !== (core.amount ?? null))
          misses.push(
            `hand ${r.n} seat ${r.seat}: executed ${d.action} ${d.amount ?? ''} != core ${core.action} ${core.amount ?? ''}`
          );
        if (core.core.legalized === undefined && core.action !== core.core.choice.action)
          misses.push(`hand ${r.n}: core action differs from its choice`);
      }
      expect(misses).toEqual([]);
    }, 600000);
});
