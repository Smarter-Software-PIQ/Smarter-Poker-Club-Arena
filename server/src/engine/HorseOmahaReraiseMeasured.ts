/**
 * omahaAcesReraiseIsMeasured and omahaReraiseRangeIsMeasured (each default OFF; EMERG lane PREFLOP-2,
 * 2026-11-20). PLO4/PLO5 cash, high only, one board, no bomb pot, preflop: a final call becomes the
 * pot-size re-raise in the cells where the re-raise was measured to earn more than the call, on fit
 * and on held-out data, each by more than one standard error, IN REAL CHIPS.
 *
 * MEASURED, NOT ASSUMED. Every preflop decision the Horses made in PLO4/PLO5 cash hands with a person
 * at the table from 2026-10-15 to 2026-11-19 (115,417 decisions), the re-raise against the call inside
 * the same spot, fit = to 11-14, held out = 11-15 to 11-19. The value is REAL CHIPS (lead 2026-11-20
 * 1:42 AM: rake and chips between Horses are internal): the chips of the Horse's hand result that
 * went to or came from persons (each loss split pro rata over the hand's winners), plus 1.9% of the
 * deductions, all-in adjusted where the sign holds. The net figure is given beside it. The Horses'
 * own re-raises in the record are pot-size (median raise-to 1.00 and 1.07 of the pot raise), so the
 * pot raise is the size the measurement holds.
 *
 * ACES (omahaAcesReraiseIsMeasured): facing TWO raises (a 3-bet) with an own stack of 250 bb or less,
 * real fit +13.06 +/- 9.11 bb a decision (81 calls, 156 raises), held out +37.03 +/- 11.67 (47, 88);
 * net +37.89 +/- 10.13 and +45.34 +/- 12.71. In this cell a final FOLD of aces becomes the re-raise
 * too: the recorded re-raises there earned real +15.11 +/- 6.33 against folding (fit) and +28.40 +/-
 * 10.25 (held out), and aces were folded there 22 times in the record.
 * NOT in the rule, because real chips do not carry them: facing ONE raise multiway above 100 bb (net
 * fit +14.29 +/- 4.06 and held out +7.96 +/- 6.52, but real +5.92 +/- 2.84 and -1.52 +/- 4.76: what
 * the re-raise gained there was rake and other Horses' chips), the big blind heads-up against one
 * open (real held out -24.81 +/- 12.81), a stack above 250 bb facing a 3-bet (real +8.13 +/- 16.94
 * and +7.67 +/- 20.66), every call facing a 4-bet or more.
 *
 * THE RE-RAISE RANGE (omahaReraiseRangeIsMeasured; hands that are not aces, by class and position):
 * a pair of kings acting AFTER the 3-bettor facing TWO raises (the 4-bet): real fit +26.65 +/- 18.00
 * (119 calls, 38 raises), held out +73.89 +/- 29.58 (50, 23); net +7.23 +/- 20.11 and +64.37 +/-
 * 30.54. Every other class and position was measured and is NOT in the range: kings out of position
 * (real held out -56.84 +/- 32.68), kings in the small blind 3-betting one raise (real fit +3.53 +/-
 * 5.09), double-suited hands 4-betting on a table in position (real fit -6.02 +/- 18.38), queens or
 * jacks with broadway (3-bet real held out -9.30 +/- 5.66), double-suited rundowns (4-bet real held
 * out -47.58 +/- 47.64). Archive repairs/EMERG/PREFLOP-2.md; scripts emerg/preflop-2/work/rg.py.
 *
 * Each rule changes only a call into a raise (or the all-in when the pot raise is the whole stack);
 * the aces rule also a fold. A call or fold that omahaPreflopJamFacingReraiseIsPriced priced (its
 * receipt is on the decision) is that option's verdict and stands: one owner per cell. PUBLIC
 * INFORMATION ONLY: the Horse's own cards, the public action history, the chips, the seats. The same
 * rule against every opponent, a person or a Horse (the real-chip accounting is for grading only).
 * Pure: no opponent memory, no draw from the brain's random stream. PLO6, PLO8, hold'em and
 * tournaments are never in scope: byte-identical with either option on.
 */
