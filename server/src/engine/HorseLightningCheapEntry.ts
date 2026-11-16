/**
 * LIGHTNING CHEAP ENTRY (2026-11-15, options lightningCheapEntryHoldem and
 * lightningCheapEntryOmaha, both DEFAULT OFF, read `=== true`).
 *
 * Owner principle 5 (2026-11-15 11:35 Chicago): "A VPIP floor is met by the
 * cheapest entry (limp, limp-fold), never by raising or putting in large
 * amounts to meet it." Lightning deals a big-blind ante of one big blind, so
 * a small blind that is folded to completes 0.5bb into a pot of 2.5bb, the
 * cheapest entry in the game, and a player behind a limp over-limps for one
 * big blind into a pot of 3.5bb or more. The decision audit recorded 0
 * first-in limps in 789 Lightning first-in decisions.
 *
 * Scope is exactly the Lightning participation predicate
 * (HorseLightningParticipation.lightningParticipationEligibility: Lightning
 * public memory domain, cash, preflop, not all-in-or-fold, NLH / PLO4 / PLO5,
 * four to six dealt, big-blind ante), reused, never forked. Inside it, and
 * only where the unopened branch of the preflop engine has already answered
 * FOLD, this file answers one question: does this hand CALL the cheap entry?
 *
 *  1. Small blind, folded to (only the big blind left, nobody entered).
 *  2. Behind one or more limpers, no raise: the small blind completes, or the
 *     button (no player but the blinds behind it, so in position after the
 *     flop) over-limps.
 *
 * It never raises, never sizes, never touches a raised pot: after a cheap
 * entry that is raised the base policy decides as usual (limp-fold is allowed
 * and expected for the weak part). No seat other than the small blind and the
 * button is ever asked, so it adds no first-in limp from any other seat.
 *
 * THE BAR is a price, not a participation target. The hand calls when its
 * expected share of the pot it buys covers the call:
 *
 *   (1 - r) * R * e_k(hand) * (pot + call + added behind) * (1 - drop) >= call
 *
 *  - e_k: the all-in equity of the hand against k random hands, from the
 *    variant's own table below (Monte Carlo, the brain's own preflop order,
 *    40 bins of equal hand share; generated, not edited:
 *    scripts/generate-lightning-cheap-entry-equity.ts). k is the players who
 *    can see the flop: the big blind, every limper and, for the button, the
 *    small blind. The big blind's range is every hand (a big blind never
 *    folds to a limp); a limper's range is taken as every hand too, which is
 *    the optimistic side for the hero (stated, not measured).
 *  - R: realisation. In position 0.80 (HU_LIMP_REALIZATION, the repo's figure
 *    for the weakest band a seat plays in position); out of position 0.70
 *    (0.1 lower for playing every street first); deeper than 100bb the out
 *    of position figure falls linearly to x0.94 at 200bb. Assumptions, not
 *    measurements.
 *  - r: the chance each player still to act raises the cheap entry, by
 *    variant: the Horses' own big blind facing a small-blind completion in
 *    Lightning raises 29.8% (NLH), 31.2% (PLO4), 36.5% (PLO5) of hands
 *    (measured 2026-11-15 through HorseLogic.decide, balanced persona, six
 *    dealt, 100bb, big-blind ante, 1,000 hands each; 23.8-35.4%, 26.0-35.8%
 *    and 30.5-40.0% across the five personas), taken as 0.30 / 0.31 / 0.37;
 *    a raised cheap entry is taken as lost (limp-fold), the pessimistic side.
 *    (The first development round used 0.18, the heads-up figure in
 *    HorseHuBbDefence; the Lightning measurement replaced it.)
 *  - drop: the rake and jackpot fee share of a pot that sees the flop, the
 *    engine's own callDeductionFraction (0 when the snapshot has none).
 *
 * What the arithmetic gives at the Lightning price (1/2, the engine's rake of
 * 10% capped at 2.5bb with no flop no drop, a jackpot fee of 0.25bb), as a
 * top share of the variant's hands (the base raises its own share first):
 *
 *                              NLH    PLO4   PLO5
 *   small blind folded to,
 *     50 and 100bb             82.5%  100%   77.5%
 *     200bb                    62.5%   95%   45%
 *   small blind behind 1 limp  62.5%   55%   40%   (100bb)
 *   small blind behind 2 limps 45%     45%   25%   (100bb)
 *   button behind 1 or 2 limps  0%      0%    0%   (three or more see the
 *                                                   flop and two can raise)
 *
 * The stated arithmetic, not a target.
 *
 * No input reads the Horse's own participation, its folds or hands since it
 * sat: the bar is a function of the public price, the players in the pot,
 * depth, the variant's table, the hand and the unfloored persona tightness
 * only (`HorseLogic` captures `unflooredTightness` before `vpipFloorMul`).
 * Note: without `lightningEarlyFoldNeedsFoldThrough` (`L-019`) the small blind
 * early-folds at the deal before the pot is folded to it, so this option moves
 * participation materially only alongside `lightningEarlyFoldNeedsFoldThrough`.
 * Opponent reads stay on top: an observed maniac at the table (never the
 * presumption) keeps the base fold.
 */
