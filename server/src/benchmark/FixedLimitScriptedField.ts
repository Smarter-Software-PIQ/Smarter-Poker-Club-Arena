/**
 * THE SCRIPTED FIXED-LIMIT FIELD (2026-11-20).
 *
 * docs/horse-league-fixed-limit.md section 1: the fixed-limit options built
 * for opponents unlike Horses (a maniac who raises and caps light; a
 * value-only player) almost never change a decision in a Horse mirror, so the
 * league needs scripted fixed-limit seats to measure them. These are those
 * seats, as LeagueSeatPolicy functions seated through the league's existing
 * human-field mechanism (LeagueMatchup.opponentPopulation =
 * FIXED_LIMIT_SCRIPTED_POPULATION_ID, LeagueMatchup.humanPersona = the
 * persona; runHumanFieldMatchup seats them through LeagueHumanField
 * .seatPolicyOf).
 *
 * Invariants (pinned by HorseLeagueFixedLimitField.test.ts):
 *  - A script reads only its own cards and the public state (LeagueSeatSpot);
 *    it never calls the Horse brain and consumes no randomness, so it is a
 *    pure function of the deal seed and the actions before it, and the field
 *    plays the same in both passes of a pair until the hero's arms differ.
 *  - It is offered the controller's own fixed-limit menu
 *    (LeagueDecisionState.leagueActionState, through HorseLeague
 *    seatPolicyDecision) and answers only with an action on that menu, at the
 *    one legal wager amount. Its answer then goes through the same validation
 *    as a Horse's, and the real-HandController replay accepts every one.
 *
 * Every frequency below is either quoted from a record in this repository
 * (the source sits next to the constant) or labelled DESIGN VALUE: chosen
 * here because no record states it. The Fixed-Limit lane's own scripts live
 * in its evidence archive outside the repository, and their thresholds are
 * not recorded here, so the tight-value postflop rule is a design value.
 *
 * Measurement plumbing only: no production caller, no database, no writer.
 * Horses are never called bots.
 */
import type { Card, HandStage } from '../types.js';
import { scoreHoldem } from '../engine/HorseEval.js';
import { humanCalibratedPreflopPercentile } from './HumanCalibratedPopulation.js';
import {
  FLH_DEFENDING_POSTFLOP_BLINDS_PERSONA,
  FLH_MANIAC_PERSONA,
  FLH_OVER_FOLDING_BLINDS_PERSONA,
  FLH_PASSIVE_CALLER_PERSONA,
  FLH_PREFLOP_DEFENDING_BLINDS_PERSONA,
  FLH_TIGHT_VALUE_PERSONA,
  FLH_VALUE_ONLY_BLINDS_PERSONA,
  type FixedLimitScriptedPersona,
} from './HorseLeagueHumanField.js';
import type { LeagueSeatPolicy, LeagueSeatSpot } from './HorseLeague.js';

type Decision = { action: string; amount?: number };

/** The one legal wager on the menu (a bet or a raise), or null when none is legal. */
function fixedWager(s: LeagueSeatSpot): Decision | null {
  const kind = s.legalActions.includes('raise')
    ? 'raise'
    : s.legalActions.includes('bet')
      ? 'bet'
      : null;
  if (kind === null || s.minRaiseTo === null) return null;
  return { action: kind, amount: s.minRaiseTo };
}

/** Call when there is a price, check when there is none. */
function callOrCheck(s: LeagueSeatSpot): Decision {
  return s.toCall > 0 ? { action: 'call' } : { action: 'check' };
}

/** Fold when there is a price, check when there is none. */
function foldOrCheck(s: LeagueSeatSpot): Decision {
  return s.toCall > 0 ? { action: 'fold' } : { action: 'check' };
}

/** Bets and raises already made on this street (the blinds are not in the history). */
export function streetWagers(s: Pick<LeagueSeatSpot, 'history' | 'stage'>): number {
  return s.history.filter(
    (a) => a.stage === s.stage && (a.action === 'bet' || a.action === 'raise')
  ).length;
}

