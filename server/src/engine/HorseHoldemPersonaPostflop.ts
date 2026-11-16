/**
 * HOLD'EM PERSONA POSTFLOP (2026-11-15, Hold'em Strategy lane; persona promises P17 and P21, postflop half).
 * Option holdemPersonaPostflop, read only as === true, default OFF.
 *
 * Until now three V87 postflop mixes were the same for every Horse or read only one persona figure:
 *  - the out-of-position flop check-trap and the flop check-raise into a stabber used a fleet mix of 0.42 and never
 *    read the persona's trapFrequency (P17, recorded PARTIAL);
 *  - the Nit Hunter was a label: nothing made it stab capped checked ranges more than the others (P21);
 *  - the heads-up in-position dry-flop range continuation bet was one frequency for all four archetypes.
 *
 * These pure helpers turn the EXISTING persona (HorsePersona.holdemPersonaFor, never edited here) into bounded
 * multipliers on those EXISTING thresholds. No new draw is taken: each site still compares its own per-spot unit
 * (v87SpotUnit, P20), so with the option off nothing is read and the decision is exactly what it was, and with it
 * on the random stream is where it was.
 *
 * FLEET AVERAGE PRESERVED under the id model (archetype shares 25 / 20 / 40 / 15):
 *  - trap: trapFrequency over its model mean, so the mean scale is 1;
 *  - cbet and stab: fixed archetype points whose share-weighted mean is exactly 1.
 * The two bluffing multipliers (cbet, stab) never exceed 1 against an opponent the style read classifies as tight.
 */
import { holdemPersonaFor, type HorseHoldemArchetype } from './HorsePersona.js';

/** Share-weighted mean of trapFrequency under the id model: 0.25*0.26 + 0.20*0.45 + 0.40*0.30 + 0.15*0.24. */
export const HOLDEM_MODEL_MEAN_TRAP_FREQUENCY = 0.311;

/** Range continuation-bet frequency by archetype. Share-weighted mean 1 (0.28 + 0.188 + 0.4 + 0.132). */
export const HOLDEM_PERSONA_CBET_SCALE: Readonly<Record<HorseHoldemArchetype, number>> =
  Object.freeze({
    lag_shark: 1.12,
    tricky_trap: 0.94,
    tag_crusher: 1.0,
    nit_hunter: 0.88,
  });

/** Stab at a capped checked range (turn takeaway) by archetype. Share-weighted mean 1 (0.25 + 0.18 + 0.375 + 0.195). */
export const HOLDEM_PERSONA_STAB_SCALE: Readonly<Record<HorseHoldemArchetype, number>> =
  Object.freeze({
    lag_shark: 1.0,
    tricky_trap: 0.9,
    tag_crusher: 0.9375,
    nit_hunter: 1.3,
  });

/** The fleet check-trap / check-raise mix the two trap sites used before, and the bound a persona may reach. */
export const HOLDEM_PERSONA_TRAP_BASE = 0.42;
export const HOLDEM_PERSONA_TRAP_MAX = 0.72;

export interface HoldemPersonaPostflopScales {
  readonly archetype: HorseHoldemArchetype;
  /** multiplier on the range continuation-bet threshold */
  readonly cbet: number;
  /** multiplier on the turn takeaway (stab) threshold */
  readonly stab: number;
  /** the check-trap / check-raise threshold itself (replaces the fleet 0.42) */
  readonly trap: number;
}

/**
 * The persona's postflop scales. `tightOpponent`: an opponent in the hand is read as tight by the style read, so
 * the two bluffing multipliers are held at 1 or below (the persona never bluffs a tight player more).
 */
export function holdemPersonaPostflopScales(
  horseId: string,
  tightOpponent: boolean
): HoldemPersonaPostflopScales {
  const persona = holdemPersonaFor(horseId);
  const cbet = HOLDEM_PERSONA_CBET_SCALE[persona.archetype];
  const stab = HOLDEM_PERSONA_STAB_SCALE[persona.archetype];
  const trap = Math.min(
    HOLDEM_PERSONA_TRAP_MAX,
    HOLDEM_PERSONA_TRAP_BASE * (persona.trapFrequency / HOLDEM_MODEL_MEAN_TRAP_FREQUENCY)
  );
  return Object.freeze({
    archetype: persona.archetype,
    cbet: tightOpponent ? Math.min(1, cbet) : cbet,
    stab: tightOpponent ? Math.min(1, stab) : stab,
    trap,
  });
}
