/**
 * THE OMAHA MAPPING of the Horse's playing style (HorsePlayStyle.ts), PLO4 and
 * PLO5 cash, high only. Option `horsePlayStyles`, default OFF.
 *
 * Owner 2026-11-15 16:40 and 16:42 America/Chicago: three winning styles, one
 * tight, one exactly as now, one other, assigned to each Horse at random.
 *
 * A style is ONLY a bounded scale on a frequency or a bar the brain already
 * has. It adds no action and no bet size, and it acts BEFORE the owner-ruled
 * chain (omahaOwnBetRules, omahaOwnerRuledFinal, omahaTurnRiverRaiseNeedsNuts,
 * omahaNoDrawRaiseOutOfPosition, omahaOopTurnCheckAfterFlopCall, the 3-bet and
 * 4-bet range options, omahaNoCallColdFourBetWithoutPremium): those rules read
 * the decision the styled brain produced and stay final for every style.
 *
 *   tight     tight-AGGRESSIVE: the preflop entry bars higher (fewer first-in
 *             hands, fewer calls), the value 3-bet and 4-bet bars as today,
 *             fewer bluffs on every street, the TAG Crusher gears (or the
 *             Horse's own Nit Hunter gears). Sizes unchanged.
 *   current   nothing: no scale is applied and the Horse keeps its archetype.
 *   pressure  IN POSITION only (cutoff and button before the flop; last to act
 *             after it): lower preflop bars, more bluff volume and raise
 *             aggression, more continuation bets, the LAG Shark gears (more
 *             3-bets with the elite coordinated class, more turn probes, more
 *             combo-draw pressure).
 *             Out of position it is the current style exactly.
 *
 * Bounds: every multiplier lies in [0.75, 1.25] (OMAHA_PLAY_STYLE_MUL_MIN and
 * _MAX, asserted by test). The archetype gears are today's four bands, not
 * new numbers: the style only chooses which existing band the Horse reads.
 *
 * Pure. NEVER refer to the horses as "bots" - they are HORSES only.
 */
import {
  ploArchetypeFor,
  ploPersonaOfArchetype,
  type HorsePloArchetype,
  type HorsePloPersona,
} from './HorsePersona.js';
import type { HorsePlayStyle } from './HorsePlayStyle.js';

export const OMAHA_PLAY_STYLE_MUL_MIN = 0.75;
export const OMAHA_PLAY_STYLE_MUL_MAX = 1.25;

/** The games this mapping covers. Hi-lo, PLO6, bomb pots, All-In-Or-Fold and heads-up tables are not mapped. */
export const OMAHA_PLAY_STYLE_VARIANTS: readonly string[] = ['plo4', 'plo5'];

/**
 * The tight style's VPIP at a six-seat 100 bb cash table with no floor, in
 * percent, rounded down. Measured 2026-11-15 in the league harness (three
 * tight seats against today's brain, the live Hybrid profile, the 27 sealed
 * options on, 1,500 mirrored pairs, seed 5570001): PLO4 23.6% over 8,691
 * dealt hands (today's brain 26.8%), PLO5 24.2% over 8,710 (today's brain
 * 27.4%). A table whose VPIP floor is above this sends the tight Horse to the
 * current style; the floors in use are 30 and 50.
 */
export const OMAHA_TIGHT_EXPECTED_VPIP_PCT: Readonly<Record<string, number>> = {
  plo4: 23,
  plo5: 24,
};

/** The scales one decision applies. All 1 = today's play. */
export interface OmahaPlayStyleDials {
  /** On StyleParams.tightness for the ENTRY bars: first-in, limp, cold call, call of a re-raise. */
  tightnessMul: number;
  /** On StyleParams.tightness for the VALUE re-raise bars (3-bet and 4-bet). */
  valueRaiseTightnessMul: number;
  /** On StyleParams.bluffFreq: bluff and semi-bluff frequency, every street. */
  bluffFreqMul: number;
  /** On StyleParams.aggression: 3-bet bars, raise and barrel frequency. */
  aggressionMul: number;
  /** On the continuation-bet frequency (decidePostflop cbetFreqMult: the dry-board c-bet and barrel without a made hand). */
  cbetFreqMul: number;
}

export const OMAHA_PLAY_STYLE_NEUTRAL: OmahaPlayStyleDials = Object.freeze({
  tightnessMul: 1,
  valueRaiseTightnessMul: 1,
  bluffFreqMul: 1,
  aggressionMul: 1,
  cbetFreqMul: 1,
});

/** tight, any position, before the flop. */
export const OMAHA_TIGHT_PREFLOP: OmahaPlayStyleDials = Object.freeze({
  tightnessMul: 1.15,
  // Tight-AGGRESSIVE: the strong hands re-raise exactly as today.
  valueRaiseTightnessMul: 1,
  bluffFreqMul: 0.8,
  aggressionMul: 1,
  cbetFreqMul: 1,
});
/** tight, any position, after the flop. Tightness is a preflop dial and is not read there. */
export const OMAHA_TIGHT_POSTFLOP: OmahaPlayStyleDials = Object.freeze({
  tightnessMul: 1,
  valueRaiseTightnessMul: 1,
  bluffFreqMul: 0.8,
  aggressionMul: 1,
  cbetFreqMul: 1,
});
/** pressure, cutoff and button, before the flop. */
export const OMAHA_PRESSURE_PREFLOP_IP: OmahaPlayStyleDials = Object.freeze({
  tightnessMul: 0.75,
  valueRaiseTightnessMul: 0.9,
  bluffFreqMul: 1.2,
  aggressionMul: 1.1,
  cbetFreqMul: 1,
});
/** pressure, last to act, after the flop. */
export const OMAHA_PRESSURE_POSTFLOP_IP: OmahaPlayStyleDials = Object.freeze({
  tightnessMul: 1,
  valueRaiseTightnessMul: 1,
  bluffFreqMul: 1.25,
  aggressionMul: 1.2,
  cbetFreqMul: 1.25,
});