// ─────────────────────────────────────────────────────────────────────────────
// flh_maniac_v1
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bets or raises whenever a wager is legal, otherwise calls, never folds.
 *
 * Source: docs/horse-league-fixed-limit.md section 1 ("The maniac is fully
 * specified by the menu (bet or raise whenever one is legal, otherwise call,
 * never fold)"), which is the lane's "Sustained maniac (every hand, every
 * bet)" (docs/horse-default-on.d/fixedLimitBetsAreNeverProbes.md, Value) and
 * its "scripted maniac who bets every checked street" (same file, Mechanism).
 * Every frequency is 100% or 0%: wager rate 1.0 whenever the menu offers one,
 * fold rate 0.0. On a capped street the menu offers fold and call only, so it
 * calls.
 */
export const flhManiacPolicy: LeagueSeatPolicy = (s) => fixedWager(s) ?? callOrCheck(s);

// ─────────────────────────────────────────────────────────────────────────────
// flh_tight_value_v1
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Preflop entry, by the hand's calibrated preflop percentile (0 worst .. 1
 * best, humanCalibratedPreflopPercentile). Raise or fold: a value-only player
 * never limps or cold-calls a single raise below its calling bar.
 *
 * Source: the plain tight-aggressive regular of ExploiterLeague.ts
 * (regPreflop / openTop, "reference: a plain tight-aggressive regular (no
 * exploit)"), the repository's one recorded tight reference policy, with each
 * no-limit sizing replaced by the single fixed-limit wager. Its six-max first-in
 * share (top 26%) sits inside the 21 to 27 percent raise share the lane
 * recorded for its tight-value player (docs/changelog/
 * 2026-11-14-fixed-limit-tight-reads.md, T1: "a 21-27 percent raiser").
 */
export const FLH_TIGHT_VALUE_PREFLOP = Object.freeze({
  /** First in, share of hands raised, by table size (ExploiterLeague openTop). */
  openTopHeadsUp: 0.8,
  openTopSixMax: 0.26,
  openTopFullRing: 0.18,
  /** Big blind with no raise: raises the top 15% (regPreflop: p >= 0.85), else checks. */
  freeRaiseAt: 0.85,
  /** Facing one raise: re-raises at or above, calls at or above, else folds (regPreflop). */
  facingRaise: { reraiseHeadsUp: 0.85, reraise: 0.94, callHeadsUp: 0.5, call: 0.82 },
  /** Facing two raises or more: caps at or above, calls at or above, else folds (regPreflop). */
  facingReraise: { reraise: 0.975, call: 0.95 },
});

/**
 * Postflop: value only. DESIGN VALUE (no record in this repository states the
 * lane's tight-value postflop thresholds; docs/horse-league-fixed-limit.md
 * asked for them to be ported, and they are not here to port). The rule reads
 * the hand's made class only (no draw, no read, no randomness), and a class
 * counts only when the player's own cards improve on the board's:
 *  - bets or raises with two pair or better;
 *  - re-raises (a third wager or more) with trips or better only;
 *  - calls one wager with one pair or better; calls two wagers or more with two
 *    pair or better; otherwise checks or folds;
 *  - never bets or raises without a made hand (no bluff, no semi-bluff).
 */
export const FLH_TIGHT_VALUE_POSTFLOP = Object.freeze({
  /** Made class (scoreHoldem category: 2 pair, 3 two pair, 4 trips) to bet or raise. */
  valueClass: 3,
  /** Made class to put in a third wager or more on a street. */
  reraiseClass: 4,
  /** Made class to call one wager. */
  callClass: 2,
  /** Made class to call two wagers or more. */
  callRaisedClass: 3,
});

/** scoreHoldem's category (1 high card .. 9 straight flush) of the best hand in `cards`. */
function madeClass(cards: readonly Card[]): number {
  if (cards.length >= 5)
    return Math.floor(scoreHoldem(cards as Card[], cards.length, false) / 2 ** 20);
  // Three or four board cards: only the rank pattern can be made.
  const counts = new Map<string, number>();
  for (const c of cards) counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1);
  const n = [...counts.values()].sort((a, b) => b - a);
  if (n[0] === 4) return 8;
  if (n[0] === 3) return 4;
  if (n[0] === 2 && n[1] === 2) return 3;
  if (n[0] === 2) return 2;
  return 1;
}

/** The seat's made class, or 1 (nothing) when its own cards do not improve on the board's. */
export function ownMadeClass(cards: readonly Card[], board: readonly Card[]): number {
  const made = madeClass([...cards, ...board]);
  return made > madeClass(board) ? made : 1;
}

