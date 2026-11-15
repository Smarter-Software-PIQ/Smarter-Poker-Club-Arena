/**
 * LIGHTNING PARTICIPATION (2026-11-15, options lightningParticipationHoldem
 * and lightningParticipationOmaha, both DEFAULT OFF, read `=== true`).
 *
 * Lightning is its own format: fast-fold cash pools (no-limit hold'em, PLO4,
 * PLO5), four to six dealt, a big-blind ante of one big blind (2.5bb in the
 * middle before anyone acts), 50 to 200bb, a new table every hand. The base
 * preflop ranges were built for ante-free Classic cash, and in Omaha the
 * first-in bar of every seat is held at about 24% by the width presumed of
 * every unknown opponent, so the button opens no wider than the cut-off
 * (production 2026-11-14: PLO4 button 24.8% against cut-off 25.8%; Omaha big
 * blind continues 23-24% against hold'em 45-46%).
 *
 * This module states the Lightning BASE range as hands, cell by cell: the top
 * share of the variant's own preflop order that enters, by seat (players
 * still to act), players dealt, effective depth and price. It never reads the
 * Horse's own participation, its recent folds or any count of hands since it
 * last entered; nothing here can grow as a Horse "falls behind". It never
 * turns a decided fold into a call after the fact: each cell is asked at the
 * range lookup, inside the branch that owns the spot. Postflop play, sizing,
 * 3-bet / 4-bet / 5-bet and stack-off bars are not touched.
 *
 * Opponent reads stay on top. A cell does not engage against an opponent
 * whose own record reads as a maniac, against a confirmed aggressive player
 * in position behind, or where a tight-opener respect or wide-opener pressure
 * read moved the base bars. The one thing a first-in cell supersedes is the
 * width PRESUMED of an Omaha opponent nobody has a read on (the presumption
 * is not a read; an observed maniac keeps its bar in full).
 *
 * Reaching a participation figure is not a goal of this file. The cells are
 * the claim; the evaluation reads what participation they produce.
 */
import { noteFire } from './BrainTelemetry.js';
import { scoreAtShare, shareAtScore } from './HorseGtoOpeningRanges.js';
import { HorseMind } from './HorseMind.js';
import { maniacRaiseWidth } from './HorseOpponentExploit.js';

export type LightningParticipationFamily = 'holdem' | 'plo4' | 'plo5';

export type LightningParticipationRefusal =
  | 'not_lightning'
  | 'format'
  | 'variant'
  | 'dealt_count'
  | 'not_bb_ante';

/** The public table facts the predicate reads. Never a seat's identity. */
export interface LightningParticipationTable {
  publicMemoryDomain?: { speed?: unknown } | null;
  gameMode?: unknown;
  stage?: unknown;
  allInOrFold?: unknown;
  gameVariant?: unknown;
  bigBlindAnte?: unknown;
  players?: ReadonlyArray<{
    seat: number;
    user_id: string;
    is_folded?: boolean;
    is_sitting_out?: boolean;
  }>;
}

/** What the preflop engine receives when the option is on and the hand is in the predicate. */
export interface LightningParticipationCtx {
  family: LightningParticipationFamily;
  /** Players dealt into the hand (4 to 6). */
  dealt: number;
  /** Players still to act behind hero in an unopened pot (button 2, small blind 1), or null. */
  behind: number | null;
  /** A live opponent reads as a maniac on its own record (never the presumption). */
  observedManiac: boolean;
  telemetry: boolean;
}

const FAMILY_OF: Readonly<Record<string, LightningParticipationFamily>> = {
  nlh: 'holdem',
  plo4: 'plo4',
  plo5: 'plo5',
};

/**
 * The one predicate. `off` = the option that owns this variant is not on (no
 * receipt: an option that is off is silent); `refused` = an option is on and
 * the hand is outside the predicate.
 */
export function lightningParticipationEligibility(
  on: { holdem: boolean; omaha: boolean },
  table: LightningParticipationTable,
  dealt: number
):
  | { state: 'off' }
  | { state: 'refused'; reason: LightningParticipationRefusal }
  | { state: 'eligible'; family: LightningParticipationFamily } {
  if (on.holdem !== true && on.omaha !== true) return { state: 'off' };
  const family = FAMILY_OF[String(table.gameVariant ?? '').toLowerCase()];
  if (family === 'holdem' ? on.holdem !== true : family !== undefined && on.omaha !== true)
    return { state: 'off' };
  if (table.publicMemoryDomain?.speed !== 'lightning')
    return { state: 'refused', reason: 'not_lightning' };
  if (table.gameMode !== 'cash' || table.stage !== 'preflop' || table.allInOrFold === true)
    return { state: 'refused', reason: 'format' };
  if (family === undefined) return { state: 'refused', reason: 'variant' };
  if (!(dealt >= 4 && dealt <= 6)) return { state: 'refused', reason: 'dealt_count' };
  if (table.bigBlindAnte !== true) return { state: 'refused', reason: 'not_bb_ante' };
  return { state: 'eligible', family };
}

