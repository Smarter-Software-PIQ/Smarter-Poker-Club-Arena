/**
 * THE SCRIPTED NO-LIMIT FIELD (2026-11-21, Hold'em Strategy lane).
 *
 * Two default-off hold'em options act in spots a Horse mirror almost never
 * deals: holdemCommittedNoPairIsPriced (a committed Horse with no pair and no
 * draw facing one bettor) and holdemDangerBoardEquityIsPriced (one pair facing
 * a bet on a four-flush or four-straight turn or river). Their six-seat mirror
 * cards diverged on 20 to 132 of 6,000 pairs per seed and never resolved
 * (docs/horse-option-authority.d/holdemCommittedNoPairIsPriced.md and
 * holdemDangerBoardEquityIsPriced.md, League). These are the scripted heads-up
 * opponents that put a Horse in those spots, each with a value-only harm
 * control, seated through the league's existing human-field mechanism
 * (LeagueMatchup.opponentPopulation = NLH_SCRIPTED_POPULATION_ID,
 * LeagueMatchup.humanPersona = the persona; runHumanFieldMatchup seats them
 * through LeagueHumanField.seatPolicyOf), exactly as the scripted fixed-limit
 * field (FixedLimitScriptedField.ts) is seated.
 *
 * Invariants (pinned by NlhScriptedField.test.ts):
 *  - A script reads only its own cards and the public state (LeagueSeatSpot);
 *    it never calls the Horse brain and consumes no randomness, so it is a
 *    pure function of the deal seed and the actions before it, and plays the
 *    same in both passes of a pair until the hero's arms differ.
 *  - It answers only with an action on the menu it is offered (HorseLeague
 *    seatPolicyDecision), at a size inside the legal range, and its answer goes
 *    through the same validation as a Horse's.
 *
 * Every frequency below is either quoted from a record in this repository
 * (the source sits next to the constant) or labelled DESIGN VALUE: chosen here
 * because no record states it. Every postflop frequency is 0% or 100% so the
 * script stays a pure function; the bluff share of the danger-board bettor is
 * whatever share of its range holds no pair on that board, not a dial.
 *
 * Measurement plumbing only: no production caller, no database, no writer.
 * Horses are never called bots.
 */
import type { HandStage } from '../types.js';
import { handClass } from '../engine/GtoCharts.js';
import { boardHasFourFlush, boardHasFourStraight } from '../engine/HorseHoldemCommittedPricing.js';
import {
  NASH_V2_CALL_MAX_BB,
  nashV2CallUpTo,
  nashV2JamUpTo,
  type NashCallerKind,
} from '../engine/HorseNashPushFoldV2.js';
import { humanCalibratedPreflopPercentile } from './HumanCalibratedPopulation.js';
import {
  NLH_DANGER_BOARD_BETTOR_PERSONA,
  NLH_DANGER_BOARD_VALUE_PERSONA,
  NLH_NASH_OPEN_JAMMER_PERSONA,
  NLH_POT_BARRELER_PERSONA,
  NLH_TIGHT_JAMMER_PERSONA,
  NLH_VALUE_BARRELER_PERSONA,
  type NlhScriptedPersona,
} from './HorseLeagueHumanField.js';
import { ownMadeClass } from './FixedLimitScriptedField.js';
import type { LeagueSeatPolicy, LeagueSeatSpot } from './HorseLeague.js';

type Decision = { action: string; amount?: number };

/**
 * Preflop entry shared by every persona here, by the hand's calibrated
 * preflop percentile (0 worst .. 1 best, humanCalibratedPreflopPercentile).
 *
 * Source: the heads-up wide small blind (HU_WIDE_SB_AGGRESSOR_PERSONA,
 * HorseLeagueHumanField.ts and humanFieldPersonaProfile in HorseLeague.ts):
 * "the small blind plays 80% of hands" (unopened fold < 0.20) and "defends 60%
 * of big blinds" (facing a raise fold < 0.40), opening "about 2.5bb" (the
 * heads-up exploiter note in HorseLeagueHumanField.ts). DESIGN VALUE: every
 * entry is a raise (the persona limps 10% of its 80%) and it never re-raises
 * (the persona three-bets 15%), so pots stay single-raised and 100bb deep
 * and the only way a stack goes in is the postflop line under test.
 */