import { noteFire } from './BrainTelemetry.js';
import {
  lightningObservedManiac,
  lightningParticipationEligibility,
  type LightningParticipationFamily,
  type LightningParticipationTable,
} from './HorseLightningParticipation.js';

/** What the preflop engine receives when an option is on and the hand is in the predicate. */
export interface LightningCheapEntryCtx {
  family: LightningParticipationFamily;
  /** Players still to act behind hero in an unopened pot (button 2, small blind 1), or null. */
  behind: number | null;
  /** A live opponent reads as a maniac on its own record (never the presumption). */
  observedManiac: boolean;
  telemetry: boolean;
}

/**
 * Built once per preflop decision by HorseLogic. Undefined unless an option
 * is on and the shared Lightning predicate holds, so every consumer below is
 * inert otherwise.
 */
export function lightningCheapEntryCtx(
  on: { holdem: boolean; omaha: boolean },
  table: LightningParticipationTable,
  seat: {
    heroUserId: string;
    dealt: number;
    behind: number | null;
    mind: boolean;
    telemetry: boolean;
  }
): LightningCheapEntryCtx | undefined {
  const e = lightningParticipationEligibility(on, table, seat.dealt);
  if (e.state === 'off') return undefined;
  if (e.state === 'refused') {
    if (seat.telemetry) {
      if (e.reason === 'not_lightning')
        noteFire('lightning_cheap_entry_refused_not_lightning_seen');
      else if (e.reason === 'format') noteFire('lightning_cheap_entry_refused_format_seen');
      else if (e.reason === 'variant') noteFire('lightning_cheap_entry_refused_variant_seen');
      else if (e.reason === 'dealt_count')
        noteFire('lightning_cheap_entry_refused_dealt_count_seen');
      else noteFire('lightning_cheap_entry_refused_not_bb_ante_seen');
    }
    return undefined;
  }
  if (seat.telemetry) noteFire('lightning_cheap_entry_eligible_seen');
  return {
    family: e.family,
    behind: seat.behind,
    observedManiac: seat.mind ? lightningObservedManiac(table, seat.heroUserId) : false,
    telemetry: seat.telemetry,
  };
}

// ── The equity tables ─────────────────────────────────────────────────────

/**
 * Per variant, 40 bins of equal hand share in the brain's own preflop order
 * (strongest first). Each row: [strength of the bin's weakest hand, top share
 * at the bin's lower edge, equity per mille against 1, 2, 3, 4, 5 random
 * hands]. Generated, not edited: scripts/generate-lightning-cheap-entry-equity.ts
 * (hold'em: the 169 classes by combos, 6,000 trials each; Omaha: 6,000 random
 * hands, 250 trials each; seed 0x2c1b3c6d).
 */
export const LIGHTNING_CHEAP_ENTRY_EQUITY: Readonly<
  Record<LightningParticipationFamily, ReadonlyArray<readonly number[]>>
