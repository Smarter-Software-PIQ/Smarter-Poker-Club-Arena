/**
 * THIN POOL, FOUR-HANDED (20261110214134; Dan 2026-11-10: form tables sooner
 * when the pool is thin). The port of the live plan (m1), proven identical to
 * fn_lightning_match_plan by scripts/dev/test-lightning-matcher-parity.sh
 * section 15:
 *   - six ready deal at once and five after one second, as before;
 *   - four ready deal four-handed once the latest of them has waited 1.5 s,
 *     only while the Cluster's whole pool (every open-pool player, free or
 *     in a hand) is at most 24; never fewer than four;
 *   - blinds and the button still go to whoever waited longest, at four.
 */
import { describe, expect, it } from 'vitest';
import {
  LIGHTNING_FORMATION_MAX_WAIT_MS,
  LIGHTNING_FOUR_HANDED_POOL_MAX,
  LIGHTNING_FOUR_HANDED_WAIT_MS,
  LIGHTNING_MATCHER_PARAM_DEFAULTS,
  lightningFormationSizes,
  lightningMatcherModel,
  lightningMatcherParams,
  lightningPassSizes,
  type LightningPoolPlayer,
} from './LightningMatcherModel.js';
import { runLightningMatcherSim } from './LightningMatcherSim.js';

const params = { ...LIGHTNING_MATCHER_PARAM_DEFAULTS, fourHanded: true };
// An older database (no thin_pool_four_handed in fn_lightning_config).
const before = { ...LIGHTNING_MATCHER_PARAM_DEFAULTS };
const id = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;

function player(i: number, idleSinceMs: number, legal = true): LightningPoolPlayer {
  return {
    playerId: id(i),
    legal,
    reasonCode: legal ? null : 'IN_HAND',
    idleSinceMs,
    enteredAtMs: i,
    joinedAtMs: i,
    slotOpenedAtMs: i,
    lastBbAtMs: 1_000 + i,
    bbUnresolved: false,
    debtSinceMs: i,
    handsSinceBb: 3,
    newcomer: false,
    positions: { btn: 0, co: 0, hj: 0, utg: 0 },
    handsSinceSb: 0,
    handsSinceButton: 0,
    lastButtonAtMs: null,
  };
}

/** `free` legal players whose latest arrival was `ago` ms before now, in a pool of `pool`. */
function plan(free: number, ago: number, pool = free) {
  const nowMs = 100_000;
  const players = [
    ...Array.from({ length: free }, (_, i) => player(i, nowMs - ago - (free - 1 - i))),
    ...Array.from({ length: pool - free }, (_, i) => player(1_000 + i, 0, false)),
  ];
  return lightningMatcherModel('m1')!.plan({ nowMs, players, recentHands: [] }, params);
}
const sizes = (p: ReturnType<typeof plan>) => p.groups.map((g) => g.players.length);

describe('the pure sizing (fn_lightning_formation_sizes)', () => {
  const p = (n: number) => Array.from({ length: n }, (_, i) => player(i, 0));
  it('gives no four from an older database (the flag absent)', () => {
    expect(lightningFormationSizes(p(4), 60_000, before)).toEqual([]);
  });
  it('gives a four only when four are left over and the latest has waited 1.5 s', () => {
    expect(lightningFormationSizes(p(4), LIGHTNING_FOUR_HANDED_WAIT_MS, params)).toEqual([4]);
    expect(lightningFormationSizes(p(4), LIGHTNING_FOUR_HANDED_WAIT_MS - 1, params)).toEqual([]);
    expect(lightningFormationSizes(p(10), LIGHTNING_FOUR_HANDED_WAIT_MS, params)).toEqual([6, 4]);
    expect(lightningFormationSizes(p(5), LIGHTNING_FORMATION_MAX_WAIT_MS, params)).toEqual([5]);
    for (const n of [1, 2, 3, 7, 8, 9]) {
      expect(lightningFormationSizes(p(n), 60_000, params).every((s) => s >= 5)).toBe(true);
    }
  });
  it('drops the four when the whole pool is above the thin limit', () => {
    const seat = p(4);
    const thin = { nowMs: 0, players: Array(LIGHTNING_FOUR_HANDED_POOL_MAX) };
    const healthy = { nowMs: 0, players: Array(LIGHTNING_FOUR_HANDED_POOL_MAX + 1) };
    expect(lightningPassSizes(seat, thin, params)).toEqual([4]);
    expect(lightningPassSizes(seat, healthy, params)).toEqual([]);
  });
});

