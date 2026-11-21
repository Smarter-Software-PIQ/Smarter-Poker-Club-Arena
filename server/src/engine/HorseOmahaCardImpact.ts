/**
 * OMAHA CARD IMPACT (owner 2026-11-15 11:41; option omahaCardImpact, default
 * OFF, read `=== true`).
 *
 * The owner, in substance: when a bad card comes the Horse has to realise it
 * is a bad card for its hand or its range, and when a turn or river card is a
 * bad card for the opponent's range; it must play defence on bad cards, take
 * full advantage of good cards that offer freerolls or more nut outs, and no
 * blanket rule may force it off the correct decision.
 *
 * What this file computes, at a PLO4/PLO5 cash turn or river decision with
 * nothing to call, heads-up, one board, high only, from public information
 * (the Horse's cards, the board, the action history, the stacks and, when
 * there is one, the measured read of the opponent):
 *
 *  (a) OWN HAND: how many unseen two-card holdings beat the Horse's hand
 *      before the last card and after it (blockers included: the Horse's own
 *      cards are removed), whether it held and holds the nuts, on the turn
 *      how many river cards give it the nuts, and the freeroll: it holds the
 *      nuts, other holdings tie it, and river cards lift it over them.
 *  (b) OPPONENT RANGE: a sample of opponent hands weighted by the line he
 *      took this hand (each call keeps the top of his range by the pot odds
 *      he was laid, scaled by his measured fold rate when he is measured;
 *      each bet, raise and check re-weights it likewise). Of that range: the
 *      share ahead of the Horse before the card and after it, the share the
 *      card improved past the Horse, the share it left behind, and the share
 *      of draws that missed.
 *  (c) an expected-value comparison of a check and of every bet size the
 *      engine considers, against a response model of that range: at each
 *      size the top of the range raises, the next part calls, the rest folds;
 *      after a check out of position he bets his best hands and some of his
 *      worst. Of the hands that call, the share that beats the Horse is
 *      reported with each size.
 *
 * HorseLogic (omahaCardImpactRule, wager_rules node) replaces the decision
 * with the candidate of highest expected value when it beats the chosen one
 * by more than OMAHA_CARD_IMPACT_MARGIN of the pot. The candidates are the
 * check, every value bet (river: the hands that call and lose outweigh those
 * that call or raise and win; turn: at least half the equity against the
 * hands that continue) and, on the turn, a bet no larger than the one chosen.
 * A river bet that is not a value bet is replaced whatever its modelled fold
 * equity. A larger bet that is not a value bet is a bluff or semi-bluff and
 * stays with the bluff and barrel paths, which keep their own decision. No
 * spot is always a check or always a bet: every candidate is priced.
 *
 * Deterministic: the sample is drawn from a private stream seeded by the
 * cards and the seats; the brain's random stream is never read. A model, not
 * a solver: see LIMITS at the end of this comment.
 *
 * LIMITS. Heads-up only. The opponent's preflop range is every hand. Draw
 * strength in the line weights is a rank-and-suit count, not an equity. On
 * the turn the river is dealt out exactly but no river betting is modelled.
 * After a check the Horse only calls or folds (no check-raise). A hand that
 * wins under OMAHA_CARD_IMPACT_BLUFF_SHARE of the pot against the range and
 * beats under OMAHA_CARD_IMPACT_AIR_SHARE of all hands is a bluff candidate
 * and is left to the existing bluff paths.
 */