> = {
  holdem: [
    [0.93, 0.025, 749, 598, 495, 424, 366],
    [0.79, 0.05, 690, 517, 411, 340, 287],
    [0.72, 0.075, 656, 477, 371, 301, 254],
    [0.66, 0.1, 625, 447, 351, 288, 243],
    [0.58, 0.125, 608, 430, 334, 274, 230],
    [0.56, 0.15, 603, 424, 325, 262, 222],
    [0.52, 0.175, 597, 413, 316, 257, 218],
    [0.48, 0.2, 555, 384, 298, 244, 208],
    [0.43, 0.225, 529, 359, 273, 223, 192],
    [0.402, 0.25, 562, 385, 292, 235, 199],
    [0.39, 0.275, 549, 374, 282, 227, 191],
    [0.38, 0.3, 550, 368, 276, 221, 183],
    [0.37, 0.325, 544, 357, 263, 208, 172],
    [0.35, 0.35, 525, 346, 257, 208, 173],
    [0.34, 0.375, 521, 337, 249, 198, 167],
    [0.284, 0.4, 499, 335, 254, 204, 170],
    [0.27, 0.425, 556, 374, 281, 224, 185],
    [0.255, 0.45, 491, 326, 244, 191, 159],
    [0.24, 0.475, 469, 308, 227, 179, 148],
    [0.226, 0.5, 530, 350, 262, 210, 174],
    [0.224, 0.525, 479, 316, 231, 183, 151],
    [0.212, 0.55, 491, 315, 232, 184, 152],
    [0.2, 0.575, 477, 306, 226, 181, 149],
    [0.196, 0.6, 473, 310, 230, 182, 153],
    [0.192, 0.625, 478, 310, 229, 181, 148],
    [0.185, 0.65, 436, 288, 216, 173, 146],
    [0.178, 0.675, 455, 288, 210, 164, 134],
    [0.174, 0.7, 442, 280, 208, 164, 137],
    [0.162, 0.725, 460, 284, 204, 158, 128],
    [0.15, 0.75, 450, 278, 199, 156, 125],
    [0.106, 0.775, 437, 270, 193, 150, 124],
    [0.092, 0.8, 464, 299, 222, 175, 144],
    [0.078, 0.825, 427, 265, 196, 153, 124],
    [0.07, 0.85, 393, 243, 177, 138, 111],
    [0.064, 0.875, 388, 239, 170, 130, 107],
    [0.06, 0.9, 383, 234, 167, 128, 104],
    [0.056, 0.925, 356, 222, 158, 123, 101],
    [0.05, 0.95, 382, 232, 165, 125, 103],
    [0.044, 0.975, 359, 214, 150, 114, 93],
    [0.036, 1, 402, 240, 166, 128, 102],
  ],
  plo4: [
    [0.93, 0.025, 652, 474, 371, 304, 260],
    [0.838, 0.05, 615, 433, 334, 273, 232],
    [0.73, 0.075, 580, 405, 312, 253, 216],
    [0.678, 0.1, 564, 390, 298, 242, 205],
    [0.608, 0.125, 564, 393, 303, 248, 211],
    [0.573, 0.15, 539, 372, 285, 232, 197],
    [0.538, 0.175, 534, 367, 280, 228, 191],
    [0.485, 0.2, 553, 379, 289, 234, 197],
    [0.44, 0.225, 526, 360, 274, 222, 186],
    [0.408, 0.25, 530, 365, 274, 222, 186],
    [0.402, 0.275, 522, 353, 267, 215, 181],
    [0.382, 0.3, 521, 351, 266, 214, 180],
    [0.37, 0.325, 507, 339, 259, 209, 174],
    [0.354, 0.35, 520, 348, 263, 212, 178],
    [0.34, 0.375, 518, 352, 264, 213, 179],
    [0.305, 0.4, 493, 328, 247, 199, 165],
    [0.284, 0.425, 496, 330, 248, 199, 166],
    [0.26, 0.45, 505, 337, 256, 207, 174],
    [0.24, 0.475, 485, 320, 240, 193, 161],
    [0.225, 0.5, 489, 327, 244, 195, 162],
    [0.212, 0.525, 507, 341, 256, 204, 168],
    [0.212, 0.55, 472, 310, 231, 184, 151],
    [0.198, 0.575, 467, 308, 232, 186, 155],
    [0.188, 0.6, 484, 319, 237, 189, 158],
    [0.185, 0.625, 486, 317, 235, 187, 153],
    [0.176, 0.65, 472, 306, 229, 181, 150],
    [0.163, 0.675, 454, 296, 219, 174, 144],
    [0.163, 0.7, 465, 299, 221, 174, 145],
    [0.141, 0.725, 480, 315, 234, 186, 154],
    [0.141, 0.75, 459, 297, 219, 173, 143],
    [0.106, 0.775, 466, 304, 225, 179, 148],
    [0.092, 0.8, 451, 291, 214, 168, 138],
    [0.072, 0.825, 460, 296, 220, 173, 141],
    [0.066, 0.85, 471, 307, 227, 180, 148],
    [0.06, 0.875, 455, 292, 215, 170, 140],
    [0.056, 0.9, 454, 288, 208, 162, 132],
    [0.05, 0.925, 458, 291, 213, 166, 135],
    [0.044, 0.95, 451, 281, 199, 153, 125],
    [0.036, 0.975, 429, 262, 187, 143, 116],
    [0, 1, 445, 281, 204, 159, 132],
  ],
  plo5: [
    [0.946, 0.025, 622, 449, 354, 299, 261],
    [0.828, 0.05, 589, 411, 319, 265, 229],
    [0.74, 0.075, 578, 407, 314, 260, 223],
    [0.66, 0.1, 572, 399, 308, 252, 216],
    [0.605, 0.125, 555, 384, 297, 242, 207],
    [0.57, 0.15, 549, 377, 290, 238, 200],
    [0.528, 0.175, 537, 367, 279, 228, 190],
    [0.48, 0.2, 538, 369, 279, 226, 190],
    [0.44, 0.225, 527, 360, 275, 224, 188],
    [0.418, 0.25, 521, 355, 271, 220, 184],
    [0.398, 0.275, 512, 349, 264, 213, 178],
    [0.375, 0.3, 522, 355, 272, 219, 183],
    [0.358, 0.325, 502, 343, 256, 206, 172],
    [0.34, 0.35, 507, 341, 255, 202, 166],
    [0.311, 0.375, 517, 344, 260, 207, 174],
    [0.284, 0.4, 511, 342, 257, 206, 172],
    [0.266, 0.425, 495, 334, 247, 198, 162],
    [0.248, 0.45, 496, 334, 253, 202, 169],
    [0.237, 0.475, 481, 318, 237, 187, 151],
    [0.225, 0.5, 495, 333, 250, 198, 164],
    [0.214, 0.525, 490, 326, 243, 193, 160],
    [0.202, 0.55, 498, 331, 247, 195, 161],
    [0.19, 0.575, 489, 323, 238, 187, 151],
    [0.178, 0.6, 488, 322, 239, 190, 157],
    [0.157, 0.625, 485, 323, 240, 192, 161],
    [0.145, 0.65, 489, 321, 239, 192, 159],
    [0.132, 0.675, 495, 328, 245, 196, 164],
    [0.12, 0.7, 482, 316, 233, 186, 153],
    [0.107, 0.725, 475, 311, 229, 181, 150],
    [0.092, 0.75, 470, 304, 224, 179, 150],
    [0.072, 0.775, 464, 297, 217, 171, 142],
    [0.048, 0.8, 457, 296, 216, 169, 141],
    [0.037, 0.825, 456, 294, 214, 168, 139],
    [0.023, 0.85, 425, 265, 191, 148, 120],
    [0.015, 0.875, 458, 293, 214, 168, 137],
    [0.005, 0.9, 450, 289, 211, 166, 135],
    [0, 0.925, 464, 295, 215, 170, 139],
    [0, 0.95, 457, 293, 211, 168, 138],
    [0, 0.975, 449, 288, 212, 166, 138],
    [0, 1, 457, 289, 211, 168, 139],
  ],
};

