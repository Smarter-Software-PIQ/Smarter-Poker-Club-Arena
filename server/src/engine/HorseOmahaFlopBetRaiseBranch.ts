/**
 * OMAHA FLOP BET PRICES THE RAISE (2026-11-18, WooWoo audit lane
 * FLOPBET-RAISE, finding FOURBET F1). Option omahaFlopBetPricesTheRaise,
 * default OFF (read `=== true`).
 *
 * Owner, verbatim: "EVERY DECISION NEEDS TO BE 100% INDEPENDANT AND DATA AND
 * MATH DERRIVED AND BY RANGES, NEVER BLANKETS".
 *
 * The finding (repairs/FOURBET/FINDINGS.md section 4): in 4-bet pots the
 * Horse bet 75-85% of the pot on the flop at a stack-to-pot ratio of 1.1-1.5,
 * was raised (persons raised 15 of 93 such bets) and called off. The v38 EV
 * engine (HorseEvEngine.evaluateSpot) prices each bet size as a fold or a
 * call only: the raising part of his range is averaged into the calls, and
 * the Horse's forced answer to the raise is absent.
 *
 * With the option on, PLO4/PLO5 cash in the priced scope (omahaPricedInScope:
 * one board, high only, no bomb pot, not Lightning, not fixed limit), on the
 * flop, heads-up against a live opponent who can raise, with nothing to call,
 * every bet size of the v38 engine gets the third branch:
 *
 *   EV(bet s) = f.P + (cont - rho).[eqBand-realized call] + rho.max(callOff, -s)
 *
 *  - f: the engine's own fold model for that size (unchanged);
 *  - rho: the share of his whole range that raises a flop bet. No per-player
 *    raise read exists in the one read interface (OmahaPricedRead has no raise
 *    cell), so rho is the MEASURED prior of the one owner,
 *    HorseOmahaPricedSites.OMAHA_PRICED_SITES_FLOP_RAISE_SHARE (0.15, persons
 *    raising Horse flop bets 10-21%, blockbet-013U37; in Horse 4-bet pots
 *    15/93 = 0.16 [0.10, 0.25], FOURBET section 4). It is measured on persons
 *    only, so it is applied against a person only; against a Horse or an
 *    opponent of unknown kind the bet keeps the two-branch price (no
 *    measurement to price with: `_unpriced_kept`).
 *  - the Horse's equity against the raisers: the flop facing-bet sampler's
 *    strongest `rho` of his holdings on this board, card removal applied
 *    (HorseOmahaFlopFacingBetEv.omahaFlopEvCounts(...).top(rho));
 *  - the Horse's answer to the raise: HorseOmahaPricedSites.
 *    omahaPricedSitesFlopRaiseAnswer (his pot raise or all in; the better of
 *    the call and the fold; realization by the same fitted owner), with the
 *    engine's marginal rake.
 *
 * No size, hand-class or stack-to-pot threshold: a smaller size or the check
 * wins only where the arithmetic says the raise branch costs more than it
 * pays. An all-in bet cannot be raised (rho 0 for it).
 */
import type { SeatPlayer } from '../types.js';
import type { HorseDecideOpts, HorseGameStateV2 } from './HorseLogic.js';
import type { EvAction, EvRaiseBranch, EvVerdict } from './HorseEvEngine.js';
import { omahaPricedInScope } from './HorseOmahaPricedWiring.js';
import { omahaOpponentKindOf } from './HorseOmahaPricedMode.js';
import { omahaFlopEvCounts } from './HorseOmahaFlopFacingBetEv.js';
import {
  OMAHA_PRICED_SITES_FLOP_RAISE_SHARE,
  omahaPricedSitesFlopRaiseAnswer,
  omahaPricedSitesFlopRealization,
} from './HorseOmahaPricedSites.js';

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export interface OmahaFlopBetRaiseBranch {
  /** the branch to hand evaluateSpot (EvSpot.raiseBranch) */
  branch: (wager: number) => EvRaiseBranch | null;
  /** rho: the raising share priced */
  raiseShare: number;
  /** where rho came from */
  raiseShareSource: 'person_measured_prior';
  /** the Horse's equity against the raising share */
  equityRaise: number;
}