const bounded = (d: OmahaPlayStyleDials): OmahaPlayStyleDials => {
  const c = (x: number): number =>
    Number.isFinite(x)
      ? Math.max(OMAHA_PLAY_STYLE_MUL_MIN, Math.min(OMAHA_PLAY_STYLE_MUL_MAX, x))
      : 1;
  return {
    tightnessMul: c(d.tightnessMul),
    valueRaiseTightnessMul: c(d.valueRaiseTightnessMul),
    bluffFreqMul: c(d.bluffFreqMul),
    aggressionMul: c(d.aggressionMul),
    cbetFreqMul: c(d.cbetFreqMul),
  };
};

/** Is this table one the Omaha mapping covers? (The cash, depth and floor rules are HorsePlayStyle's.) */
export function omahaPlayStyleMapped(table: {
  gameVariant?: string;
  isOmaha: boolean;
  isHiLo: boolean;
  allInOrFold?: boolean;
  bombPot?: boolean;
  dealtSeats: number;
}): boolean {
  return (
    table.isOmaha &&
    !table.isHiLo &&
    OMAHA_PLAY_STYLE_VARIANTS.includes(String(table.gameVariant ?? '')) &&
    table.allInOrFold !== true &&
    table.bombPot !== true &&
    table.dealtSeats >= 3
  );
}

/**
 * Before the flop. `late` is the cutoff or the button (PreflopPosition
 * 'late'): the only seats where the pressure style differs from current.
 */
export function omahaPlayStylePreflopDials(
  style: HorsePlayStyle,
  late: boolean
): OmahaPlayStyleDials {
  if (style === 'tight') return bounded(OMAHA_TIGHT_PREFLOP);
  if (style === 'pressure' && late) return bounded(OMAHA_PRESSURE_PREFLOP_IP);
  return OMAHA_PLAY_STYLE_NEUTRAL;
}

/** After the flop. `inPosition`: no live opponent acts after the Horse. */
export function omahaPlayStylePostflopDials(
  style: HorsePlayStyle,
  inPosition: boolean
): OmahaPlayStyleDials {
  if (style === 'tight') return bounded(OMAHA_TIGHT_POSTFLOP);
  if (style === 'pressure' && inPosition) return bounded(OMAHA_PRESSURE_POSTFLOP_IP);
  return OMAHA_PLAY_STYLE_NEUTRAL;
}

/**
 * The archetype whose gears this decision reads. current, and pressure out of
 * position: the Horse's own. tight: its own when that is TAG Crusher or Nit
 * Hunter, otherwise TAG Crusher. pressure in position: LAG Shark.
 */
export function omahaPlayStyleArchetype(
  horseId: string,
  style: HorsePlayStyle,
  inPosition: boolean
): HorsePloArchetype {
  const own = ploArchetypeFor(horseId);
  if (style === 'tight') return own === 'tag_crusher' || own === 'nit_hunter' ? own : 'tag_crusher';
  if (style === 'pressure' && inPosition) return 'lag_shark';
  return own;
}

/**
 * The persona gears of this decision (ploPersonaFor when the style is
 * current). Tight keeps the higher of its own and the band's elite re-raise
 * mix: the strong coordinated hands re-raise at least as often as today.
 */
export function omahaPlayStylePersona(
  horseId: string,
  style: HorsePlayStyle,
  inPosition: boolean
): HorsePloPersona {
  const persona = ploPersonaOfArchetype(
    horseId,
    omahaPlayStyleArchetype(horseId, style, inPosition)
  );
  if (style !== 'tight') return persona;
  const own = ploPersonaOfArchetype(horseId, ploArchetypeFor(horseId));
  return { ...persona, plo3BetMix: Math.max(persona.plo3BetMix, own.plo3BetMix) };
}

/**
 * The aggression tie-break of the EV engine (HorsePersona
 * indifferenceAggressionBias, a per-Horse seed in -0.12..+0.12 BB that acts
 * only among candidates within 0.12 BB of the best). The pressure style in
 * position reads the top of that existing range, so between a bet and a check
 * the engine prices as equal it bets. Every other case: undefined, the
 * Horse's own seed.
 */
export const OMAHA_PRESSURE_IP_INDIFFERENCE_AGGRESSION_BIAS = 0.12;
export function omahaPlayStyleIndifferenceAggressionBias(
  style: HorsePlayStyle,
  inPosition: boolean
): number | undefined {
  return style === 'pressure' && inPosition
    ? OMAHA_PRESSURE_IP_INDIFFERENCE_AGGRESSION_BIAS
    : undefined;
}