function tightValuePreflop(s: LeagueSeatSpot): Decision {
  const p = humanCalibratedPreflopPercentile(s.cards, s.variant);
  const t = FLH_TIGHT_VALUE_PREFLOP;
  const hu = s.numSeats <= 2;
  const raises = streetWagers(s);
  const wager = fixedWager(s);
  const raiseOr = (fallback: Decision): Decision => wager ?? fallback;
  if (raises === 0) {
    if (s.toCall <= 0)
      return p >= t.freeRaiseAt ? raiseOr({ action: 'check' }) : { action: 'check' };
    const top = hu ? t.openTopHeadsUp : s.numSeats <= 6 ? t.openTopSixMax : t.openTopFullRing;
    return p >= 1 - top ? raiseOr(callOrCheck(s)) : foldOrCheck(s);
  }
  if (raises === 1) {
    if (p >= (hu ? t.facingRaise.reraiseHeadsUp : t.facingRaise.reraise))
      return raiseOr(callOrCheck(s));
    if (p >= (hu ? t.facingRaise.callHeadsUp : t.facingRaise.call)) return callOrCheck(s);
    return foldOrCheck(s);
  }
  if (p >= t.facingReraise.reraise) return raiseOr(callOrCheck(s));
  if (p >= t.facingReraise.call) return callOrCheck(s);
  return foldOrCheck(s);
}

function tightValuePostflop(s: LeagueSeatSpot): Decision {
  const t = FLH_TIGHT_VALUE_POSTFLOP;
  const made = ownMadeClass(s.cards, s.board);
  const wagers = streetWagers(s);
  const wager = fixedWager(s);
  if (s.toCall <= 0) return made >= t.valueClass && wager ? wager : { action: 'check' };
  // Facing `wagers` bets and raises: a raise would be wager number wagers + 1.
  if (wager && made >= (wagers >= 2 ? t.reraiseClass : t.valueClass)) return wager;
  if (made >= (wagers >= 2 ? t.callRaisedClass : t.callClass)) return { action: 'call' };
  return { action: 'fold' };
}

export const flhTightValuePolicy: LeagueSeatPolicy = (s) =>
  (s.stage as HandStage) === 'preflop' ? tightValuePreflop(s) : tightValuePostflop(s);