export const NLH_SCRIPTED_PREFLOP = Object.freeze({
  /** First in: raises at or above this percentile (plays the top 80%), else folds. */
  openAt: 0.2,
  /** Open size in big blinds (raise to). */
  openToBb: 2.5,
  /** Facing a raise or more: calls at or above this percentile (defends 60%), else folds. */
  continueAt: 0.4,
});

/**
 * Postflop made classes (scoreHoldem category of the seat's own improvement on
 * the board, ownMadeClass: 1 nothing, 2 one pair, 3 two pair, 4 trips,
 * 5 straight). DESIGN VALUE throughout (no record states them):
 *  - the value barreler bets and continues against a raise with two pair or
 *    better and calls a bet with one pair;
 *  - the danger-board personas bet a straight or better for value and call a
 *    river bet with one pair or better.
 */
export const NLH_SCRIPTED_POSTFLOP = Object.freeze({
  /** Made class the value barreler bets, and continues against a raise, with (3: two pair). */
  valueBetClass: 3,
  /** Made class a persona calls a wager with where its line does not call any two (2: one pair). */
  callClass: 2,
  /** Made class the danger-board personas bet a danger board with for value (5: straight). */
  dangerValueClass: 5,
  /**
   * Danger-board bet size as a share of the pot. DESIGN VALUE: half the pot, a
   * price at which the live line calls one pair, so pricing it against the
   * bettor's range can change the answer.
   */
  dangerBetPotShare: 0.5,
});

/**
 * Starting stack, in big blinds, of the committed-spot cards. DESIGN VALUE:
 * 40bb, the heads-up short cash depth the league already deals
 * (human_hu_bb_defends_to_price_40bb and its siblings), where two pot-sized
 * bets after a single-raised pot leave a stack-to-pot ratio under 1.2.
 */
export const NLH_SCRIPTED_COMMITTED_STACK_BB = 40;

const can = (s: LeagueSeatSpot, a: string): boolean => s.legalActions.includes(a);

/** Calls a price (all-in when the call is the whole stack), checks when there is none. */
function callOrCheck(s: LeagueSeatSpot): Decision {
  if (s.toCall <= 0) return { action: 'check' };
  if (can(s, 'call')) return { action: 'call' };
  return can(s, 'all_in') ? { action: 'all_in' } : { action: 'fold' };
}

function foldOrCheck(s: LeagueSeatSpot): Decision {
  return s.toCall > 0 ? { action: 'fold' } : { action: 'check' };
}

/** A bet or raise to `to`, clamped into the legal range; the whole stack when that is all of it. */
function wagerTo(s: LeagueSeatSpot, to: number): Decision | null {
  const kind = can(s, 'raise') ? 'raise' : can(s, 'bet') ? 'bet' : null;
  if (kind === null || s.minRaiseTo === null || s.maxRaiseTo === null) {
    return can(s, 'all_in') ? { action: 'all_in' } : null;
  }
  const amount = Math.min(s.maxRaiseTo, Math.max(s.minRaiseTo, Math.round(to)));
  if (amount >= s.myBet + s.stack && can(s, 'all_in')) return { action: 'all_in' };
  return { action: kind, amount };
}

/** A pot-sized bet (DESIGN VALUE: one pot); the whole stack once the pot covers it. */
function potBet(s: LeagueSeatSpot): Decision | null {
  return wagerTo(s, s.currentBet + s.pot);
}

/** Bets and raises already made on this street (the blinds are not in the history). */
function streetWagers(s: Pick<LeagueSeatSpot, 'history' | 'stage'>): number {
  return s.history.filter(
    (a) =>
      a.stage === s.stage && (a.action === 'bet' || a.action === 'raise' || a.action === 'all_in')
  ).length;
}

function preflop(s: LeagueSeatSpot): Decision {
  const p = humanCalibratedPreflopPercentile(s.cards, s.variant);
  const t = NLH_SCRIPTED_PREFLOP;
  if (streetWagers(s) === 0) {
    // Unopened: the big blind over a limp checks; first in opens or folds.
    if (s.toCall <= 0) return { action: 'check' };
    if (p < t.openAt) return { action: 'fold' };
    return wagerTo(s, t.openToBb * s.bigBlind) ?? callOrCheck(s);
  }
  return p >= t.continueAt ? callOrCheck(s) : foldOrCheck(s);
}

