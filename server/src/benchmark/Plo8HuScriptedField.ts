/**
 * THE SCRIPTED PLO8 HEADS-UP FIELD (2026-11-21, Heads Up lane).
 *
 * HUMAN_CALIBRATED_OMAHA_DEV_POPULATION_ID covers plo4/plo5/plo6 only, so
 * omahaHiLoTournamentFirstIn (PLO8 tournament, heads-up, <= 20bb) had only a
 * Horse mirror card (plo8_mtt_hu_omaha_hilo_tournament_first_in_12bb). These
 * are pure, deterministic scripted PLO8 heads-up opponents seated through the
 * league's existing human-field mechanism (LeagueMatchup.opponentPopulation =
 * PLO8_HU_SCRIPTED_POPULATION_ID, LeagueMatchup.humanPersona = the persona;
 * runHumanFieldMatchup seats them through LeagueHumanField.seatPolicyOf),
 * matching FixedLimitScriptedField.ts and NlhScriptedField.ts.
 *
 * Invariants (pinned by Plo8HuScriptedField.test.ts):
 *  - Reads only its own hole cards and the public state (LeagueSeatSpot); never
 *    calls HorseLogic and consumes no randomness, so it is a pure function of
 *    the deal seed and prior actions and plays identically in both passes of a
 *    pair until the hero's arms differ.
 *  - Answers only with an action on s.legalActions and legalizes every wager
 *    through legalWagerTo (ExploiterLeague.ts) so fractional-cent pot-limit
 *    caps never produce an illegal amount.
 *
 * Every threshold below is a labelled DESIGN VALUE (no calibrated human PLO8
 * heads-up tournament dataset exists in this repository: 0 live human PLO8 HU
 * MTT hands in hand_history as of 2026-11-21). Measurement plumbing only: no
 * production caller, no database, no writer.
 */
import type { Card, HandStage } from '../types.js';
import { omahaPreflopPercentile } from '../engine/HorseEval.js';
import { HAND_RANKINGS, evaluateOmahaHand, evaluateOmahaLowHand } from '../engine/PokerEngine.js';
import { legalWagerTo } from './ExploiterLeague.js';
import {
  PLO8_HU_AGGRO_3BETTOR_PERSONA,
  PLO8_HU_REC_CALLER_PERSONA,
  PLO8_HU_TIGHT_BLIND_PERSONA,
  type Plo8HuScriptedPersona,
} from './HorseLeagueHumanField.js';
import type { LeagueSeatPolicy, LeagueSeatSpot } from './HorseLeague.js';

type Decision = { action: string; amount?: number };

/** Short-stack final-table depth matching plo8_mtt_hu_omaha_hilo_tournament_first_in_12bb. */
export const PLO8_HU_SCRIPTED_STACK_BB = 12;

/**
 * DESIGN VALUE thresholds for plo8_hu_rec_caller_v1 (realistic short-stack
 * recreational caller/defender in PLO8 heads-up):
 *  - First in (SB): plays top 75% (raises pot with top 45%, limps next 30%,
 *    folds bottom 25%).
 *  - Checked-to BB (facing limp): raises pot with top 25%, checks the rest.
 *  - Facing one raise (BB): 3-bets pot with top 15%, calls next 55% (70% total
 *    defence), folds bottom 30%.
 *  - Facing 2+ raises: continues with top 40%, folds weaker.
 *  - Postflop: bets 75% pot when checked to with two pair+ or made low+pair or
 *    6-or-better low; raises pot with trips+ or 6-or-better low+pair; sticky
 *    calls any bet with any pair, made low or low draw (2+ low hole ranks and
 *    2+ low board ranks); folds pure air.
 */
export const PLO8_HU_REC_CALLER_THRESHOLDS = Object.freeze({
  sbRaiseAt: 0.55,
  sbLimpAt: 0.25,
  bbIsoRaiseAt: 0.75,
  vsRaiseThreeBetAt: 0.85,
  vsRaiseCallAt: 0.3,
  vsThreeBetCallAt: 0.6,
  postflopValueBetPotShare: 0.75,
});