// ─────────────────────────────────────────────────────────────────────────────
// flh_passive_caller_v1 (2026-11-21)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A passive caller: calls wide preflop, never folds after the flop, bets only
 * strong hands and rarely raises. It is the field a first-to-act river lead
 * can be paid by (it checks behind most hands that call a bet) and a third
 * river-betting range for the one-bet value raise (it bets a made hand and
 * never folds it to a raise).
 *
 * Source: the calling station of ExploiterLeague.ts (callingStation: "Never
 * folds after the flop; calls wide preflop; bets only strong hands"), the
 * repository's one recorded passive-caller policy. Preflop is its percentile
 * bars unchanged, each no-limit size replaced by the one fixed-limit wager:
 * unraised it calls at percentile 0.40 or better and never raises first in;
 * facing one raise it re-raises at 0.92, calls at 0.40; facing two or more it
 * calls at 0.60. Postflop "never folds" is kept as written.
 */
export const FLH_PASSIVE_CALLER_PREFLOP = Object.freeze({
  /** Unraised or facing one raise: calls at or above (callingStation: p >= 0.4). */
  callAt: 0.4,
  /** Facing one raise: re-raises at or above (callingStation: p >= 0.92). */
  reraiseAt: 0.92,
  /** Facing two raises or more: calls at or above (callingStation: p >= 0.6). */
  callReraisedAt: 0.6,
});

/**
 * Postflop bars by made class. DESIGN VALUE: callingStation bets at a Monte
 * Carlo equity of 0.75 or better and raises at 0.95 or better, and a script
 * here may consume no randomness, so each equity bar is replaced by a made
 * class chosen here (no record states a class for them):
 *  - checked to, it bets with two pair or better, otherwise checks;
 *  - facing a wager it raises only with a full house or better, otherwise
 *    calls: it never folds after the flop (sourced, above).
 */
export const FLH_PASSIVE_CALLER_POSTFLOP = Object.freeze({
  /** Made class (scoreHoldem category: 3 two pair) to bet when checked to. DESIGN VALUE. */
  betClass: 3,
  /** Made class (7 full house) to raise a wager. DESIGN VALUE. */
  raiseClass: 7,
});

function passiveCallerPreflop(s: LeagueSeatSpot): Decision {
  const p = humanCalibratedPreflopPercentile(s.cards, s.variant);
  const t = FLH_PASSIVE_CALLER_PREFLOP;
  const raises = streetWagers(s);
  if (raises === 0) {
    if (s.toCall <= 0) return { action: 'check' };
    return p >= t.callAt ? { action: 'call' } : { action: 'fold' };
  }
  if (raises === 1) {
    if (p >= t.reraiseAt) return fixedWager(s) ?? callOrCheck(s);
    return p >= t.callAt ? callOrCheck(s) : foldOrCheck(s);
  }
  return p >= t.callReraisedAt ? callOrCheck(s) : foldOrCheck(s);
}

function passiveCallerPostflop(s: LeagueSeatSpot): Decision {
  const t = FLH_PASSIVE_CALLER_POSTFLOP;
  const made = ownMadeClass(s.cards, s.board);
  const wager = fixedWager(s);
  if (s.toCall <= 0) return made >= t.betClass && wager ? wager : { action: 'check' };
  if (wager && made >= t.raiseClass) return wager;
  return { action: 'call' };
}

export const flhPassiveCallerPolicy: LeagueSeatPolicy = (s) =>
  (s.stage as HandStage) === 'preflop' ? passiveCallerPreflop(s) : passiveCallerPostflop(s);

// ─────────────────────────────────────────────────────────────────────────────
// flh_over_folding_blinds_v1 (2026-11-21)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Over-folding blinds: the field fixedLimitStealVsTightBlinds was built for.
 *
 * What the option reads (HorseFixedLimitPreflop.fixedLimitOverFolder): the
 * opponent's own POSTFLOP fold to a bet engaged high on at least
 * FIXED_LIMIT_STEAL_MIN_OPPS (15) decayed opportunities, with no preflop
 * statistic (vpip, pfr, rfi, threeBet) engaged wide. So the script must give
 * up its blinds, fold postflop, and not be wide preflop.
 *
 * Why every postflop and raising frequency here is 0% or 100%. The read ages
 * an opportunity-gated statistic at the fast rate (half-life 8 hands instead
 * of 30 opportunity hands) whenever a fast-window rate differs from the long
 * one by 0.2 (HorseOpponentExploit.styleShiftReleased, STYLE_SHIFT_PFR_GAP),
 * and a mixed frequency trips that by chance. The first form of this script
 * (flh_tight_value_v1's raise-or-fold preflop with a fit-or-fold postflop that
 * continued with two pair or better) was measured on 2026-11-21, seed
 * 20261115: 0 of 10,000 pairs diverged, and the one counter row printed
 * during a separate 2,500-pair run held 12.4 decayed fold opportunities,
 * under the 15 the option needs (docs/horse-league-fixed-limit.md).
 * A script with no mixed frequency keeps its opportunities.
 *
 * Preflop: never raises. Its entry shares and calling bars are
 * flh_tight_value_v1's (FLH_TIGHT_VALUE_PREFLOP, sourced from ExploiterLeague
 * .ts regPreflop / openTop) with every raise replaced by a call; that
 * replacement is a DESIGN VALUE. First in it calls the share tight-value
 * opens (26% at up to six seats) and folds the rest; the big blind checks its
 * option; facing one raise it calls at percentile 0.82 or better (heads-up
 * 0.50) and folds the rest, so at six seats a blind folds to a single raise
 * 82% of the time, where the published fixed-limit defence widths quoted in
 * HorseFixedLimitPreflop.ts (REFERENCES) are 45 to 55 percent defended against
 * an early raise and 75 to 85 against the button; facing two raises or more
 * it calls at 0.95.
 *
 * Postflop: checks whenever it may and folds to every wager. DESIGN VALUE (no
 * record in this repository states the lane's over-folder thresholds,
 * docs/horse-league-fixed-limit.md): this is the extreme over-folder, the one
 * range the option is most favoured against, and a card against it is a
 * favourable-range measurement, never a harm control.
 */
