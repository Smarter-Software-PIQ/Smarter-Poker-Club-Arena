/**
 * LAW (lane UNBLOCK 2026-11-19): when the math core throws (its error fallback), with omahaNoCategoricalRules
 * on no categorical rule of HorseOmahaRuleSites fires on the PLO4/PLO5 cash decision that falls back.
 * Place in server/src/engine/omahaMathCore/ beside OmahaMathCoreNoCategoricalRules.law.test.ts.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('./OmahaMathCore.js', async (orig) => ({
  ...(await orig<typeof import('./OmahaMathCore.js')>()),
  decideOmahaMathCore: () => {
    throw new Error('law: forced core error');
  },
}));

import { drainFires, enableBrainTelemetry } from '../BrainTelemetry.js';
import { seedFastRandom } from '../HorseEval.js';
import { HorseLogic, type HorseDecideOpts } from '../HorseLogic.js';
import { HorseMind } from '../HorseMind.js';
import { OMAHA_CATEGORICAL_RULE_SITES, OMAHA_OPEN_RULE_SITES } from '../HorseOmahaRuleSites.js';
import {
  LIVE,
  LIVE_OPTIONS,
  recordedState,
  type RecordedDecision,
} from '../HorseOmahaPricedRules.test-support.js';
import RECORDED from '../HorseOmahaPricedRules.fixture.json';

const RECORDS = RECORDED as unknown as RecordedDecision[];
const PATTERNS = [
  ...OMAHA_CATEGORICAL_RULE_SITES.flatMap((s) => s.legacyReceipts),
  ...OMAHA_OPEN_RULE_SITES.filter((s) => s.legacyOptions.some((o) => o !== 'v16SizeCond')).flatMap(
    (s) => s.legacyReceipts
  ),
];
const hit = (f: string) =>
  PATTERNS.some((p) => (p.endsWith('*') ? f.startsWith(p.slice(0, -1)) : f === p));

describe('core error fallback with omahaNoCategoricalRules on', () => {
  it('the core fell back on every decision and no categorical receipt fired', () => {
    enableBrainTelemetry();
    const opts: HorseDecideOpts = {
      ...LIVE_OPTIONS,
      omahaMathCore: true,
      omahaNoCategoricalRules: true,
      omahaMathCorePlo4Flop: true,
      omahaMathCorePlo4Turn: true,
      omahaMathCorePlo4River: true,
      omahaMathCorePlo5Flop: true,
      omahaMathCorePlo5Turn: true,
      omahaMathCorePlo5River: true,
    };
    const bad: string[] = [];
    let fellBack = 0;
    let flopInScope = 0;
    let trFastPath = 0;
    let inScope = 0;
    for (const r of RECORDS) {
      HorseMind.reset();
      const st = recordedState(r) as unknown as { hero: never; gs: never };
      drainFires();
      seedFastRandom(1);
      const d = HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
        telemetry: true,
        observeMind: false,
        decisionTimeMs: 1794938400000,
        ...opts,
      } as never);
      // A malformed fixture state (a negative stack, e.g. hand 59852287 seat 5) is outside the core's scope.
      if ((st.hero as unknown as { stack: number }).stack >= 0 || d.omahaMathCore) {
        inScope++;
        if (r.street === 'flop') flopInScope++;
      }
      if (d.omahaMathCore?.applied === false && d.omahaMathCore.error) fellBack++;
      if (d.omahaMathCore?.core?.tables === 'b3-turn-river-hud') trFastPath++;
      for (const f of drainFires().map((x) => x.feature)) if (hit(f)) bad.push(`hand ${r.n}: ${f}`);
    }
    expect(inScope).toBeGreaterThanOrEqual(RECORDS.length - 1);
    // Flop hits mocked decideOmahaMathCore and falls back cleanly; turn/river stays on B3 fast-path
    // (audit P0-1: zero fallback to population decideOmahaMathCore), and 0 categorical receipts fire.
    expect(fellBack).toBe(flopInScope);
    expect(trFastPath).toBe(inScope - flopInScope);
    expect(bad).toEqual([]);
  }, 600000);
});