/** True on a four-flush or four-straight board (the boards holdemDangerBoardEquityIsPriced acts on). */
export function nlhDangerBoard(board: LeagueSeatSpot['board']): boolean {
  return board.length >= 4 && (boardHasFourFlush(board) || boardHasFourStraight(board));
}

// nlh_pot_barreler_v1 ───────────────────────────────────────────────────────

/**
 * First to act or checked to, it bets the pot on every street with any two
 * cards (its whole stack once the pot covers it). Facing a Horse's bet it calls
 * any two on the flop and one pair or better on the turn and river; facing a
 * raise it calls with one pair or better and folds no pair. DESIGN VALUE: the
 * extreme barreler, wager rate 1.0 whenever it may bet. Its cards are dealt
 * 40bb deep (NLH_SCRIPTED_COMMITTED_STACK_BB): a Horse that calls its flop pot
 * bet faces a turn pot bet with a stack-to-pot ratio near 1, the committed
 * branch, holding whatever it floated the flop with.
 */
export const nlhPotBarrelerPolicy: LeagueSeatPolicy = (s) => {
  if ((s.stage as HandStage) === 'preflop') return preflop(s);
  const made = ownMadeClass(s.cards, s.board);
  if (s.toCall <= 0) return potBet(s) ?? { action: 'check' };
  if (streetWagers(s) >= 2 || (s.stage as HandStage) !== 'flop') {
    return made >= NLH_SCRIPTED_POSTFLOP.callClass ? callOrCheck(s) : { action: 'fold' };
  }
  return callOrCheck(s);
};

// nlh_value_barreler_v1 ──────────────────────────────────────────────────────

/**
 * The pot barreler's harm control, at the same depth: it bets the pot only
 * with two pair or better and never bluffs, so every bet that commits a Horse
 * is strong. Facing a Horse's bet it calls with one pair or better; facing a
 * raise it continues with two pair or better and folds the rest.
 */
export const nlhValueBarrelerPolicy: LeagueSeatPolicy = (s) => {
  if ((s.stage as HandStage) === 'preflop') return preflop(s);
  const t = NLH_SCRIPTED_POSTFLOP;
  const made = ownMadeClass(s.cards, s.board);
  if (s.toCall <= 0)
    return made >= t.valueBetClass ? (potBet(s) ?? { action: 'check' }) : { action: 'check' };
  const need = streetWagers(s) >= 2 ? t.valueBetClass : t.callClass;
  return made >= need ? callOrCheck(s) : { action: 'fold' };
};

// nlh_danger_board_bettor_v1 / nlh_danger_board_value_v1 ─────────────────────

function dangerBoardPolicy(bluffs: boolean): LeagueSeatPolicy {
  return (s) => {
    if ((s.stage as HandStage) === 'preflop') return preflop(s);
    if ((s.stage as HandStage) === 'flop') return callOrCheck(s);
    const t = NLH_SCRIPTED_POSTFLOP;
    const made = ownMadeClass(s.cards, s.board);
    const danger = nlhDangerBoard(s.board);
    if (s.toCall <= 0) {
      const value = made >= t.dangerValueClass;
      const bluff = bluffs && made === 1;
      if (danger && (value || bluff)) {
        return wagerTo(s, s.currentBet + t.dangerBetPotShare * s.pot) ?? { action: 'check' };
      }
      return { action: 'check' };
    }
    if ((s.stage as HandStage) === 'turn') return callOrCheck(s);
    return made >= t.callClass ? callOrCheck(s) : { action: 'fold' };
  };
}

/**
 * Never bets the flop and never folds before the river; on a four-flush or
 * four-straight turn or river, first to act or checked to, it bets half the
 * pot with a straight or better (value) and with no pair (bluff), and checks
 * one pair, two pair and trips. Facing a river wager it calls with one pair
 * or better and folds no pair. The value and bluff shares are what its range
 * holds on that board.
 */