/**
 * DESIGN VALUE thresholds for plo8_hu_tight_blind_v1 (short-stack tight-blind
 * / nit harm control in PLO8 heads-up):
 *  - First in (SB): raises pot ONLY with top 25%, never limps, folds 75%
 *    (tests whether Hero's 75% BB defence loses against a tight opener).
 *  - Checked-to BB: raises pot with top 15%, checks the rest.
 *  - Facing one raise (BB): 3-bets pot with top 10%, calls next 15% (25% total
 *    defence, folding 75% of big blinds).
 *  - Facing 2+ raises: continues ONLY with top 15%, folds weaker.
 *  - Postflop: bets 75% pot (and raises pot facing a bet) with trips+ or
 *    two-pair+low or 6-or-better low; bets 50% pot with two pair; calls bets
 *    with two pair+ or any made low; folds one pair or worse with no made low.
 */
export const PLO8_HU_TIGHT_BLIND_THRESHOLDS = Object.freeze({
  sbRaiseAt: 0.75,
  bbIsoRaiseAt: 0.85,
  vsRaiseThreeBetAt: 0.9,
  vsRaiseCallAt: 0.75,
  vsThreeBetCallAt: 0.85,
  strongBetPotShare: 0.75,
  mediumBetPotShare: 0.5,
});

/**
 * DESIGN VALUE thresholds for plo8_hu_aggro_3bettor_v1 (aggressive short-stack
 * 3-betting / jamming harm control in PLO8 heads-up, built to punish wide
 * first-in SB opens and pressure wide BB defence):
 *  - First in (SB): raises pot with top 70%, never limps, folds bottom 30%.
 *  - Checked-to BB: raises pot with top 50%, checks the rest.
 *  - Facing one raise (BB): 3-bets pot (jamming or committing at 12bb) with
 *    top 45%, calls next 25% (70% total defence), folds bottom 30%.
 *  - Facing 2+ raises: continues (calls off / commits) with top 55%, folds
 *    weaker.
 *  - Postflop: bets full pot when checked to with any pair+, made low, or low
 *    draw; raises pot facing a bet with two pair+, made low, or pair+low draw;
 *    calls a bet with any pair or low draw; folds pure air.
 */
export const PLO8_HU_AGGRO_3BETTOR_THRESHOLDS = Object.freeze({
  sbRaiseAt: 0.3,
  bbIsoRaiseAt: 0.5,
  vsRaiseThreeBetAt: 0.55,
  vsRaiseCallAt: 0.3,
  vsThreeBetCallAt: 0.45,
  postflopBetPotShare: 1,
});

const LOW_RANK_VALUE: Readonly<Record<string, number>> = Object.freeze({
  A: 1,
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
});

function callOrCheck(s: LeagueSeatSpot): Decision {
  if (s.toCall <= 0 && s.legalActions.includes('check')) return { action: 'check' };
  if (s.legalActions.includes('call')) return { action: 'call' };
  if (s.legalActions.includes('all_in')) return { action: 'all_in' };
  if (s.legalActions.includes('check')) return { action: 'check' };
  return { action: s.legalActions[0] ?? 'fold' };
}

function foldOrCheck(s: LeagueSeatSpot): Decision {
  if (s.toCall <= 0 && s.legalActions.includes('check')) return { action: 'check' };
  if (s.legalActions.includes('fold')) return { action: 'fold' };
  return callOrCheck(s);
}

/**
 * Pot-limit-safe wager toward `targetTo` (total street commitment). Uses
 * `legalWagerTo` so fractional-cent pot-limit caps never round above
 * `s.maxRaiseTo` (AScriptedSeatWagerIsInsideTheLegalRange.law.test.ts).
 */
function wagerTo(s: LeagueSeatSpot, targetTo: number): Decision | null {
  const kind = s.currentBet > 0 ? 'raise' : 'bet';
  if (s.legalActions.includes(kind) && s.minRaiseTo !== null && s.maxRaiseTo !== null) {
    return { action: kind, amount: legalWagerTo(s.minRaiseTo, s.maxRaiseTo, targetTo) };
  }
  if (s.legalActions.includes('all_in')) return { action: 'all_in' };
  return null;
}

/** Full pot-sized wager (or all-in if short stack covers the pot cap). */
function potWager(s: LeagueSeatSpot, potShare = 1): Decision | null {
  const fullPotTo = s.currentBet + s.toCall + s.pot;
  const targetTo =
    potShare >= 1 ? fullPotTo : s.currentBet + s.toCall + Math.max(s.bigBlind, s.pot * potShare);
  return wagerTo(s, targetTo);
}

function streetWagers(s: LeagueSeatSpot): number {
  let n = 0;
  for (const a of s.history) {
    if (
      a.stage === s.stage &&
      (a.action === 'bet' || a.action === 'raise' || a.action === 'all_in')
    )
      n++;
  }
  return n;
}

