/**
 * PLO6 FACING A BET IS PRICED (2026-11-19, HORSE DECISIONS lane; option
 * plo6FacingBetIsPriced, default OFF, read `=== true`).
 *
 * Owner rules: no blanket rules; every Horse decision priced by range, equity
 * and EV; a bet size never triggers a decision by itself.
 *
 * What decided before (audit HVH48 auditor C, archive
 * plo-handoff-review-01a1cbbd/hvh48-audit-01TLQer7J/C-plo6/REPORT.md, 11,558
 * PLO6 Horse decisions against people, 183 fold mistakes, 156 of them flipped
 * by switching the six fold rules off). PLO6 runs on the categorical Omaha
 * path; every priced Omaha option is PLO4/PLO5 only (omahaStrategyInPlo6 is
 * held off). Facing a bet a PLO6 Horse folds by:
 *   1. plo6RiverNutDiscipline (v58 / v59): a river bet costing over 10% of
 *      the final pot is folded when one RANDOM six-card hand beats the Horse
 *      15% (paired board) / 30% (unpaired) of the time, whatever the bettor's
 *      range and the price; its other arm turns raises into calls.
 *   2. fixed class ceilings on the equity (V15, V40, V87) wherever the line
 *      looks strong.
 *   3. the paired-board fold: below a full house any bet of a quarter of the
 *      stack, whatever the price (the price relief is PLO4/PLO5 only).
 *   4. the paired-river check: below a full house the river is checked after
 *      a called turn bet on a paired board, whatever the value.
 *
 * What this module is: the priced verdict for PLO6 cash (a table or
 * Lightning; never a tournament, a bomb pot, All-In-Or-Fold, hi-lo or more
 * than one board), facing a bet or a raise on the flop, the turn or the
 * river, on the Horse's EXACT six cards against the bettor's line range:
 *
 *  TURN, RIVER  The exact counts of HorseOmahaFacingBetEv with six cards
 *          (every two-card pair of the unseen cards scored with the engine's
 *          evaluator, holdings counted exactly with the Horse's own cards,
 *          the board and known dead cards removed; on the turn every river
 *          card). The bettor's range is the value region his bet's share of
 *          the pot and his line give (the strongest share V of holdings) and
 *          a bluff share q (the measured population prior); the field must
 *          be beaten too. EV(call) against the exact price, net of the
 *          marginal rake, against the one margin. On the river a raise to
 *          each legal size is priced as HorseOmahaPricedRules.omahaPricedRaise
 *          prices it (his bluffs fold first, the strongest part of his value
 *          continues at the price the raise lays him, the top of that
 *          re-raises): the raise is the answer when EV(raise) beats the best
 *          other action by that rule's margin.
 *  FLOP    The seeded sample of HorseOmahaFlopFacingBetEv with six cards
 *          (holdings drawn from the unseen cards and ordered by strength on
 *          the flop, two-card runouts walked evenly, every other player on
 *          the same runouts; the seed is the cards, the brain's random stream
 *          is not touched), its realization model for chips behind.
 *
 * The verdict reads the request alone: no option, no opponent memory, no
 * priced-mode state (withOmahaPricedMode off), so the receipt validator can
 * re-run it on the request (HorseLogic.plo6FacingBetPricedVerdictOf). No
 * random-hand share enters it: the six-card river fold guard of SPEC-A 3.12
 * (plo6FacingBetEvFoldStands) is passed off.
 *
 * Pure: no telemetry, no state of its own.
 */
