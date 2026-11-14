/**
 * A LEAGUE CARD'S RESULT DEPENDS ONLY ON ITS OWN DEFINITION AND SEED
 * (2026-11-13, heads-up lane, HU-EVAL-003 and HU-EVAL-004).
 *
 * The brain keys per-hand draws on the hand's first action timestamp (the
 * persona indifference band, V48 chart adherence). The league dealt every
 * hand on the next slot of a process-wide counter, so:
 *
 *   HU-EVAL-004  the card a worker ran second was dealt on other timestamps
 *                than the same card run first, and the same seed gave another
 *                answer (80bb heads-up mirror, 3,000 pairs, seed 20261112:
 *                -4.86 run first, -8.10 run second in the same process). The
 *                nightly worker runs the whole card in one process, in an
 *                order that changes every night.
 *   HU-EVAL-003  the two passes of one duplicate pair never shared a
 *                timestamp, so two IDENTICAL arms drew different persona
 *                mixes: against the limp persona, pair 803 of seed 20261112
 *                folded the turn in one pass and called it in the other.
 *
 * Both passes of pair p are now dealt on leaguePairHandClock(p), a function
 * of the pair alone. These laws hold the property, not the mechanism: the
 * timestamps the brain is shown, and the result, are the same whatever ran
 * before, and identical arms never diverge.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HorseLogic } from '../engine/HorseLogic.js';
import {
  HU_LIMP_EVERY_BUTTON_PERSONA,
  LEAGUE_MATCHUPS,
  runMatchup,
  type LeagueMatchup,
  type LeagueResult,
} from './HorseLeague.js';
import { HUMAN_CALIBRATED_POPULATION_ID } from './HumanCalibratedPopulation.js';

afterEach(() => {
  vi.restoreAllMocks();
});

const card = (name: string): LeagueMatchup => {
  const m = LEAGUE_MATCHUPS.find((x) => x.name === name);
  if (!m) throw new Error(`${name} left the card`);
  return m;
};

/** What a stored row is built from, without the wall-clock duration. */
const measured = (r: LeagueResult) => {
  const { durationMs: _d, benchmarkComponents, ...rest } = r;
  return {
    ...rest,
    benchmarkComponents: benchmarkComponents.map(({ durationMs: _c, ...c }) => c),
  };
};

/** Runs a matchup and records, per brain decision, the timestamp of the
 *  hand's first action: the value the brain keys its per-hand draws on. */
async function runRecordingHandClocks(
  matchup: LeagueMatchup,
  pairs: number,
  seed: number
): Promise<{ result: LeagueResult; clocks: number[] }> {
  const clocks: number[] = [];
  const original = HorseLogic.decide.bind(HorseLogic);
  const spy = vi.spyOn(HorseLogic, 'decide').mockImplementation((player, gs, style, mods, opts) => {
    const first = gs.actionHistory?.[0]?.timestamp;
    if (typeof first === 'number') clocks.push(first);
    return original(player, gs, style, mods, opts);
  });
  try {
    return { result: await runMatchup(matchup, pairs, seed), clocks };
  } finally {
    spy.mockRestore();
  }
}

describe('a league card gives the same result alone and after another card', () => {
  it.each([
    ['hu_bb_defends_to_price', 'v11_leak_fixes'],
    ['human_hu_bb_defends_vs_minraise_40bb', 'hu_commit_under_pot'],
    ['v7_preflop', 'human_hu_v7_preflop_vs_limper_40bb'],
  ] as const)(
    '%s: the brain is shown the same hand clocks, and the result is the same, after %s',
    async (name, other) => {
      const alone = await runRecordingHandClocks(card(name), 40, 20261112);
      await runMatchup(card(other), 25, 4242);
      const after = await runRecordingHandClocks(card(name), 40, 20261112);
      expect(alone.clocks.length).toBeGreaterThan(40);
      expect(after.clocks).toEqual(alone.clocks);
      expect(measured(after.result)).toEqual(measured(alone.result));
    },
    600_000
  );

  it('a longer card is identical run first, second and third in one process', async () => {
    const hu = card('hu_bb_defends_to_price_40bb');
    const first = await runMatchup(hu, 400, 20261112);
    await runMatchup(card('human_hu_commit_under_pot'), 60, 7);
    const second = await runMatchup(hu, 400, 20261112);
    await runMatchup(card('hu_mind_layer'), 60, 9);
    const third = await runMatchup(hu, 400, 20261112);
    expect(first.hands).toBe(800);
    expect(measured(second)).toEqual(measured(first));
    expect(measured(third)).toEqual(measured(first));
  }, 600_000);

  it('a card that runs while another is mid-run is unchanged by it', async () => {
    const hu = card('hu_commit_under_pot');
    const alone = await runMatchup(hu, 48, 20261112);
    const [together] = await Promise.all([
      runMatchup(hu, 48, 20261112),
      runMatchup(card('hu_bb_defends_to_price'), 48, 5),
    ]);
    expect(measured(together)).toEqual(measured(alone));
  }, 600_000);
});

describe('identical arms never diverge', () => {
  it('both passes of every pair are dealt on one hand clock', async () => {
    const { clocks, result } = await runRecordingHandClocks(
      { ...card('human_hu_v7_preflop_vs_limper_40bb'), b: {} },
      30,
      20261112
    );
    expect(result.divergentPairs).toBe(0);
    // Identical arms play identical hands, so each pass contributes the same
    // sequence of decisions: the recording is every pair's clocks twice over.
    const perPair = new Map<number, number>();
    for (const c of clocks) perPair.set(c, (perPair.get(c) ?? 0) + 1);
    expect(perPair.size).toBeGreaterThan(20);
    // One clock per pair: 30 pairs can show the brain at most 30 of them.
    expect(perPair.size).toBeLessThanOrEqual(30);
    for (const [clock, n] of perPair) {
      expect(n % 2, `hand clock ${clock} was shown to one pass only`).toBe(0);
    }
  }, 600_000);

  it('the limp persona card with one arm twice: 0 of 900 pairs diverge (pair 803 did)', async () => {
    const r = await runMatchup(
      {
        name: 'identical_arms_vs_limper',
        seats: 2,
        stackBB: 40,
        hybridBaseline: true,
        moodClock: 'deal_seed',
        a: {},
        b: {},
        opponentPopulation: HUMAN_CALIBRATED_POPULATION_ID,
        humanPersona: HU_LIMP_EVERY_BUTTON_PERSONA,
      },
      900,
      20261112
    );
    expect(r.hands).toBe(1800);
    expect(r.divergentPairs).toBe(0);
    expect(r.bb100).toBe(0);
    expect(r.inert).toBe(true);
    const [armA, armB] = r.benchmarkComponents;
    expect(armB.bb100).toBe(armA.bb100);
  }, 600_000);

  it.each(['hu_bb_defends_to_price', 'hu_commit_under_pot', 'v12_ranges_river', 'hu_mind_layer'])(
    '%s with arm A on both sides is inert: no pair diverges',
    async (name) => {
      const m = card(name);
      const r = await runMatchup({ ...m, name: `${name}_identical`, b: { ...m.a } }, 150, 20261112);
      expect(r.hands).toBe(300);
      expect(r.divergentPairs).toBe(0);
      expect(r.bb100).toBe(0);
      expect(r.inert).toBe(true);
    },
    600_000
  );
});