export type OmahaFlopBetRaiseBranchVerdict =
  | { kind: 'off' }
  | { kind: 'unpriced'; reason: string }
  | { kind: 'priced'; value: OmahaFlopBetRaiseBranch };

/**
 * The raise branch for the v38 flop bet of `player`, or why there is none.
 * `pot`: the pot hero bets into; `effective`: the most either can lose from
 * here (the engine's effective stack); `rake`: the engine's marginal rake.
 * 'off' with the option off or out of the spot (the engine prices exactly as
 * before); 'unpriced' in the spot when it cannot be priced (the engine prices
 * exactly as before; the caller fires `_unpriced_kept`).
 */
export function omahaFlopBetRaiseBranchOf(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  opts: HorseDecideOpts,
  pot: number,
  effective: number,
  inPosition: boolean,
  rake: number
): OmahaFlopBetRaiseBranchVerdict {
  if (opts.omahaFlopBetPricesTheRaise !== true) return { kind: 'off' };
  try {
    if (String(gs.stage ?? '') !== 'flop') return { kind: 'off' };
    const board = gs.communityCards ?? [];
    if (board.length !== 3) return { kind: 'off' };
    if (!omahaPricedInScope(player, gs, opts)) return { kind: 'off' };
    const live = (gs.players ?? []).filter(
      (p) => p.seat !== player.seat && !p.is_folded && !p.is_sitting_out
    );
    if (live.length !== 1) return { kind: 'off' };
    const opp = live[0];
    if (opp.is_all_in || !fin(opp.stack) || !(opp.stack > 0))
      return { kind: 'unpriced', reason: 'opponent_cannot_raise' };
    if (!fin(pot) || !(pot > 0) || !fin(effective) || !(effective > 0))
      return { kind: 'unpriced', reason: 'no_price' };
    if (omahaOpponentKindOf(gs, opp.user_id) !== 'person')
      return { kind: 'unpriced', reason: 'no_measured_raise_share_for_kind' };
    const rho = OMAHA_PRICED_SITES_FLOP_RAISE_SHARE;
    const counts = omahaFlopEvCounts(player.cards, board, player.knownDeadCards ?? [], rho);
    if (counts === null) return { kind: 'unpriced', reason: 'no_sample' };
    const t = counts.top(rho);
    const equityRaise = t.win + t.tie / 2;
    if (!fin(equityRaise)) return { kind: 'unpriced', reason: 'no_sample' };
    const rk = fin(rake) ? Math.max(0, Math.min(0.5, rake)) : 0;
    const branch = (wager: number): EvRaiseBranch | null => {
      if (!fin(wager) || !(wager > 0)) return null;
      const b = Math.min(wager, effective);
      // an all-in bet cannot be raised
      if (b >= effective - 0.005) return { share: 0, equityRaise, evFacingRaise: -b };
      const real = omahaPricedSitesFlopRealization(inPosition, pot, b, effective);
      const answer = omahaPricedSitesFlopRaiseAnswer(pot, b, effective, equityRaise, real, rk);
      return { share: rho, equityRaise, evFacingRaise: answer.ev };
    };
    return {
      kind: 'priced',
      value: {
        branch,
        raiseShare: rho,
        raiseShareSource: 'person_measured_prior',
        equityRaise,
      },
    };
  } catch {
    return { kind: 'unpriced', reason: 'error' };
  }
}

/**
 * What the raise branch did to the engine's highest-EV action (receipts
 * only; the decision is the engine's pick): the best without the branch is
 * the argmax of each wager's fold-or-call price (`evWithoutRaise`).
 *  kept: the same action and size; resized: a bet of another size;
 *  checked: a bet became the check; bet: the check became a bet.
 */
export function omahaFlopBetRaiseBranchChange(
  v: EvVerdict
): 'kept' | 'resized' | 'checked' | 'bet' {
  const without = (a: EvAction): number =>
    (a.kind === 'bet' || a.kind === 'raise') && a.evWithoutRaise !== undefined
      ? a.evWithoutRaise
      : a.ev;
  let was = v.candidates[0];
  for (const a of v.candidates) if (without(a) > without(was)) was = a;
  const now = v.best;
  if (was.kind === 'bet' && now.kind === 'bet')
    return was.amount === now.amount ? 'kept' : 'resized';
  if (was.kind === 'bet') return 'checked';
  if (now.kind === 'bet') return 'bet';
  return 'kept';
}