/**
 * Pure PLO8 postflop hand summary using PokerEngine's exact Omaha high and
 * 8-or-better low evaluators plus deterministic low-draw detection on flop/turn.
 */
export function plo8PostflopHandRead(
  holeCards: readonly Card[],
  board: readonly Card[],
  stage: HandStage
): {
  highRanking: number;
  hasMadeLow: boolean;
  lowTopRank: number | null;
  hasLowDraw: boolean;
} {
  const cards = [...holeCards];
  const comm = [...board];
  const highRanking = comm.length >= 3 ? evaluateOmahaHand(cards, comm).ranking : 0;
  const low = comm.length >= 3 ? evaluateOmahaLowHand(cards, comm) : null;
  const lowTopRank = low && low.kickers.length > 0 ? low.kickers[0]! : null;
  const hasMadeLow = low !== null;

  let hasLowDraw = false;
  if (!hasMadeLow && (stage === 'flop' || stage === 'turn')) {
    const holeLows = new Set<number>();
    for (const c of cards) {
      const v = LOW_RANK_VALUE[c.rank];
      if (v !== undefined) holeLows.add(v);
    }
    const boardLows = new Set<number>();
    for (const c of comm) {
      const v = LOW_RANK_VALUE[c.rank];
      if (v !== undefined) boardLows.add(v);
    }
    // At least 2 distinct low hole cards not all paired on board, and 2+ low board cards
    // so one running low card completes a qualifying 8-or-better low.
    let unpairedHoleLows = 0;
    for (const v of holeLows) if (!boardLows.has(v)) unpairedHoleLows++;
    hasLowDraw = boardLows.size >= 2 && unpairedHoleLows >= 2;
  }

  return { highRanking, hasMadeLow, lowTopRank, hasLowDraw };
}

// plo8_hu_rec_caller_v1 -------------------------------------------------------

export const plo8HuRecCallerPolicy: LeagueSeatPolicy = (s) => {
  const stage = s.stage as HandStage;
  const t = PLO8_HU_REC_CALLER_THRESHOLDS;
  if (stage === 'preflop') {
    const p = omahaPreflopPercentile([...s.cards], true);
    const wagers = streetWagers(s);
    if (wagers === 0) {
      if (s.toCall <= 0) {
        return p >= t.bbIsoRaiseAt ? (potWager(s, 1) ?? callOrCheck(s)) : callOrCheck(s);
      }
      if (p >= t.sbRaiseAt) return potWager(s, 1) ?? callOrCheck(s);
      if (p >= t.sbLimpAt) return callOrCheck(s);
      return foldOrCheck(s);
    }
    if (wagers === 1) {
      if (p >= t.vsRaiseThreeBetAt) return potWager(s, 1) ?? callOrCheck(s);
      if (p >= t.vsRaiseCallAt) return callOrCheck(s);
      return foldOrCheck(s);
    }
    return p >= t.vsThreeBetCallAt ? callOrCheck(s) : foldOrCheck(s);
  }

  const read = plo8PostflopHandRead(s.cards, s.board, stage);
  const strongValue =
    read.highRanking >= HAND_RANKINGS.TWO_PAIR ||
    (read.hasMadeLow && read.highRanking >= HAND_RANKINGS.PAIR) ||
    (read.hasMadeLow && read.lowTopRank !== null && read.lowTopRank <= 6);
  const monster =
    read.highRanking >= HAND_RANKINGS.THREE_OF_A_KIND ||
    (read.hasMadeLow &&
      read.lowTopRank !== null &&
      read.lowTopRank <= 6 &&
      read.highRanking >= HAND_RANKINGS.PAIR);
  const stickyContinue =
    strongValue || read.highRanking >= HAND_RANKINGS.PAIR || read.hasMadeLow || read.hasLowDraw;

  if (s.toCall <= 0) {
    if (strongValue) return potWager(s, t.postflopValueBetPotShare) ?? { action: 'check' };
    return { action: 'check' };
  }
  if (monster && streetWagers(s) <= 1) return potWager(s, 1) ?? callOrCheck(s);
  return stickyContinue ? callOrCheck(s) : foldOrCheck(s);
};

// plo8_hu_tight_blind_v1 ------------------------------------------------------