/**
 * Built once per preflop decision by HorseLogic. Undefined unless the option
 * is on and the predicate holds, so every consumer below is inert otherwise.
 */
export function lightningParticipationCtx(
  on: { holdem: boolean; omaha: boolean },
  table: LightningParticipationTable,
  seat: {
    heroUserId: string;
    dealt: number;
    behind: number | null;
    mind: boolean;
    telemetry: boolean;
  }
): LightningParticipationCtx | undefined {
  const e = lightningParticipationEligibility(on, table, seat.dealt);
  if (e.state === 'off') return undefined;
  if (e.state === 'refused') {
    if (seat.telemetry) {
      if (e.reason === 'not_lightning')
        noteFire('lightning_participation_refused_not_lightning_seen');
      else if (e.reason === 'format') noteFire('lightning_participation_refused_format_seen');
      else if (e.reason === 'variant') noteFire('lightning_participation_refused_variant_seen');
      else if (e.reason === 'dealt_count')
        noteFire('lightning_participation_refused_dealt_count_seen');
      else noteFire('lightning_participation_refused_not_bb_ante_seen');
    }
    return undefined;
  }
  if (seat.telemetry) noteFire('lightning_participation_eligible');
  let observedManiac = false;
  if (seat.mind) {
    try {
      for (const p of table.players ?? []) {
        if (p.user_id === seat.heroUserId || p.is_folded || p.is_sitting_out) continue;
        const read = HorseMind.opponentRead(p.user_id);
        if (read && read.presumed !== true && maniacRaiseWidth(read) !== null) {
          observedManiac = true;
          break;
        }
      }
    } catch {
      /* reads are best-effort, as in HorseLogic */
    }
  }
  return {
    family: e.family,
    dealt: seat.dealt,
    behind: seat.behind,
    observedManiac,
    telemetry: seat.telemetry,
  };
}

// ── The cells ────────────────────────────────────────────────────────────

/**
 * Omaha first-in raise share (percent of the variant's own hands, a balanced
 * Horse, 100bb or deeper, six dealt) by players still to act behind: 5 =
 * under the gun six-handed, 2 = the button, 1 = the small blind (raise or
 * fold; out of position to the one player left, so narrower than the button).
 * Non-decreasing from the earliest seat to the button by construction.
 */
export const LIGHTNING_OMAHA_FIRST_IN_SHARE: Readonly<
  Record<'plo4' | 'plo5', Readonly<Record<number, number>>>
> = {
  plo4: { 5: 20, 4: 24, 3: 34, 2: 42, 1: 34 },
  plo5: { 5: 20, 4: 24, 3: 34, 2: 40, 1: 32 },
};
/** Share points added per seat missing from six (no folded ranges behind to bunch the deck). */
export const LIGHTNING_OMAHA_SHORT_HANDED_POINTS = 1;
/** First-in width at 50bb or less, as a fraction of the 100bb width (linear between). */
export const LIGHTNING_FIRST_IN_SHALLOW_FACTOR = 0.9;

/**
 * Omaha big-blind continue share (percent, calls and 3-bets together) against
 * ONE raise at the reference price of a pot-sized open (to-call / (pot +
 * to-call) = 0.33), nobody else in, 100bb or deeper, by the raiser's seat
 * group. Against the small blind the big blind has position.
 */
export const LIGHTNING_OMAHA_BB_DEFEND_SHARE: Readonly<Record<string, number>> = {
  early: 40,
  middle: 44,
  late: 50,
  sb: 56,
};
/** Share points per unit of price below (wider) or above (narrower) the reference. */
export const LIGHTNING_OMAHA_BB_PRICE_SLOPE = 120;
export const LIGHTNING_OMAHA_BB_REFERENCE_PRICE = 0.33;
export const LIGHTNING_OMAHA_BB_PRICE_POINTS: Readonly<{ min: number; max: number }> = {
  min: -10,
  max: 15,
};
/** Each caller already in costs realisation; the better price is already in the price term. */
export const LIGHTNING_OMAHA_BB_POINTS_PER_CALLER = -6;
export const LIGHTNING_OMAHA_BB_MULTIWAY_CAP = 36;
export const LIGHTNING_OMAHA_BB_SHARE_BOUNDS: Readonly<{ min: number; max: number }> = {
  min: 20,
  max: 62,
};
/** Big-blind defence at 50bb or less, as a fraction of the 100bb width (linear between). */
export const LIGHTNING_BB_SHALLOW_FACTOR = 0.85;

