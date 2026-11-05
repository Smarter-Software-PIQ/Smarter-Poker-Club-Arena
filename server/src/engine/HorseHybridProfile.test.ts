import { describe, expect, it } from 'vitest';
import {
  HORSE_HYBRID_PROFILES,
  resolveHorseHybridProfile,
  horseHybridDecisionMatches,
} from './HorseHybridProfile.js';

const cash = {
  tightness: 0.98,
  aggression: 1.18,
  bluffFreq: 0.91,
  sizingMultiplier: 0.94,
  referenceNlhOpenings: true as const,
};
const tournament = {
  tightness: 1.02,
  aggression: 1.04,
  bluffFreq: 1.055,
  sizingMultiplier: 0.94,
  referenceNlhOpenings: true as const,
};

describe('owner-directed game-specific Horse Hybrid v1', () => {
  it.each(['tag', 'lag', 'balanced', 'tricky', 'grinder', 'maniac', null])(
    'routes every legacy %s profile to both distinct modes',
    (style) => {
      const profile = {
        style,
        tightness: 1.5,
        aggression: 0.6,
        bluffFreq: 1.4,
        sizingMultiplier: 1.5,
      };
      expect(resolveHorseHybridProfile(profile, 'horse-a', 'cash')).toMatchObject({
        style: 'grinder',
        mods: cash,
      });
      expect(resolveHorseHybridProfile(profile, 'horse-a', 'tournament')).toMatchObject({
        style: 'tricky',
        mods: tournament,
      });
    }
  );

  it.each([undefined, null, {}, 'nit', 42, []])(
    'a missing or legacy profile still receives the complete mode profile',
    (profile) => {
      expect(resolveHorseHybridProfile(profile, 'new-horse', 'cash')).toMatchObject({
        style: 'grinder',
        mods: cash,
      });
      expect(resolveHorseHybridProfile(profile, 'new-horse', 'tournament')).toMatchObject({
        style: 'tricky',
        mods: tournament,
      });
    }
  );

  it('preserves authored persona and diagnostics without changing the stored profile', () => {
    const profile = {
      style: 'lag',
      persona: { straddleRate: 0.2, gtoAdherence: 0.9 },
      leaks: { river_raise_war: 2 },
      leaksHands: 100,
      aggression: 1.5,
    };
    const before = structuredClone(profile);
    for (const mode of ['cash', 'tournament'] as const) {
      const out = resolveHorseHybridProfile(profile, 'horse-a', mode);
      expect(out.mods.persona).toEqual(profile.persona);
      expect(out.mods.leaks).toEqual(profile.leaks);
      expect(out.mods.leaksHands).toBe(100);
    }
    expect(profile).toEqual(before);
  });

  it('legacy tuner writes cannot change either game or contaminate the other mode', () => {
    const first = resolveHorseHybridProfile({ aggression: 0.85, tightness: 1.18 }, 'h', 'cash');
    const next = resolveHorseHybridProfile({ aggression: 1.18, tightness: 0.85 }, 'h', 'cash');
    expect(first).toEqual(next);
    const tourney = resolveHorseHybridProfile({ aggression: 1.18 }, 'h', 'tournament');
    expect(tourney.mods).toMatchObject(tournament);
    first.mods.aggression = 0.6;
    expect(resolveHorseHybridProfile(null, 'h', 'cash').mods).toMatchObject(cash);
    expect(Object.isFrozen(HORSE_HYBRID_PROFILES.cash.mods)).toBe(true);
  });

  it.each([undefined, null, '', 'spin', 'constructor'])('refuses ambiguous mode %s', (mode) => {
    expect(() => resolveHorseHybridProfile({}, 'h', mode as never)).toThrow(/explicit/);
  });

  it('evidence requires the correct mode, style and every actual dial', () => {
    expect(horseHybridDecisionMatches('cash', 'grinder', cash)).toBe(true);
    expect(horseHybridDecisionMatches('tournament', 'tricky', tournament)).toBe(true);
    expect(horseHybridDecisionMatches('tournament', 'grinder', cash)).toBe(false);
    expect(horseHybridDecisionMatches(undefined, 'grinder', cash)).toBe(false);
    for (const dial of ['tightness', 'aggression', 'bluffFreq', 'sizingMultiplier'] as const) {
      expect(horseHybridDecisionMatches('cash', 'grinder', { ...cash, [dial]: 1 })).toBe(false);
    }
    expect(
      horseHybridDecisionMatches('cash', 'grinder', { ...cash, referenceNlhOpenings: undefined })
    ).toBe(false);
  });
});