function overFoldingBlindsPreflop(s: LeagueSeatSpot): Decision {
  const p = humanCalibratedPreflopPercentile(s.cards, s.variant);
  const t = FLH_TIGHT_VALUE_PREFLOP;
  const hu = s.numSeats <= 2;
  const raises = streetWagers(s);
  if (raises === 0) {
    if (s.toCall <= 0) return { action: 'check' };
    const top = hu ? t.openTopHeadsUp : s.numSeats <= 6 ? t.openTopSixMax : t.openTopFullRing;
    return p >= 1 - top ? { action: 'call' } : { action: 'fold' };
  }
  const bar =
    raises === 1 ? (hu ? t.facingRaise.callHeadsUp : t.facingRaise.call) : t.facingReraise.call;
  return p >= bar ? callOrCheck(s) : foldOrCheck(s);
}

export const flhOverFoldingBlindsPolicy: LeagueSeatPolicy = (s) =>
  (s.stage as HandStage) === 'preflop' ? overFoldingBlindsPreflop(s) : foldOrCheck(s);

// ─────────────────────────────────────────────────────────────────────────────
// The steal's harm controls (2026-11-21)
// ─────────────────────────────────────────────────────────────────────────────
//
// fixedLimitStealVsTightBlinds widens a late first-in open when every player
// behind reads as an over-folder (postflop fold to a bet engaged high on at
// least 15 decayed opportunities, no preflop statistic engaged wide). The
// over-folding blinds above are the range it is most favoured against. A harm
// control is a range where the same postflop folding is real but the widened
// open is punished: by a value-only range that re-raises it, or by blinds
// that call it preflop. Neither is a favourable-range measurement.

/**
 * flh_value_only_blinds_v1: a value-only range.
 *
 * Preflop is flh_tight_value_v1's raise or fold (FLH_TIGHT_VALUE_PREFLOP,
 * sourced from ExploiterLeague.ts regPreflop / openTop): it enters only by
 * raising, re-raises a single raise with the top 6% at six seats (top 15%
 * heads-up) and calls a band below that, so a widened steal meets a value
 * re-raise or a value call.
 *
 * Postflop: DESIGN VALUE (no record in this repository states a value-only
 * player's postflop continuation thresholds). It continues only with two
 * pair or better (made class counted only when its own cards improve on the
 * board, as flh_tight_value_v1): checked to it bets two pair or better, else
 * checks; facing a wager it raises two pair or better (a third wager or more
 * only with trips or better, as flh_tight_value_v1) and folds everything
 * else, one pair included. So it folds to most postflop bets, which is what
 * the over-folder read measures, while every chip it puts in after the flop
 * is value. Its fold frequency is set by its cards, not by a random draw.
 */
export const FLH_VALUE_ONLY_POSTFLOP = Object.freeze({
  /** Made class (scoreHoldem category: 3 two pair) to bet, raise or continue. DESIGN VALUE. */
  continueClass: 3,
  /** Made class (4 trips) to put in a third wager or more (FLH_TIGHT_VALUE_POSTFLOP.reraiseClass). */
  reraiseClass: FLH_TIGHT_VALUE_POSTFLOP.reraiseClass,
});

function valueOnlyPostflop(s: LeagueSeatSpot): Decision {
  const t = FLH_VALUE_ONLY_POSTFLOP;
  const made = ownMadeClass(s.cards, s.board);
  const wager = fixedWager(s);
  if (s.toCall <= 0) return made >= t.continueClass && wager ? wager : { action: 'check' };
  if (made < t.continueClass) return { action: 'fold' };
  if (wager && made >= (streetWagers(s) >= 2 ? t.reraiseClass : t.continueClass)) return wager;
  return { action: 'call' };
}

export const flhValueOnlyBlindsPolicy: LeagueSeatPolicy = (s) =>
  (s.stage as HandStage) === 'preflop' ? tightValuePreflop(s) : valueOnlyPostflop(s);

/**
 * flh_preflop_defending_blinds_v1: blinds that defend preflop and fold
 * postflop.
 *
 * Preflop: never raises. First in it calls the share flh_tight_value_v1 opens
 * (FLH_TIGHT_VALUE_PREFLOP.openTop*) and folds the rest; the big blind checks
 * its option; facing two raises or more it calls at FLH_TIGHT_VALUE_PREFLOP
 * .facingReraise.call (0.95). Facing one raise it defends at the published
 * fixed-limit blind defence widths quoted in HorseFixedLimitPreflop.ts
 * (REFERENCES): "vs the button ~75-85%" and "heads-up ~85-90%". It calls at
 * percentile 0.20 or better at three to six seats (80% defended, the middle
 * of the button range, the steal being a late open) and at 0.12 or better
 * heads-up (88%, the middle of the heads-up range). Above six seats it uses
 * the early-raise width "vs early ~45-55%" (0.50, 50% defended).
 *
 * Postflop: checks whenever it may and folds to every wager, as
 * flh_over_folding_blinds_v1. DESIGN VALUE.
 */