export const nlhDangerBoardBettorPolicy: LeagueSeatPolicy = dangerBoardPolicy(true);

/** The danger-board bettor's harm control: the same, but it bets a danger board for value only. */
export const nlhDangerBoardValuePolicy: LeagueSeatPolicy = dangerBoardPolicy(false);

// nlh_nash_open_jammer_v1 / nlh_tight_jammer_v1 (2026-11-21, nashCallVsJam) ──

/**
 * Preflop players still behind `seatIdx` (clockwise to the big blind inclusive):
 * 0 for BB, 1 for SB, 2 for BTN (6-max), 3 for CO, 4 for HJ, 5 for UTG.
 * Matches HorseLeague.playHand's blind assignment (heads-up: dealer = SB;
 * 3+ seats: dealer + 1 = SB, dealer + 2 = BB).
 */
export function preflopSeatsBehind(seatIdx: number, dealerSeat: number, numSeats: number): number {
  const bbIdx = numSeats === 2 ? dealerSeat % 2 : (dealerSeat + 1) % numSeats;
  return (bbIdx - seatIdx + numSeats) % numSeats;
}

/**
 * Short-stack open-jammer constants for nashCallVsJam (2026-11-21).
 *
 * The human-calibrated population sizes every raise and never open-jams, so
 * nashCallVsJam had 0 divergent pairs against it (docs/changelog/
 * 2026-11-07-nash-push-fold-v2.md). These two personas seat a scripted short-
 * stack (<=20bb) NLH open-jammer field and a tight/nut-only harm control:
 *
 *  - nlh_nash_open_jammer_v1:
 *    - Unopened <=20bb: jams when HorseNashPushFoldV2.nashV2JamUpTo(hand,
 *      behind, deadAnteBB, 1) >= depthBB, else folds. Source: the chip-EV
 *      push/fold equilibrium table solved by server/scripts/nash-push-fold/
 *      solve.py --v2. DESIGN VALUE: deterministic >= cutoff (no half-blind
 *      randomization) so the script consumes no randomness.
 *    - Facing a lone open-jam <=20bb: calls when nashV2CallUpTo(hand,
 *      jammerBehind, callerKind, deadAnteBB, 1) >= effBB, else folds. Same
 *      source; deterministic >= cutoff is a DESIGN VALUE.
 *    - Non-jam preflop spots (facing a limp, a non-all-in raise, or a
 *      multiway/reraised pot) and rare postflop spots: DESIGN VALUE bars
 *      below so the script stays realistic and pure if hero min-raises or limps.
 *
 *  - nlh_tight_jammer_v1 (harm control):
 *    - DESIGN VALUE: open-jams and continues ONLY with the top ~9% of hands
 *      (humanCalibratedPreflopPercentile >= 0.91, within the 8-10% nut-heavy
 *      short-stack open-jammer band) at <=20bb, folding everything else. Never
 *      min-raises or limps, so every entry is a tight open-jam; postflop (if
 *      hero limps and BB checks) plays value-only made classes (DESIGN VALUE).
 */
export const NLH_NASH_OPEN_JAMMER_NON_JAM = Object.freeze({
  /** Facing limpers only (BB option): jam at or above this calibrated percentile. DESIGN VALUE. */
  bbIsoJamAt: 0.85,
  /** Facing limpers only (non-BB): jam at or above this calibrated percentile. DESIGN VALUE. */
  overLimpJamAt: 0.82,
  /** Facing one non-all-in raise <=20bb: reshove all-in at or above. DESIGN VALUE. */
  reshoveAt: 0.88,
  /** Facing one non-all-in raise: call at or above. DESIGN VALUE. */
  callSingleRaiseAt: 0.72,
  /** Facing two+ wagers or an already-called all-in: call at or above. DESIGN VALUE. */
  callMultiwayAt: 0.92,
  /** Postflop made class to bet half-pot when checked to or call one wager (2: one pair). DESIGN VALUE. */
  postflopPlayClass: 2,
  /** Postflop made class to call two+ wagers (3: two pair). DESIGN VALUE. */
  postflopRaisedClass: 3,
  /** Postflop bet share of pot. DESIGN VALUE. */
  postflopBetPotShare: 0.5,
});

