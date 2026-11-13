/**
 * THE HEADS-UP HUMAN-FIELD CARD (2026-11-07)
 *
 * Every human-field card was six-max. hu_bb_defends_to_price (default OFF)
 * read +0.37 +/- 0.31 bb/100 horse-vs-horse, unresolved, against a small
 * blind that opens what horses open. Its human twin seats the hero against
 * the hu_wide_sb_aggressor_v1 persona of the calibrated field, heads-up 80bb.
 *
 * Pins: the persona plays a wide small blind and stabs when checked to, and
 * only where it was written for; the card is on the nightly set with the
 * mirror's arms, depth and hero persona; the hero plays both blinds; the
 * stored row says which persona it measured; and the flag still defaults off.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HUMAN_HU_BB_DEFENDS_TO_PRICE,
  HUMAN_HU_BB_DEFENDS_TO_PRICE_40BB,
  HU_WIDE_SB_AGGRESSOR_PERSONA,
  HUMAN_FIELD_HERO_SEAT,
  HUMAN_FIELD_PAIRS,
  LEAGUE_MATCHUPS,
  V53_PRESSURE_POPULATION_ID,
  humanFieldPersonaProfile,
  leagueResultConfig,
  runMatchup,
  type LeagueMatchup,
} from './HorseLeague.js';
import { horseLeagueComputeResponseIsValid } from './HorseLeagueComputeWorkerClient.js';
import {
  HUMAN_CALIBRATED_POPULATION_ID,
  humanCalibratedProfileFor,
} from './HumanCalibratedPopulation.js';
import { HorseLogic } from '../engine/HorseLogic.js';

const HUMAN = HUMAN_CALIBRATED_POPULATION_ID;
const HU_TABLE = { population: HUMAN, variant: 'nlh', seats: 2 } as const;

afterEach(() => {
  vi.restoreAllMocks();
});

const shareOf = (node: Record<string, number> | undefined, ...actions: string[]): number => {
  const total = Object.values(node ?? {}).reduce((s, n) => s + n, 0);
  return actions.reduce((s, a) => s + (node?.[a] ?? 0), 0) / Math.max(1, total);
};

describe('the hu_wide_sb_aggressor_v1 persona', () => {
  it('is the calibrated NLH profile with a wide small blind, light defence and stabs', () => {
    const base = humanCalibratedProfileFor('nlh');
    const p = humanFieldPersonaProfile(HU_WIDE_SB_AGGRESSOR_PERSONA, HU_TABLE);
    expect(p.family).toBe('nlh');
    expect(p.cutoffs?.['preflop/unopened']).toEqual({ fold: 0.2, raise: 0.3 });
    expect(p.cutoffs?.['preflop/facing_raise']).toEqual({ fold: 0.4, raise: 0.85 });
    expect(p.preflop.freeRaise).toBe(0.35);
    for (const street of ['flop', 'turn', 'river'] as const) {
      expect(p.cutoffs?.[`${street}/checked_to`]?.bet).toBeLessThan(
        base.cutoffs![`${street}/checked_to`]!.bet!
      );
      // Facing a bet it plays the calibrated (human-data) cutoffs, unchanged.
      expect(p.cutoffs?.[`${street}/facing_bet`]).toEqual(base.cutoffs![`${street}/facing_bet`]);
    }
    expect(p.postflop).toEqual(base.postflop);
    // The calibrated profile itself is untouched.
    expect(base.cutoffs?.['preflop/unopened']).toEqual({ fold: 0.614133, raise: 0.807612 });
  });

  it('is refused anywhere but the heads-up NLH calibrated field', () => {
    const p = HU_WIDE_SB_AGGRESSOR_PERSONA;
    expect(() => humanFieldPersonaProfile(p, { ...HU_TABLE, seats: 6 })).toThrow(/heads-up NLH/);
    expect(() => humanFieldPersonaProfile(p, { ...HU_TABLE, variant: 'plo4' })).toThrow(
      /heads-up NLH/
    );
    expect(() =>
      humanFieldPersonaProfile(p, { ...HU_TABLE, population: V53_PRESSURE_POPULATION_ID })
    ).toThrow(/heads-up NLH/);
    expect(() => humanFieldPersonaProfile('nobody' as never, HU_TABLE)).toThrow(/Unknown/);
  });

  it('a card cannot name a persona without a human field, nor deal one six-max', async () => {
    await expect(
      runMatchup(
        { name: 'p', seats: 2, a: {}, b: {}, humanPersona: HU_WIDE_SB_AGGRESSOR_PERSONA },
        1,
        1
      )
    ).rejects.toThrow(/needs a human field/);
    await expect(
      runMatchup(
        {
          name: 'p',
          a: {},
          b: {},
          opponentPopulation: HUMAN,
          humanPersona: HU_WIDE_SB_AGGRESSOR_PERSONA,
        },
        1,
        1
      )
    ).rejects.toThrow(/heads-up NLH/);
  });
});

describe('the heads-up human-field card', { timeout: 180_000 }, () => {
  const card = (): LeagueMatchup =>
    LEAGUE_MATCHUPS.find((m) => m.name === HUMAN_HU_BB_DEFENDS_TO_PRICE)!;

  it("is on the nightly card with the mirror card's arms, depth and hero persona", () => {
    const h = card();
    const mirror = LEAGUE_MATCHUPS.find((m) => m.name === 'hu_bb_defends_to_price')!;
    expect(h).toBeDefined();
    expect(h).toMatchObject({
      seats: 2,
      stackBB: 80,
      pairs: HUMAN_FIELD_PAIRS,
      hybridBaseline: true,
      moodClock: 'deal_seed',
      opponentPopulation: HUMAN,
      humanPersona: HU_WIDE_SB_AGGRESSOR_PERSONA,
    });
    expect(h.a).toEqual(mirror.a);
    expect(h.b).toEqual(mirror.b);
    expect(h.a).toEqual({ huBbDefendsToPrice: true });
    expect(h.b).toEqual({});
    expect(leagueResultConfig(h, 'a')).toEqual({
      huBbDefendsToPrice: true,
      opponentPopulation: HUMAN,
      humanPersona: HU_WIDE_SB_AGGRESSOR_PERSONA,
    });
    expect(leagueResultConfig(h, 'b')).toEqual({
      opponentPopulation: HUMAN,
      humanPersona: HU_WIDE_SB_AGGRESSOR_PERSONA,
    });
  });

  it('the hero plays both blinds on the Hybrid persona; the field opens wide and stabs', async () => {
    const heroSeat = HUMAN_FIELD_HERO_SEAT + 1;
    const heroButton = { yes: 0, no: 0 };
    const styles = new Set<string>();
    const original = HorseLogic.decide.bind(HorseLogic);
    vi.spyOn(HorseLogic, 'decide').mockImplementation((player, gs, style, mods, opts) => {
      expect(player.seat).toBe(heroSeat);
      styles.add(String(style));
      const first = (gs.actionHistory ?? []).filter((a) => a.seat === heroSeat).length === 0;
      if (first && gs.stage === 'preflop') {
        if (gs.dealerSeat === heroSeat) heroButton.yes++;
        else heroButton.no++;
      }
      return original(player, gs, style, mods, opts);
    });
    const r = await runMatchup(card(), 300, 20261107);
    expect(r.hands).toBe(600);
    expect(r.illegalActions).toBe(0);
    expect(r.truncatedStreets).toBe(0);
    // Dealer rotates every pair: the hero is the small blind half the time.
    expect(heroButton.yes).toBeGreaterThan(0);
    expect(heroButton.no).toBeGreaterThan(0);
    expect(Math.abs(heroButton.yes - heroButton.no)).toBeLessThanOrEqual(
      0.1 * (heroButton.yes + heroButton.no)
    );
    expect([...styles]).not.toContain('balanced');
    const resp = r.humanResponses ?? {};
    // Small blind first in: ~80% play, ~70% raise (calibrated six-max: ~39% / ~19%).
    expect(shareOf(resp['preflop/unopened'], 'raise', 'all_in')).toBeGreaterThan(0.6);
    expect(shareOf(resp['preflop/unopened'], 'fold')).toBeLessThan(0.3);
    expect(shareOf(resp['flop/checked_to'], 'bet', 'all_in')).toBeGreaterThan(0.5);
    expect(horseLeagueComputeResponseIsValid({ type: 'MATCHUP_RESULT', jobId: 1, result: r })).toBe(
      true
    );
  });
});

/**
 * HU-NLH-001 (2026-11-12): V85 widens the heads-up cash big blind above 50bb
 * only, so the 80bb cards measure the flag on top of V85. The 40bb pair
 * measures it in the band the V11 bars still decide.
 */
