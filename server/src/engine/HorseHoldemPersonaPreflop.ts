/**
 * HOLD'EM PERSONA PREFLOP (2026-11-15, option holdemPersonaPreflop, default
 * OFF). The persona layer that completes the Hold'em archetype promises of
 * the elite strategy plan (PLAN L85, L152) as one option:
 *
 *  1. Ordinary 3-bets and squeezes seeded per hand + persona. The option turns
 *     on the persona re-raise mix (holdemPersonaReRaiseMix, PR #10791): the
 *     3-bet bluff and the squeeze bluff decide on the Horse's own zero-draw
 *     unit (Horse id, table id and hand number, exact hole cards, a salt per
 *     behaviour) against the bluff probability scaled by the persona's
 *     nlh3BetMix. Value 3-bets are bar membership, not a mix, and are not
 *     touched. Shallow four-bet reshoves are NOT persona-specific (owner
 *     decision R3-B, 2026-11-13).
 *  2. Per-archetype nine-seat cash VPIP bands (PLAN L152: LAG about 29-31,
 *     Tricky about 27-29, TAG about 26-28, Nit Hunter about 25-27) through a
 *     fixed shift of the seat's OPENING SHARE and of the defender's CONTINUE
 *     SHARE, in hand-share points, applied in share space before the share is
 *     turned into a score bar. The Hybrid protection (calibrated opening
 *     widths are never multiplied by a per-Horse tightness:
 *     HorseLogic `nlhOpeningTightness = 1` under `referenceNlhOpenings`) is
 *     not touched: no tightness multiplier is read or written here.
 *  3. The described Nit Hunter behaviour, preflop half: "punishes loose
 *     openers / limpers" (HorsePersona.ts archetype comment). Against a
 *     credibly wide opener or a credibly loose limper (the existing exploit
 *     reads; never a presumed read), a Nit Hunter stops tightening and
 *     attacks: its opening (isolation) share shift becomes +2 points and its
 *     continue shift 0 (it plays the fleet's continue range there). The
 *     "stabs capped checked ranges" half is postflop and is not built here.
 *
 * Pure arithmetic on bars and scales: no random draw is added, removed or
 * moved. No realised frequency is read and nothing is steered toward a band.
 */
import { holdemPersonaFor, type HorseHoldemArchetype } from './HorsePersona.js';
import { scoreAtShare, shareAtScore, v85DepthWeight } from './HorseGtoOpeningRanges.js';

/** Hand-share points added to the opening share and to the continue share. */
export interface HoldemPersonaRangeShift {
  openPts: number;
  continuePts: number;
}

/**
 * The per-archetype shift (requirement map Deliverable 3, measured there at
 * nine seats 100bb: LAG 30.61, Tricky 28.16, TAG 27.08, Nit 26.31 VPIP).
 * Most of the LAG width is in opens (initiative), most of the TAG and Nit
 * tightening in flats.
 */
export const HOLDEM_PERSONA_RANGE_SHIFT: Readonly<
  Record<HorseHoldemArchetype, HoldemPersonaRangeShift>
> = {
  lag_shark: { openPts: 4, continuePts: 1.5 },
  tricky_trap: { openPts: 0, continuePts: 0 },
  tag_crusher: { openPts: -1, continuePts: -2 },
  nit_hunter: { openPts: -3, continuePts: -3 },
};

/** PLAN L152: nine-seat cash VPIP band per archetype, percent (the targets). */
export const HOLDEM_PERSONA_VPIP_BAND: Readonly<
  Record<HorseHoldemArchetype, readonly [number, number]>
> = {
  lag_shark: [29, 31],
  tricky_trap: [27, 29],
  tag_crusher: [26, 28],
  nit_hunter: [25, 27],
};

/** A Nit Hunter facing a credibly loose opener or limper. */
export const NIT_HUNTER_PUNISH_SHIFT: HoldemPersonaRangeShift = { openPts: 2, continuePts: 0 };

export interface HoldemPersonaRange {
  archetype: HorseHoldemArchetype;
  shift: HoldemPersonaRangeShift;
  /** A negative shift was withheld because the table has a VPIP floor. */
  floorHeld: boolean;
  /** The Nit Hunter's punish rule replaced its shift. */
  punishing: boolean;
}

/**
 * The persona's range shift for one decision. `vpipFloored`: the table runs
 * a Classic VPIP floor; there no shift may narrow a range (the persona never
 * pushes a Horse toward the floor), so negative points become 0.
 * `punishLoose`: the existing reads say the opener (one raise) or a limper in
 * front is credibly loose.
 */
export function holdemPersonaRange(
  horseId: string,
  vpipFloored: boolean,
  punishLoose: boolean
): HoldemPersonaRange {
  const archetype = holdemPersonaFor(horseId).archetype;
  const punishing = archetype === 'nit_hunter' && punishLoose;
  const base = punishing ? NIT_HUNTER_PUNISH_SHIFT : HOLDEM_PERSONA_RANGE_SHIFT[archetype];
  if (!vpipFloored || (base.openPts >= 0 && base.continuePts >= 0))
    return { archetype, shift: base, floorHeld: false, punishing };
  return {
    archetype,
    shift: { openPts: Math.max(0, base.openPts), continuePts: Math.max(0, base.continuePts) },
    floorHeld: true,
    punishing,
  };
}

/**
 * The seat's opening share (percent) after the persona's shift. Tapers with
 * the V85 depth weight (exactly the input at 50bb or less, full from 85bb),
 * so short-stack play is unchanged. A zero shift returns the input exactly.
 */
export function holdemPersonaOpenSharePct(
  targetPct: number,
  openPts: number,
  depthBB: number
): number {
  const w = v85DepthWeight(depthBB);
  if (openPts === 0 || w === 0) return targetPct;
  return Math.min(95, Math.max(1, targetPct + openPts * w));
}

/**
 * The defender's continue bar after the persona's shift, moved in share
 * space on the same ladder. Never narrower than the value 3-bet range (the
 * value bar is not moved), never wider than 88 percent of hands. A zero
 * shift, or 50bb or less, returns the bar exactly.
 */
export function holdemPersonaContinueBar(
  continueBar: number,
  valueBar: number,
  continuePts: number,
  depthBB: number
): number {
  const w = v85DepthWeight(depthBB);
  if (continuePts === 0 || w === 0) return continueBar;
  const share = shareAtScore(continueBar);
  const lower = Math.min(share, shareAtScore(valueBar));
  const upper = Math.max(share, 0.88);
  const next = Math.min(upper, Math.max(lower, share + (continuePts * w) / 100));
  return next === share ? continueBar : scoreAtShare(next);
}