/**
 * Hold'em big blind against one open, nobody else in: the (defender, opener
 * seat) continue width the base already reads is widened by the price the
 * big-blind ante lays. The base widths are referenced to a 3bb ante-free open
 * (2 into 6.5 = 0.31); a Lightning 2.5bb open lays 1.5 into 6.5 (0.23).
 */
export const LIGHTNING_HOLDEM_BB_REFERENCE_PRICE = 0.31;
export const LIGHTNING_HOLDEM_BB_PRICE_SLOPE = 90;
export const LIGHTNING_HOLDEM_BB_MAX_POINTS = 10;
export const LIGHTNING_HOLDEM_BB_MAX_SHARE = 85;
/** None of the hold'em widening at this depth or less, all of it from the full depth. */
export const LIGHTNING_HOLDEM_BB_DEPTH_NONE_BB = 50;
export const LIGHTNING_HOLDEM_BB_DEPTH_FULL_BB = 85;

const BAR_CAP = 0.95;
const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));
const shallow = (depthBB: number, factor: number): number =>
  !Number.isFinite(depthBB) || depthBB >= 100
    ? 1
    : depthBB <= 50
      ? factor
      : factor + ((1 - factor) * (depthBB - 50)) / 50;

/** The Omaha first-in share (percent) of a cell, or null when the cell does not exist. */
export function lightningOmahaFirstInShare(
  family: LightningParticipationFamily,
  behind: number | null,
  dealt: number,
  depthBB: number
): number | null {
  if (family === 'holdem' || behind === null) return null;
  const base = LIGHTNING_OMAHA_FIRST_IN_SHARE[family][behind];
  if (base === undefined) return null;
  const shortHanded = Math.max(0, 6 - dealt) * LIGHTNING_OMAHA_SHORT_HANDED_POINTS;
  return (base + shortHanded) * shallow(depthBB, LIGHTNING_FIRST_IN_SHALLOW_FACTOR);
}

/** The Omaha big-blind continue share (percent) at this price, against this raiser. */
export function lightningOmahaBbDefendShare(
  raiserPosition: string,
  price: number,
  callers: number,
  depthBB: number
): number {
  const base =
    LIGHTNING_OMAHA_BB_DEFEND_SHARE[raiserPosition] ?? LIGHTNING_OMAHA_BB_DEFEND_SHARE.middle;
  const pricePoints = clamp(
    LIGHTNING_OMAHA_BB_PRICE_SLOPE * (LIGHTNING_OMAHA_BB_REFERENCE_PRICE - price),
    LIGHTNING_OMAHA_BB_PRICE_POINTS.min,
    LIGHTNING_OMAHA_BB_PRICE_POINTS.max
  );
  const n = Math.max(0, Math.floor(callers));
  let share = base + pricePoints + n * LIGHTNING_OMAHA_BB_POINTS_PER_CALLER;
  if (n > 0) share = Math.min(share, LIGHTNING_OMAHA_BB_MULTIWAY_CAP);
  share *= shallow(depthBB, LIGHTNING_BB_SHALLOW_FACTOR);
  return clamp(share, LIGHTNING_OMAHA_BB_SHARE_BOUNDS.min, LIGHTNING_OMAHA_BB_SHARE_BOUNDS.max);
}

/** Share points the hold'em big blind's continue width gains at this price and depth. */
export function lightningHoldemBbPricePoints(price: number, depthBB: number): number {
  const depth = clamp(
    (depthBB - LIGHTNING_HOLDEM_BB_DEPTH_NONE_BB) /
      (LIGHTNING_HOLDEM_BB_DEPTH_FULL_BB - LIGHTNING_HOLDEM_BB_DEPTH_NONE_BB),
    0,
    1
  );
  return (
    clamp(
      LIGHTNING_HOLDEM_BB_PRICE_SLOPE * (LIGHTNING_HOLDEM_BB_REFERENCE_PRICE - price),
      0,
      LIGHTNING_HOLDEM_BB_MAX_POINTS
    ) * depth
  );
}

type AuthorityNote = (event: {
  branch: 'lightning_participation_first_in' | 'lightning_participation_bb_defend';
  strength: number;
  threeBetThreshold: number;
  effectiveThreeBetThreshold: number;
  premiumValue: boolean;
  pressure: boolean;
}) => void;

