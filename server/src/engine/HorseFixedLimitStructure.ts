/**
 * FIXED-LIMIT STRUCTURAL RULES (HU-FL-001 + Fixed-Limit E3, E4, E9 repairs).
 *
 * Pure structural rules where fixed-limit betting arithmetic differs from
 * no-limit and pot-limit:
 *  - HU-FL-001 (`fixedLimitHasNoJamOrFold`): no jam-or-fold push/fold table.
 *  - E3 (`fixedLimitRaiserContinuesVsOneBet`): a preflop raiser facing a
 *    single 1-small-bet re-raise (opener vs 3-bet, or 3-bettor vs 4-bet cap)
 *    continues when realized equity against the re-raiser's range covers the
 *    raw 1-bet price plus survival risk, rather than raise-folding to
 *    no-limit stack-off bars or whole-hand projected rake deductions.
 *  - E4 (`fixedLimitReraisedPositionOf`): in multi-raised fixed-limit preflop
 *    pots (`raises >= 2`), postflop position is determined by exact seat order
 *    relative to the button and the re-raiser, ignoring callers of an earlier
 *    price who have not yet answered the re-raise.
 *  - E9 (`fixedLimitVpipFloorAllowsCall`, `fixedLimitRaiseOverLimpTo`):
 *    fixed-limit VPIP floor enforcement only limps or completes for at most
 *    one big blind in an unraised pot (never cold-calling 2-bets, 3-bets or
 *    4-bet caps under the 6-BB no-limit cap), and a preflop raise behind a
 *    limp in `vpipFloorLimpEv` is priced at `2 * bigBlind`.
 *
 * Kept pure in this module so `HorseOpponentExploitNeutrality.law.test.ts`
 * can hold its October 16 historical layer-isolation corpus without any
 * production opt-out.
 */
import {
  FIXED_LIMIT_BEHIND_REALIZATION,
  FIXED_LIMIT_DEFENCE_REALIZATION,
  fixedLimitEquityVsTopShare,
  fixedLimitTopShareOfStrength,
  type FixedLimitPreflopVariant,
} from './HorseFixedLimitPreflop.js';

export function fixedLimitHasNoJamOrFold(isFixedLimit: boolean | undefined): boolean {
  return isFixedLimit === true;
}

/** In-position postflop equity realization for a fixed-limit preflop caller. */
export const FIXED_LIMIT_IP_REALIZATION: Readonly<Record<FixedLimitPreflopVariant, number>> =
  Object.freeze({ flh: 0.78, flo8: 0.68 });

/** Postflop action order relative to the dealer button (SB lowest, button 1024 highest). */
export function fixedLimitPostflopOrder(seat: number, dealerSeat: number | undefined): number {
  if (dealerSeat === undefined || !Number.isFinite(dealerSeat)) return seat;
  const d = seat - dealerSeat;
  return d <= 0 ? d + 1024 : d;
}

export interface FixedLimitReraisedSeatFacts {
  seat: number;
  bet: number;
  allIn: boolean;
  raisedPreflop: boolean;
}

export interface FixedLimitReraisedPosition {
  /** hero acts after the last raiser on every postflop street */
  ipVsRaiser: boolean;
  /** non-all-in players already in for currentBet who act after hero postflop */
  inForBehind: number;
  /** non-all-in earlier preflop raisers who have not yet answered currentBet and act after hero postflop */
  raisersPendingBehind: number;
  /** non-all-in callers of an earlier price who have not yet answered currentBet and act after hero postflop */
  callersPendingBehind: number;
  /** true iff hero acts after the re-raiser and no committed or earlier-raising live seat acts after hero postflop */
  inPosition: boolean;
}

/**
 * E4: Exact postflop seat-order position in a multi-raised fixed-limit pot.
 * Callers of an earlier price who have not yet answered the re-raise are
 * reported in `callersPendingBehind` and do not mark hero out of position.
 */
export function fixedLimitReraisedPositionOf(
  heroSeat: number,
  raiserSeat: number,
  dealerSeat: number | undefined,
  others: readonly FixedLimitReraisedSeatFacts[],
  price: number,
  bigBlind: number
): FixedLimitReraisedPosition | null {
  if (dealerSeat === undefined || !Number.isFinite(dealerSeat) || raiserSeat < 0) return null;
  const mine = fixedLimitPostflopOrder(heroSeat, dealerSeat);
  const behind = (p: FixedLimitReraisedSeatFacts): boolean =>
    !p.allIn && fixedLimitPostflopOrder(p.seat, dealerSeat) > mine;
  const inFor = (p: FixedLimitReraisedSeatFacts): boolean =>
    Number.isFinite(p.bet) && p.bet >= price - 0.005;
  const ipVsRaiser = mine > fixedLimitPostflopOrder(raiserSeat, dealerSeat);
  let inForBehind = 0;
  let raisersPendingBehind = 0;
  let callersPendingBehind = 0;
  for (const p of others) {
    if (!behind(p)) continue;
    if (inFor(p)) inForBehind++;
    else if (p.raisedPreflop) raisersPendingBehind++;
    else if (Number.isFinite(p.bet) && p.bet > bigBlind + 0.005) callersPendingBehind++;
  }
  return {
    ipVsRaiser,
    inForBehind,
    raisersPendingBehind,
    callersPendingBehind,
    inPosition: ipVsRaiser && inForBehind === 0 && raisersPendingBehind === 0,
  };
}

