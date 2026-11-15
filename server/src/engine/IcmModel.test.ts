/**
 * V16 ICM — Malmuth-Harville ground truth.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  bubbleFactor,
  createIcmEquityEstimator,
  icmEquity,
  pairwiseBubbleFactor,
  premiumFromBubbleFactor,
  icmBustPaysPlaceOn,
  withIcmBustPaysPlace,
} from './IcmModel.js';

describe('icmEquity', () => {
  it('bounds optional future-hand work with truthful uncertainty and unchanged default work', () => {
    const stacks = Array.from({ length: 18 }, () => 1000),
      payouts = [50, 30, 20];
    const baseline = createIcmEquityEstimator(stacks, payouts, 0);
    const future = createIcmEquityEstimator(stacks, payouts, 0, undefined, 128);
    expect(baseline.trials).toBe(1200);
    expect(future.trials).toBe(128);
    const a = baseline.estimate(stacks),
      b = future.estimate(stacks);
    expect(b.errorBound).toBeGreaterThan(a.errorBound);
    expect(Math.abs(b.equity - 100 / 18)).toBeLessThanOrEqual(b.errorBound);
    expect(future.estimate(stacks)).toEqual(b);
    expect(createIcmEquityEstimator(stacks, payouts, 0, undefined, 1).trials).toBe(96);
    expect(createIcmEquityEstimator(stacks, payouts, 0, undefined, 100000).trials).toBe(1200);
    expect(
      createIcmEquityEstimator([100, 200], [100], 0, undefined, 128).estimate([100, 200])
    ).toEqual(createIcmEquityEstimator([100, 200], [100], 0).estimate([100, 200]));
  });
  it('two players: closed form p*(P1-P2)+P2', () => {
    // 60/40 chips, payouts 100/60: hero(60%) = 0.6*100 + 0.4*60 = 84
    expect(icmEquity([600, 400], [100, 60], 0)).toBeCloseTo(84, 6);
    expect(icmEquity([600, 400], [100, 60], 1)).toBeCloseTo(76, 6);
    // equities sum to the prize pool
  });

  it('equal stacks share equally and sum to the pool', () => {
    const stacks = [1000, 1000, 1000];
    const pays = [50, 30, 20];
    const e0 = icmEquity(stacks, pays, 0);
    const e1 = icmEquity(stacks, pays, 1);
    const e2 = icmEquity(stacks, pays, 2);
    expect(e0).toBeCloseTo(e1, 6);
    expect(e1).toBeCloseTo(e2, 6);
    expect(e0 + e1 + e2).toBeCloseTo(100, 6);
  });

  it('prices a live all-in seat after an award crosses the ten-player exact boundary', () => {
    // The eleventh entrant has committed its chips, not been eliminated.
    // Both opponents can survive a split while the remote field stays fixed.
    const stacks = Array.from({ length: 10 }, () => 100).concat(0);
    const prizes = [60, 40];
    const mutable = [0, 10];
    const workspace = createIcmEquityEstimator(stacks, prizes, 0, mutable, 128);
    const reference = stacks.slice();
    const restored = reference.slice();
    restored[10] = 100;
    Object.freeze(restored);
    expect(workspace.estimate(reference).equity).toBeCloseTo(10, 12);
    expect(workspace.estimate(reference).errorBound).toBe(0);

    // Equal stacks share the full prize pool by symmetry.
    const result = workspace.estimate(restored);
    expect(result.method).toBe('plackett_luce_mc');
    expect(result.modeledPlayers).toBe(11);
    expect(result.equity).toBeGreaterThan(0);
    expect(Math.abs(result.equity - 100 / 11)).toBeLessThanOrEqual(result.errorBound);
    expect(result.errorBound).toBeGreaterThan(0);
    expect(result.trials).toBe(128);
    expect(workspace.method).toBe('plackett_luce_mc');
    expect(workspace.trials).toBe(128);
    expect(workspace.randomClockDraws).toBe(128 * 11);

    // The fallback owns its original inputs and generates common clocks only
    // once. A bounded continuation is the same prefix, never another sample.
    const direct = createIcmEquityEstimator(restored, prizes, 0, mutable, 128);
    const expectedPrefix = direct.estimate(restored, 96);
    expect(result).toEqual(direct.estimate(restored));
    stacks.fill(0);
    prizes.fill(0);
    mutable.fill(9);
    const log = vi.spyOn(Math, 'log');
    try {
      expect(workspace.estimate(restored, 96)).toEqual(expectedPrefix);
      expect(workspace.estimate(restored, 96)).toEqual(expectedPrefix);
      expect(workspace.estimate(restored, 10_000)).toEqual(result);
      expect(log.mock.calls.length).toBeLessThanOrEqual(1);
      // Returning below the boundary still receives exact arithmetic.
      expect(workspace.estimate(reference).equity).toBeCloseTo(10, 12);
      expect(workspace.estimate(reference).errorBound).toBe(0);
      const drifted = restored.slice();
      drifted[1] += 1;
      expect(() => workspace.estimate(drifted)).toThrow('ICM remote stack changed');
    } finally {
      log.mockRestore();
    }
  });

  it('prices every finishing place symmetrically at the ten-player exact boundary', () => {
    const stacks = Array.from({ length: 10 }, () => 1000);
    // A unit prize at one rank isolates that rank's probability. Exchangeable
    // stacks must give every hero exactly 1/10, including the deepest rank.
    for (let rank = 0; rank < 10; rank++) {
      const prizes = Array.from({ length: 10 }, (_, i) => Number(i === rank));
      const equities = stacks.map((_, hero) => icmEquity(stacks, prizes, hero));
      for (const equity of equities) expect(equity).toBeCloseTo(0.1, 12);
      expect(equities.reduce((sum, equity) => sum + equity, 0)).toBeCloseTo(1, 12);
    }
  });

  it('a chip lead is worth LESS than proportional (the ICM curve)', () => {
    // 3 players, hero has half the chips: chip-proportional share of the
    // 100 pool would be 50; ICM must be less (flat payout curvature).
    const eq = icmEquity([3000, 2000, 1000], [50, 30, 20], 0);
    expect(eq).toBeGreaterThan(34); // better than an equal share
    expect(eq).toBeLessThan(50); // but less than chip-proportional
  });

  it('handles big fields directly without changing player cardinality', () => {
    const stacks = Array.from({ length: 60 }, (_, i) => 1000 + i * 100);
    const pays = [40, 25, 15, 10, 6, 4];
    const t0 = Date.now();
    const eq = icmEquity(stacks, pays, 59); // biggest stack
    expect(Date.now() - t0).toBeLessThan(200);
    expect(eq).toBeGreaterThan(100 / 60); // clearly above average share
    expect(eq).toBeLessThan(40);
  });

  it('reuses one deterministic action workspace and rejects remote-stack drift', () => {
    const stacks = Array.from({ length: 1_000 }, (_, index) => 500 + index * 3);
    const payouts = Array.from({ length: 200 }, () => 0.5);
    const workspace = createIcmEquityEstimator(stacks, payouts, 998, [998, 999]);
    const candidate = [...stacks];
    candidate[998] -= 250;
    candidate[999] += 250;

    const first = workspace.estimate(candidate);
    const second = workspace.estimate(candidate);
    expect(first).toEqual(second);
    expect(first.modeledPlayers).toBe(1_000);
    expect(workspace.randomClockDraws).toBeLessThanOrEqual(240_000);

    const drifted = [...candidate];
    drifted[0] += 1;
    expect(() => workspace.estimate(drifted)).toThrow('ICM remote stack changed');

    const withBustedRemote = [...stacks, 0];
    const zeroWorkspace = createIcmEquityEstimator(withBustedRemote, payouts, 998, [998, 999]);
    const resurrectedRemote = [...withBustedRemote];
    resurrectedRemote[1_000] = 1;
    expect(() => zeroWorkspace.estimate(resurrectedRemote)).toThrow('ICM remote stack changed');
  });
});

describe('bubbleFactor', () => {
  const pays = [50, 30, 20];

  it('is EXACTLY ~1 in a winner-take-all (pure chip EV) - the conservation regression', () => {
    // The first cut created/destroyed the risked chips instead of moving
    // them, and WTA read BF 2. With conservation it must be 1.
    const bf = bubbleFactor([2000, 2000, 2000], [100], 0, 2000);
    expect(bf).toBeGreaterThan(0.99);
    expect(bf).toBeLessThan(1.01);
  });

  it('a medium stack on a flat payout has BF well above 1', () => {
    // 4 players, 3 paid, flat-ish payouts: the classic bubble squeeze.
    const bf = bubbleFactor([2000, 2000, 2000, 500], [40, 32, 28], 0, 1500);
    expect(bf).toBeGreaterThan(1.3);
  });

  it('risking into a COVERING stack costs more than the same risk covered', () => {
    // Hero 1500. vs a covering 4000 stack hero risks his whole 1500;
    // vs a covered 700 stack hero risks only 700.
    const stacks = [1500, 4000, 700, 1800];
    const vsCovering = bubbleFactor(stacks, pays, 0, 1500);
    const vsCovered = bubbleFactor(stacks, pays, 0, 700);
    expect(vsCovering).toBeGreaterThan(vsCovered);
  });

  it('premium mapping is monotone and capped', () => {
    expect(premiumFromBubbleFactor(1)).toBe(0);
    expect(premiumFromBubbleFactor(1.5)).toBeCloseTo(0.02, 6);
    expect(premiumFromBubbleFactor(2)).toBeCloseTo(0.04, 6);
    expect(premiumFromBubbleFactor(9)).toBe(0.14);
  });
});

/**
 * A BUST IN THE MONEY IS WORTH ITS PLACE (2026-11-15, hand 59441335).
 * icmEquity prices a zero stack at 0, and bubbleFactor read the down state of
 * a whole-stack risk through it, so a player who busts ninth with nine places
 * paid was charged every payout including ninth's: the 2.1bb final-table
 * short stack below read 5 (the cap) instead of about 1.17. The bust is
 * priced at the payout of the place the player finishes (behind every stack
 * that was live before the hand), and at 0 only where that place is unpaid.
 */