export const NLH_TIGHT_JAMMER_PREFLOP = Object.freeze({
  /**
   * Calibrated preflop percentile bar to open-jam or continue (top ~9% of
   * hands: 77+, AJo+, ATs+, KQs). DESIGN VALUE: nut-heavy harm control for
   * nashCallVsJam against a tight open-jammer.
   */
  openJamAt: 0.91,
  /** Postflop made class to bet half-pot when checked to or call two+ wagers (3: two pair). DESIGN VALUE. */
  postflopValueClass: 3,
  /** Postflop made class to call a single wager (2: one pair). DESIGN VALUE. */
  postflopCallClass: 2,
  /** Postflop bet share of pot. DESIGN VALUE. */
  postflopBetPotShare: 0.5,
});

function jamOrCall(s: LeagueSeatSpot): Decision {
  return can(s, 'all_in') ? { action: 'all_in' } : callOrCheck(s);
}

function preflopActions(s: Pick<LeagueSeatSpot, 'history'>) {
  return s.history.filter((a) => a.stage === 'preflop');
}

function isWagerAction(action: string): boolean {
  return action === 'bet' || action === 'raise' || action === 'all_in';
}

function nashOpenJammerPreflop(s: LeagueSeatSpot): Decision {
  const depthBB = (s.myBet + s.stack) / s.bigBlind;
  if (depthBB > NASH_V2_CALL_MAX_BB) return preflop(s);

  const behind = preflopSeatsBehind(s.seatIdx, s.dealerSeat, s.numSeats);
  const pre = preflopActions(s);
  const wagers = pre.filter((a) => isWagerAction(a.action));
  const calls = pre.filter((a) => a.action === 'call');
  const cls = s.cards.length >= 2 ? handClass(s.cards[0], s.cards[1]) : null;
  const p = humanCalibratedPreflopPercentile(s.cards, s.variant);
  const t = NLH_NASH_OPEN_JAMMER_NON_JAM;

  // Unopened (folded to this seat): open-jam or fold from HorseNashPushFoldV2.
  if (wagers.length === 0 && calls.length === 0) {
    if (s.toCall <= 0 || behind < 1) return { action: 'check' };
    const deadAnteBB = Math.max(0, Math.min(2, (s.pot - 1.5 * s.bigBlind) / s.bigBlind));
    const upTo = cls ? nashV2JamUpTo(cls, behind, deadAnteBB, 1) : null;
    return upTo !== null && upTo >= depthBB ? jamOrCall(s) : { action: 'fold' };
  }

  // Facing limpers only (no raise yet).
  if (wagers.length === 0) {
    if (s.toCall <= 0) return p >= t.bbIsoJamAt ? jamOrCall(s) : { action: 'check' };
    return p >= t.overLimpJamAt ? jamOrCall(s) : { action: 'fold' };
  }

  // Facing a lone open-jam (one all-in wager, no calls/limps): call from Nash caller table.
  if (wagers.length === 1 && wagers[0].action === 'all_in' && calls.length === 0) {
    const jammerIdx = wagers[0].seat - 1;
    const jammerBehind = preflopSeatsBehind(jammerIdx, s.dealerSeat, s.numSeats);
    if (jammerBehind >= 1 && behind < jammerBehind) {
      const callerKind: NashCallerKind = behind === 0 ? 'bb' : behind === 1 ? 'sb' : 'open';
      const jamAmount = wagers[0].amount ?? s.currentBet;
      const effBB = Math.min(s.myBet + s.stack, jamAmount) / s.bigBlind;
      const blindsInPot = (jammerBehind === 1 ? 1 : 1.5) * s.bigBlind;
      const deadAnteBB = Math.max(0, Math.min(2, (s.pot - jamAmount - blindsInPot) / s.bigBlind));
      const upTo = cls ? nashV2CallUpTo(cls, jammerBehind, callerKind, deadAnteBB, 1) : null;
      return upTo !== null && upTo >= effBB ? callOrCheck(s) : foldOrCheck(s);
    }
  }

  // Facing one non-all-in open raise: reshove top 12%, call next 16%, fold rest.
  if (wagers.length === 1 && wagers[0].action !== 'all_in') {
    if (p >= t.reshoveAt) return jamOrCall(s);
    return p >= t.callSingleRaiseAt ? callOrCheck(s) : foldOrCheck(s);
  }

  // Facing 2+ wagers or an already-called jam: continue only with top 8%.
  return p >= t.callMultiwayAt ? callOrCheck(s) : foldOrCheck(s);
}