describe('the 40bb heads-up pair (HU-NLH-001)', { timeout: 180_000 }, () => {
  const mirror = (): LeagueMatchup =>
    LEAGUE_MATCHUPS.find((m) => m.name === 'hu_bb_defends_to_price_40bb')!;
  const twin = (): LeagueMatchup =>
    LEAGUE_MATCHUPS.find((m) => m.name === HUMAN_HU_BB_DEFENDS_TO_PRICE_40BB)!;

  it('is on the nightly card at 40bb with the 80bb pair unchanged', () => {
    const base = LEAGUE_MATCHUPS.find((m) => m.name === 'hu_bb_defends_to_price')!;
    expect(base.stackBB).toBe(80);
    expect(mirror()).toMatchObject({
      seats: 2,
      stackBB: 40,
      pairs: base.pairs,
      hybridBaseline: true,
      moodClock: 'deal_seed',
    });
    expect(mirror().a).toEqual({ huBbDefendsToPrice: true });
    expect(mirror().b).toEqual({});
    expect(twin()).toMatchObject({
      seats: 2,
      stackBB: 40,
      pairs: HUMAN_FIELD_PAIRS,
      hybridBaseline: true,
      moodClock: 'deal_seed',
      opponentPopulation: HUMAN,
      humanPersona: HU_WIDE_SB_AGGRESSOR_PERSONA,
    });
    expect(twin().a).toEqual(mirror().a);
    expect(twin().b).toEqual(mirror().b);
    const eighty = LEAGUE_MATCHUPS.find((m) => m.name === HUMAN_HU_BB_DEFENDS_TO_PRICE)!;
    expect(eighty.stackBB).toBe(80);
  });

  it('both cards deal a measurement at 40bb: the arms diverge and nothing is illegal', async () => {
    for (const card of [mirror(), twin()]) {
      const r = await runMatchup(card, 300, 20261112);
      expect(r.hands).toBe(600);
      expect(r.illegalActions).toBe(0);
      expect(r.truncatedStreets).toBe(0);
      expect(r.inert).not.toBe(true);
      expect(r.divergentPairs ?? 0).toBeGreaterThan(0);
    }
  });

  it('the flag still defaults off', () => {
    expect(mirror().b).toEqual({});
    expect(twin().b).toEqual({});
  });
});
