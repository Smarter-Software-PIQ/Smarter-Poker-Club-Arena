/**
 * Owner-directed Hybrid v1 (2026-11-04): Pebbles' Grinder cash profile and
 * Flint's Tricky tournament profile. These are starting profiles, not a
 * promise of profit. The shared variant brain still owns every action.
 *
 * A single legacy dial cannot tune two different games. Preserve authored
 * persona and diagnostic counts, but take all four decision dials from the
 * mode's immutable source profile. No database rewrite or nightly repair.
 */
import { resolveHorseStyle, type HorseProfileMods } from './HorseLogic.js';
import type { HorseStyle } from '../types.js';

export type HorseHybridMode = 'cash' | 'tournament';
export const HORSE_HYBRID_VERSION = 'horse-hybrid-v1-20261104';

type HybridDials = Required<
  Pick<
    HorseProfileMods,
    'tightness' | 'aggression' | 'bluffFreq' | 'sizingMultiplier' | 'referenceNlhOpenings'
  >
>;
interface HybridProfile {
  readonly style: HorseStyle;
  readonly donor: string;
  readonly mods: Readonly<HybridDials>;
}

export const HORSE_HYBRID_PROFILES: Readonly<Record<HorseHybridMode, HybridProfile>> =
  Object.freeze({
    cash: Object.freeze({
      style: 'grinder',
      donor: 'pebbles',
      mods: Object.freeze({
        tightness: 0.98,
        aggression: 1.18,
        bluffFreq: 0.91,
        sizingMultiplier: 0.94,
        referenceNlhOpenings: true,
      }),
    }),
    tournament: Object.freeze({
      style: 'tricky',
      donor: 'flint',
      mods: Object.freeze({
        tightness: 1.02,
        aggression: 1.04,
        bluffFreq: 1.055,
        sizingMultiplier: 0.94,
        referenceNlhOpenings: true,
      }),
    }),
  });

/** Explicit game mode is required; a missing mode must never become cash. */
export function resolveHorseHybridProfile(
  profile: unknown,
  horseId: string,
  mode: HorseHybridMode
): { style: HorseStyle; mods: HorseProfileMods } {
  const selected = Object.hasOwn(HORSE_HYBRID_PROFILES, mode)
    ? HORSE_HYBRID_PROFILES[mode]
    : undefined;
  if (!selected) throw new Error('Horse hybrid requires an explicit cash or tournament mode');
  const { mods } = resolveHorseStyle(profile, horseId);
  return { style: selected.style, mods: { ...mods, ...selected.mods } };
}

/** Worker-side evidence: emitted only after these actual inputs ran the brain. */
export function horseHybridDecisionMatches(
  mode: unknown,
  style: unknown,
  mods: HorseProfileMods | undefined
): boolean {
  if (mode !== 'cash' && mode !== 'tournament') return false;
  const expected = HORSE_HYBRID_PROFILES[mode];
  if (style !== expected.style || !mods) return false;
  if (mods.referenceNlhOpenings !== true) return false;
  for (const key of ['tightness', 'aggression', 'bluffFreq', 'sizingMultiplier'] as const) {
    if (mods[key] !== expected.mods[key]) return false;
  }
  return true;
}
