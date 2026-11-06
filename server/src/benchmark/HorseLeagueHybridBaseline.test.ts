/**
 * 2026-11-06: hybridBaseline seats every horse on the style and dials
 * production serves (HORSE_HYBRID_PROFILES, #9595), so an opt-in arm can be
 * measured against the brain the fleet actually plays. The arms must still
 * differ only in their flags.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { runMatchup } from './HorseLeague.js';
import { HorseLogic } from '../engine/HorseLogic.js';
import { HORSE_HYBRID_PROFILES } from '../engine/HorseHybridProfile.js';
import { HUMAN_CALIBRATED_POPULATION_ID } from './HumanCalibratedPopulation.js';

afterEach(() => vi.restoreAllMocks());

describe('HorseLeague hybridBaseline', { timeout: 60_000 }, () => {
  it('plays every horse on the cash Hybrid style and dials on a cash card', async () => {
    const spy = vi.spyOn(HorseLogic, 'decide');
    await runMatchup({ name: 'hybrid_cash', a: {}, b: {}, hybridBaseline: true }, 4, 11);
    expect(spy.mock.calls.length).toBeGreaterThan(0);
    for (const call of spy.mock.calls) {
      expect(call[2]).toBe(HORSE_HYBRID_PROFILES.cash.style);
      expect(call[3]).toMatchObject(HORSE_HYBRID_PROFILES.cash.mods);
    }
  });

  it('plays the tournament Hybrid on a tournament card and keeps arm dials on top', async () => {
    const spy = vi.spyOn(HorseLogic, 'decide');
    await runMatchup(
      {
        name: 'hybrid_mtt',
        a: {},
        b: {},
        hybridBaseline: true,
        modsA: { tightness: 1.1 },
        context: {
          gameMode: 'tournament',
          format: 'mtt',
          ante: 0,
          tournament: {
            schemaVersion: 1,
            contextStatus: 'complete',
            contextIssues: [],
            playersLeft: 180,
            spotsPaid: 30,
            entrants: 300,
            avgStackChips: 200,
            medianStackChips: 200,
            seatsPerTable: 6,
            nearBubble: false,
            inMoney: false,
            payoutPct: [30, 20, 14, 10, 8, 6, 4, 3, 3, 2],
            currentSmallBlind: 1,
            currentBigBlind: 2,
            currentAnte: 0,
            anteType: 'none',
            nextSmallBlind: 2,
            nextBigBlind: 4,
            nextAnte: 0,
            nextBlindInMin: 10,
          },
        },
      },
      4,
      11
    );
    expect(spy.mock.calls.length).toBeGreaterThan(0);
    const tightness = new Set<number | undefined>();
    for (const call of spy.mock.calls) {
      expect(call[2]).toBe(HORSE_HYBRID_PROFILES.tournament.style);
      expect(call[3]?.aggression).toBe(HORSE_HYBRID_PROFILES.tournament.mods.aggression);
      tightness.add(call[3]?.tightness);
    }
    expect([...tightness].sort()).toEqual(
      [HORSE_HYBRID_PROFILES.tournament.mods.tightness, 1.1].sort()
    );
  });

  it('measures exactly zero when both arms are the same brain', async () => {
    const r = await runMatchup({ name: 'hybrid_self', a: {}, b: {}, hybridBaseline: true }, 60, 5);
    expect(r.bb100).toBe(0);
    expect(r.divergentPairs).toBe(0);
    expect(r.illegalActions).toBe(0);
  });

  it('refuses a combination it cannot honour instead of ignoring the option', async () => {
    await expect(
      runMatchup({ name: 'x', a: {}, b: {}, hybridBaseline: true, productionStyles: true }, 1, 1)
    ).rejects.toThrow(/productionStyles/);
    await expect(
      runMatchup(
        {
          name: 'y',
          a: {},
          b: {},
          hybridBaseline: true,
          opponentPopulation: HUMAN_CALIBRATED_POPULATION_ID,
        },
        1,
        1
      )
    ).rejects.toThrow(/human-field/);
  });
});
