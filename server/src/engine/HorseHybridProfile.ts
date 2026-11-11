/**
 * Owner-directed Hybrid v1 (2026-11-04): Pebbles' Grinder cash profile and
 * Flint's Tricky tournament profile. These are starting profiles, not a
 * promise of profit. The shared variant brain still owns every action.
 *
 * A single legacy dial cannot tune two different games. Preserve authored
 * persona and diagnostic counts, but take all four decision dials from the
 * mode's immutable source profile.
 *
 * Owner direction (2026-11-05, verbatim): "YOU NEED TO HAVE CHANGED ALL 1000
 * HORSES TO THE NEW 'HYBRID' STYLE HORSE AND RETIRE ALL OTHER 'STYLES
 * ASSIGNED TO THOSE HORSES' AND ACTIVATE THE NEW 'HYBRID' TO ALL OF THEM."
 * Every horse row now carries horse_profile.style = 'hybrid' (the retired
 * persona is kept under horse_profile.retiredStyle for history), and every
 * live assignment path writes 'hybrid'. The stored style never picks the
 * decision profile: the game mode does, exactly as before, so a 'hybrid' row
 * resolves to the same cash (grinder/pebbles) or tournament (tricky/flint)
 * dials a legacy row did.
 */
import { resolveHorseStyle, type HorseProfileMods } from './HorseLogic.js';
import {
  defaultPersonaFor,
  indifferenceStyleSeedsFor,
  PERSONA_DEFAULT,
  type HorseIndifferenceStyleSeeds,
  type HorsePersonaV2,
} from './HorsePersona.js';
import { HORSE_ASSIGNED_STYLE, type HorseStyle } from '../types.js';

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

/** The style written to every horse; its decision profile comes from the mode. */
export const HORSE_HYBRID_STYLE: HorseStyle = HORSE_ASSIGNED_STYLE;

/** The mode profile a stored 'hybrid' style plays. Same answer for every row. */
export function horseHybridModeStyle(mode: HorseHybridMode): HorseStyle {
  const selected = Object.hasOwn(HORSE_HYBRID_PROFILES, mode)
    ? HORSE_HYBRID_PROFILES[mode]
    : undefined;
  if (!selected) throw new Error('Horse hybrid requires an explicit cash or tournament mode');
  return selected.style;
}

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

/**
 * Effective solver adherence for live decision execution:
 * Every Hybrid v1 horse (`mods.referenceNlhOpenings === true`, i.e. 100% of
 * Cash & Tournament horses across the 1,000-horse fleet) executes at full
 * solver adherence (`1`), even if a legacy DB row retained `gtoAdherence < 1`.
 * Non-hybrid standalone test callers without `referenceNlhOpenings` retain
 * their explicit `mods.persona.gtoAdherence`.
 */
export function resolveHorseHybridSolverAdherence(mods: HorseProfileMods | undefined): number {
  if (mods?.referenceNlhOpenings === true) return 1;
  return mods?.persona?.gtoAdherence ?? PERSONA_DEFAULT.gtoAdherence;
}

export interface HorseHybridExecutionProfile {
  readonly style: HorseStyle;
  readonly mods: HorseProfileMods;
  readonly persona: HorsePersonaV2;
  readonly gtoAdherence: 1;
  readonly indifferenceSeeds: HorseIndifferenceStyleSeeds;
}

/**
 * Resolves the complete live Hybrid v1 execution profile for any horse in the
 * 1,000-horse fleet: guarantees `gtoAdherence === 1` in both cash and tournament
 * modes while attaching deterministic EV-bounded (±0.12 BB) indifference seeds.
 */
export function resolveHorseHybridExecutionProfile(
  profile: unknown,
  horseId: string,
  mode: HorseHybridMode
): HorseHybridExecutionProfile {
  const resolved = resolveHorseHybridProfile(profile, horseId, mode);
  const basePersona = resolved.mods.persona ?? defaultPersonaFor(horseId);
  const persona: HorsePersonaV2 = { ...basePersona, gtoAdherence: 1 };
  return {
    style: resolved.style,
    mods: { ...resolved.mods, persona },
    persona,
    gtoAdherence: 1,
    indifferenceSeeds: indifferenceStyleSeedsFor(horseId, mode),
  };
}
