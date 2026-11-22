/**
 * THE SCRIPTED FIXED-LIMIT OMAHA HI-LO FIELD (2026-11-21).
 *
 * Mirror play on legal fixed-limit Omaha hi-lo (flo8) diverged 0 of 300 pairs
 * for fixedLimitHiLoLowHalfFloor and fixedLimitHiLoNutLowRiverBet
 * (HorseLeague.ts, FIXED_LIMIT_OMAHA_HILO_CARDS), and fixedLimitOmahaNoPresumption
 * needs multi-range evaluation across tight-value, barreling, and maniac fields.
 * This module provides five pure deterministic flo8 scripted seat policies
 * seated through the league's existing human-field mechanism
 * (LeagueMatchup.opponentPopulation = FLO8_SCRIPTED_POPULATION_ID,
 * LeagueMatchup.humanPersona = the persona).
 *
 * Invariants (pinned by HorseLeagueFlo8Field.test.ts):
 *  - Every policy reads only its own cards and the public state (LeagueSeatSpot),
 *    never calls the Horse brain or HorseMind, and consumes zero randomness.
 *  - Every policy answers only with an action on the fixed-limit menu it is
 *    offered, at the one legal wager amount (never all_in), and replays action
 *    by action through a real HandController with exact hi-lo stack parity.
 *
 * Every frequency below is either quoted from a record in this repository or
 * labelled DESIGN VALUE.
 *
 * Measurement plumbing only: no production caller, no database, no writer.
 * Horses are never called bots.
 */
import type { Card, HandStage } from '../types.js';
import { omahaPreflopPercentile, scoreOmahaHi, scoreOmahaHiPartial } from '../engine/HorseEval.js';
import { RANK_VALUES, evaluateOmahaLowHand } from '../engine/PokerEngine.js';
import {
  FLH_TIGHT_VALUE_PREFLOP,
  flhManiacPolicy,
  streetWagers,
} from './FixedLimitScriptedField.js';
import {
  FLO8_HIGH_BARRELER_PERSONA,
  FLO8_MANIAC_PERSONA,
  FLO8_PASSIVE_CALLER_PERSONA,
  FLO8_RIVER_FOLDER_PERSONA,
  FLO8_TIGHT_VALUE_PERSONA,
  type Flo8ScriptedPersona,
} from './HorseLeagueHumanField.js';
import type { LeagueSeatPolicy, LeagueSeatSpot } from './HorseLeague.js';

type Decision = { action: string; amount?: number };

/** The one legal wager on the fixed-limit menu (bet or raise), or null when capped/unavailable. */
function fixedWager(s: LeagueSeatSpot): Decision | null {
  const kind = s.legalActions.includes('raise')
    ? 'raise'
    : s.legalActions.includes('bet')
      ? 'bet'
      : null;
  if (kind === null || s.minRaiseTo === null) return null;
  return { action: kind, amount: s.minRaiseTo };
}

function callOrCheck(s: LeagueSeatSpot): Decision {
  return s.toCall > 0 ? { action: 'call' } : { action: 'check' };
}

function foldOrCheck(s: LeagueSeatSpot): Decision {
  return s.toCall > 0 ? { action: 'fold' } : { action: 'check' };
}

/** Ace-low rank value (A = 1, 2..8 = face value, 9..K = 0). */
function lowRank(c: Card): number {
  const r = RANK_VALUES[c.rank];
  return r === 14 ? 1 : r <= 8 ? r : 0;
}

/**
 * Omaha high made-hand category on a 3..5 card board (1 high card, 2 pair,
 * 3 two pair, 4 trips/set, 5 straight, 6 flush, 7 full house, 8 quads, 9 SF).
 */
export function omahaHiCat(hole: readonly Card[], board: readonly Card[]): number {
  if (hole.length < 4 || board.length < 3) return 1;
  const score =
    board.length === 5
      ? scoreOmahaHi(hole as Card[], board as Card[])
      : scoreOmahaHiPartial(hole as Card[], board as Card[]);
  return Math.floor(score / 0x100000);
}

/**
 * True when `hole` holds the exact nut 8-or-better low on `board` (3..5 cards):
 * the board shows at least three distinct ranks <= 8 and hero holds both of the
 * two lowest ranks in 1..8 not already on the board.
 */