export interface FixedLimitRaiserVsOneBetSpot {
  isFixedLimit: boolean | undefined;
  variant: FixedLimitPreflopVariant | null;
  dealt: number;
  raises: number;
  heroRaisedPreflop: boolean;
  strength: number;
  toCall: number;
  stack: number;
  bigBlind: number;
  pricePot: number;
  riskAdd: number;
  inPosition: boolean;
  wagersCapped?: boolean;
  pendingRaisersBehind?: number;
  wideReRaiser?: boolean;
  tightReRaiserBump?: number;
}

export interface FixedLimitRaiserVsOneBetVerdict {
  equity: number;
  realized: number;
  required: number;
  calls: boolean;
}

/**
 * E3: When hero already raised preflop in a fixed-limit hand and faces a
 * single 1-small-bet re-raise (`effCall <= bigBlind * 1.05`, e.g. 2 BB -> 3 BB
 * or 3 BB -> 4 BB cap), decide whether realized equity against the re-raiser's
 * range covers the raw 1-bet pot price plus survival risk. Never turns a call
 * or raise into a fold; used only to rescue an unpriced fold.
 */
export function fixedLimitRaiserContinuesVsOneBet(
  spot: FixedLimitRaiserVsOneBetSpot
): FixedLimitRaiserVsOneBetVerdict | null {
  if (
    spot.isFixedLimit !== true ||
    spot.variant === null ||
    spot.raises < 2 ||
    !spot.heroRaisedPreflop ||
    !(spot.toCall > 0) ||
    !(spot.stack > 0) ||
    !(spot.bigBlind > 0)
  ) {
    return null;
  }
  const effCall = Math.min(spot.toCall, spot.stack);
  if (effCall > spot.bigBlind * 1.05) return null;
  const rawOdds = effCall / Math.max(1e-9, Math.max(0, spot.pricePot) + effCall);
  const survivalRisk =
    Math.max(0, spot.riskAdd) * Math.sqrt(Math.min(1, effCall / Math.max(1e-9, spot.stack)));
  const baseShare =
    spot.raises >= 3 ? (spot.dealt <= 2 ? 0.12 : 0.06) : spot.dealt <= 2 ? 0.22 : 0.12;
  const shareScale =
    spot.wideReRaiser === true
      ? 1.5
      : spot.tightReRaiserBump !== undefined && spot.tightReRaiserBump > 0
        ? 0.65
        : 1;
  const reRaiserShare = Math.max(0.03, Math.min(0.5, baseShare * shareScale));
  const heroShare = fixedLimitTopShareOfStrength(spot.variant, spot.strength);
  const equity = fixedLimitEquityVsTopShare(spot.variant, heroShare, reRaiserShare);
  const baseReal = spot.inPosition
    ? FIXED_LIMIT_IP_REALIZATION[spot.variant]
    : FIXED_LIMIT_DEFENCE_REALIZATION[spot.variant];
  const behindCount = spot.wagersCapped ? 0 : Math.max(0, spot.pendingRaisersBehind ?? 0);
  const realized = equity * baseReal * Math.pow(FIXED_LIMIT_BEHIND_REALIZATION, behindCount);
  const required = rawOdds + survivalRisk;
  return { equity, realized, required, calls: realized >= required };
}

/** True when a table's variant or betting structure is Fixed-Limit. */
export function isFixedLimitGameVariant(
  gameVariant: unknown,
  bettingStructure?: string | null
): boolean {
  if (bettingStructure === 'fixed_limit') return true;
  const v = String(gameVariant ?? '')
    .trim()
    .toLowerCase();
  return v === 'flh' || v === 'flo8' || v.startsWith('fl_') || v.includes('fixed_limit');
}

/**
 * E9: On a floored fixed-limit table, VPIP floor call-down may only limp or
 * complete in an unraised pot (`currentBet <= 1 BB` and `toCall <= 1 BB`),
 * never cold-call a 2-bet, 3-bet or 4-bet cap that slipped under the 6-BB
 * no-limit ceiling.
 */
export function fixedLimitVpipFloorAllowsCall(spot: {
  isFixedLimit: boolean;
  currentBet: number;
  toCall: number;
  bigBlind: number;
}): boolean {
  if (!spot.isFixedLimit) return true;
  if (!(spot.bigBlind > 0)) return false;
  return spot.currentBet <= spot.bigBlind * 1.05 && spot.toCall <= spot.bigBlind * 1.05;
}

/**
 * E9: In fixed limit, a preflop raise behind a limp is always `2 * bigBlind`
 * (one small bet on top of the big blind), never `bigBlind * (4 + limpers)`.
 */
export function fixedLimitRaiseOverLimpTo(bigBlind: number): number {
  return 2 * bigBlind;
}