import type { SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import { preflopRaiseCount } from './HorseOmahaReraisedPot.js';
import { omahaIsTournamentMode } from './HorseOmahaTournamentScope.js';
import { omahaColdCallClass, type OmahaColdCallClass } from './HorseOmahaColdCallMeasured.js';

export const OMAHA_RERAISE_MEASURED_VARIANTS: ReadonlySet<string> = new Set(['plo4', 'plo5']);

export interface OmahaReraiseMeasuredGrade {
  /** re-raise minus call, big blinds a decision, and its standard error */
  fitBB: number;
  fitSeBB: number;
  heldOutBB: number;
  heldOutSeBB: number;
}

/** The aces cell and its grades in real chips (the bound is part of the measurement). */
export const OMAHA_ACES_RERAISE_CELLS = Object.freeze({
  /** facing two raises, own stack at or under this many big blinds */
  facingThreeBet: Object.freeze({
    stackAtMostBB: 250,
    fitBB: 13.06,
    fitSeBB: 9.11,
    heldOutBB: 37.03,
    heldOutSeBB: 11.67,
    /** the re-raise against the FOLD in the same cell (the value of the recorded re-raises) */
    againstFold: Object.freeze({
      fitBB: 15.11,
      fitSeBB: 6.33,
      heldOutBB: 28.4,
      heldOutSeBB: 10.25,
    }),
  }),
  /** measured and NOT in the rule: facing one raise, two or more live opponents, above 100 bb */
  facingOneRaiseMultiway: Object.freeze({
    fitBB: 5.92,
    fitSeBB: 2.84,
    heldOutBB: -1.52,
    heldOutSeBB: 4.76,
  }),
});

/** The cell of the measured re-raise range for hands that are not aces, in real chips. */
export const OMAHA_RERAISE_RANGE_CELLS = Object.freeze({
  /** kings, in position against the 3-bettor, facing two raises */
  kingsInPositionFourBet: Object.freeze({
    fitBB: 26.65,
    fitSeBB: 18.0,
    heldOutBB: 73.89,
    heldOutSeBB: 29.58,
  }),
});

/** A cell is in a rule only when fit and held out are both above zero by more than one standard error. */
export function omahaReraiseMeasuredPasses(g: OmahaReraiseMeasuredGrade): boolean {
  return g.fitBB - g.fitSeBB > 0 && g.heldOutBB - g.heldOutSeBB > 0;
}

export interface OmahaReraiseMeasuredSpot {
  variant: string;
  lightning: boolean;
  /** preflop raises the Horse faces */
  raises: number;
  /** opponents not folded (all in or not), the Horse excluded */
  liveOpponents: number;
  /** the Horse's stack plus its chips in front, in big blinds */
  stackBB: number;
  /** the Horse posted the small blind in this hand and has less than a big blind in */
  smallBlind: boolean;
  /** the Horse has called, checked or raised in this hand */
  acted: boolean;
  /** the Horse acts after the last raiser on every later street */
  inPosition: boolean;
  cls: OmahaColdCallClass;
  /** the pot-size raise, capped by the stack */
  raiseTo: number;
  allIn: number;
}

/** Order to act on a postflop street: the small blind first, the dealer last. */
function order(seat: number, dealerSeat: number | undefined): number {
  const d = seat - (dealerSeat ?? 0);
  return d <= 0 ? d + 1024 : d;
}

/** The spot both rules read, or null out of scope or when no raise is legal. Reads only the request. */
export function omahaReraiseMeasuredSpot(
  player: SeatPlayer,
  gs: HorseGameStateV2
): OmahaReraiseMeasuredSpot | null {
  try {
    if (String(gs.stage ?? '') !== 'preflop') return null;
    const variant = String(gs.gameVariant ?? '').toLowerCase();
    if (!OMAHA_RERAISE_MEASURED_VARIANTS.has(variant)) return null;
    const hole = player.cards ?? [];
    if (hole.length !== (variant === 'plo4' ? 4 : 5)) return null;
    if (omahaIsTournamentMode(gs)) return null;
    if (gs.bombPot === true || gs.allInOrFold === true) return null;
    if ((gs.boardCount ?? 1) > 1 || gs.communityCards2?.length || gs.communityCards3?.length)
      return null;
    if (gs.variantRules?.splitLow8OrBetter === true) return null;
    const bb = Number(gs.bigBlind);
    if (!(bb > 0)) return null;
    const stack = Number.isFinite(player.stack) ? Math.max(0, player.stack) : 0;
    const heroBet = Number.isFinite(player.bet) ? Math.max(0, player.bet ?? 0) : 0;
    const toCall = Number.isFinite(gs.toCall)
      ? Math.max(0, gs.toCall as number)
      : Math.max(0, (gs.currentBet || 0) - heroBet);
    if (toCall <= 0.005 || stack <= toCall + 0.005) return null;
    // A raise must be legal: the engine offers a raise range and the action.
    const legal = Array.isArray(gs.legalActions) ? gs.legalActions : null;
    if (legal && !legal.includes('raise')) return null;
    if (
      !Number.isFinite(gs.maxRaiseTo) ||
      !Number.isFinite(gs.minRaiseTo) ||
      (gs.maxRaiseTo as number) < (gs.minRaiseTo as number)
    )
      return null;
    const allIn = heroBet + stack;
    const raiseTo = Math.min(allIn, gs.maxRaiseTo as number);
    if (!(raiseTo > heroBet + toCall + 0.005)) return null;
    const history = gs.actionHistory ?? [];
    const raises = preflopRaiseCount(history);
    if (raises < 1) return null;
    let raiserSeat = -1;
    let acted = false;
    // the engine names the blind seats on the request; a recorded history may carry the post itself
    let postedSmallBlind = gs.blindSeats?.smallBlind === player.seat;
    for (const a of history) {
      if (a.stage !== 'preflop') continue;
      if (a.seat === player.seat && (a.action as string) === 'sb') postedSmallBlind = true;
      const wager = a.action === 'raise' || a.action === 'bet' || a.action === 'all_in';
      if (a.seat === player.seat) {
        if (wager || a.action === 'call' || a.action === 'check') acted = true;
      } else if (wager) raiserSeat = a.seat;
    }
    if (raiserSeat < 0) return null;
    const dealt = (gs.players ?? []).filter((p) => !p.is_sitting_out || p.is_all_in);
    const live = dealt.filter((p) => p.seat !== player.seat && !p.is_folded);
    // Somebody must be able to answer the raise.
    if (!live.some((p) => !p.is_all_in && Number.isFinite(p.stack) && p.stack > 0.005)) return null;
    const speed = (gs as { publicMemoryDomain?: { speed?: unknown } | null }).publicMemoryDomain
      ?.speed;
    return {
      variant,
      lightning: speed === 'lightning',
      raises,
      liveOpponents: live.length,
      stackBB: allIn / bb,
      smallBlind: postedSmallBlind && dealt.length >= 3 && heroBet < bb - 0.005,
      acted,
      inPosition: order(player.seat, gs.dealerSeat) > order(raiserSeat, gs.dealerSeat),
      cls: omahaColdCallClass(hole),
      raiseTo,
      allIn,
    };
  } catch {
    return null;
  }
}

/**
 * True in the aces cell: the call (or the fold) of aces facing a 3-bet at 250 bb or less, which the
 * measurement says should be the re-raise.
 */
export function omahaAcesReraiseCell(
  spot: OmahaReraiseMeasuredSpot,
  standing: 'call' | 'fold' = 'call'
): boolean {
  if (spot.cls !== 'aces' || spot.raises !== 2) return false;
  const two = OMAHA_ACES_RERAISE_CELLS.facingThreeBet;
  return (
    omahaReraiseMeasuredPasses(standing === 'fold' ? two.againstFold : two) &&
    spot.stackBB <= two.stackAtMostBB
  );
}

/** True in the cell of the measured re-raise range for hands that are not aces. */
export function omahaReraiseRangeCell(
  spot: OmahaReraiseMeasuredSpot,
  standing: 'call' | 'fold' = 'call'
): boolean {
  if (standing !== 'call') return false;
  return (
    omahaReraiseMeasuredPasses(OMAHA_RERAISE_RANGE_CELLS.kingsInPositionFourBet) &&
    spot.raises === 2 &&
    spot.cls === 'kings' &&
    spot.inPosition
  );
}

function reraised<D extends { action: string; amount?: number | null }>(
  decision: D,
  gs: HorseGameStateV2,
  spot: OmahaReraiseMeasuredSpot
): D {
  const legal = Array.isArray(gs.legalActions) ? gs.legalActions : null;
  const out = { ...decision } as D;
  if (spot.raiseTo >= spot.allIn - 0.005 && (!legal || legal.includes('all_in'))) {
    out.action = 'all_in';
    delete out.amount;
  } else {
    out.action = 'raise';
    out.amount = Math.round(spot.raiseTo * 100) / 100;
  }
  return out;
}

function rule<D extends { action: string; amount?: number | null }>(
  decision: D,
  player: SeatPlayer,
  gs: HorseGameStateV2,
  on: boolean,
  cell: (spot: OmahaReraiseMeasuredSpot, standing: 'call' | 'fold') => boolean
): D {
  if (!on || (decision.action !== 'call' && decision.action !== 'fold')) return decision;
  try {
    // one owner per cell: a call or fold the three-way pricing judged is that option's verdict
    if ((decision as { omahaPreflopThreeWay?: unknown }).omahaPreflopThreeWay != null)
      return decision;
    const spot = omahaReraiseMeasuredSpot(player, gs);
    if (!spot || !cell(spot, decision.action as 'call' | 'fold')) return decision;
    return reraised(decision, gs, spot);
  } catch {
    return decision;
  }
}

/**
 * omahaAcesReraiseIsMeasured: with the option on, a final call or fold of a pair of aces facing a
 * 3-bet with 250 bb or less becomes the pot-size re-raise. Everything else is returned untouched (the same object).
 */
export function omahaAcesReraiseMeasuredRule<D extends { action: string; amount?: number | null }>(
  decision: D,
  player: SeatPlayer,
  gs: HorseGameStateV2,
  on: boolean
): D {
  return rule(decision, player, gs, on, omahaAcesReraiseCell);
}

/**
 * omahaReraiseRangeIsMeasured: with the option on, a final call of kings facing a 3-bet in position
 * (the one cell of the measured re-raise range) becomes the pot-size re-raise. Everything else is returned untouched (the same object).
 */
export function omahaReraiseRangeMeasuredRule<D extends { action: string; amount?: number | null }>(
  decision: D,
  player: SeatPlayer,
  gs: HorseGameStateV2,
  on: boolean
): D {
  return rule(decision, player, gs, on, omahaReraiseRangeCell);
}
