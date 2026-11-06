/**
 * A mind-on league card must not depend on the hour it runs in.
 *
 * R7 (dataset 187815b1) epoch 4 league/cash recorded -3.575 bb/100 (se 1.768)
 * at 19:40Z on engine 92e26a9f. Re-run offline with the sealed model, the same
 * seed and EQUITY_GOVERNOR=off it reproduces to the last digit only when the
 * V9 mood clock is pinned to hour 19; other hours give other verdicts. The
 * mood read the wall clock because no decision passed decisionTimeMs. A
 * `moodClock: 'deal_seed'` matchup stamps every decision of a pair with
 * dealMoodClockMs(handSeed), in both passes and both arms.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dealMoodClockMs, runMatchup, type LeagueMatchup } from './HorseLeague.js';
import { HorseLogic, HORSE_MOOD_TEST_CLOCK_KEY } from '../engine/HorseLogic.js';

const G = globalThis as Record<string, unknown>;
let suitePin: unknown;

beforeEach(() => {
  // The suite pins every mood to one hour (testing/theHorseMoodHourIsPinned).
  // Production and the qualification job do not, so neither does this test.
  suitePin = G[HORSE_MOOD_TEST_CLOCK_KEY];
  delete G[HORSE_MOOD_TEST_CLOCK_KEY];
});

afterEach(() => {
  G[HORSE_MOOD_TEST_CLOCK_KEY] = suitePin;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const MATCHUP: LeagueMatchup = {
  name: 'deal_mood_clock_probe',
  seats: 6,
  stackBB: 100,
  // Two arms that really differ postflop (where the V9 mood scales bluff and
  // aggression volume), so the card has divergent pairs to measure.
  a: {},
  b: { v18Families: false },
  moodClock: 'deal_seed',
};

async function runAt(isoUtc: string, matchup: LeagueMatchup) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(isoUtc));
  const result = await runMatchup(matchup, 120, 82_001);
  vi.useRealTimers();
  return result;
}

describe('HorseLeague deal mood clock', { timeout: 120_000 }, () => {
  it('draws every hour of the day from the deal seed, reproducibly', () => {
    const hours = new Set<number>();
    // The hand seeds runMatchup actually deals: (runSeed ^ p*2654435761)>>>0.
    for (let p = 0; p < 5_000; p++) {
      const seed = (82_001 ^ (p * 2654435761)) >>> 0 || 1;
      const ms = dealMoodClockMs(seed);
      expect(ms).toBe(dealMoodClockMs(seed));
      expect(ms).toBeGreaterThanOrEqual(0);
      expect(ms).toBeLessThan(86_400_000);
      hours.add(Math.floor(ms / 3_600_000));
    }
    expect([...hours].sort((x, y) => x - y)).toEqual([...Array(24).keys()]);
  });

  it("stamps every decision of a pair, both passes, with that deal's clock", async () => {
    const original = HorseLogic.decide.bind(HorseLogic);
    const stamps: Array<number | undefined> = [];
    vi.spyOn(HorseLogic, 'decide').mockImplementation(((...args: unknown[]) => {
      const opts = args[4] as { decisionTimeMs?: number } | undefined;
      stamps.push(opts?.decisionTimeMs);
      return (original as (...a: unknown[]) => unknown)(...args);
    }) as typeof HorseLogic.decide);
    const pairs = 24;
    await runMatchup(MATCHUP, pairs, 82_001);
    expect(stamps.length).toBeGreaterThan(pairs * 2);
    expect(stamps.every((ms) => typeof ms === 'number')).toBe(true);
    // Collapse consecutive repeats: one run of identical stamps per pair.
    const runs = stamps.filter((ms, i) => i === 0 || ms !== stamps[i - 1]);
    const expected = [...Array(pairs).keys()].map((p) =>
      dealMoodClockMs((82_001 ^ (p * 2654435761)) >>> 0 || 1)
    );
    expect(runs).toEqual(expected.filter((ms, i) => i === 0 || ms !== expected[i - 1]));
  });

  it('leaves an unpinned card on the wall clock (unchanged default)', async () => {
    const original = HorseLogic.decide.bind(HorseLogic);
    const stamps: Array<number | undefined> = [];
    vi.spyOn(HorseLogic, 'decide').mockImplementation(((...args: unknown[]) => {
      stamps.push((args[4] as { decisionTimeMs?: number } | undefined)?.decisionTimeMs);
      return (original as (...a: unknown[]) => unknown)(...args);
    }) as typeof HorseLogic.decide);
    await runMatchup({ ...MATCHUP, moodClock: undefined }, 4, 82_001);
    expect(stamps.length).toBeGreaterThan(0);
    expect(stamps.every((ms) => ms === undefined)).toBe(true);
  });

  // Six spread hours keep the suite fast; the mechanism test covers all 24.
  const HOURS = [0, 4, 9, 13, 19, 23].map((h) => `2026-11-06T${String(h).padStart(2, '0')}:40:00Z`);
  const fingerprint = (r: { bb100: number; stderr: number; divergentPairs?: number }) =>
    `${r.bb100}|${r.stderr}|${r.divergentPairs}`;

  it('gives the same card at every wall-clock hour', async () => {
    const seen = new Set<string>();
    let divergent = 0;
    for (const at of HOURS) {
      const result = await runAt(at, MATCHUP);
      divergent = result.divergentPairs ?? 0;
      seen.add(fingerprint(result));
    }
    expect(divergent).toBeGreaterThan(0);
    expect(seen.size).toBe(1);
  });
});