import type { Card, HorseDecision, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import type { OmahaReadConditional } from './HorseOmahaReadConditional.js';
import { scoreOmahaHiPartial, variantInfo } from './HorseEval.js';
import { omahaTurnRiverTables } from './HorseOmahaRiverTables.js';
import { omahaNutClassNow } from './HorseOmahaMadeHandDefense.js';
import { RANKS, RANK_VALUES, SUITS } from './PokerEngine.js';
import {
  omahaCashOnlyExcludes,
  omahaIcmPremiumOf,
  omahaTournamentIcmRisk,
} from './HorseOmahaTournamentScope.js';
import {
  omahaStrategyGameInScope,
  omahaStrategyConstant,
  omahaStrategyHoleCountServed,
} from './HorseOmahaStrategyGame.js';

export const OMAHA_CARD_IMPACT_VARIANTS: ReadonlySet<string> = new Set(['plo4', 'plo5']);
/** Opponent hands sampled per decision. */
export const OMAHA_CARD_IMPACT_SAMPLES = 800;
/** A replacement must beat the chosen action by this share of the pot. */
export const OMAHA_CARD_IMPACT_MARGIN = 0.04;
/** A bluff candidate, which the bluff paths own: it wins under BLUFF_SHARE of
 * the pot against his range AND beats under AIR_SHARE of all unseen hands. */
export const OMAHA_CARD_IMPACT_BLUFF_SHARE = 0.3;
export const OMAHA_CARD_IMPACT_AIR_SHARE = 0.35;
/** Outs (flush 9 or 5.4, three per straight rank) that make a hand a draw. */
export const OMAHA_CARD_IMPACT_DRAW_OUTS = 5;
/** River cards to the nuts that make a turn card a good card for the hand. */
export const OMAHA_CARD_IMPACT_NUT_OUTS = 6;
/** Pot fractions considered, beside the size the engine chose. */
export const OMAHA_CARD_IMPACT_SIZES: readonly number[] = [0.33, 0.5, 0.66, 0.75, 1];
/** River cards that must lift the nuts over the hands tying it, for a freeroll. */
export const OMAHA_CARD_IMPACT_FREEROLL_OUTS = 4;
/** Population priors, used when the opponent is not measured. */
export const OMAHA_CARD_IMPACT_PRIOR = {
  /** bets when checked to */
  betCheckedTo: 0.45,
  /** share of his bets that are bluffs */
  bluffShare: 0.3,
  /** share of his range that raises a bet */
  raiseShare: 0.1,
  /** the bet he makes when checked to, as a share of the pot */
  betSize: 0.66,
  /** reference bet share at which a measured fold rate was observed */
  referenceBet: 0.6,
} as const;

const STREET_BOARD: Record<string, number> = { turn: 4, river: 5 };
const key = (c: Card) => `${c.rank}${c.suit[0]}`;
const cat = (score: number) => Math.floor(score / 0x100000);
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const round2 = (n: number) => Math.round(n * 100) / 100;

/** The opponent's tendencies as the model uses them. */
export interface OmahaCardImpactRead {
  measured: boolean;
  /** share of his range that continues against a reference-size bet (1 - fold to bet) */
  continueRate: number | null;
  /** the same on the river */
  riverCallRate: number | null;
  betCheckedTo: number;
  bluffShare: number;
}

export function omahaCardImpactRead(read: OmahaReadConditional | null): OmahaCardImpactRead {
  const P = OMAHA_CARD_IMPACT_PRIOR;
  if (!read || read.measured !== true)
    return {
      measured: false,
      continueRate: null,
      riverCallRate: null,
      betCheckedTo: P.betCheckedTo,
      bluffShare: P.bluffShare,
    };
  const fin = (x: unknown): number | null =>
    typeof x === 'number' && Number.isFinite(x) ? clamp(x, 0, 1) : null;
  const fold = fin(read.foldToBet?.mean);
  return {
    measured: true,
    continueRate: fold === null ? null : 1 - fold,
    riverCallRate: fin(read.riverCall?.mean),
    betCheckedTo: fin(read.betCheckedTo?.mean) ?? P.betCheckedTo,
    bluffShare: read.valueLeader
      ? 0.15
      : read.betCheckedTo?.engaged === 'high'
        ? 0.45
        : P.bluffShare,
  };
}

/** One thing the opponent did after the flop, in order. */
export interface OmahaCardImpactStep {
  /** board cards out when he acted: 3, 4 or 5 */
  boardLen: number;
  kind: 'call' | 'bet' | 'raise' | 'check';
  /** call only: the pot-odds share of a range that continues (pot / (pot + bet)) */
  keep: number;
}

export interface OmahaCardImpactScope {
  street: 'turn' | 'river';
  opponent: SeatPlayer;
  /** the opponent has checked this street: a check by the Horse ends it */
  heroCloses: boolean;
}

/** The scope of the option at this node, or null. Public information only. */
export function omahaCardImpactScope(
  hero: SeatPlayer,
  gs: HorseGameStateV2
): OmahaCardImpactScope | null {
  try {
    const variant = String(gs.gameVariant ?? '').toLowerCase();
    if (!omahaStrategyGameInScope(OMAHA_CARD_IMPACT_VARIANTS, gs)) return null;
    const stage = String(gs.stage ?? '');
    if (stage !== 'turn' && stage !== 'river') return null;
    const vi = variantInfo(variant);
    if (!vi.isOmaha || vi.isFixedLimit || gs.bettingStructure === 'fixed_limit') return null;
    if (gs.variantRules ? gs.variantRules.splitLow8OrBetter : vi.isHiLo) return null;
    if (
      (gs.boardCount ?? 1) > 1 ||
      (gs.communityCards2?.length ?? 0) > 0 ||
      (gs.communityCards3?.length ?? 0) > 0
    )
      return null;
    if (gs.allInOrFold === true || gs.wagersCapped === true) return null;
    // Cash only; omahaStrategyInTournaments opens its public tournament scope.
    if (omahaCashOnlyExcludes(hero, gs)) return null;
    if ((gs.communityCards ?? []).length !== STREET_BOARD[stage]) return null;
    if (!Array.isArray(hero.cards) || hero.cards.length !== vi.holeCount) return null;
    if (hero.is_folded || hero.is_all_in || !(hero.stack > 0)) return null;
    const toCall = Number.isFinite(gs.toCall)
      ? Math.max(0, gs.toCall as number)
      : Math.max(0, (gs.currentBet || 0) - (Number.isFinite(hero.bet) ? hero.bet : 0));
    if (toCall > 0.005) return null;
    if (Array.isArray(gs.legalActions) && !gs.legalActions.includes('check')) return null;
    if (!Number.isFinite(gs.pot) || !(gs.pot > 0)) return null;
    const live = (gs.players ?? []).filter(
      (p) => p.seat !== hero.seat && !p.is_folded && !p.is_sitting_out
    );
    if (live.length !== 1) return null;
    const opponent = live[0];
    if (opponent.is_all_in || !(opponent.stack > 0)) return null;
    const heroCloses = (gs.actionHistory ?? []).some(
      (a) => String(a.stage) === stage && a.seat === opponent.seat && String(a.action) === 'check'
    );
    return { street: stage, opponent, heroCloses };
  } catch {
    return null;
  }
}

/**
 * The opponent's postflop line from the action history. Pots of the earlier
 * streets are rebuilt backwards from the pot now; where that fails a call
 * keeps the reference-bet share.
 */
export function omahaCardImpactLine(
  hero: SeatPlayer,
  opponent: SeatPlayer,
  gs: HorseGameStateV2
): OmahaCardImpactStep[] {
  const history = Array.isArray(gs.actionHistory) ? gs.actionHistory : [];
  const stage = String(gs.stage ?? '');
  const streets = stage === 'river' ? ['flop', 'turn', 'river'] : ['flop', 'turn'];
  const boardLen: Record<string, number> = { flop: 3, turn: 4, river: 5 };
  // Chips each street added, walking forward.
  interface Walk {
    total: number;
    events: Array<{ kind: OmahaCardImpactStep['kind']; potBefore: number; risk: number }>;
  }
  const walk = (street: string): Walk => {
    const committed = new Map<number, number>();
    let wager = 0;
    let sum = 0;
    let aggPot = 0;
    let aggRisk = 0;
    const events: Walk['events'] = [];
    for (const a of history) {
      if (String(a.stage) !== street) continue;
      const act = String(a.action);
      const amt = Number.isFinite(a.amount) ? Math.max(0, a.amount as number) : 0;
      const had = committed.get(a.seat) ?? 0;
      const mine = a.seat === opponent.seat;
      if (act === 'check') {
        if (mine && wager <= 0.005) events.push({ kind: 'check', potBefore: sum, risk: 0 });
      } else if (act === 'call' || (act === 'all_in' && amt <= wager + 0.005 && wager > 0)) {
        const add = act === 'call' ? amt : Math.max(0, Math.min(amt, wager) - had);
        if (mine) events.push({ kind: 'call', potBefore: aggPot, risk: aggRisk });
        committed.set(a.seat, had + add);
        sum += add;
      } else if (act === 'bet' || act === 'raise' || act === 'all_in') {
        const add = Math.max(0, amt - had);
        if (mine)
          events.push({ kind: wager <= 0.005 ? 'bet' : 'raise', potBefore: sum, risk: add });
        aggPot = sum;
        aggRisk = add;
        committed.set(a.seat, amt);
        sum += add;
        wager = Math.max(wager, amt);
      }
    }
    return { total: sum, events };
  };
  const walks = streets.map(walk);
  // Pot at the start of each street, backwards from the pot now.
  const now = Number.isFinite(gs.pot) ? gs.pot : 0;
  const starts: number[] = new Array(streets.length).fill(NaN);
  let p = now - walks[walks.length - 1].total;
  for (let i = streets.length - 1; i >= 0; i--) {
    starts[i] = p;
    if (i > 0) p -= walks[i - 1].total;
  }
  const ref = 1 / (1 + OMAHA_CARD_IMPACT_PRIOR.referenceBet);
  const steps: OmahaCardImpactStep[] = [];
  streets.forEach((street, i) => {
    for (const e of walks[i].events) {
      const pot = starts[i] + e.potBefore;
      const keep = e.kind === 'call' && pot > 0.005 && e.risk > 0.005 ? pot / (pot + e.risk) : ref;
      steps.push({ boardLen: boardLen[street], kind: e.kind, keep: clamp(keep, 0.05, 0.97) });
    }
  });
  void hero;
  return steps;
}

export interface OmahaCardImpactOption {
  action: 'check' | 'bet' | 'all_in';
  amount: number;
  /** expected chips from here (the pot share won less the chips put in) */
  ev: number;
  /** share of his range that folds, calls, raises */
  fold: number;
  call: number;
  raise: number;
  /** of the hands that call or raise, the share that beats the Horse */
  continueBeats: number;
  /** the Horse's equity against the hands that call or raise */
  continueEquity: number;
  /**
   * A value bet: on the river the hands that continue and lose outweigh those
   * that continue and win; on the turn the Horse has at least half the equity
   * against the hands that continue. Always false for a check.
   */
  value: boolean;
}

export interface OmahaCardImpact {
  street: 'turn' | 'river';
  own: {
    /** unseen two-card holdings */
    combos: number;
    beatersBefore: number;
    beatersNow: number;
    nutsBefore: boolean;
    nutsNow: boolean;
    /** turn only: river cards after which the Horse holds the nuts */
    nutOuts: number;
    /** turn only: river cards that lift the nuts over the holdings tying it */
    freerollOuts: number;
    freeroll: boolean;
  };
  opp: {
    measured: boolean;
    /** effective sample size of the weighted range */
    effective: number;
    aheadBefore: number;
    aheadNow: number;
    /** behind or level before the card, ahead after it */
    improvedPast: number;
    /** ahead before the card, behind after it */
    leftBehind: number;
    /** held a draw before the card, did not improve and is behind */
    missedDraws: number;
  };
  /** the Horse's share of the pot at showdown against the range */
  showdown: number;
  /** the share of all unseen hands (unweighted) the Horse's hand beats now */
  beatsRandom: number;
  /** bad: more of his range is ahead, or the nut rank fell; good: a freeroll,
   * the nuts gained, nut outs gained, his range left behind or missed */
  verdict: 'bad' | 'good' | 'mixed' | 'neutral';
  options: OmahaCardImpactOption[];
}

export interface OmahaCardImpactInput {
  hole: Card[];
  board: Card[];
  dead?: Card[];
  pot: number;
  heroStack: number;
  oppStack: number;
  heroCloses: boolean;
  line: OmahaCardImpactStep[];
  read: OmahaCardImpactRead;
  /** bet amounts to price (each at most the Horse's stack) */
  amounts: number[];
  /** an opponent seat, mixed into the seed only */
  seedSalt?: number;
  /**
   * omahaSmallBetIsPriced (default absent): the share of his range that continues and that raises facing a bet of a
   * given pot share, measured (HorseOmahaSmallBet.omahaSmallBetResponseAt). Absent: the pot-odds keep and the prior raise share.
   */
  responseAt?: OmahaCardImpactResponseCurve;
  /**
   * omahaStrongHandCheckIsPriced (default absent): the size of his bet after a check, as a share of the pot, from his
   * own public stab sizes shrunk to the population's. Absent: the fixed prior size (P.betSize), as before.
   */
  stabSize?: number;
}

/**
 * The share of his range that continues against a bet laid at pot odds `prior` (pot / (pot + bet)): the pot odds, scaled by his
 * measured continue rate at the reference bet when he is measured. The one owner of that keep (omahaCardImpact's line weights
 * and bet responses use it).
 */
export function omahaCardImpactKeep(
  read: OmahaCardImpactRead,
  prior: number,
  river: boolean
): number {
  const rate = river ? (read.riverCallRate ?? read.continueRate) : read.continueRate;
  if (!read.measured || rate === null) return prior;
  return clamp((rate * prior) / (1 / (1 + OMAHA_CARD_IMPACT_PRIOR.referenceBet)), 0.05, 0.97);
}

/** Points (pot share, continue share, raise share) sorted by share; linear between points, flat beyond the ends. */
export type OmahaCardImpactResponseCurve = readonly {
  share: number;
  cont: number;
  raise: number;
}[];

/** The curve at a pot share: continue and raise shares, each clamped to [0, 1], raise <= continue. */
export function omahaCardImpactResponseOf(
  curve: OmahaCardImpactResponseCurve,
  share: number
): { cont: number; raise: number } {
  const n = curve.length;
  const at = (i: number) => ({
    cont: clamp(curve[i].cont, 0, 1),
    raise: clamp(Math.min(curve[i].raise, curve[i].cont), 0, 1),
  });
  if (share <= curve[0].share) return at(0);
  if (share >= curve[n - 1].share) return at(n - 1);
  for (let i = 1; i < n; i++)
    if (share <= curve[i].share) {
      const a = at(i - 1);
      const b = at(i);
      const t = (share - curve[i - 1].share) / (curve[i].share - curve[i - 1].share);
      return { cont: a.cont + t * (b.cont - a.cont), raise: a.raise + t * (b.raise - a.raise) };
    }
  return at(n - 1);
}

const cache = new Map<string, OmahaCardImpact | null>();
const CACHE_MAX = 128;

/**
 * The ranks (2 to 14) whose arrival gives the hand a straight it does not
 * hold, by rank masks (bit r = rank value r, ace also bit 1), under the
 * two-card rule. Empty when the hand already holds a straight.
 */
export function omahaStraightOutRanks(holeMask: number, boardMask: number): number[] {
  const made = (bm: number): boolean => {
    for (let top = 14; top >= 5; top--) {
      let w = 0;
      for (let k = 0; k < 5; k++) w |= 1 << (top - k === 1 ? 1 : top - k);
      const missing = w & ~bm;
      let m = 0;
      for (let b = missing; b; b &= b - 1) m++;
      if (m > 2 || (missing & ~holeMask) !== 0) continue;
      let h = 0;
      for (let b = holeMask & w; b; b &= b - 1) h++;
      if (h >= 2) return true;
    }
    return false;
  };
  const out: number[] = [];
  if (made(boardMask)) return out;
  for (let r = 2; r <= 14; r++) {
    const bit = (1 << r) | (r === 14 ? 2 : 0);
    if (boardMask & (1 << r)) continue;
    if (made(boardMask | bit)) out.push(r);
  }
  return out;
}

/** Straight-draw rank outs by rank masks (bit r = rank value r, ace also bit 1). */
const straightRankOuts = (holeMask: number, boardMask: number): number =>
  omahaStraightOutRanks(holeMask, boardMask).length;

/** The rank mask of some cards (bit r = rank value r, ace also bit 1). */
export const omahaRankMask = (cards: readonly Card[]): number => {
  let m = 0;
  for (const c of cards) {
    const v = RANK_VALUES[c.rank];
    m |= 1 << v;
    if (v === 14) m |= 2;
  }
  return m;
};
const rankMask = omahaRankMask;

/**
 * 0: the draw outs of a sampled hand are the fixed form below (PLO4/PLO5, as
 * the option was measured). 1: the distinct form (PLO6 lane, H19). Read per
 * game through omahaStrategyConstant('cardImpactDistinctDrawOuts').
 */
export const OMAHA_CARD_IMPACT_DISTINCT_DRAW_OUTS = 0;

/**
 * The draw outs of a hand before the river (0 on a five-card board).
 *
 * Fixed form (`live` null; PLO4/PLO5): a flush draw is 9 outs when it is the
 * nut draw and 5.4 otherwise, however many of the suit are held or gone; a
 * straight draw is 3 outs for every rank that completes it; the two are
 * added, so a card that completes both is counted twice.
 *
 * Distinct form (`live` = the cards that can still come: not in this hand,
 * not in the Horse's hand, not on the board; PLO6 lane 2026-11-15, H19):
 * every live card that completes the flush or a straight is counted once; a
 * card that only completes a flush that is not the nut flush counts 0.6
 * (5.4 / 9, the fixed form's own weight).
 */
export function omahaCardImpactDrawOuts(
  hand: readonly Card[],
  b: readonly Card[],
  live: readonly Card[] | null
): number {
  if (b.length >= 5) return 0;
  let outs = 0;
  const flush = new Map<string, number>();
  for (const suit of SUITS) {
    const onBoard = b.filter((c) => c.suit === suit);
    if (onBoard.length !== 2) continue;
    const mine = hand.filter((c) => c.suit === suit);
    if (mine.length < 2) continue;
    const taken = new Set(onBoard.map((c) => RANK_VALUES[c.rank]));
    let topFree = 14;
    while (taken.has(topFree)) topFree--;
    const nut = mine.some((c) => RANK_VALUES[c.rank] === topFree);
    outs = Math.max(outs, nut ? 9 : 5.4);
    flush.set(suit, nut ? 1 : 0.6);
  }
  if (live === null) return outs + straightRankOuts(rankMask(hand), rankMask(b)) * 3;
  const ranks = new Set(omahaStraightOutRanks(rankMask(hand), rankMask(b)));
  let distinct = 0;
  for (const c of live)
    distinct += Math.max(flush.get(c.suit) ?? 0, ranks.has(RANK_VALUES[c.rank]) ? 1 : 0);
  return distinct;
}

/** The whole computation. Null when it cannot be made. */
export function omahaCardImpact(input: OmahaCardImpactInput): OmahaCardImpact | null {
  const { hole, board, pot, heroStack, oppStack, heroCloses, line, read } = input;
  const dead = input.dead ?? [];
  if (board.length !== 4 && board.length !== 5) return null;
  if (!omahaStrategyHoleCountServed(hole.length)) return null;
  if (!(pot > 0) || !(heroStack > 0) || !(oppStack > 0)) return null;
  const known = [...hole, ...board, ...dead];
  if (new Set([...hole, ...board].map(key)).size !== hole.length + board.length) return null;
  const cacheKey = JSON.stringify([
    hole.map(key),
    board.map(key),
    dead.map(key),
    round2(pot),
    round2(heroStack),
    round2(oppStack),
    heroCloses,
    line,
    read,
    input.amounts.map(round2),
    input.seedSalt ?? 0,
    omahaStrategyConstant('cardImpactDistinctDrawOuts', { gameVariant: `plo${hole.length}` }),
    ...(input.responseAt && input.responseAt.length > 0 ? [input.responseAt] : []),
  ]);
  const hit = cache.get(cacheKey);
  if (hit !== undefined)
    return hit === null ? null : (JSON.parse(JSON.stringify(hit)) as OmahaCardImpact);

  const street: 'turn' | 'river' = board.length === 4 ? 'turn' : 'river';
  const removed = new Set(known.map(key));
  const unseen: Card[] = [];
  for (const suit of SUITS)
    for (const rank of RANKS) {
      const c = { rank, suit } as Card;
      if (!removed.has(key(c))) unseen.push(c);
    }
  const n = unseen.length;
  const h = hole.length;
  if (n < h + 2) return null;
  const prev = board.slice(0, -1);
  const flop = board.slice(0, 3);

  // Two-card tables on each board: the best hand each unseen pair makes.
  const table = (b: Card[]): Float64Array => {
    const t = new Float64Array(n * n);
    const two: Card[] = [unseen[0], unseen[0]];
    for (let i = 0; i < n; i++) {
      two[0] = unseen[i];
      for (let j = i + 1; j < n; j++) {
        two[1] = unseen[j];
        const s = scoreOmahaHiPartial(two, b);
        t[i * n + j] = s;
        t[j * n + i] = s;
      }
    }
    return t;
  };
  // The turn's pair tables are the decision's shared exact count
  // (HorseOmahaRiverTables, the same values, taken once per decision).
  const shared = street === 'turn' ? omahaTurnRiverTables(hole, board, dead) : null;
  const tNow = shared !== null && shared.n === n ? shared.now : table(board);
  const tPrev = table(prev);
  const tFlop = prev.length === 3 ? tPrev : table(flop);
  const heroNow = scoreOmahaHiPartial(hole, board);
  const heroPrev = scoreOmahaHiPartial(hole, prev);
  if (!(heroNow > 0) || !(heroPrev > 0)) return null;

  // (a) own hand: beaters before and after, the nuts.
  const combos = (n * (n - 1)) / 2;
  let beatersNow = 0;
  let beatersBefore = 0;
  const tiePairs: number[] = [];
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const s = tNow[i * n + j];
      if (s > heroNow) beatersNow++;
      else if (s === heroNow) tiePairs.push(i * n + j);
      if (tPrev[i * n + j] > heroPrev) beatersBefore++;
    }

  // Turn: every river card. heroRiver[r], and per river the pair table of
  // the hands that use the river card.
  let riverInc: Float64Array[] | null = null;
  let heroRiver: Float64Array | null = null;
  let nutOuts = 0;
  let freerollOuts = 0;
  if (street === 'turn') {
    riverInc = new Array(n);
    heroRiver = new Float64Array(n);
    const b3: Card[] = [board[0], board[0], board[0]];
    const two: Card[] = [unseen[0], unseen[0]];
    const sub: Array<[number, number]> = [];
    for (let x = 0; x < 4; x++) for (let y = x + 1; y < 4; y++) sub.push([x, y]);
    for (let r = 0; r < n; r++) {
      let inc: Float64Array;
      let top = 0;
      if (shared !== null && shared.n === n) {
        inc = shared.river[r];
        for (let i = 0; i < n; i++) {
          if (i === r) continue;
          for (let j = i + 1; j < n; j++) {
            if (j === r) continue;
            const v = inc[i * n + j];
            if (v > top) top = v;
          }
        }
      } else {
        inc = new Float64Array(n * n);
        b3[2] = unseen[r];
        for (let i = 0; i < n; i++) {
          if (i === r) continue;
          two[0] = unseen[i];
          for (let j = i + 1; j < n; j++) {
            if (j === r) continue;
            two[1] = unseen[j];
            let best = tNow[i * n + j];
            for (const [x, y] of sub) {
              b3[0] = board[x];
              b3[1] = board[y];
              const s = scoreOmahaHiPartial(two, b3);
              if (s > best) best = s;
            }
            inc[i * n + j] = best;
            inc[j * n + i] = best;
            if (best > top) top = best;
          }
        }
      }
      riverInc[r] = inc;
      const hr = scoreOmahaHiPartial(hole, [...board, unseen[r]]);
      heroRiver[r] = hr;
      if (hr >= top) nutOuts++;
      if (beatersNow === 0 && tiePairs.length > 0 && hr > heroNow) {
        let level = 0;
        for (const p of tiePairs) {
          const i = Math.floor(p / n);
          const j = p % n;
          if (i === r || j === r) continue;
          if (inc[p] >= hr) level++;
        }
        if (level <= 0.2 * tiePairs.length) freerollOuts++;
      }
    }
  }
  const freeroll =
    street === 'turn' &&
    beatersNow === 0 &&
    tiePairs.length > 0 &&
    freerollOuts >= OMAHA_CARD_IMPACT_FREEROLL_OUTS;

  // (b) the opponent's range: a deterministic sample, weighted by his line.
  let seed = 0x811c9dc5;
  const seedText = [...hole.map(key).sort(), '|', ...board.map(key), '|', input.seedSalt ?? 0].join(
    ''
  );
  for (let i = 0; i < seedText.length; i++)
    seed = Math.imul(seed ^ seedText.charCodeAt(i), 0x01000193) >>> 0;
  if (seed === 0) seed = 1;
  const next = (): number => {
    seed ^= seed << 13;
    seed >>>= 0;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    seed >>>= 0;
    return seed / 4294967296;
  };
  const K = OMAHA_CARD_IMPACT_SAMPLES;
  const pool = Array.from({ length: n }, (_, i) => i);
  const hands: Int16Array = new Int16Array(K * h);
  for (let k = 0; k < K; k++) {
    for (let c = 0; c < h; c++) {
      const r = c + Math.floor(next() * (n - c));
      const tmp = pool[c];
      pool[c] = pool[r];
      pool[r] = tmp;
      hands[k * h + c] = pool[c];
    }
  }
  const best = (k: number, t: Float64Array): number => {
    let b = 0;
    for (let x = 0; x < h; x++)
      for (let y = x + 1; y < h; y++) {
        const s = t[hands[k * h + x] * n + hands[k * h + y]];
        if (s > b) b = s;
      }
    return b;
  };
  const sNow = new Float64Array(K);
  const sPrev = new Float64Array(K);
  const sFlop = new Float64Array(K);
  for (let k = 0; k < K; k++) {
    sNow[k] = best(k, tNow);
    sPrev[k] = best(k, tPrev);
    sFlop[k] = tFlop === tPrev ? sPrev[k] : best(k, tFlop);
  }
  // Draw outs before the river, by suit and rank counts.
  // (omahaCardImpactDrawOuts: the fixed form, or for a game whose calibration
  // sets cardImpactDistinctDrawOuts the distinct live cards.)
  const distinctOuts =
    omahaStrategyConstant('cardImpactDistinctDrawOuts', { gameVariant: `plo${h}` }) === 1;
  const outsOf = (k: number, b: Card[]): number => {
    if (b.length >= 5) return 0;
    const cards: Card[] = [];
    for (let c = 0; c < h; c++) cards.push(unseen[hands[k * h + c]]);
    if (!distinctOuts) return omahaCardImpactDrawOuts(cards, b, null);
    // What could still come on that board: the cards nobody is known to hold
    // (his own removed), and the board cards dealt after it.
    const live: Card[] = board.slice(b.length);
    const mine = new Set<number>();
    for (let c = 0; c < h; c++) mine.add(hands[k * h + c]);
    for (let u = 0; u < n; u++) if (!mine.has(u)) live.push(unseen[u]);
    return omahaCardImpactDrawOuts(cards, b, live);
  };
  const drawOf = (k: number, b: Card[]): number =>
    Math.min(0.6, outsOf(k, b) * (b.length === 3 ? 0.038 : 0.021));
  // Continue strength on a board: made-hand percentile lifted by the draw.
  const strength = (scores: Float64Array, b: Card[]): Float64Array => {
    const order = Array.from({ length: K }, (_, i) => i).sort((x, y) => scores[x] - scores[y]);
    const pct = new Float64Array(K);
    for (let i = 0; i < K; ) {
      let j = i;
      while (j < K && scores[order[j]] === scores[order[i]]) j++;
      for (let x = i; x < j; x++) pct[order[x]] = (i + j) / 2 / K;
      i = j;
    }
    const out = new Float64Array(K);
    for (let k = 0; k < K; k++) {
      const d = drawOf(k, b);
      out[k] = pct[k] + (1 - pct[k]) * d;
    }
    return out;
  };
  const cFlop = strength(sFlop, flop);
  const cPrev = prev.length === 3 ? cFlop : strength(sPrev, prev);
  const cNow = strength(sNow, board);
  const cOf = (len: number) => (len === 3 ? cFlop : len === board.length ? cNow : cPrev);
  const w = new Float64Array(K).fill(1);
  // Mark the top `share` of the weighted range by `c`.
  const topMask = (c: Float64Array, share: number): Uint8Array => {
    const order = Array.from({ length: K }, (_, i) => i).sort((x, y) => c[y] - c[x]);
    let total = 0;
    for (let k = 0; k < K; k++) total += w[k];
    const mask = new Uint8Array(K);
    let acc = 0;
    for (const k of order) {
      if (acc >= share * total - 1e-12) break;
      mask[k] = 1;
      acc += w[k];
    }
    return mask;
  };
  const P = OMAHA_CARD_IMPACT_PRIOR;
  const keepOf = (prior: number, river: boolean): number => omahaCardImpactKeep(read, prior, river);
  for (const step of line) {
    const c = cOf(step.boardLen);
    if (step.kind === 'call') {
      const keep = topMask(c, keepOf(step.keep, step.boardLen === 5));
      const raises = topMask(c, P.raiseShare);
      for (let k = 0; k < K; k++) w[k] *= keep[k] ? (raises[k] ? 0.5 : 1) : 0.05;
    } else if (step.kind === 'raise') {
      const m = topMask(c, P.raiseShare * 1.2);
      for (let k = 0; k < K; k++) w[k] *= m[k] ? 1 : 0.03;
    } else if (step.kind === 'bet') {
      const m = topMask(c, read.betCheckedTo);
      for (let k = 0; k < K; k++) w[k] *= m[k] ? 1 : 0.25;
    } else {
      const m = topMask(c, read.betCheckedTo * 0.7);
      for (let k = 0; k < K; k++) w[k] *= m[k] ? 0.35 : 1;
    }
  }
  let W = 0;
  let W2 = 0;
  for (let k = 0; k < K; k++) {
    W += w[k];
    W2 += w[k] * w[k];
  }
  if (!(W > 0)) return null;

  // The Horse's equity against each sampled hand (the river dealt out on the turn).
  const eq = new Float64Array(K);
  for (let k = 0; k < K; k++) {
    if (street === 'river') {
      eq[k] = heroNow > sNow[k] ? 1 : heroNow === sNow[k] ? 0.5 : 0;
      continue;
    }
    let sum = 0;
    let cnt = 0;
    for (let r = 0; r < n; r++) {
      let mine = false;
      for (let c = 0; c < h; c++) if (hands[k * h + c] === r) mine = true;
      if (mine) continue;
      const o = best(k, riverInc![r]);
      const hr = heroRiver![r];
      sum += hr > o ? 1 : hr === o ? 0.5 : 0;
      cnt++;
    }
    eq[k] = cnt > 0 ? sum / cnt : 0.5;
  }

  let aheadBefore = 0;
  let aheadNow = 0;
  let improvedPast = 0;
  let leftBehind = 0;
  let missedDraws = 0;
  let showdown = 0;
  let beatsRandom = 0;
  for (let k = 0; k < K; k++) {
    if (sNow[k] < heroNow) beatsRandom += 1 / K;
    const before = sPrev[k] > heroPrev;
    const after = sNow[k] > heroNow;
    const x = w[k] / W;
    if (before) aheadBefore += x;
    if (after) aheadNow += x;
    if (after && !before) improvedPast += x;
    if (before && !after && sNow[k] < heroNow) leftBehind += x;
    if (!after && outsOf(k, prev) >= OMAHA_CARD_IMPACT_DRAW_OUTS && cat(sNow[k]) === cat(sPrev[k]))
      missedDraws += x;
    showdown += x * eq[k];
  }

  // (c) expected value of a check and of each size.
  const order = Array.from({ length: K }, (_, i) => i).sort((x, y) => cNow[y] - cNow[x]);
  const eff = Math.min(heroStack, oppStack);
  const river = street === 'river';
  const options: OmahaCardImpactOption[] = [];
  const betOption = (amount: number): OmahaCardImpactOption => {
    const B = Math.min(amount, eff);
    const measured =
      input.responseAt && input.responseAt.length > 0
        ? omahaCardImpactResponseOf(input.responseAt, B / pot)
        : null;
    const q = measured ? measured.cont : keepOf(pot / (pot + B), river);
    const allIn = B >= eff - 0.005;
    const rho = allIn ? 0 : Math.min(measured ? measured.raise : P.raiseShare, q);
    const T = allIn ? B : Math.min(pot + 3 * B, eff);
    let acc = 0;
    let fold = 0;
    let call = 0;
    let raise = 0;
    let beats = 0;
    let evCall = 0;
    let raiseEq = 0;
    let loses = 0;
    let contEq = 0;
    for (const k of order) {
      const x = w[k] / W;
      if (acc < rho - 1e-12) {
        raise += x;
        raiseEq += x * eq[k];
        contEq += x * eq[k];
        if (eq[k] < 0.5) beats += x;
        else if (eq[k] > 0.5) loses += x;
      } else if (acc < q - 1e-12) {
        call += x;
        evCall += x * (eq[k] * (pot + B) - (1 - eq[k]) * B);
        contEq += x * eq[k];
        if (eq[k] < 0.5) beats += x;
        else if (eq[k] > 0.5) loses += x;
      } else fold += x;
      acc += x;
    }
    const eR = raise > 0 ? raiseEq / raise : 0;
    const evRaise = raise * Math.max(-B, eR * (pot + T) - (1 - eR) * T);
    const cont = call + raise;
    return {
      action: amount >= heroStack - 0.005 ? 'all_in' : 'bet',
      amount: round2(amount),
      ev: round2(fold * pot + evCall + evRaise),
      fold: round2(fold),
      call: round2(call),
      raise: round2(raise),
      continueBeats: cont > 0 ? round2(beats / cont) : 0,
      continueEquity: cont > 0 ? round2(contEq / cont) : 1,
      value: cont <= 0 ? false : river ? loses > beats : contEq / cont >= 0.5,
    };
  };
  let evCheck: number;
  if (heroCloses) evCheck = pot * showdown;
  else {
    const beta = clamp(read.betCheckedTo, 0, 1);
    const value = beta * (1 - read.bluffShare);
    const bluff = beta * read.bluffShare;
    const stabSize =
      typeof input.stabSize === 'number' && Number.isFinite(input.stabSize) && input.stabSize > 0
        ? Math.min(2, input.stabSize)
        : P.betSize;
    const D = Math.min(stabSize * pot, eff);
    let acc = 0;
    let betMass = 0;
    let betEq = 0;
    let through = 0;
    for (const k of order) {
      const x = w[k] / W;
      if (acc < value - 1e-12 || acc >= 1 - bluff - 1e-12) {
        betMass += x;
        betEq += x * eq[k];
      } else through += x * eq[k];
      acc += x;
    }
    const eS = betMass > 0 ? betEq / betMass : 0;
    evCheck = pot * through + betMass * Math.max(0, eS * (pot + D) - (1 - eS) * D);
  }
  options.push({
    action: 'check',
    amount: 0,
    ev: round2(evCheck),
    fold: 0,
    call: 0,
    raise: 0,
    continueBeats: 0,
    continueEquity: 0,
    value: false,
  });
  const seen = new Set<number>();
  for (const a of input.amounts) {
    const amount = round2(Math.min(a, heroStack));
    if (!(amount > 0) || seen.has(amount)) continue;
    seen.add(amount);
    options.push(betOption(amount));
  }

  const nutsNow = beatersNow === 0;
  const nutsBefore = beatersBefore === 0;
  const bad =
    aheadNow - aheadBefore >= 0.1 ||
    (nutsBefore && !nutsNow) ||
    (beatersNow - beatersBefore) / combos >= 0.05;
  const good =
    freeroll ||
    (nutsNow && !nutsBefore) ||
    (street === 'turn' && !nutsNow && nutOuts >= OMAHA_CARD_IMPACT_NUT_OUTS) ||
    aheadBefore - aheadNow >= 0.1 ||
    (missedDraws >= 0.25 && aheadNow <= aheadBefore + 0.02);
  const result: OmahaCardImpact = {
    street,
    own: {
      combos,
      beatersBefore,
      beatersNow,
      nutsBefore,
      nutsNow,
      nutOuts,
      freerollOuts,
      freeroll,
    },
    opp: {
      measured: read.measured,
      effective: round2((W * W) / W2),
      aheadBefore: round2(aheadBefore),
      aheadNow: round2(aheadNow),
      improvedPast: round2(improvedPast),
      leftBehind: round2(leftBehind),
      missedDraws: round2(missedDraws),
    },
    showdown: round2(showdown),
    beatsRandom: round2(beatsRandom),
    verdict: bad && good ? 'mixed' : bad ? 'bad' : good ? 'good' : 'neutral',
    options,
  };
  cache.set(cacheKey, result);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  return JSON.parse(JSON.stringify(result)) as OmahaCardImpact;
}

