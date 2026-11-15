/**
 * LAW: FIXED-LIMIT OMAHA HAS NO PRESUMPTION (2026-11-14, Fixed-Limit lane, T1).
 *
 * Every Omaha opponent without a disproof is read as an aggressive raiser
 * (presumedAggressorRead, owner update 2026-10-27). That presumption is a
 * pot-limit policy: it prices a pot-sized raise. In fixed-limit Omaha (flo8)
 * a raise costs one bet, and a normal-to-tight raiser (21-27 percent) never
 * disproves it, so the Horse read a tight player as a wide aggressor and
 * stole less against him (O-TIGHT-FL-DIAGNOSIS). With
 * HorseDecideOpts.fixedLimitOmahaNoPresumption (read as === true, DEFAULT OFF)
 * a fixed-limit Omaha read is the opponent's own measured read. Pot-limit
 * Omaha, hi-lo included, is unchanged.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { HorseMind } from './HorseMind.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const OPP = '50000000-0000-4000-8000-0000000000f8';

function readFor(variant: string, on: boolean) {
  HorseMind.setDecisionScope('omaha:hu', variant, 'cash');
  HorseMind.setDecisionReadOptions(on ? { fixedLimitOmahaNoPresumption: true } : {});
  return HorseMind.opponentRead(OPP);
}

afterEach(() => {
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

describe('a fixed-limit Omaha opponent is not presumed aggressive (option on)', () => {
  it('off (main): an unknown flo8 opponent is presumed an aggressive raiser', () => {
    const read = readFor('flo8', false);
    expect(read?.presumed).toBe(true);
  });

  it('on: an unknown flo8 opponent carries no presumption, and the withholding is receipted', () => {
    enableBrainTelemetry();
    drainFires();
    for (const mode of ['cash', 'tournament'] as const) {
      for (const sc of ['omaha:hu', 'omaha:short', 'omaha:full'] as const) {
        HorseMind.setDecisionScope(sc, 'flo8', mode);
        HorseMind.setDecisionReadOptions({ fixedLimitOmahaNoPresumption: true });
        const read = HorseMind.opponentRead(OPP);
        expect(read?.presumed === true, `${sc} ${mode}`).toBe(false);
        HorseMind.setDecisionScope(null);
      }
    }
    const fires = drainFires();
    expect(fires.some((f) => f.feature === 'fixed_limit_omaha_presumption_withheld')).toBe(true);
    expect(fires.some((f) => f.feature === 'plo_opponent_presumed_aggressive')).toBe(false);
  });

  it('on: pot-limit Omaha, hi-lo included, keeps the presumption exactly', () => {
    for (const variant of ['plo4', 'plo5', 'plo6', 'plo8']) {
      const off = readFor(variant, false);
      HorseMind.setDecisionScope(null);
      const on = readFor(variant, true);
      expect(on?.presumed, variant).toBe(true);
      expect(on, variant).toEqual(off);
      HorseMind.setDecisionScope(null);
    }
  });

  it('the decide option reaches the read options as === true only', () => {
    const src = readFileSync(resolve(__dirname, 'HorseLogic.ts'), 'utf8');
    expect(src).toContain(
      'fixedLimitOmahaNoPresumption: opts.fixedLimitOmahaNoPresumption === true,'
    );
  });
});
