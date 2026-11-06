/**
 * The spot-conditioned evaluator (V55, 2026-11-06) is only valid if (1) it
 * deals exactly the cards playHand deals, (2) a deal outside the class plays
 * identically in both arms, and (3) the Omaha development field stays off
 * every card the nightly worker runs and plays pot-limit legally.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  playHand,
  LEAGUE_MATCHUPS,
  HUMAN_FIELD_HERO_SEAT,
  HUMAN_FIELD_VARIANTS,
  HUMAN_CALIBRATED_OMAHA_DEV_POPULATION_ID,
  leagueFieldVariants,
  type LeagueHumanField,
} from './HorseLeague.js';
import { HorseLogic } from '../engine/HorseLogic.js';
import { HorseMind } from '../engine/HorseMind.js';
import {
  leagueDealFor,
  dealMeetsCondition,
  runSpotConditionedMatchup,
} from './HorseLeagueSpotConditioned.js';
import type { Card } from '../types.js';

const key = (cs: Card[]) => cs.map((c) => `${c.rank}${c.suit[0]}`).join(' ');
const field: LeagueHumanField = {
  population: HUMAN_CALIBRATED_OMAHA_DEV_POPULATION_ID,
  isHuman: (s) => s !== HUMAN_FIELD_HERO_SEAT,
};

afterEach(() => vi.restoreAllMocks());

describe('HorseLeague spot-conditioned evaluation', { timeout: 120_000 }, () => {
  it('deals the hero exactly the cards playHand deals', () => {
    for (let h = 0; h < 12; h++) {
      const seed = 4100 + h * 7919;
      const deal = leagueDealFor(seed, 6, 'plo4');
      const original = HorseLogic.decide.bind(HorseLogic);
      let seen: Card[] | null = null;
      let board: Card[] = [];
      vi.spyOn(HorseLogic, 'decide').mockImplementation(((
        p: never,
        gs: never,
        ...rest: never[]
      ) => {
        const player = p as { seat: number; cards: Card[] };
        const state = gs as { communityCards: Card[] };
        if (player.seat === HUMAN_FIELD_HERO_SEAT + 1) {
          seen = player.cards;
          if (state.communityCards.length > board.length) board = state.communityCards;
        }
        return (original as (...args: never[]) => unknown)(p, gs, ...rest);
      }) as never);
      playHand(
        seed,
        (h % 6) + 1,
        () => ({ mind: false, telemetry: false }),
        undefined,
        HorseMind.createSandbox(),
        'plo4',
        6,
        100,
        undefined,
        () => ({}),
        field
      );
      vi.restoreAllMocks();
      expect(seen, `hand ${h}`).not.toBeNull();
      expect(key(seen!)).toBe(key(deal.holes[HUMAN_FIELD_HERO_SEAT]));
      if (board.length > 0) expect(key(board)).toBe(key(deal.board.slice(0, board.length)));
    }
  });

  it('a deal outside the class plays identically in both V55 arms', () => {
    let checked = 0;
    for (let p = 0; checked < 60 && p < 400; p++) {
      const seed = (20261106 ^ (p * 2654435761)) >>> 0 || 1;
      const deal = leagueDealFor(seed, 6, 'plo4');
      if (dealMeetsCondition('omaha_river_trips', deal.holes[0], deal.board)) continue;
      const play = (on: boolean) =>
        playHand(
          seed,
          (p % 6) + 1,
          () => ({ v55OmahaRiverTripsFlat: on }),
          undefined,
          HorseMind.createSandbox(),
          'plo4',
          6,
          100,
          undefined,
          () => ({}),
          field
        )[0];
      expect(play(true), `deal ${p}`).toBe(play(false));
      checked++;
    }
    expect(checked).toBe(60);
  });

  it('reaches the V55 spot that self-play never reaches, with legal pot-limit play', () => {
    const r = runSpotConditionedMatchup(
      {
        name: 'test_plo4_v55',
        variant: 'plo4',
        a: { v55OmahaRiverTripsFlat: true },
        b: {},
        opponentPopulation: HUMAN_CALIBRATED_OMAHA_DEV_POPULATION_ID,
        condition: 'omaha_river_trips',
      },
      300,
      20261106
    );
    expect(r.conditionedPairs).toBe(300);
    expect(r.classRate).toBeGreaterThan(0.02);
    expect(r.classRate).toBeLessThan(0.5);
    expect(r.illegalActions).toBe(0);
    expect(r.truncatedStreets).toBe(0);
  });

  it('keeps the Omaha development field off the nightly card and the NLH field NLH-only', () => {
    expect(HUMAN_FIELD_VARIANTS).toEqual(['nlh']);
    expect(leagueFieldVariants(HUMAN_CALIBRATED_OMAHA_DEV_POPULATION_ID)).toEqual([
      'plo4',
      'plo5',
      'plo6',
    ]);
    for (const m of LEAGUE_MATCHUPS)
      expect(m.opponentPopulation, m.name).not.toBe(HUMAN_CALIBRATED_OMAHA_DEV_POPULATION_ID);
  });
});