import type { SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import { omahaPricedBet, omahaPricedRaise } from './HorseOmahaPricedRules.js';
import { OMAHA_PRICED_MODE_OFF, withOmahaPricedMode } from './HorseOmahaPricedMode.js';
import { omahaIsTournamentMode } from './HorseOmahaTournamentScope.js';
import { realizationFactor } from './GtoFacingDefenseV32.js';
import { plo6FlopDefenceVerdict } from './HorsePlo6FlopDefence.js';
import {
  plo6HasPrivateRiverNuts,
  plo6MultiwayRiverVerdict,
  plo6RiverCurrentNutsCallSpot,
  plo6RiverFoldGuardStands,
  plo6RiverStandingCallHolds,
} from './HorsePlo6RiverDefence.js';
import { plo6MultiwayTurnVerdict } from './HorsePlo6MultiwayTurnField.js';

export type Plo6FacingBetStreet = 'flop' | 'turn' | 'river';

/** What the caller supplies from the request (HorseLogic): never an opponent read. */
export interface Plo6FacingBetPricedInputs {
  /** the marginal rake on the pot, as a fraction (0 when capped or none) */
  rake: number;
  /** the Horse acts last on the later streets */
  inPosition: boolean;
  /** the engine's realization factor for turn chips that see a river decision */
  realization: number;
}

export interface Plo6FacingBetPricedVerdict {
  street: Plo6FacingBetStreet;
  /**
   * The priced answer. Flop and turn: fold or call. River: fold, call, or a
   * raise ('raise', or 'all_in' when the priced size is the whole stack).
   */
  action: 'fold' | 'call' | 'raise' | 'all_in';
  /** raise-to for a raise or an all-in raise; 0 otherwise */
  raiseTo: number;
  /** chips the call puts in, and whether that is the whole stack */
  paid: number;
  allInCall: boolean;
  /** EV of the call in chips and the margin it had to exceed: the call is priced when evCall > margin */
  evCall: number;
  margin: number;
  callPriced: boolean;
  /** the best raise row's EV (river only), null when none was priced */
  evRaise: number | null;
  /** the realized win share and tie share the call was priced on, and the price */
  pWin: number;
  pTie: number;
  price: number;
  source: 'exact' | 'sampled';
  /** E7: exact six-card M1 river fold bar (beaten >= 0.15 paired / >= 0.30 unpaired, price > 0.10) */
  riverFoldGuardStands?: boolean;
  /** E7: true when a standing river call has >= 20% equity against the bettor's value region */
  standingRiverCallHolds?: boolean;
  /** E7: exact unbeatable six-card current river nuts where worst-case chop >= call */
  currentRiverNutsFloor?: boolean;
  /** E7: exact unbeatable private-card river nuts (a standing river raise must never be flattened) */
  privateRiverNuts?: boolean;
}

/**
 * The street of a PLO6 cash facing-bet spot this option covers, or null. Public
 * state only: the variant, the table kind, the board, the six cards' count and
 * a bet to call.
 */
export function plo6FacingBetPricedScope(
  player: SeatPlayer,
  gs: HorseGameStateV2
): Plo6FacingBetStreet | null {
  try {
    if (String(gs.gameVariant ?? '').toLowerCase() !== 'plo6') return null;
    if (omahaIsTournamentMode(gs)) return null;
    if (
      gs.variantRules?.splitLow8OrBetter ||
      (gs.boardCount ?? 1) !== 1 ||
      gs.communityCards2?.length ||
      gs.communityCards3?.length ||
      gs.bombPot === true ||
      gs.allInOrFold
    )
      return null;
    const street =
      gs.stage === 'flop'
        ? 'flop'
        : gs.stage === 'turn'
          ? 'turn'
          : gs.stage === 'river'
            ? 'river'
            : null;
    if (street === null) return null;
    const board = gs.communityCards ?? [];
    if (board.length !== (street === 'flop' ? 3 : street === 'turn' ? 4 : 5)) return null;
    if ((player.cards ?? []).length !== 6) return null;
    const toCall = Number.isFinite(gs.toCall)
      ? (gs.toCall as number)
      : Math.max(0, (gs.currentBet || 0) - (player.bet || 0));
    if (!(toCall > 0.005)) return null;
    return street;
  } catch {
    return null;
  }
}

/**
 * The priced verdict, or null outside the scope or when the hand cannot be
 * priced (the caller then leaves the decision as it is).
 */
export function plo6FacingBetPriced(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  inputs: Plo6FacingBetPricedInputs
): Plo6FacingBetPricedVerdict | null {
  const street = plo6FacingBetPricedScope(player, gs);
  if (street === null) return null;
  try {
    return withOmahaPricedMode(OMAHA_PRICED_MODE_OFF, () => {
      const rake = Math.max(0, Math.min(0.2, Number.isFinite(inputs.rake) ? inputs.rake : 0));
      if (street === 'flop') {
        const v = plo6FlopDefenceVerdict(player, gs, {
          rake,
          inPosition: inputs.inPosition === true,
        });
        if (!v) return null;
        return {
          street,
          action: v.call ? 'call' : 'fold',
          raiseTo: 0,
          paid: v.spot.paid,
          allInCall: v.spot.allIn,
          evCall: v.ev,
          margin: v.margin,
          callPriced: v.call,
          evRaise: null,
          pWin: v.pWin,
          pTie: v.pTie,
          price: v.price,
          source: 'sampled',
        };
      }
      if (street === 'turn') {
        const mw = plo6MultiwayTurnVerdict(player, gs, {
          rake,
          inPosition: inputs.inPosition === true,
        });
        if (mw) {
          return {
            street,
            action: mw.call ? 'call' : 'fold',
            raiseTo: 0,
            paid: mw.spot.paid,
            allInCall: mw.spot.allIn,
            evCall: mw.ev,
            margin: mw.margin,
            callPriced: mw.call,
            evRaise: null,
            pWin: mw.pWin,
            pTie: mw.pTie,
            price: mw.price,
            source: 'sampled',
          };
        }
      }
      const r = omahaPricedRaise(player, gs, {
        rake,
        realization: inputs.realization,
        plo6Priced: true,
      });
      if (!r) {
        if (street === 'river') {
          const nutsSpot = plo6RiverCurrentNutsCallSpot(player, gs);
          if (nutsSpot) {
            const pot = Math.max(0, Number.isFinite(gs.pot) ? gs.pot : 0);
            const price = nutsSpot.paid / Math.max(1e-9, pot + nutsSpot.paid);
            return {
              street,
              action: 'call',
              raiseTo: 0,
              paid: nutsSpot.paid,
              allInCall: nutsSpot.allIn,
              evCall: Math.max(0.01, pot - nutsSpot.paid),
              margin: 0,
              callPriced: true,
              evRaise: null,
              pWin: 1,
              pTie: 0,
              price,
              source: 'exact',
              riverFoldGuardStands: false,
              currentRiverNutsFloor: true,
              privateRiverNuts: plo6HasPrivateRiverNuts(player, gs),
            };
          }
        }
        return null;
      }
      if (street === 'turn') {
        const callPriced = r.call.call;
        return {
          street,
          action: callPriced ? 'call' : 'fold',
          raiseTo: 0,
          paid: r.spot.paid,
          allInCall: r.spot.allIn,
          evCall: r.call.ev,
          margin: r.call.margin,
          callPriced,
          evRaise: null,
          pWin: r.call.pWin,
          pTie: r.call.pTie,
          price: r.call.price,
          source: 'exact',
        };
      }
      // E7 (river): joint six-card multiway river field + value-domination guard + current-nuts floor + nut-raise protection.
      const nutsSpot = plo6RiverCurrentNutsCallSpot(player, gs);
      const privateRiverNuts = plo6HasPrivateRiverNuts(player, gs, r.spot);
      const mwRiver =
        r.spot.callers + r.spot.allIns + r.spot.behind > 0
          ? plo6MultiwayRiverVerdict(player, gs, { rake }, r.spot)
          : null;
      const guardStands =
        nutsSpot !== null ? false : plo6RiverFoldGuardStands(player, gs, r.spot) === true;
      const standingCallHolds =
        !guardStands && mwRiver === null && plo6RiverStandingCallHolds(player, gs, r.spot);
      const baseCallOk = mwRiver !== null ? mwRiver.call : r.call.call;
      const callPriced = nutsSpot !== null ? true : baseCallOk && !guardStands;
      const evCallRaw = mwRiver !== null ? mwRiver.ev : r.call.ev;
      const marginRaw = mwRiver !== null ? mwRiver.margin : r.call.margin;
      let action: Plo6FacingBetPricedVerdict['action'];
      if (guardStands) {
        action = 'fold';
      } else if (
        (r.action === 'raise' || r.action === 'all_in') &&
        (mwRiver === null || callPriced || privateRiverNuts)
      ) {
        action = r.action;
      } else {
        action = callPriced ? 'call' : 'fold';
      }
      return {
        street,
        action,
        raiseTo: action === 'raise' || action === 'all_in' ? r.amount : 0,
        paid: r.spot.paid,
        allInCall: r.spot.allIn,
        evCall: nutsSpot !== null && evCallRaw <= marginRaw ? marginRaw + 0.01 : evCallRaw,
        margin: marginRaw,
        callPriced,
        evRaise: r.best ? r.best.ev : null,
        pWin: mwRiver !== null ? mwRiver.pWin : r.call.pWin,
        pTie: mwRiver !== null ? mwRiver.pTie : r.call.pTie,
        price: r.call.price,
        source: mwRiver !== null ? 'sampled' : 'exact',
        riverFoldGuardStands: guardStands,
        standingRiverCallHolds: standingCallHolds,
        currentRiverNutsFloor: nutsSpot !== null,
        privateRiverNuts,
      };
    });
  } catch {
    return null;
  }
}

/** The paired-river check, priced: EV of the bet another owner chose against EV of the check. */
export interface Plo6PairedRiverBetPriced {
  evBet: number;
  evCheck: number;
  /** the bet is worth at least the check */
  betStands: boolean;
}

/**
 * PLO6 cash river with nothing to call: the bet `amount` priced beside the
 * check against every live opponent's range as his line left it
 * (HorseOmahaPricedRules.omahaPricedBet with no opponent read: the population
 * figures). Null outside PLO6 cash or when it cannot be priced.
 */
export function plo6PairedRiverBetPriced(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  amount: number
): Plo6PairedRiverBetPriced | null {
  try {
    if (String(gs.gameVariant ?? '').toLowerCase() !== 'plo6' || gs.stage !== 'river') return null;
    if (omahaIsTournamentMode(gs) || gs.bombPot === true || gs.allInOrFold) return null;
    if ((gs.boardCount ?? 1) !== 1 || gs.communityCards2?.length || gs.communityCards3?.length)
      return null;
    if (gs.variantRules?.splitLow8OrBetter) return null;
    if ((player.cards ?? []).length !== 6 || !(Number.isFinite(amount) && amount > 0)) return null;
    return withOmahaPricedMode(OMAHA_PRICED_MODE_OFF, () => {
      const v = omahaPricedBet(player, gs, () => null, amount, 0, { plo6Priced: true });
      if (!v || !v.proposed) return null;
      return {
        evBet: v.proposed.ev,
        evCheck: v.evCheck,
        betStands: v.proposed.ev >= v.evCheck,
      };
    });
  } catch {
    return null;
  }
}

/**
 * Receipt validation (the request carries no option and no rake state): may
 * the wager_rules node of a PLO6 cash decision have turned a fold (or a raise
 * the paired-board fold folded) into the call of `amount`? True when the call
 * is priced (EV over the margin) for the exact chips it puts in, re-run on the
 * request with no rake (rake only lowers the value of a call, so this admits
 * every call the rule can make) in either position (the turn realization of
 * that position). The whole-stack call is an all-in, a wager action, admitted
 * elsewhere.
 */
export function plo6FacingBetPricedAdmitsCall(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  amount: number | null | undefined
): boolean {
  try {
    if (typeof amount !== 'number' || !Number.isFinite(amount)) return false;
    if (plo6FacingBetPricedScope(player, gs) === null) return false;
    for (const inPosition of [true, false]) {
      const v = plo6FacingBetPriced(player, gs, {
        rake: 0,
        inPosition,
        realization: realizationFactor({ street: 'turn', inPosition }),
      });
      if (!v) return false;
      if (v.allInCall || Math.abs(v.paid - amount) > 0.005) return false;
      if (v.callPriced) return true;
    }
    return false;
  } catch {
    return false;
  }
}