export const plo8HuTightBlindPolicy: LeagueSeatPolicy = (s) => {
  const stage = s.stage as HandStage;
  const t = PLO8_HU_TIGHT_BLIND_THRESHOLDS;
  if (stage === 'preflop') {
    const p = omahaPreflopPercentile([...s.cards], true);
    const wagers = streetWagers(s);
    if (wagers === 0) {
      if (s.toCall <= 0) {
        return p >= t.bbIsoRaiseAt ? (potWager(s, 1) ?? callOrCheck(s)) : callOrCheck(s);
      }
      if (p >= t.sbRaiseAt) return potWager(s, 1) ?? callOrCheck(s);
      return foldOrCheck(s);
    }
    if (wagers === 1) {
      if (p >= t.vsRaiseThreeBetAt) return potWager(s, 1) ?? callOrCheck(s);
      if (p >= t.vsRaiseCallAt) return callOrCheck(s);
      return foldOrCheck(s);
    }
    return p >= t.vsThreeBetCallAt ? callOrCheck(s) : foldOrCheck(s);
  }

  const read = plo8PostflopHandRead(s.cards, s.board, stage);
  const strongValue =
    read.highRanking >= HAND_RANKINGS.THREE_OF_A_KIND ||
    (read.hasMadeLow && read.highRanking >= HAND_RANKINGS.TWO_PAIR) ||
    (read.hasMadeLow && read.lowTopRank !== null && read.lowTopRank <= 6);
  const solidShowdown = read.highRanking >= HAND_RANKINGS.TWO_PAIR || read.hasMadeLow;

  if (s.toCall <= 0) {
    if (strongValue) return potWager(s, t.strongBetPotShare) ?? { action: 'check' };
    if (read.highRanking >= HAND_RANKINGS.TWO_PAIR) {
      return potWager(s, t.mediumBetPotShare) ?? { action: 'check' };
    }
    return { action: 'check' };
  }
  if (strongValue && streetWagers(s) <= 1) return potWager(s, 1) ?? callOrCheck(s);
  return solidShowdown ? callOrCheck(s) : foldOrCheck(s);
};

// plo8_hu_aggro_3bettor_v1 ----------------------------------------------------

export const plo8HuAggro3BettorPolicy: LeagueSeatPolicy = (s) => {
  const stage = s.stage as HandStage;
  const t = PLO8_HU_AGGRO_3BETTOR_THRESHOLDS;
  if (stage === 'preflop') {
    const p = omahaPreflopPercentile([...s.cards], true);
    const wagers = streetWagers(s);
    if (wagers === 0) {
      if (s.toCall <= 0) {
        return p >= t.bbIsoRaiseAt ? (potWager(s, 1) ?? callOrCheck(s)) : callOrCheck(s);
      }
      if (p >= t.sbRaiseAt) return potWager(s, 1) ?? callOrCheck(s);
      return foldOrCheck(s);
    }
    if (wagers === 1) {
      if (p >= t.vsRaiseThreeBetAt) return potWager(s, 1) ?? callOrCheck(s);
      if (p >= t.vsRaiseCallAt) return callOrCheck(s);
      return foldOrCheck(s);
    }
    return p >= t.vsThreeBetCallAt ? callOrCheck(s) : foldOrCheck(s);
  }

  const read = plo8PostflopHandRead(s.cards, s.board, stage);
  const aggroRaise =
    read.highRanking >= HAND_RANKINGS.TWO_PAIR ||
    read.hasMadeLow ||
    (read.highRanking >= HAND_RANKINGS.PAIR && read.hasLowDraw);
  const continueHand = aggroRaise || read.highRanking >= HAND_RANKINGS.PAIR || read.hasLowDraw;

  if (s.toCall <= 0) {
    if (continueHand) return potWager(s, t.postflopBetPotShare) ?? { action: 'check' };
    return { action: 'check' };
  }
  if (aggroRaise && streetWagers(s) <= 1) return potWager(s, 1) ?? callOrCheck(s);
  return continueHand ? callOrCheck(s) : foldOrCheck(s);
};

/** The seat policy a scripted PLO8 heads-up persona plays. */
export function plo8HuScriptedPolicy(persona: Plo8HuScriptedPersona): LeagueSeatPolicy {
  if (persona === PLO8_HU_REC_CALLER_PERSONA) return plo8HuRecCallerPolicy;
  if (persona === PLO8_HU_TIGHT_BLIND_PERSONA) return plo8HuTightBlindPolicy;
  if (persona === PLO8_HU_AGGRO_3BETTOR_PERSONA) return plo8HuAggro3BettorPolicy;
  throw new Error(`Unknown scripted PLO8 heads-up persona: ${String(persona)}`);
}