/** Opponents the tables carry (k = 1..5). */
export const LIGHTNING_CHEAP_ENTRY_MAX_OPPONENTS = 5;
/** Realisation of the cheap entry: in position (the button), out of position (the small blind). */
export const LIGHTNING_CHEAP_ENTRY_REALISATION: Readonly<{
  inPosition: number;
  outOfPosition: number;
}> = { inPosition: 0.8, outOfPosition: 0.7 };
/** Out-of-position realisation at 200bb as a fraction of 100bb (linear from 100bb; none shallower). */
export const LIGHTNING_CHEAP_ENTRY_DEEP_OOP_FACTOR = 0.94;
/** Chance each player still to act raises the cheap entry, by variant (a raised entry is taken as lost). */
export const LIGHTNING_CHEAP_ENTRY_RAISE_PER_PLAYER_BEHIND: Readonly<
  Record<LightningParticipationFamily, number>
> = { holdem: 0.3, plo4: 0.31, plo5: 0.37 };
/** Largest call the option answers, in big blinds (a completion or one limp). */
export const LIGHTNING_CHEAP_ENTRY_MAX_CALL_BB = 1;

const BAR_CAP = 0.95;
const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));

/** The realisation of a cheap entry in or out of position at this depth. */
export function lightningCheapEntryRealisation(inPosition: boolean, depthBB: number): number {
  if (inPosition) return LIGHTNING_CHEAP_ENTRY_REALISATION.inPosition;
  const deep = Number.isFinite(depthBB) ? clamp((depthBB - 100) / 100, 0, 1) : 0;
  return (
    LIGHTNING_CHEAP_ENTRY_REALISATION.outOfPosition *
    (1 - (1 - LIGHTNING_CHEAP_ENTRY_DEEP_OOP_FACTOR) * deep)
  );
}

