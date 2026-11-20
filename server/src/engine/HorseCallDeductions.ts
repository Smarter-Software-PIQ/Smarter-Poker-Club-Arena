import type { SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import { prepareJointPots } from './multiway/JointPotDistribution.js';
import { calculateRake } from './PokerEngine.js';
import { horsePolicyDealtPlayers } from './multiway/DealtSeatCensus.js';
import { priceDiamondCashFees } from '../domain/diamondCashFeeSnapshot.js';

/** Project the fraction removed from contested awards after this call. Fees
 * scale all winners, including main/side-pot winners, by this same fraction.
 * No cards, outcomes, controller mutations or database calls are involved.
 * Null is an incomplete legacy snapshot, never evidence of a rake-free pot. */
export function horseCallDeductionFraction(
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  call: number
): number | null {
  if (gs.gameMode === 'tournament' || (!gs.gameMode && gs.tournament != null)) return 0;
  if (gs.stateSchemaVersion !== 1 || !gs.rakeConfig || !Number.isFinite(call) || call < 0)
    return null;
  const unit = gs.chipUnit ?? (gs.asset === 'diamonds' ? 1 : 0.01);
  const effective = Math.min(call, hero.stack);
  try {
    if (gs.players.filter((p) => p.user_id === hero.user_id).length !== 1) return null;
    if (Math.abs(gs.players.reduce((n, p) => n + p.totalInvested, 0) - gs.pot) > unit / 10)
      return null;
    const seats = gs.players.map((p) =>
      p.user_id === hero.user_id
        ? {
            ...p,
            stack: hero.stack - effective,
            bet: hero.bet + effective,
            totalInvested: hero.totalInvested + effective,
            is_all_in: effective >= hero.stack,
          }
        : p
    );
    const prepared = prepareJointPots(seats, unit);
    const gross = prepared.pots.reduce((n, p) => n + p.amount, 0);
    if (!(gross > 0)) return 0;
    const dealt = horsePolicyDealtPlayers(gs.players, hero.seat, gs.dealtSeatIds).length;
    const r = gs.rakeConfig,
      b = gs.bbjConfig;
    const diamond =
      r.diamondCashFees && gs.asset === 'diamonds'
        ? priceDiamondCashFees(r.diamondCashFees.schedule, {
            pot: gross,
            dealtIn: dealt,
            sawFlop: true,
            variant: r.diamondCashFees.variant,
            doubleBoard: r.diamondCashFees.doubleBoard,
          })
        : null;
    const rake = diamond?.rake ?? (r.timedRake ? 0 : calculateRake(gross, true, r, dealt));
    const bbj =
      diamond?.bbjFee ??
      (b?.enabled && dealt >= b.minPlayersDealt
        ? Math.round(gs.bigBlind * b.feeBB * 100) / 100
        : 0);
    if (![rake, bbj].every((n) => Number.isFinite(n) && n >= 0)) return null;
    return Math.min(1, (rake + Math.min(Math.max(0, gross - rake), bbj)) / gross);
  } catch {
    return null;
  }
}

/**
 * The whole projected deduction of the pot after the hero calls what he faces (capped rake plus the
 * jackpot drop, by the controller's own rules), as a share of the pot BEFORE the call: the number a
 * verdict of the form `win = pot x (1 - rake)` needs so that `win` is what the call really wins.
 * Null when there is nothing to call or the deduction cannot be projected. Public rules only.
 */
export function horseWholeDeductionOfTheCall(
  hero: SeatPlayer,
  gs: HorseGameStateV2
): number | null {
  if (gs.asset === 'diamonds') return null;
  const pot = Number.isFinite(gs.pot) ? gs.pot : 0;
  const toCall = Math.max(0, (Number(gs.currentBet) || 0) - (Number(hero.bet) || 0));
  const call = Math.min(toCall, Number.isFinite(hero.stack) ? Math.max(0, hero.stack) : 0);
  if (!(pot > 0) || !(call > 0)) return null;
  const fraction = horseCallDeductionFraction(hero, gs, call);
  if (fraction === null) return null;
  return Math.max(0, Math.min(0.5, (fraction * (pot + call)) / pot));
}