export const FLH_PREFLOP_DEFENDING_BLINDS_PREFLOP = Object.freeze({
  /** Facing one raise, calls at or above this percentile (HorseFixedLimitPreflop REFERENCES). */
  defendHeadsUp: 0.12,
  defendShortHanded: 0.2,
  defendFullRing: 0.5,
});

function preflopDefendingBlindsPreflop(s: LeagueSeatSpot): Decision {
  const p = humanCalibratedPreflopPercentile(s.cards, s.variant);
  const t = FLH_TIGHT_VALUE_PREFLOP;
  const d = FLH_PREFLOP_DEFENDING_BLINDS_PREFLOP;
  const hu = s.numSeats <= 2;
  const raises = streetWagers(s);
  if (raises === 0) {
    if (s.toCall <= 0) return { action: 'check' };
    const top = hu ? t.openTopHeadsUp : s.numSeats <= 6 ? t.openTopSixMax : t.openTopFullRing;
    return p >= 1 - top ? { action: 'call' } : { action: 'fold' };
  }
  const bar =
    raises === 1
      ? hu
        ? d.defendHeadsUp
        : s.numSeats <= 6
          ? d.defendShortHanded
          : d.defendFullRing
      : t.facingReraise.call;
  return p >= bar ? callOrCheck(s) : foldOrCheck(s);
}

export const flhPreflopDefendingBlindsPolicy: LeagueSeatPolicy = (s) =>
  (s.stage as HandStage) === 'preflop' ? preflopDefendingBlindsPreflop(s) : foldOrCheck(s);

/**
 * flh_defending_postflop_blinds_v1 (2026-11-21): steal harm control that
 * defends preflop AND continues postflop with top pair or better on the flop
 * and two pair or better on every street.
 *
 * Preflop: identical to flh_preflop_defending_blinds_v1 (never raises so
 * pfr = rfi = threeBet = 0 never trips styleShiftReleased; defends 80% at
 * six-max and 88% heads-up against a single raise).
 *
 * Postflop: DESIGN VALUE (fit-or-fold continuation calibrated to keep
 * multi-street postflop foldToBet safely above the holdem:full over-folder
 * envelope high edge 0.633 while punishing widened trash steals postflop):
 *  - two pair or better (ownMadeClass >= 3): bets when checked to, raises one
 *    wager, caps/reraises with trips or better (ownMadeClass >= 4), otherwise calls;
 *  - top pair or overpair (ownMadeClass === 2 matching highest board rank or
 *    pocket pair above highest board rank): bets when checked to on the flop
 *    and calls one flop small bet, then folds unimproved one pair to turn/river
 *    big-bet wagers;
 *  - weaker one pair (middle/bottom/underpair) or high card: checks or folds.
 */
const RANK_ORDER = '23456789TJQKA';
function rankValue(rank: string): number {
  const idx = RANK_ORDER.indexOf(rank === '10' ? 'T' : rank.toUpperCase());
  return idx >= 0 ? idx + 2 : 0;
}

/** True when hole cards make top pair (matching highest board rank) or an overpair. */
export function hasTopPairOrOverpair(cards: readonly Card[], board: readonly Card[]): boolean {
  if (cards.length < 2 || board.length < 3) return false;
  let topBoard = 0;
  for (const c of board) topBoard = Math.max(topBoard, rankValue(c.rank));
  const r0 = rankValue(cards[0].rank);
  const r1 = rankValue(cards[1].rank);
  if (r0 === r1 && r0 > topBoard) return true;
  return r0 === topBoard || r1 === topBoard;
}

export const FLH_DEFENDING_POSTFLOP_BLINDS_POSTFLOP = Object.freeze({
  /** Made class (scoreHoldem category: 3 two pair) to raise one wager or call two+. DESIGN VALUE. */
  valueClass: FLH_TIGHT_VALUE_POSTFLOP.valueClass,
  /** Made class (4 trips) to put in a third wager or more. DESIGN VALUE. */
  reraiseClass: FLH_TIGHT_VALUE_POSTFLOP.reraiseClass,
});

