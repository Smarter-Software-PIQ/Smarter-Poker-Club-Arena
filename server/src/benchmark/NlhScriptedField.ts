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
import { boardHasFourFlush, boardHasFourStraight } from '../engine/HorseHoldemCommittedPricing.js';
import { humanCalibratedPreflopPercentile } from './HumanCalibratedPopulation.js';
import {
  NLH_DANGER_BOARD_BETTOR_PERSONA,
  NLH_DANGER_BOARD_VALUE_PERSONA,
  NLH_POT_BARRELER_PERSONA,
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

/** The seat policy a scripted no-limit persona plays. */
export function nlhScriptedPolicy(persona: NlhScriptedPersona): LeagueSeatPolicy {
  if (persona === NLH_POT_BARRELER_PERSONA) return nlhPotBarrelerPolicy;
  if (persona === NLH_VALUE_BARRELER_PERSONA) return nlhValueBarrelerPolicy;
  if (persona === NLH_DANGER_BOARD_BETTOR_PERSONA) return nlhDangerBoardBettorPolicy;
  if (persona === NLH_DANGER_BOARD_VALUE_PERSONA) return nlhDangerBoardValuePolicy;
  throw new Error(`Unknown scripted no-limit persona: ${String(persona)}`);
}