/**
 * The all-in equity a hand needs for the cheap entry to pay at this price:
 * call / ((1 - r) * R * (pot + call + added behind) * (1 - drop)).
 */
export function lightningCheapEntryRequiredEquity(spot: {
  family: LightningParticipationFamily;
  call: number;
  pot: number;
  /** Chips the players behind add to see the flop (the small blind's completion). */
  addedBehind: number;
  /** Players still to act behind hero. */
  behind: number;
  inPosition: boolean;
  depthBB: number;
  /** Rake and jackpot fee share of the pot (engine callDeductionFraction), 0..1. */
  drop: number;
}): number {
  const r =
    1 -
    Math.pow(
      1 - LIGHTNING_CHEAP_ENTRY_RAISE_PER_PLAYER_BEHIND[spot.family],
      Math.max(0, spot.behind)
    );
  const R = lightningCheapEntryRealisation(spot.inPosition, spot.depthBB);
  const potWon =
    Math.max(0, spot.pot + spot.call + Math.max(0, spot.addedBehind)) *
    (1 - clamp(spot.drop, 0, 1));
  const denom = (1 - r) * R * potWon;
  return denom > 0 ? spot.call / denom : Infinity;
}

/**
 * The strength bar (the brain's own preflop scale, before tightness) at which
 * the hand's equity against `opponents` random hands meets `need`: the
 * strength of the weakest bin such that every bin from the top down to it
 * clears (equity read monotone from the top: a bin never counts above any
 * stronger bin). Null when not even the top bin clears.
 */
export function lightningCheapEntryStrengthBar(
  family: LightningParticipationFamily,
  opponents: number,
  need: number
): number | null {
  const rows = LIGHTNING_CHEAP_ENTRY_EQUITY[family];
  const k = clamp(Math.round(opponents), 1, LIGHTNING_CHEAP_ENTRY_MAX_OPPONENTS);
  let floor = Infinity;
  let bar: number | null = null;
  for (const row of rows) {
    floor = Math.min(floor, row[1 + k]! / 1000);
    if (!(floor >= need)) break;
    bar = row[0]!;
  }
  return bar;
}