export interface OmahaCardImpactDecision {
  decision: HorseDecision;
  changed: null | 'defence_check' | 'press_bet' | 'freeroll_pot' | 'resized';
  impact: OmahaCardImpact;
  /** the engine's own choice, priced by the same model */
  legacy: OmahaCardImpactOption;
  chosen: OmahaCardImpactOption;
}

/** The bet amounts priced at this node: the pot fractions, legal, deduplicated. */
export function omahaCardImpactAmounts(
  hero: SeatPlayer,
  opponent: SeatPlayer,
  gs: HorseGameStateV2
): number[] {
  const pot = gs.pot;
  const stack = hero.stack;
  // A state without a legal-action menu (the league's) allows both.
  const menu = Array.isArray(gs.legalActions) ? gs.legalActions : null;
  const canBet = menu === null || menu.includes('bet');
  const canShove = menu === null || menu.includes('all_in');
  const min = Number.isFinite(gs.minRaiseTo) ? (gs.minRaiseTo as number) : (gs.bigBlind ?? 1);
  const max = Math.min(
    Number.isFinite(gs.maxRaiseTo) ? (gs.maxRaiseTo as number) : pot,
    stack,
    Math.max(min, opponent.stack)
  );
  const whole = (gs.bigBlind ?? 1) >= 1;
  const out: number[] = [];
  for (const f of OMAHA_CARD_IMPACT_SIZES) {
    let a = f * pot;
    a = whole ? Math.round(a) : round2(a);
    a = round2(clamp(a, Math.min(min, max), max));
    const shove = a >= stack - 0.005;
    if (shove ? !canShove : !canBet) continue;
    if (!out.includes(a)) out.push(a);
  }
  return out;
}

