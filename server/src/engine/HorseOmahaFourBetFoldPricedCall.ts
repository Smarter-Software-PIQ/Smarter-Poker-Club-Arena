/**
 * omahaFourBetFoldPricedCall (default OFF; EMERG lane PREFLOP-UNCONTESTED, 2026-11-20).
 *
 * LIVEGRADE-7 duty 5: persons win the hands that end before the flop (+352 +/- 27
 * bb/100 Nov 17-19). Lane PREFLOP-UNCONTESTED split that channel: blind steals are
 * about 1% of it; persons' re-raises the Horses fold to carry it (3-bets folded to
 * +1,847 bb, 4-bets or more folded to +1,509 bb, Nov 17-19). Graded on real cards
 * offline, the Horse folds facing a 4-bet or more after its own preflop raise,
 * heads-up, gave up EV(call) +1,302 +/- 138 bb (n 62, Nov 17-20); without the most
 * frequent re-raiser +346 +/- 50 (n 26, no player above 15% of the cell); against
 * Horse re-raisers +13.9 +/- 2.4 a fold (n 19). The exact replay showed why: the
 * reference folds and no priced rule ever examines a FOLD there (the priced call of
 * a re-raise, omahaReraisedCallPriced, only examines calls).
 *
 * The rule, the outermost answer of the wager_rules node: in PLO4/PLO5 cash (table
 * and Lightning, one board, high only, no bomb pot), PREFLOP, the Horse made a raise
 * earlier in this hand, it faces a re-raise with at least three preflop raises in
 * the hand (a 4-bet or more), every other player has folded (heads-up with the
 * re-raiser), and the node's final action is FOLD: the call is priced by the
 * engine's own omahaReraisedCallPriced with the inputs of omahaReraisedCallPricingOf
 * (the re-raiser's public re-raise rate read, the realization by position and
 * depth, the call deduction for rake; nothing forked), and the fold becomes the
 * legal call only when that EV(call) > 0. It changes only a fold, never raises.
 *
 * Public information only: hero's cards, the action, the pot, the chips behind and
 * the re-raiser's public rate. No account, person/Horse flag or unshown card is read.
 */
import type { HorseDecision, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import { omahaNoCategoricalRulesInScope } from './HorseOmahaNoCategoricalRules.js';
import { preflopRaiseCount } from './HorseOmahaReraisedPot.js';
import {
  omahaReraisedCallPriced,
  type OmahaReraisedCallPricing,
  type OmahaReraisedCallPricedNumbers,
} from './HorseOmahaOopReraisedPot.js';

/** The pricing inputs (HorseLogic.omahaReraisedCallPricingOf), registered by HorseLogic at load. */
export type FourBetFoldPricingOf = (
  player: SeatPlayer,
  gs: HorseGameStateV2,
  raiser: SeatPlayer,
  toCall: number,
  stack: number,
  heroBet: number
) => OmahaReraisedCallPricing | undefined;

let pricingOf: FourBetFoldPricingOf | null = null;

/** HorseLogic registers the pricing inputs once (no import cycle; the validator re-runs the same). */
export function registerFourBetFoldPricing(fn: FourBetFoldPricingOf): void {
  pricingOf = fn;
}

export interface OmahaFourBetFoldPricedSpot {
  /** chips the call puts in (the whole stack when short) */
  paid: number;
  allIn: boolean;
  priced: OmahaReraisedCallPricedNumbers;
}

/**
 * The spot and its priced call, or null. Pure in the request (and the registered
 * pricing inputs, which read only public information).
 */
export function omahaFourBetFoldPricedSpot(
  player: SeatPlayer,
  gs: HorseGameStateV2
): OmahaFourBetFoldPricedSpot | null {
  try {
    if (pricingOf === null) return null;
    if (!omahaNoCategoricalRulesInScope(player, gs)) return null;
    if (String(gs.stage ?? '') !== 'preflop') return null;
    if (gs.allInOrFold === true) return null;
    if (player.is_folded || player.is_all_in || player.is_sitting_out) return null;
    const history = gs.actionHistory ?? [];
    if (preflopRaiseCount(history) < 3) return null;
    const heroRaised = history.some(
      (a) =>
        a.stage === 'preflop' &&
        a.seat === player.seat &&
        (a.action === 'raise' ||
          a.action === 'bet' ||
          (a.action === 'all_in' && a.isFullRaise !== undefined))
    );
    if (!heroRaised) return null;
    let raiser: SeatPlayer | undefined;
    for (let k = history.length - 1; k >= 0; k--) {
      const a = history[k]!;
      if (a.stage !== 'preflop' || a.seat === player.seat) continue;
      if (a.action !== 'raise' && a.action !== 'all_in' && a.action !== 'bet') continue;
      raiser = (gs.players ?? []).find((p) => p.seat === a.seat);
      break;
    }
    if (!raiser || raiser.is_folded) return null;
    if (
      (gs.players ?? []).some(
        (p) =>
          p.seat !== player.seat && p.seat !== raiser!.seat && !p.is_folded && !p.is_sitting_out
      )
    )
      return null;
    const heroBet = Number.isFinite(player.bet) ? Math.max(0, player.bet ?? 0) : 0;
    const stack = Number.isFinite(player.stack) ? Math.max(0, player.stack) : 0;
    const toCall = Number.isFinite(gs.toCall)
      ? Math.max(0, gs.toCall as number)
      : Math.max(0, (gs.currentBet || 0) - heroBet);
    if (!(toCall > 0.005) || !(stack > 0)) return null;
    const pot = Number.isFinite(gs.pot) ? Math.max(0, gs.pot) : 0;
    if (!(pot > 0)) return null;
    const legal = Array.isArray(gs.legalActions) ? gs.legalActions : null;
    const allIn = stack <= toCall + 0.005;
    if (legal && !legal.includes('call') && !(allIn && legal.includes('all_in'))) return null;
    const pricing = pricingOf(player, gs, raiser, toCall, stack, heroBet);
    if (!pricing) return null;
    const priced = omahaReraisedCallPriced(
      player.cards ?? [],
      player.knownDeadCards ?? [],
      preflopRaiseCount(history),
      Math.min(toCall, stack),
      pot,
      stack,
      pricing
    );
    if (!priced || !Number.isFinite(priced.evCall) || !(priced.evCall > 0)) return null;
    return { paid: Math.round(Math.min(toCall, stack) * 100) / 100, allIn, priced };
  } catch {
    return null;
  }
}

/** The rule: a final preflop fold in the spot becomes the legal call; everything else is returned unchanged. */
export function omahaFourBetFoldPricedCallRule(
  decision: HorseDecision,
  player: SeatPlayer,
  gs: HorseGameStateV2,
  on: boolean,
  legalize: (d: HorseDecision) => HorseDecision
): HorseDecision {
  if (!on || decision.action !== 'fold') return decision;
  const spot = omahaFourBetFoldPricedSpot(player, gs);
  if (!spot) return decision;
  try {
    const legal = legalize({ ...decision, action: 'call', amount: spot.paid });
    if (legal.action !== 'call' && legal.action !== 'all_in') return decision;
    return { ...decision, action: legal.action, amount: legal.amount };
  } catch {
    return decision;
  }
}

/** The validator's re-run: fold -> call is admitted only where the priced call holds, for the exact chips owed. */
export function omahaFourBetFoldPricedCallAdmitsCall(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  amount: number | null | undefined
): boolean {
  const spot = omahaFourBetFoldPricedSpot(player, gs);
  if (!spot) return false;
  return Number.isFinite(amount) && Math.abs((amount as number) - spot.paid) <= 0.005;
}
