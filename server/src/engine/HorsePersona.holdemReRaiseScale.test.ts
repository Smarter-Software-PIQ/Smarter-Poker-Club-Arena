import { describe, expect, it } from 'vitest';
import {
  HOLDEM_ARCHETYPE_NLH_3BET_MIX,
  HOLDEM_MODEL_MEAN_NLH_3BET_MIX,
  holdemPersonaFor,
  holdemPersonaReRaiseScale,
} from './HorsePersona.js';

/**
 * D3 option C: the persona re-raise scale divides a Horse's nlh3BetMix by the
 * model mean. The mean is a constant in the source; this recomputes it from
 * the archetype shares and ranges, and holds the table to holdemPersonaFor.
 */
describe("the Hold'em persona re-raise scale", () => {
  it('the model mean is the share-weighted mean of the rounded mix over the 1,000 hash buckets', () => {
    let mean = 0;
    let shares = 0;
    for (const a of HOLDEM_ARCHETYPE_NLH_3BET_MIX) {
      let sum = 0;
      for (let h = 0; h < 1000; h++) sum += Math.round((a.base + (h / 1000) * a.span) * 100) / 100;
      mean += (a.sharePct / 100) * (sum / 1000);
      shares += a.sharePct;
    }
    expect(shares).toBe(100);
    expect(Math.round(mean * 100000) / 100000).toBe(HOLDEM_MODEL_MEAN_NLH_3BET_MIX);
    expect(HOLDEM_MODEL_MEAN_NLH_3BET_MIX).toBe(0.42143);
  });

  it('the table describes holdemPersonaFor: every id sits in its archetype range, in the stated shares', () => {
    const byArchetype = new Map(HOLDEM_ARCHETYPE_NLH_3BET_MIX.map((a) => [a.archetype, a]));
    const seen = new Map<string, number>();
    const N = 20000;
    for (let n = 1; n <= N; n++) {
      const id = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
      const p = holdemPersonaFor(id);
      const row = byArchetype.get(p.archetype)!;
      expect(p.nlh3BetMix).toBeGreaterThanOrEqual(row.base);
      expect(p.nlh3BetMix).toBeLessThanOrEqual(Math.round((row.base + row.span) * 100) / 100);
      seen.set(p.archetype, (seen.get(p.archetype) ?? 0) + 1);
    }
    for (const a of HOLDEM_ARCHETYPE_NLH_3BET_MIX)
      expect(Math.abs((100 * (seen.get(a.archetype) ?? 0)) / N - a.sharePct)).toBeLessThan(1.5);
  });

  it('the scale is the mix over the model mean, 0.52 to 1.52, and a pure function of the id', () => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let n = 1; n <= 5000; n++) {
      const id = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
      const s = holdemPersonaReRaiseScale(id);
      expect(s).toBe(holdemPersonaFor(id).nlh3BetMix / HOLDEM_MODEL_MEAN_NLH_3BET_MIX);
      expect(holdemPersonaReRaiseScale(id)).toBe(s);
      lo = Math.min(lo, s);
      hi = Math.max(hi, s);
    }
    expect(lo).toBeGreaterThanOrEqual(0.22 / HOLDEM_MODEL_MEAN_NLH_3BET_MIX);
    expect(hi).toBeLessThanOrEqual(0.64 / HOLDEM_MODEL_MEAN_NLH_3BET_MIX);
    expect(lo).toBeLessThan(0.56);
    expect(hi).toBeGreaterThan(1.48);
  });
});