/**
 * The decision: the engine's choice priced beside a check and every size; the
 * best replaces it when it is worth more than the margin. Null when out of
 * scope, when the model cannot be computed, or when the hand is a bluff
 * candidate (left to the bluff paths).
 */
export function omahaCardImpactDecision(
  decision: HorseDecision,
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  read: OmahaReadConditional | null,
  /** omahaBetSizeByPublicState: the only sizes to price beside the decision's own (the public size). */
  sizes?: readonly number[]
): OmahaCardImpactDecision | null {
  const scope = omahaCardImpactScope(hero, gs);
  if (!scope) return null;
  if (decision.action !== 'check' && decision.action !== 'bet' && decision.action !== 'all_in')
    return null;
  const amounts = sizes ? [...sizes] : omahaCardImpactAmounts(hero, scope.opponent, gs);
  const legacyAmount =
    decision.action === 'all_in'
      ? hero.stack
      : decision.action === 'bet' && Number.isFinite(decision.amount)
        ? (decision.amount as number)
        : 0;
  if (decision.action !== 'check' && !(legacyAmount > 0)) return null;
  const priced =
    legacyAmount > 0 ? [round2(Math.min(legacyAmount, hero.stack)), ...amounts] : amounts;
  const impact = omahaCardImpact({
    hole: hero.cards,
    board: gs.communityCards ?? [],
    dead: hero.knownDeadCards ?? [],
    pot: gs.pot,
    heroStack: hero.stack,
    oppStack: scope.opponent.stack,
    heroCloses: scope.heroCloses,
    line: omahaCardImpactLine(hero, scope.opponent, gs),
    read: omahaCardImpactRead(read),
    amounts: priced,
    seedSalt: scope.opponent.seat * 16 + hero.seat,
  });
  if (!impact) return null;
  if (
    impact.showdown < OMAHA_CARD_IMPACT_BLUFF_SHARE &&
    impact.beatsRandom < OMAHA_CARD_IMPACT_AIR_SHARE
  )
    return null;
  const legacy =
    decision.action === 'check'
      ? impact.options[0]
      : impact.options.find(
          (o) =>
            o.action !== 'check' && Math.abs(o.amount - Math.min(legacyAmount, hero.stack)) < 0.006
        );
  if (!legacy) return null;
  // Candidates: the check; every value bet; on the turn also a bet no larger
  // than the one chosen (a smaller bet is defence, and its equity when called
  // is priced). A bet that is not a value bet and is larger than the chosen
  // action is a bluff or a semi-bluff: the bluff and barrel paths decide those.
  const river = impact.street === 'river';
  // omahaStrategyInTournaments: in a tournament every bet is charged the
  // survival premium on the chips it risks, over the money at stake when it
  // is called or raised (premium x (pot + 2 x bet) x continue share). The
  // check is never charged, so the premium only ever moves the choice toward
  // fewer chips. 0 in cash: the options are compared exactly as before.
  const icmRisk = omahaTournamentIcmRisk(hero, gs);
  const worth = (o: OmahaCardImpactOption): number =>
    icmRisk > 0 && o.action !== 'check'
      ? o.ev -
        omahaIcmPremiumOf(icmRisk, o.amount, hero.stack) *
          (gs.pot + 2 * o.amount) *
          Math.max(0, Math.min(1, o.call + o.raise))
      : o.ev;
  const admissible = (o: OmahaCardImpactOption): boolean =>
    o.action === 'check' ||
    o.value ||
    (!river && legacy.action !== 'check' && o.amount <= legacy.amount + 0.005);
  let chosen: OmahaCardImpactOption = admissible(legacy) ? legacy : impact.options[0];
  for (const o of impact.options) if (admissible(o) && worth(o) > worth(chosen)) chosen = o;
  const same: OmahaCardImpactDecision = { decision, changed: null, impact, legacy, chosen: legacy };
  // A river bet that better hands call more than worse ones is replaced
  // whatever its modelled fold equity; every other replacement must be worth
  // more than the margin.
  const riverNotValue = river && legacy.action !== 'check' && !legacy.value;
  if (chosen === legacy) return same;
  if (
    !riverNotValue &&
    !(worth(chosen) - worth(legacy) > omahaStrategyConstant('cardImpactMargin', gs) * gs.pot)
  )
    return same;
  if (chosen.action === 'check') {
    const checked: HorseDecision = { ...decision, action: 'check' };
    delete checked.amount;
    return { decision: checked, changed: 'defence_check', impact, legacy, chosen };
  }
  const next: HorseDecision = { ...decision, action: chosen.action };
  if (chosen.action === 'bet') next.amount = chosen.amount;
  else delete next.amount;
  const fullPot = chosen.amount >= Math.min(gs.pot, hero.stack, scope.opponent.stack) - 0.5;
  const changed =
    impact.own.freeroll && fullPot
      ? 'freeroll_pot'
      : legacy.action === 'check' || chosen.amount > legacy.amount
        ? 'press_bet'
        : 'resized';
  return { decision: next, changed, impact, legacy, chosen };
}

/**
 * What the worker receipt validator admits as a bet turned into a check: the
 * option's public scope, and a hand that is not nut class (HorseLogic never
 * checks or shrinks a nut-class bet here). The receipt context carries
 * neither the options nor the opponent read, so the comparison itself is not
 * re-run.
 */
export function omahaCardImpactCheckAdmissible(hero: SeatPlayer, gs: HorseGameStateV2): boolean {
  try {
    return omahaCardImpactScope(hero, gs) !== null && !omahaNutClassNow(hero, gs);
  } catch {
    return false;
  }
}

/** Test seam: forget the memoised computations. */
export function omahaCardImpactResetCache(): void {
  cache.clear();
}
