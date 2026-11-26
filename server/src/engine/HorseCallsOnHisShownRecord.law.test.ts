/**
 * LAW: A CALL IS ADDED ONLY ON THE BETTOR'S OWN SHOWN RECORD (holdemRiverCallVsMeasuredBluffIsPriced,
 * holdemMultiwayFlopSmallBetCallIsPriced; both default OFF, read `=== true`; plo-lead7 2026-11-25).
 *
 *  - with no record (opponent memory off) the option changes no decision on any hand: today's behaviour stands;
 *  - against a script that bluffs the river far beyond balanced, once its called bets have been shown, the option
 *    turns folds into calls (its receipt fires) and never into anything else;
 *  - against a script that never bluffs, the shown record is all value and the option never calls.
 * Heads-up league hands (ExploiterLeague), the script plays the production Horse except its river bets.
 */
import { describe, expect, it } from 'vitest';
import {
  runExploiterCell,
  exploiterSpotHelpers as H,
  type ExploiterPolicy,
} from '../benchmark/ExploiterLeague.js';
import { HORSE_HYBRID_PROFILES } from './HorseHybridProfile.js';
import { HorseMind } from './HorseMind.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import type { HorseDecideOpts } from './HorseLogic.js';

const hy = HORSE_HYBRID_PROFILES.cash;
/** River first to act or checked to: bet 2/3 pot with strong hands and with air at `q`; otherwise the Horse. */
const riverBettor =
  (q: number): ExploiterPolicy =>
  (s) => {
    if (s.stage === 'river' && s.toCall <= 0) {
      const e = H.quietEquity(s);
      if (e >= 0.8 || (e < 0.3 && H.hashRand(s, 77) < q)) return H.potWager(s, 2 / 3);
      return { action: 'check' };
    }
    return s.horseDecide(hy.style, { ...hy.mods }, {}) as { action: string; amount?: number };
  };

async function differenced(
  opt: string,
  q: number,
  memory: 'on' | 'off',
  pairs: number
): Promise<{ diff: number[]; fires: Record<string, number> }> {
  HorseMind.setLearnsPostflopBetsInSandbox(true);
  enableBrainTelemetry();
  const arms: Record<'off' | 'on', number[]> = { off: [], on: [] };
  const fires: Record<string, number> = {};
  for (const arm of ['off', 'on'] as const) {
    drainFires();
    await runExploiterCell({
      exploiter: 'horse_mirror',
      variant: 'nlh',
      seats: 2,
      stackBB: 100,
      pairs,
      seed: 4141,
      memory,
      horseOpts: { telemetry: true, ...(arm === 'on' ? { [opt]: true } : {}) } as HorseDecideOpts,
      policy: riverBettor(q),
      onPair: (_p, e) => arms[arm].push(e),
    });
    if (arm === 'on')
      for (const f of drainFires()) fires[f.feature] = (fires[f.feature] ?? 0) + f.fires;
  }
  HorseMind.setLearnsPostflopBetsInSandbox(false);
  return { diff: arms.on.map((x, i) => x - arms.off[i]), fires };
}

describe('a call is added only on the bettor’s own shown record', () => {
  it('no record: the river option changes no hand', async () => {
    const r = await differenced('holdemRiverCallVsMeasuredBluffIsPriced', 0.9, 'off', 150);
    expect(r.diff.every((x) => x === 0)).toBe(true);
    expect(r.fires.holdem_river_call_vs_measured_bluff_called ?? 0).toBe(0);
  }, 120_000);

  it('a measured over-bluffer: folds become calls', async () => {
    const r = await differenced('holdemRiverCallVsMeasuredBluffIsPriced', 0.9, 'on', 400);
    expect(r.fires.holdem_river_call_vs_measured_bluff_called ?? 0).toBeGreaterThan(0);
  }, 180_000);

  it('a bettor who never bluffs: never a call', async () => {
    const r = await differenced('holdemRiverCallVsMeasuredBluffIsPriced', 0, 'on', 300);
    expect(r.fires.holdem_river_call_vs_measured_bluff_called ?? 0).toBe(0);
    expect(r.diff.every((x) => x === 0)).toBe(true);
  }, 180_000);

  it('no record: the multiway flop option changes no hand', async () => {
    const r = await differenced('holdemMultiwayFlopSmallBetCallIsPriced', 0.9, 'off', 150);
    expect(r.diff.every((x) => x === 0)).toBe(true);
  }, 120_000);
});