/** The engine's own answer stands and the real decision (not a rewound counterfactual) is told why. */
function refuseForRead(lp: LightningParticipationCtx, real: boolean): void {
  if (real && lp.telemetry) noteFire('lightning_participation_refused_opponent_read_seen');
}

/**
 * OMAHA FIRST-IN. Asked at the open test of the unopened branch: does this
 * hand open? `baseOpens` is the base answer and is never taken away. The cell
 * engages only in a pot nobody has entered (no limper, no straddle), for a
 * seat that is not the big blind; it raises or folds and adds no limp.
 */
export function lightningParticipationFirstIn(
  lp: LightningParticipationCtx | undefined,
  spot: {
    isOmaha: boolean;
    position: string;
    limpers: number;
    straddled: boolean;
    toCall: number;
    strength: number;
    openThresh: number;
    baseOpens: boolean;
    depthBB: number;
    tightness: number;
    lagBullyIpBehind?: boolean;
    noteAuthority?: AuthorityNote;
  }
): boolean {
  if (
    lp === undefined ||
    lp.family === 'holdem' ||
    !spot.isOmaha ||
    spot.baseOpens ||
    spot.limpers !== 0 ||
    spot.straddled ||
    spot.position === 'bb' ||
    !(spot.toCall > 0)
  )
    return spot.baseOpens;
  const share = lightningOmahaFirstInShare(lp.family, lp.behind, lp.dealt, spot.depthBB);
  if (share === null) return spot.baseOpens;
  const real = spot.noteAuthority !== undefined;
  if (lp.observedManiac || spot.lagBullyIpBehind === true) {
    refuseForRead(lp, real);
    return spot.baseOpens;
  }
  const bar = Math.min(BAR_CAP, scoreAtShare(share / 100) * spot.tightness);
  if (!(spot.strength >= bar)) return false;
  if (real) {
    if (lp.telemetry) noteFire('lightning_participation_changed');
    spot.noteAuthority!({
      branch: 'lightning_participation_first_in',
      strength: spot.strength,
      threeBetThreshold: spot.openThresh,
      effectiveThreeBetThreshold: bar,
      premiumValue: false,
      pressure: false,
    });
  }
  return true;
}

/**
 * BIG-BLIND DEFENCE AGAINST ONE RAISE. Asked only where the facing-one-raise
 * branch has already answered fold, and answers whether the hand is inside
 * the big blind's Lightning continue range at this price. True = call. The
 * 3-bet tests ran before it and are not changed.
 */
export function lightningParticipationBbDefend(
  lp: LightningParticipationCtx | undefined,
  spot: {
    isOmaha: boolean;
    position: string;
    raiserPosition: string;
    callers: number;
    toCall: number;
    pot: number;
    priceOK: boolean;
    depthBB: number;
    strength: number;
    tightness: number;
    /** Hold'em: the (defender, opener seat) continue bar the base read; absent = no cell. */
    holdemContinueBar?: number;
    /** A tight-opener respect or wide-opener pressure read moved the base bars. */
    opponentRead: boolean;
    noteAuthority?: AuthorityNote;
  }
): boolean {
  if (lp === undefined || spot.position !== 'bb' || !spot.priceOK || !(spot.toCall > 0))
    return false;
  if (spot.isOmaha !== (lp.family !== 'holdem')) return false;
  const price = spot.toCall / Math.max(1e-9, spot.pot + spot.toCall);
  let share: number;
  let baseBar: number;
  if (lp.family === 'holdem') {
    if (spot.holdemContinueBar === undefined || spot.callers !== 0) return false;
    const points = lightningHoldemBbPricePoints(price, spot.depthBB);
    if (!(points > 0)) return false;
    baseBar = spot.holdemContinueBar;
    share = Math.min(LIGHTNING_HOLDEM_BB_MAX_SHARE, shareAtScore(baseBar) * 100 + points);
  } else {
    baseBar = Number.NaN;
    share = lightningOmahaBbDefendShare(spot.raiserPosition, price, spot.callers, spot.depthBB);
  }
  const real = spot.noteAuthority !== undefined;
  if (spot.opponentRead) {
    refuseForRead(lp, real);
    return false;
  }
  const bar = Math.min(BAR_CAP, scoreAtShare(share / 100) * spot.tightness);
  if (!(spot.strength >= bar)) return false;
  if (real) {
    if (lp.telemetry) noteFire('lightning_participation_changed');
    spot.noteAuthority!({
      branch: 'lightning_participation_bb_defend',
      strength: spot.strength,
      threeBetThreshold: Number.isFinite(baseBar) ? baseBar : bar,
      effectiveThreeBetThreshold: bar,
      premiumValue: false,
      pressure: false,
    });
  }
  return true;
}