/** The top share (0..1) of the variant's hands a cheap entry at this need takes in. */
export function lightningCheapEntryShare(
  family: LightningParticipationFamily,
  opponents: number,
  need: number
): number {
  const rows = LIGHTNING_CHEAP_ENTRY_EQUITY[family];
  const k = clamp(Math.round(opponents), 1, LIGHTNING_CHEAP_ENTRY_MAX_OPPONENTS);
  let floor = Infinity;
  let share = 0;
  for (const row of rows) {
    floor = Math.min(floor, row[1 + k]! / 1000);
    if (!(floor >= need)) break;
    share = row[1]!;
  }
  return share;
}

type AuthorityNote = (event: {
  branch: 'lightning_cheap_entry_sb_complete' | 'lightning_cheap_entry_over_limp';
  strength: number;
  threeBetThreshold: number;
  effectiveThreeBetThreshold: number;
  premiumValue: boolean;
  pressure: boolean;
}) => void;

/**
 * Asked only where the unopened branch has already answered FOLD. True = call
 * the cheap entry (complete or over-limp). Never a raise.
 */
export function lightningCheapEntry(
  ce: LightningCheapEntryCtx | undefined,
  spot: {
    isOmaha: boolean;
    position: string;
    isButton: boolean;
    limpers: number;
    raises: number;
    straddled: boolean;
    /** Live opponents (not folded), the blinds included. */
    oppsLeft: number;
    toCall: number;
    bigBlind: number;
    /** The contestable pot before hero's call. */
    pot: number;
    /** Engine callDeductionFraction (rake and jackpot fee), absent = 0. */
    drop?: number;
    depthBB: number;
    strength: number;
    tightness: number;
    noteAuthority?: AuthorityNote;
  }
): boolean {
  if (ce === undefined) return false;
  if (spot.isOmaha !== (ce.family !== 'holdem')) return false;
  if (spot.raises !== 0 || spot.straddled) return false;
  const bb = spot.bigBlind > 0 ? spot.bigBlind : 1;
  if (!(spot.toCall > 0) || spot.toCall > LIGHTNING_CHEAP_ENTRY_MAX_CALL_BB * bb + 1e-9)
    return false;
  const limpers = Math.max(0, Math.floor(spot.limpers));
  const sb = spot.position === 'sb';
  // The button: only the two blinds still to act behind it.
  const button = spot.position === 'late' && spot.isButton && ce.behind === 2;
  let behind: number;
  let opponents: number;
  let addedBehind: number;
  let branch: 'lightning_cheap_entry_sb_complete' | 'lightning_cheap_entry_over_limp';
  if (sb && limpers === 0 && spot.oppsLeft === 1) {
    // 1. Folded to the small blind: only the big blind is left.
    behind = 1;
    opponents = 1;
    addedBehind = 0;
    branch = 'lightning_cheap_entry_sb_complete';
  } else if (limpers >= 1 && (sb || button)) {
    // 2. Behind one or more limpers: the small blind completes, the button over-limps.
    behind = sb ? 1 : 2;
    opponents = limpers + behind;
    addedBehind = sb ? 0 : bb / 2;
    branch = 'lightning_cheap_entry_over_limp';
  } else return false;
  const real = spot.noteAuthority !== undefined;
  if (real && ce.telemetry) noteFire('lightning_cheap_entry_asked_seen');
  if (ce.observedManiac) {
    if (real && ce.telemetry) noteFire('lightning_cheap_entry_refused_opponent_read_seen');
    return false;
  }
  const need = lightningCheapEntryRequiredEquity({
    family: ce.family,
    call: spot.toCall,
    pot: spot.pot,
    addedBehind,
    behind,
    inPosition: !sb,
    depthBB: spot.depthBB,
    drop: Number.isFinite(spot.drop) ? (spot.drop as number) : 0,
  });
  const strengthBar = lightningCheapEntryStrengthBar(ce.family, opponents, need);
  if (strengthBar === null) return false;
  const bar = Math.min(BAR_CAP, strengthBar * spot.tightness);
  if (!(spot.strength >= bar)) return false;
  if (real) {
    if (ce.telemetry) noteFire('lightning_cheap_entry_changed_seen');
    spot.noteAuthority!({
      branch,
      strength: spot.strength,
      threeBetThreshold: strengthBar,
      effectiveThreeBetThreshold: bar,
      premiumValue: false,
      pressure: false,
    });
  }
  return true;
}