describe('the plan (fn_lightning_match_plan)', () => {
  it('deals four in a thin pool once the latest arrival has waited 1.5 s', () => {
    expect(sizes(plan(4, LIGHTNING_FOUR_HANDED_WAIT_MS))).toEqual([4]);
    expect(sizes(plan(4, LIGHTNING_FOUR_HANDED_WAIT_MS, 20))).toEqual([4]);
  });
  it('holds four inside 1.5 s, even after the five-handed second', () => {
    expect(sizes(plan(4, LIGHTNING_FORMATION_MAX_WAIT_MS + 200))).toEqual([]);
  });
  it('keeps six as the target in a healthy pool, however long four have waited', () => {
    expect(sizes(plan(4, 60_000, LIGHTNING_FOUR_HANDED_POOL_MAX + 1))).toEqual([]);
    expect(sizes(plan(28, 60_000))).toEqual([6, 6, 6, 6]);
    expect(sizes(plan(22, 60_000))).toEqual([6, 6, 6, 4]);
  });
  it('leaves five and six unchanged and never deals three', () => {
    expect(sizes(plan(5, LIGHTNING_FORMATION_MAX_WAIT_MS))).toEqual([5]);
    expect(sizes(plan(6, 0))).toEqual([6]);
    expect(sizes(plan(3, 60_000))).toEqual([]);
  });
  it('seats a four-handed table with a button and both blinds', () => {
    const g = plan(4, 60_000).groups[0];
    expect(new Set(g.players).size).toBe(4);
    expect(g.bb).not.toBe(g.sb);
    expect(g.players).toContain(g.btn);
    expect([g.bb, g.sb]).not.toContain(g.btn);
  });
});

describe('the pool lived through (LightningMatcherSim, the same plan)', () => {
  it('a thin pool deals some four-handed tables; a healthy one keeps sixes', () => {
    const thin = runLightningMatcherSim({
      players: 14,
      hands: 3_000,
      seed: 5,
      instanceTarget: 6,
      instanceMax: 6,
    });
    const healthy = runLightningMatcherSim({
      players: 60,
      hands: 3_000,
      seed: 5,
      instanceTarget: 6,
      instanceMax: 6,
    });
    expect(thin.table_sizes[4] ?? 0).toBeGreaterThan(0);
    expect(healthy.table_sizes[4] ?? 0).toBe(0);
  });
});

describe('the engine follows the database it reads', () => {
  it('plans five or six only until fn_lightning_config says the thin-pool rule is installed', () => {
    const nowMs = 100_000;
    const four = Array.from({ length: 4 }, (_, i) => player(i, nowMs - 60_000));
    const m = lightningMatcherModel('m1')!;
    expect(m.plan({ nowMs, players: four, recentHands: [] }, before).groups).toHaveLength(0);
    expect(lightningMatcherParams({}).fourHanded).toBe(false);
    expect(lightningMatcherParams({ thin_pool_four_handed: 'true' }).fourHanded).toBe(false);
    const live = lightningMatcherParams({ thin_pool_four_handed: true });
    expect(live.fourHanded).toBe(true);
    expect(
      m.plan({ nowMs, players: four, recentHands: [] }, live).groups.map((g) => g.players.length)
    ).toEqual([4]);
  });
});

describe('new players are still the big blind first', () => {
  it('never holds a newcomer out of a five to deal a four', () => {
    const nowMs = 100_000;
    const regulars = [0, 1, 2].map((i) => player(i, nowMs - 60_000));
    const newcomers = [3, 4].map((i) => ({
      ...player(i, nowMs - 60_000),
      lastBbAtMs: null,
      handsSinceBb: null,
      newcomer: true,
    }));
    const p = lightningMatcherModel('m1')!.plan(
      { nowMs, players: [...regulars, ...newcomers], recentHands: [], entryBigBlind: true },
      params
    );
    expect(p.groups.map((g) => g.players.length)).toEqual([5]);
    expect(p.groups[0].entryBb).toHaveLength(1);
  });
});