function nashOpenJammerPostflop(s: LeagueSeatSpot): Decision {
  const t = NLH_NASH_OPEN_JAMMER_NON_JAM;
  const made = ownMadeClass(s.cards, s.board);
  if (s.toCall <= 0) {
    return made >= t.postflopPlayClass
      ? (wagerTo(s, s.currentBet + t.postflopBetPotShare * s.pot) ?? { action: 'check' })
      : { action: 'check' };
  }
  const need = streetWagers(s) >= 2 ? t.postflopRaisedClass : t.postflopPlayClass;
  return made >= need ? callOrCheck(s) : { action: 'fold' };
}

/**
 * Short-stack (<=20bb) Nash open-jammer: open-jams and calls lone open-jams
 * from HorseNashPushFoldV2 across UTG/HJ/CO/BTN/SB in cash and BBA MTT.
 */
export const nlhNashOpenJammerPolicy: LeagueSeatPolicy = (s) =>
  (s.stage as HandStage) === 'preflop' ? nashOpenJammerPreflop(s) : nashOpenJammerPostflop(s);

function tightJammerPreflop(s: LeagueSeatSpot): Decision {
  const depthBB = (s.myBet + s.stack) / s.bigBlind;
  const p = humanCalibratedPreflopPercentile(s.cards, s.variant);
  const t = NLH_TIGHT_JAMMER_PREFLOP;
  if (p < t.openJamAt) return foldOrCheck(s);

  const pre = preflopActions(s);
  const wagers = pre.filter((a) => isWagerAction(a.action));
  if (depthBB <= NASH_V2_CALL_MAX_BB) {
    if (wagers.length === 0) return jamOrCall(s);
    if (wagers.length === 1 && wagers[0].action !== 'all_in') return jamOrCall(s);
  }
  return callOrCheck(s);
}

function tightJammerPostflop(s: LeagueSeatSpot): Decision {
  const t = NLH_TIGHT_JAMMER_PREFLOP;
  const made = ownMadeClass(s.cards, s.board);
  if (s.toCall <= 0) {
    return made >= t.postflopValueClass
      ? (wagerTo(s, s.currentBet + t.postflopBetPotShare * s.pot) ?? { action: 'check' })
      : { action: 'check' };
  }
  const need = streetWagers(s) >= 2 ? t.postflopValueClass : t.postflopCallClass;
  return made >= need ? callOrCheck(s) : { action: 'fold' };
}

/**
 * Tight/nut-only open-jammer harm control for nashCallVsJam: open-jams and
 * continues only with the top ~9% of hands (calibrated percentile >= 0.91).
 */
export const nlhTightJammerPolicy: LeagueSeatPolicy = (s) =>
  (s.stage as HandStage) === 'preflop' ? tightJammerPreflop(s) : tightJammerPostflop(s);

/** The seat policy a scripted no-limit persona plays. */
export function nlhScriptedPolicy(persona: NlhScriptedPersona): LeagueSeatPolicy {
  if (persona === NLH_POT_BARRELER_PERSONA) return nlhPotBarrelerPolicy;
  if (persona === NLH_VALUE_BARRELER_PERSONA) return nlhValueBarrelerPolicy;
  if (persona === NLH_DANGER_BOARD_BETTOR_PERSONA) return nlhDangerBoardBettorPolicy;
  if (persona === NLH_DANGER_BOARD_VALUE_PERSONA) return nlhDangerBoardValuePolicy;
  if (persona === NLH_NASH_OPEN_JAMMER_PERSONA) return nlhNashOpenJammerPolicy;
  if (persona === NLH_TIGHT_JAMMER_PERSONA) return nlhTightJammerPolicy;
  throw new Error(`Unknown scripted no-limit persona: ${String(persona)}`);
}