function defendingPostflopBlindsPostflop(s: LeagueSeatSpot): Decision {
  const t = FLH_DEFENDING_POSTFLOP_BLINDS_POSTFLOP;
  const made = ownMadeClass(s.cards, s.board);
  const flopTopPair =
    (s.stage as HandStage) === 'flop' && made === 2 && hasTopPairOrOverpair(s.cards, s.board);
  const wagers = streetWagers(s);
  const wager = fixedWager(s);
  if (s.toCall <= 0)
    return (made >= t.valueClass || flopTopPair) && wager ? wager : { action: 'check' };
  if (made >= t.valueClass) {
    if (wager && made >= (wagers >= 2 ? t.reraiseClass : t.valueClass)) return wager;
    return { action: 'call' };
  }
  if (flopTopPair && wagers < 2) return { action: 'call' };
  return { action: 'fold' };
}

export const flhDefendingPostflopBlindsPolicy: LeagueSeatPolicy = (s) =>
  (s.stage as HandStage) === 'preflop'
    ? preflopDefendingBlindsPreflop(s)
    : defendingPostflopBlindsPostflop(s);

// ─────────────────────────────────────────────────────────────────────────────
// The no-limit probe history (LeagueMatchup.probeHistoryHands)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The no-limit hands a card may play before its fixed-limit pairs, so the
 * field's pooled probe share is non-zero (docs/horse-league-fixed-limit.md
 * section 2). Preflop it checks or calls, never raises; after the flop it
 * makes the minimum bet whenever it is checked to and calls any bet. Every
 * such bet is one big blind, which the probe rule counts as a probe
 * (HorseOpponentExploit: a checked-to first bet of at most
 * max(bigBlind, PROBE_BET_MAX_POT_SHARE * pot)); its never-raise preflop keeps
 * hands going to the flop so the tallies fill. DESIGN VALUE: the lane's own
 * seeding (AB-EVALUATION-2.md 3.1 (b), outside this repository) is not
 * recorded here; the law AFixedLimitReadIsNeverProbeDiscounted.law.test.ts
 * seeds a pooled share of 90 probes in 120 checked-to bets by hand, and this
 * script reaches its share by play.
 */
export const nlhProbeWarmupPolicy: LeagueSeatPolicy = (s) => {
  if (s.toCall > 0)
    return s.legalActions.includes('call') ? { action: 'call' } : { action: 'fold' };
  if (
    (s.stage as HandStage) !== 'preflop' &&
    s.legalActions.includes('bet') &&
    s.minRaiseTo !== null
  )
    return { action: 'bet', amount: s.minRaiseTo };
  return { action: 'check' };
};

/** The seat policy a scripted fixed-limit persona plays. */
export function fixedLimitScriptedPolicy(persona: FixedLimitScriptedPersona): LeagueSeatPolicy {
  if (persona === FLH_MANIAC_PERSONA) return flhManiacPolicy;
  if (persona === FLH_TIGHT_VALUE_PERSONA) return flhTightValuePolicy;
  if (persona === FLH_PASSIVE_CALLER_PERSONA) return flhPassiveCallerPolicy;
  if (persona === FLH_OVER_FOLDING_BLINDS_PERSONA) return flhOverFoldingBlindsPolicy;
  if (persona === FLH_VALUE_ONLY_BLINDS_PERSONA) return flhValueOnlyBlindsPolicy;
  if (persona === FLH_PREFLOP_DEFENDING_BLINDS_PERSONA) return flhPreflopDefendingBlindsPolicy;
  if (persona === FLH_DEFENDING_POSTFLOP_BLINDS_PERSONA) return flhDefendingPostflopBlindsPolicy;
  throw new Error(`Unknown scripted fixed-limit persona: ${String(persona)}`);
}

/** The response-count node a scripted decision is tallied under (LeagueResult.humanResponses). */
export function fixedLimitScriptedNode(s: Pick<LeagueSeatSpot, 'stage' | 'toCall'>): string {
  return `${s.stage}/${s.toCall > 0 ? 'facing_bet' : 'checked_to'}`;
}