export function hasNutLow(hole: readonly Card[], board: readonly Card[]): boolean {
  if (hole.length < 2 || board.length < 3) return false;
  const boardLows = new Set<number>();
  for (const c of board) {
    const r = lowRank(c);
    if (r > 0) boardLows.add(r);
  }
  if (boardLows.size < 3) return false;
  const needed: number[] = [];
  for (let r = 1; r <= 8 && needed.length < 2; r++) {
    if (!boardLows.has(r)) needed.push(r);
  }
  if (needed.length < 2) return false;
  const holeLows = new Set<number>();
  for (const c of hole) {
    const r = lowRank(c);
    if (r > 0) holeLows.add(r);
  }
  return holeLows.has(needed[0]) && holeLows.has(needed[1]);
}

/**
 * True when `hole` already makes an 8-or-better low on `board`, or (on flop/turn)
 * holds two distinct low ranks that need at most one more low card to qualify.
 */
export function hasLowDraw(hole: readonly Card[], board: readonly Card[]): boolean {
  if (evaluateOmahaLowHand(hole as Card[], board as Card[]) !== null) return true;
  if (board.length >= 5 || board.length < 3) return false;
  const boardLows = new Set<number>();
  for (const c of board) {
    const r = lowRank(c);
    if (r > 0) boardLows.add(r);
  }
  if (boardLows.size < 2) return false;
  const holeLows: number[] = [];
  const seen = new Set<number>();
  for (const c of hole) {
    const r = lowRank(c);
    if (r > 0 && !seen.has(r)) {
      seen.add(r);
      holeLows.push(r);
    }
  }
  for (let i = 0; i < holeLows.length; i++) {
    for (let j = i + 1; j < holeLows.length; j++) {
      const union = new Set<number>(boardLows);
      union.add(holeLows[i]);
      union.add(holeLows[j]);
      if (union.size >= 4) return true;
    }
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. flo8_high_barreler_v1 (6-max favourable field for fixedLimitHiLoLowHalfFloor)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * DESIGN VALUE thresholds for flo8_high_barreler_v1: enters wide preflop (top
 * 55%, raises once, caps top 10%) and bets/barrels postflop with any pair or
 * better or top-50% unpaired hand, creating multi-street high pressure on
 * qualifying low rivers without preflop 4-bet pot bloat.
 */
export const FLO8_HIGH_BARRELER = Object.freeze({
  preflopContinueAt: 0.45,
  preflopCapAt: 0.9,
  unpairedBetPct: 0.5,
  betHiCat: 2,
  raiseHiCat: 4,
  callRaisedHiCat: 3,
});

function highBarrelerPreflop(s: LeagueSeatSpot): Decision {
  const p = omahaPreflopPercentile(s.cards, true);
  const t = FLO8_HIGH_BARRELER;
  const raises = streetWagers(s);
  const wager = fixedWager(s);
  if (raises === 0) {
    if (p >= t.preflopContinueAt) return wager ?? callOrCheck(s);
    return foldOrCheck(s);
  }
  if (p >= t.preflopCapAt && wager) return wager;
  if (p >= t.preflopContinueAt) return callOrCheck(s);
  return foldOrCheck(s);
}

function highBarrelerPostflop(s: LeagueSeatSpot): Decision {
  const t = FLO8_HIGH_BARRELER;
  const hiCat = omahaHiCat(s.cards, s.board);
  const hasLow = evaluateOmahaLowHand(s.cards, s.board) !== null;
  const lowDraw = hasLowDraw(s.cards, s.board);
  const wager = fixedWager(s);
  const wagers = streetWagers(s);
  if (s.toCall <= 0) {
    const p = omahaPreflopPercentile(s.cards, true);
    if (wager && (hiCat >= t.betHiCat || p >= t.unpairedBetPct)) return wager;
    return { action: 'check' };
  }
  if (wager && hiCat >= t.raiseHiCat) return wager;
  if (wagers <= 1) {
    if (hiCat >= t.betHiCat || hasLow || lowDraw) return { action: 'call' };
    return { action: 'fold' };
  }
  if (hiCat >= t.callRaisedHiCat || hasLow) return { action: 'call' };
  return { action: 'fold' };
}

export const flo8HighBarrelerPolicy: LeagueSeatPolicy = (s) =>
  (s.stage as HandStage) === 'preflop' ? highBarrelerPreflop(s) : highBarrelerPostflop(s);

// ─────────────────────────────────────────────────────────────────────────────
// 2. flo8_maniac_v1 (high-heat range + harm control for noPresumption)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reuses flhManiacPolicy: bets or raises whenever a fixed-limit wager is legal,
 * otherwise calls, never folds.
 */
export const flo8ManiacPolicy: LeagueSeatPolicy = flhManiacPolicy;

// ─────────────────────────────────────────────────────────────────────────────
// 3. flo8_tight_value_v1 (value-only + quartering harm control for all 3 options)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * DESIGN VALUE postflop thresholds for flo8_tight_value_v1 (preflop reuses
 * FLH_TIGHT_VALUE_PREFLOP over omahaPreflopPercentile(cards, true)): bets and
 * raises only two pair+ or the nut low, 3-bets only trips+, calls one wager
 * with one pair+ or any qualifying 8-low, folds the rest, never bluffs.
 */
export const FLO8_TIGHT_VALUE_POSTFLOP = Object.freeze({
  valueHiCat: 3,
  reraiseHiCat: 4,
  callHiCat: 2,
});

function tightValuePreflop(s: LeagueSeatSpot): Decision {
  const p = omahaPreflopPercentile(s.cards, true);
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
  const t = FLO8_TIGHT_VALUE_POSTFLOP;
  const hiCat = omahaHiCat(s.cards, s.board);
  const hasLow = evaluateOmahaLowHand(s.cards, s.board) !== null;
  const nutLow = hasNutLow(s.cards, s.board);
  const wagers = streetWagers(s);
  const wager = fixedWager(s);
  if (s.toCall <= 0) {
    return wager && (hiCat >= t.valueHiCat || nutLow) ? wager : { action: 'check' };
  }
  if (wagers >= 2) {
    if (wager && hiCat >= t.reraiseHiCat) return wager;
    return hiCat >= t.valueHiCat || nutLow ? { action: 'call' } : { action: 'fold' };
  }
  if (wager && (hiCat >= t.valueHiCat || nutLow)) return wager;
  if (hiCat >= t.callHiCat || hasLow) return { action: 'call' };
  return { action: 'fold' };
}

export const flo8TightValuePolicy: LeagueSeatPolicy = (s) =>
  (s.stage as HandStage) === 'preflop' ? tightValuePreflop(s) : tightValuePostflop(s);

// ─────────────────────────────────────────────────────────────────────────────
// 4. flo8_river_folder_v1 (HU favourable field for fixedLimitHiLoNutLowRiverBet)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * DESIGN VALUE thresholds for flo8_river_folder_v1: wide HU preflop entry
 * (calls p >= 0.35, raises p >= 0.80); checks flop/turn unless trips+ and calls
 * one bet with a pair or low draw so hands reach unbet rivers; on the river
 * checks unless trips+ and folds one-pair/air facing a bet, calling only two
 * pair+ or a qualifying low.
 */
export const FLO8_RIVER_FOLDER = Object.freeze({
  preflopCallAt: 0.35,
  preflopRaiseAt: 0.8,
  betHiCat: 4,
  earlyCallHiCat: 2,
  riverCallHiCat: 3,
  riverCallRaisedHiCat: 4,
});

function riverFolderPreflop(s: LeagueSeatSpot): Decision {
  const p = omahaPreflopPercentile(s.cards, true);
  const t = FLO8_RIVER_FOLDER;
  const raises = streetWagers(s);
  const wager = fixedWager(s);
  if (raises === 0) {
    if (p >= t.preflopRaiseAt && wager) return wager;
    if (s.toCall <= 0) return { action: 'check' };
    return p >= t.preflopCallAt ? { action: 'call' } : { action: 'fold' };
  }
  if (raises === 1 && p >= t.preflopRaiseAt && wager) return wager;
  return p >= t.preflopCallAt ? callOrCheck(s) : foldOrCheck(s);
}

function riverFolderPostflop(s: LeagueSeatSpot): Decision {
  const t = FLO8_RIVER_FOLDER;
  const hiCat = omahaHiCat(s.cards, s.board);
  const hasLow = evaluateOmahaLowHand(s.cards, s.board) !== null;
  const wagers = streetWagers(s);
  const wager = fixedWager(s);
  if (s.toCall <= 0) {
    return wager && hiCat >= t.betHiCat ? wager : { action: 'check' };
  }
  if ((s.stage as HandStage) === 'river') {
    if (wagers <= 1) {
      return hiCat >= t.riverCallHiCat || hasLow ? { action: 'call' } : { action: 'fold' };
    }
    return hiCat >= t.riverCallRaisedHiCat || hasNutLow(s.cards, s.board)
      ? { action: 'call' }
      : { action: 'fold' };
  }
  if (wagers <= 1) {
    return hiCat >= t.earlyCallHiCat || hasLowDraw(s.cards, s.board)
      ? { action: 'call' }
      : { action: 'fold' };
  }
  return hiCat >= t.riverCallHiCat || hasLow ? { action: 'call' } : { action: 'fold' };
}

export const flo8RiverFolderPolicy: LeagueSeatPolicy = (s) =>
  (s.stage as HandStage) === 'preflop' ? riverFolderPreflop(s) : riverFolderPostflop(s);

// ─────────────────────────────────────────────────────────────────────────────
// 5. flo8_passive_caller_v1 (HU station-refusal + quartering stress test)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * DESIGN VALUE thresholds for flo8_passive_caller_v1: mirrors
 * flh_passive_caller_v1 preflop bars on omahaPreflopPercentile(cards, true)
 * (calls p >= 0.40, raises p >= 0.92, calls reraises p >= 0.60); postflop
 * checks unless trips+, raises only full house+, and never folds postflop.
 */
export const FLO8_PASSIVE_CALLER = Object.freeze({
  preflopCallAt: 0.4,
  preflopReraiseAt: 0.92,
  preflopCallReraisedAt: 0.6,
  betHiCat: 4,
  raiseHiCat: 7,
});

function passiveCallerPreflop(s: LeagueSeatSpot): Decision {
  const p = omahaPreflopPercentile(s.cards, true);
  const t = FLO8_PASSIVE_CALLER;
  const raises = streetWagers(s);
  if (raises === 0) {
    if (s.toCall <= 0) return { action: 'check' };
    return p >= t.preflopCallAt ? { action: 'call' } : { action: 'fold' };
  }
  if (raises === 1) {
    if (p >= t.preflopReraiseAt) return fixedWager(s) ?? callOrCheck(s);
    return p >= t.preflopCallAt ? callOrCheck(s) : foldOrCheck(s);
  }
  return p >= t.preflopCallReraisedAt ? callOrCheck(s) : foldOrCheck(s);
}

function passiveCallerPostflop(s: LeagueSeatSpot): Decision {
  const t = FLO8_PASSIVE_CALLER;
  const hiCat = omahaHiCat(s.cards, s.board);
  const wager = fixedWager(s);
  if (s.toCall <= 0) return wager && hiCat >= t.betHiCat ? wager : { action: 'check' };
  if (wager && hiCat >= t.raiseHiCat) return wager;
  return { action: 'call' };
}

export const flo8PassiveCallerPolicy: LeagueSeatPolicy = (s) =>
  (s.stage as HandStage) === 'preflop' ? passiveCallerPreflop(s) : passiveCallerPostflop(s);

/** The seat policy a scripted fixed-limit Omaha hi-lo persona plays. */
export function flo8ScriptedPolicy(persona: Flo8ScriptedPersona): LeagueSeatPolicy {
  if (persona === FLO8_HIGH_BARRELER_PERSONA) return flo8HighBarrelerPolicy;
  if (persona === FLO8_MANIAC_PERSONA) return flo8ManiacPolicy;
  if (persona === FLO8_TIGHT_VALUE_PERSONA) return flo8TightValuePolicy;
  if (persona === FLO8_RIVER_FOLDER_PERSONA) return flo8RiverFolderPolicy;
  if (persona === FLO8_PASSIVE_CALLER_PERSONA) return flo8PassiveCallerPolicy;
  throw new Error(`Unknown scripted flo8 persona: ${String(persona)}`);
}