describe('bubbleFactor values a bust at the place it finishes (option icmBustPaysPlace)', () => {
  // The option is on for these cases (HorseLogic.decide scopes it per decision).
  const itOn = (name: string, fn: () => void) => it(name, () => withIcmBustPaysPlace(true, fn));
  // Hand 59441335: nine left of 86, 13 paid (the repository ladder at 15%).
  const FINAL_TABLE = [342_381, 310_173, 191_640, 126_232, 124_308, 74_332, 69_856, 38_469, 12_609];
  const SHORT = 8;
  const LADDER_13 = [25.14, 14.44, 10.44, 8.3, 6.94, 6.0, 5.31, 4.77, 4.34, 3.99, 3.69, 3.44, 3.2];
  const bustAtPlace = (stacks: number[], pays: number[], hero: number, risk: number) => {
    // Independent arithmetic: risk against the largest other stack.
    let opp = -1;
    stacks.forEach((s, i) => {
      if (i !== hero && (opp < 0 || s > stacks[opp])) opp = i;
    });
    const r = Math.min(risk, stacks[hero], stacks[opp]);
    const now = icmEquity(stacks, pays, hero);
    const up = stacks.slice();
    up[hero] += r;
    up[opp] -= r;
    const down = stacks.slice();
    down[hero] -= r;
    down[opp] += r;
    const live = stacks.filter((s) => s > 0).length;
    const downEq = down[hero] > 0 ? icmEquity(down, pays, hero) : (pays[live - 1] ?? 0);
    return (now - downEq) / (icmEquity(up, pays, hero) - now);
  };

  itOn('the in-the-money short stack reads about 1.17, not the cap of 5', () => {
    const bf = bubbleFactor(FINAL_TABLE, LADDER_13, SHORT, 12_609);
    expect(bf).toBeCloseTo(bustAtPlace(FINAL_TABLE, LADDER_13, SHORT, 12_609), 9);
    expect(bf).toBeGreaterThan(1.1);
    expect(bf).toBeLessThan(1.3);
    // Its equity never falls below ninth's payout, so what a bust loses is
    // the part above 4.34, not all of it.
    expect(icmEquity(FINAL_TABLE, LADDER_13, SHORT)).toBeGreaterThan(LADDER_13[8]);
  });

  itOn('the pairwise factor prices the same bust the same way', () => {
    const covering = 0; // the 342k stack covers hero
    const bf = pairwiseBubbleFactor(FINAL_TABLE, LADDER_13, SHORT, covering, 12_609);
    expect(bf).toBeCloseTo(bustAtPlace(FINAL_TABLE, LADDER_13, SHORT, 12_609), 9);
    expect(bf).toBeLessThan(1.3);
  });

  itOn('every stack at the final table that can bust reads a factor below the cap', () => {
    for (let hero = 1; hero < FINAL_TABLE.length; hero++) {
      const bf = bubbleFactor(FINAL_TABLE, LADDER_13, hero, FINAL_TABLE[hero]);
      expect(bf).toBeCloseTo(bustAtPlace(FINAL_TABLE, LADDER_13, hero, FINAL_TABLE[hero]), 9);
      expect(bf).toBeLessThan(5);
    }
  });

  itOn('outside the money a bust is worth 0, exactly as before', () => {
    // Five left, three paid: fifth is unpaid, so the bust prices at zero.
    const stacks = [9_000, 6_000, 3_000, 1_500, 500];
    for (let hero = 1; hero < stacks.length; hero++) {
      const now = icmEquity(stacks, [50, 30, 20], hero);
      const up = stacks.slice();
      up[hero] += stacks[hero];
      up[0] -= stacks[hero];
      const legacy = Math.min(5, Math.max(1, now / (icmEquity(up, [50, 30, 20], hero) - now)));
      expect(bubbleFactor(stacks, [50, 30, 20], hero, stacks[hero])).toBeCloseTo(legacy, 12);
    }
  });

  itOn('a partial risk that leaves chips behind is unchanged', () => {
    const covered = bubbleFactor(FINAL_TABLE, LADDER_13, 2, 38_469);
    expect(covered).toBeCloseTo(bustAtPlace(FINAL_TABLE, LADDER_13, 2, 38_469), 12);
  });

  it('with the option off a bust is valued at 0, exactly as before (the cap for the short stack)', () => {
    expect(bubbleFactor(FINAL_TABLE, LADDER_13, SHORT, 12_609)).toBe(5);
    expect(
      withIcmBustPaysPlace(true, () => bubbleFactor(FINAL_TABLE, LADDER_13, SHORT, 12_609))
    ).toBeLessThan(5);
    expect(icmBustPaysPlaceOn()).toBe(false);
  });
});
