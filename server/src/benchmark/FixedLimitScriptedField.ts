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
  FLH_MANIAC_PERSONA,
  FLH_TIGHT_VALUE_PERSONA,
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
  throw new Error(`Unknown scripted fixed-limit persona: ${String(persona)}`);
}

/** The response-count node a scripted decision is tallied under (LeagueResult.humanResponses). */
export function fixedLimitScriptedNode(s: Pick<LeagueSeatSpot, 'stage' | 'toCall'>): string {
  return `${s.stage}/${s.toCall > 0 ? 'facing_bet' : 'checked_to'}`;
}
