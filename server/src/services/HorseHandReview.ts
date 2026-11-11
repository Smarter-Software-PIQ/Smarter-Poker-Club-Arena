/**
 * ═══════════════════════════════════════════════════════════════════════════
 * HORSE HAND REVIEW — the 20bb flag (Dan 2026-08-26)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * "Every hand where a horse wins or loses 20bb needs to be flagged and
 *  reviewed, for every horse, across all cash game variants, MTTs, spins and
 *  heads up. Track, audit, correct and improve horse decision making."
 *
 * Called beside writeHandFacts at settlement, from the same in-memory inputs:
 * SeatPlayer.totalInvested (blinds/antes included, net of uncalled refund)
 * and the winners list. These are EXACT — nothing here reconstructs nets
 * from hand_history.actions, whose reconstruction was measured failing chip
 * conservation in 38% of hands (2026-08-23 self-tuner audit).
 *
 * Any horse whose |net| >= 20bb gets one row in horse_hand_reviews carrying
 * everything a reviewer needs (its hole cards, the board, the full action
 * log, the net) plus LEAK TAGS from the pattern detectors below — the ones
 * that recognize the exact hands Dan watched: a non-nut flush stacking off
 * into a raise, a dominated pair calling down, a blown-off big bluff.
 *
 * Fire-and-forget, never throws, and deliberately NOT awaited by settlement.
 * The rows, their replay receipts and the per-horse/day rollup are written
 * together by ONE call to fn_hhr_record_atomic (P14.1); raw rows are pruned
 * at 30 days by sp_prune_horse_hand_reviews(), and a receipt whose review is
 * gone and whose hand is past the 30-day publication horizon by
 * sp_prune_horse_hand_review_receipts() (20261008041150).
 */

import { supabase } from './supabase/client.js';
import { reportError } from './errorReporter.js';
import { bindToProcessRoot } from './supabase/dataActorContext.js';
import { allocateWeightedShareCents } from './rakeAllocation.js';
import { accumulatePlayStats, freshPlay, type HandRow, type PlayStats } from './HorsePlayStats.js';
import {
  variantInfo,
  omahaNutStatus,
  omahaBoatPosition,
  nlhNutStatus,
  scoreOmahaHiPartial,
  omahaDrawQuality,
  scoreOmahaLow,
} from '../engine/HorseEval.js';
import { omahaEliteClassRead } from '../engine/HorseHandClasses.js';
import { RANK_VALUES, RANKS, SUITS } from '../engine/PokerEngine.js';
import type { Card } from '../types.js';

export interface HorseReviewInput {
  handId: string;
  tableId: string;
  clubId?: string | null;
  tournamentId?: string | null;
  gameVariant: string;
  bigBlind: number;
  playedAt: string;
  potSize?: number;
  /** Card objects OR the engine's board strings ("Khearts", "10spades"). */
  board?: unknown[] | null;
  /**
   * Every board the hand was dealt, board 1 included: double/triple-board
   * bomb pots and run-it-twice runs. Absent or one entry = a single-board
   * hand. The Omaha made-hand tags judge ONE board, so they stand down when
   * this holds more than one (2026-09-30).
   */
  boards?: unknown[][] | null;
  /** Every seat dealt in: userId -> { seat, cards }. */
  holeCardsAll: Map<string, { seat: number; cards: unknown }>;
  /** userId -> totalInvested (blinds/antes included, net of uncalled refund). */
  contributions: Map<string, number>;
  winners: Array<{ userId: string; amount: number }>;
  actions: Array<{
    seat: number;
    userId?: string;
    action: string;
    amount?: number;
    stage: string;
    /** HandController's discriminator on an all_in: true = full raise,
     *  false = short raise, UNDEFINED = a call-off that never moved the bet. */
    isFullRaise?: boolean;
    origin?: string;
    dead?: boolean;
    publicNode?: import('./pokerStatAction.js').StatActionRights['publicNode'];
  }>;
  roster: Array<{ userId: string; isHorse: boolean }>;
  /** Rake taken from this hand's pot, in chips. Shared to each horse by the
   *  same weighted-contribution allocator the money pipeline uses, so
   *  horse_daily_nets.rake_bb agrees with rake_attributions to the cent.
   *  Absent = 0 (older callers, tests); the tuner then falls back to the
   *  fleet-relative rule, which needs no rake at all. */
  rakeAmount?: number;
  /**
   * Bad-beat-jackpot fee dropped from this pot (2026-09-06).
   *
   * The other half of the house take. Measured on 2026-09-06 over 11,687 cash
   * hands: horse net -10,797bb, attributed rake +9,020bb, residual -1,778bb,
   * table BBJ drop 1,761bb. The fleet plays itself, so its result is zero
   * minus the drop - and it is, once BOTH halves are counted.
   */
  bbjAmount?: number;
  /** Button seat, so HorsePlayStats can place the blinds the way the tuner's
   *  hand_history path always has. Absent = no blind reconstruction. */
  buttonSeat?: number | null;
  /**
   * The table's VPIP floor in percent, 0 when it has none (2026-09-06).
   *
   * A floored table stands a seat up after ten hands under the floor, horses
   * included, so the brain widens toward it (HorseLogic.vpipFloorMul) and a
   * horse there is REQUIRED to play 40-70% of hands. Its VPIP is therefore
   * not comparable with the 19-32% winning-player band, and the frequency
   * rows it produces are keyed apart so nothing judges the two together.
   */
  vpipFloor?: number;
  /**
   * The results bucket this hand files under (2026-10-24). Absent: derived as
   * always (tournament / hu_cash / cash). Lightning passes
   * `lightningReviewFormat(bigBlind)` so its hands get their own scoreboard
   * rows per stake and never move the cash tuner's inputs, which read only
   * cash and hu_cash.
   */
  format?: string;
  /** Touch the fleet seat for this table (default true). A Lightning host
   *  table is not where the horse is seated, so Lightning passes false. */
  seatTouch?: boolean;
  /** Both daily counts are owned by the immutable accepted-hand projection. */
  rollupsInAcceptedFacts?: boolean;
  /** Optional tournament bubble / final-table pay-jump pressure indicator. */
  nearBubbleOrPayJump?: boolean;
  /** Optional tournament stage label ('bubble' | 'near_bubble' | 'final_table' | 'pay_jump'). */
  tournamentStage?: string | null;
  /** Optional tournament stack coverage flag (true when hero is covered by villain). */
  coveredStack?: boolean;
}

/** The Lightning results bucket for one stake, e.g. `lightning_2bb` or `lightning_0.5bb`. */
export function lightningReviewFormat(bigBlind: number): string {
  const bb = Number.isFinite(bigBlind) && bigBlind > 0 ? Math.round(bigBlind * 100) / 100 : 0;
  return `lightning_${bb}bb`;
}

function reviewFormat(input: HorseReviewInput, dealtCount: number): string {
  if (typeof input.format === 'string' && input.format.length > 0) return input.format;
  return input.tournamentId ? 'tournament' : dealtCount === 2 ? 'hu_cash' : 'cash';
}

const FLAG_BB = 20;

export interface HorseReviewRow {
  hand_id: string;
  table_id: string;
  tournament_id: string | null;
  club_id: string | null;
  played_at: string;
  game_variant: string;
  format: string;
  big_blind: number;
  horse_user_id: string;
  seat: number | null;
  net_amount: number;
  net_bb: number;
  pot_size: number | null;
  hole_cards: unknown;
  board: unknown;
  actions: unknown;
  leak_tags: string[];
}

const r2 = (n: number): number => Math.round(n * 100) / 100;

function isCardArray(v: unknown): v is Card[] {
  return (
    Array.isArray(v) &&
    v.length >= 2 &&
    v.every((c) => c && typeof c === 'object' && 'rank' in c && 'suit' in c)
  );
}

const SUIT_NAMES = ['hearts', 'diamonds', 'clubs', 'spades'] as const;

/**
 * The settlement path carries the board as strings ("Khearts", "10spades");
 * hole cards arrive as Card objects. Accept either. Returns null when the
 * shape is unrecognized — detectors then simply skip board-aware tags.
 */
export function parseCards(v: unknown): Card[] | null {
  if (isCardArray(v)) return v;
  if (!Array.isArray(v) || v.length < 3) return null;
  const out: Card[] = [];
  for (const item of v) {
    if (typeof item !== 'string') return null;
    const suit = SUIT_NAMES.find((sn) => item.endsWith(sn));
    if (!suit) return null;
    let rank = item.slice(0, item.length - suit.length);
    if (rank === '10') rank = 'T';
    if (!rank) return null;
    out.push({ rank, suit } as Card);
  }
  return out;
}

/**
 * How many aggressive actions the horse took on the river. Two or more is a
 * raise war it kept escalating. Shared so the winning and losing sides of that
 * line are counted by the SAME rule - a mirror measured differently is not a
 * denominator.
 */
function riverAggressiveActions(row: {
  heroActions: Array<{ action: string; stage: string; isFullRaise?: boolean }>;
}): number {
  return row.heroActions.filter((a) => a.stage === 'river' && isAggressiveAction(a)).length;
}

/**
 * ═══ A CALL-OFF ALL-IN IS A CALL (2026-09-05) ═══
 *
 * HandController records every all_in with `isFullRaise`: true when it is a
 * full raise, false when it raised currentBet by less than the minimum, and
 * UNDEFINED when the stack did not reach currentBet at all - a call for
 * everything the player had. HorseLogic has read that discriminator since
 * the V28 audit fix (routing: "an all-in call-off is a caller of the price").
 * These detectors never did: every all_in counted as a bet or raise.
 *
 * Measured on 2026-09-04: 450 of 952 river_raise_war tags were a hero bet
 * followed by a hero CALL-off of a shove (the river_raise_paidoff shape, not
 * a war), and 941 of 7,569 river_aggr_lost tags were hands whose only river
 * action by the hero was a call-off. The win-side mirrors (river_aggr_won,
 * river_raise_war_won) share the same function, so the river_aggression_ev
 * headline was contaminated in both directions. Preflop, a call-off looked
 * like a raise and suppressed coldcall_stackoff / limped_pot_bloat.
 *
 * Aggression is bet, raise, or an all_in that MOVED the bet. An all_in with
 * no isFullRaise is a call wherever a detector asks.
 */
export function isAggressiveAction(a: { action: string; isFullRaise?: boolean }): boolean {
  return (
    a.action === 'bet' ||
    a.action === 'raise' ||
    (a.action === 'all_in' && a.isFullRaise !== undefined)
  );
}

function isCallAction(a: { action: string; isFullRaise?: boolean }): boolean {
  return a.action === 'call' || (a.action === 'all_in' && a.isFullRaise === undefined);
}

/**
 * The stack-off bar for the PLO discipline detectors below: a hundred big
 * blinds is a full buy-in at every cash table the fleet plays, so this counts
 * hands where the horse put its WHOLE stack in, not merely a big pot.
 */
const PLO_STACKOFF_BB = 100;

/**
 * Hand categories as `scoreOmahaHiPartial` numbers them (HorseEval): 1 high
 * card, 2 one pair, 3 two pair, 4 trips, 5 straight, 6 flush, 7 full house,
 * 8 quads. Named here because a bare `=== 4` in a detector is unreadable and
 * the ladder is offset from the usual one.
 */
const CAT_ONE_PAIR = 2;
const CAT_TRIPS = 4;
const CAT_FULL_HOUSE = 7;

/** Does the board carry a pair (or better) of any rank? */
export function boardHasPair(board: Card[]): boolean {
  const seen = new Set<string>();
  for (const c of board) {
    if (seen.has(c.rank)) return true;
    seen.add(c.rank);
  }
  return false;
}

/**
 * Omaha: is hero's full house the TOP full house on this board? Enumerates
 * every two-card holding from the cards hero cannot see (52 minus the board
 * minus hero's hole cards) and asks whether any of them makes a bigger FULL
 * HOUSE - two hole cards and three board cards, the Omaha rule, which is
 * exactly what scoreOmahaHiPartial does with a two-card hand. ~800
 * evaluations of a five-card board; only called for a made boat with a full
 * stack in, a few hundred hands a day.
 *
 * ── QUADS AND STRAIGHT FLUSHES ARE COOLERS (2026-11-07) ──
 * This used to count a possible QUADS as a bigger boat, so the best full
 * house on any paired board (quads are live on every paired board) was
 * tagged plo_underfull_stackoff. A boat that only quads or a straight flush
 * beats is not an under-full: there is no better full house to have held,
 * so there is no under-full decision to measure. The 2026-11-06 review of the
 * twenty biggest losses raised it on 3363822 (that hand stays tagged: hero's
 * boat was aces full of THREES, and Ad 7x makes aces full of sevens).
 */
export function omahaBoatIsNut(hole: Card[], board: Card[]): boolean {
  const heroScore = scoreOmahaHiPartial(hole, board);
  const heroCat = Math.floor(heroScore / 0x100000);
  if (heroCat < CAT_FULL_HOUSE) return false;
  const seen = new Set<string>();
  for (const c of hole) seen.add(c.rank + c.suit);
  for (const c of board) seen.add(c.rank + c.suit);
  const unseen: Card[] = [];
  for (const rank of RANKS) {
    for (const suit of SUITS) {
      if (!seen.has(rank + suit)) unseen.push({ rank, suit } as Card);
    }
  }
  const combo: Card[] = new Array(2);
  for (let i = 0; i < unseen.length; i++) {
    combo[0] = unseen[i];
    for (let j = i + 1; j < unseen.length; j++) {
      combo[1] = unseen[j];
      const s = scoreOmahaHiPartial(combo, board);
      if (s <= heroScore) continue;
      const cat = Math.floor(s / 0x100000);
      if (cat === CAT_FULL_HOUSE) return false;
    }
  }
  return true;
}

/**
 * ═══ THE STREET THE STACK WENT IN ON (2026-09-11) ═══
 *
 * The PLO stack-off detectors judge a MADE hand, and a made hand is a function
 * of the board - so it matters which board. They read the five-card river
 * board for every hand, which labels the decision by how the hand ENDED
 * rather than by what hero held when the money went in. Measured over the
 * seven days to 2026-09-10 by hero's last chip-committing action: 64 of 353
 * plo_toppair_no_redraw_stackoff tags were PREFLOP all-ins - AA/KK 4-bet and
 * 5-bet wars (reviews 411733 AA76, 430475 AAJJ, 388442 AAKK33) that showed
 * down an unimproved pair - and review 376230 was tagged
 * plo_naked_trips_stackoff for a FLOP stack-off holding aces and the nut
 * flush draw on Q-3-3 that merely ran out 5-5. HorseLogic reads these tags
 * as ploStackoffLoad, so V40 was lowering the Omaha ceiling of horses for
 * playing aces correctly preflop.
 *
 * The commit street is the stage of hero's LAST action that put chips in:
 * bet, raise, call, or any all_in (a call-off is a commitment too). One
 * exception: a CALL of less than 15% of everything hero invested is a
 * remainder, not a decision - review 411733 called off 104.55 of a 5-bet
 * preflop and then 22.28 more when the villain shoved his last chips on the
 * flop, and that flop call is not where the stack went in. A preflop commit
 * is preflop_stackoff's hand and not a postflop made-hand decision, so the
 * PLO block stands down; a flop or turn commit is judged on the board hero
 * could see. Rows with no readable actions (older rows, fixtures) keep the
 * river board, so nothing already pinned changes.
 */
export type CommitStreet = 'preflop' | 'flop' | 'turn' | 'river';

const REMAINDER_SHARE = 0.15;

export function commitStreet(
  heroActions: Array<{ action: string; stage: string; amount?: number; isFullRaise?: boolean }>,
  /** hero's total investment in chips; lets a trailing remainder call be skipped */
  invested?: number
): CommitStreet | null {
  for (let i = heroActions.length - 1; i >= 0; i--) {
    const a = heroActions[i];
    if (
      !(a.action === 'bet' || a.action === 'raise' || a.action === 'call' || a.action === 'all_in')
    ) {
      continue;
    }
    if (
      invested !== undefined &&
      invested > 0 &&
      isCallAction(a) &&
      typeof a.amount === 'number' &&
      a.amount < invested * REMAINDER_SHARE
    ) {
      continue;
    }
    const s = a.stage;
    if (s === 'preflop' || s === 'flop' || s === 'turn' || s === 'river') return s;
    return null;
  }
  return null;
}

/** The board as hero saw it on `street`; the whole board when unknown. */
export function boardAsOf(board: Card[], street: CommitStreet | null): Card[] {
  if (street === 'flop') return board.slice(0, 3);
  if (street === 'turn') return board.slice(0, 4);
  return board;
}

/**
 * Omaha top pair: a hole card pairs the HIGHEST board rank. The caller has
 * already established the hand is exactly one pair, so a hole card on the top
 * rank means that pair is the top pair (an overpair, a middle pair or a
 * bottom pair has no hole card there).
 */
export function isOmahaTopPair(hole: Card[], board: Card[]): boolean {
  if (board.length === 0) return false;
  const top = Math.max(...board.map((bc) => RANK_VALUES[bc.rank]));
  return hole.some((hc) => RANK_VALUES[hc.rank] === top);
}

/**
 * Hi-lo: does hero hold a qualifying low, or (with cards to come) a low draw?
 * A low draw is two distinct hole ranks of eight or under plus at least two
 * OTHER distinct board ranks of eight or under, so one more low card makes
 * the five distinct low ranks Omaha 8-or-better needs.
 */
export function omahaLowLive(hole: Card[], board: Card[]): boolean {
  if (board.length >= 3 && scoreOmahaLow(hole, board) !== Infinity) return true;
  if (board.length >= 5) return false;
  const low = (card: Card): number => {
    const v = RANK_VALUES[card.rank];
    return v === 14 ? 1 : v;
  };
  const holeLows = [...new Set(hole.map(low).filter((v) => v <= 8))];
  const boardLows = [...new Set(board.map(low).filter((v) => v <= 8))];
  for (let i = 0; i < holeLows.length; i++) {
    for (let j = i + 1; j < holeLows.length; j++) {
      const others = boardLows.filter((v) => v !== holeLows[i] && v !== holeLows[j]);
      if (others.length >= 2) return true;
    }
  }
  return false;
}

/**
 * What the FINAL board makes available to somebody else. Omaha plays exactly
 * two hole cards and three board cards, which is what each test below counts:
 *
 *  - fullHouseLive: the board is paired, so any opponent holding the case card
 *    or a pocket pair to another board rank has a boat. (Hero holding trips
 *    THROUGH a paired board is inside this set by construction - which is the
 *    point: trips is the losing end of that board, not the winning one.)
 *  - flushLive: three or more of one suit on the board, so two suited hole
 *    cards complete it.
 *  - straightLive: some five-rank window holds three or more distinct board
 *    ranks, so two hole cards fill it. Same window test `omahaNutStatus` uses
 *    to decide whether hero's own straight is the nut one.
 *
 * This is deliberately a read of the BOARD alone. It asks "was a better hand
 * available here", never "did the opponent have it" - a detector that needed
 * the villain's cards could not run on the hands where they never showed.
 */
export function omahaBoardThreats(board: Card[]): {
  fullHouseLive: boolean;
  flushLive: boolean;
  straightLive: boolean;
} {
  const rankCount = new Map<number, number>();
  const suitCount = new Map<string, number>();
  for (const c of board) {
    const r = RANK_VALUES[c.rank];
    rankCount.set(r, (rankCount.get(r) ?? 0) + 1);
    suitCount.set(c.suit, (suitCount.get(c.suit) ?? 0) + 1);
  }
  const fullHouseLive = [...rankCount.values()].some((n) => n >= 2);
  const flushLive = [...suitCount.values()].some((n) => n >= 3);

  let straightLive = false;
  for (let top = 14; top >= 5 && !straightLive; top--) {
    let onBoard = 0;
    for (let k = 0; k < 5; k++) {
      const r = top - k === 1 ? 14 : top - k; // wheel: the 5-high straight uses the ace
      if (rankCount.has(r)) onBoard++;
    }
    if (onBoard >= 3) straightLive = true;
  }
  return { fullHouseLive, flushLive, straightLive };
}

type HoldemSeatZone = 'sb' | 'bb' | 'early' | 'middle' | 'late';

function isHoldemTrapOrSuitedConnectorLimp(hole: Card[]): boolean {
  if (hole.length !== 2) return false;
  const r1 = RANK_VALUES[hole[0].rank];
  const r2 = RANK_VALUES[hole[1].rank];
  if (r1 === r2 && r1 >= 12) return true;
  if (
    hole[0].suit === hole[1].suit &&
    Math.abs(r1 - r2) === 1 &&
    Math.min(r1, r2) >= 4 &&
    Math.max(r1, r2) <= 10
  ) {
    return true;
  }
  return false;
}

function isHoldemPremiumPreflopCalloff(hole: Card[]): boolean {
  if (hole.length !== 2) return false;
  const r1 = RANK_VALUES[hole[0].rank];
  const r2 = RANK_VALUES[hole[1].rank];
  if (r1 === r2 && r1 >= 12) return true;
  return Math.max(r1, r2) === 14 && Math.min(r1, r2) === 13;
}

function resolveHoldemSeatZone(row: {
  position?: string | null;
  seat?: number | null;
  buttonSeat?: number | null;
  activeSeats?: number[] | null;
}): HoldemSeatZone | null {
  if (typeof row.position === 'string' && row.position.trim().length > 0) {
    const p = row.position.trim().toLowerCase();
    if (p === 'sb' || p === 'small_blind') return 'sb';
    if (p === 'bb' || p === 'big_blind') return 'bb';
    if (
      p === 'utg' ||
      p === 'utg+1' ||
      p === 'utg1' ||
      p === 'utg+2' ||
      p === 'utg2' ||
      p === 'ep' ||
      p === 'early'
    ) {
      return 'early';
    }
    if (
      p === 'mp' ||
      p === 'mp1' ||
      p === 'mp2' ||
      p === 'lj' ||
      p === 'hj' ||
      p === 'middle' ||
      p === 'oop'
    ) {
      return 'middle';
    }
    if (
      p === 'co' ||
      p === 'cutoff' ||
      p === 'btn' ||
      p === 'button' ||
      p === 'lp' ||
      p === 'late' ||
      p === 'ip'
    ) {
      return 'late';
    }
  }
  if (
    typeof row.seat === 'number' &&
    typeof row.buttonSeat === 'number' &&
    Array.isArray(row.activeSeats) &&
    row.activeSeats.length >= 3
  ) {
    const sorted = [...new Set(row.activeSeats)].sort((a, b) => a - b);
    const heroIdx = sorted.indexOf(row.seat);
    if (heroIdx >= 0 && sorted.length >= 3) {
      // Find button seat or nearest active seat at/before buttonSeat clockwise.
      let btnIdx = sorted.indexOf(row.buttonSeat);
      if (btnIdx < 0) {
        btnIdx = 0;
        for (let i = 0; i < sorted.length; i++) {
          if (sorted[i] <= row.buttonSeat) btnIdx = i;
        }
      }
      const offset = (heroIdx - btnIdx + sorted.length) % sorted.length;
      if (offset === 0) return 'late';
      if (offset === 1) return 'sb';
      if (offset === 2) return 'bb';
      if (offset === sorted.length - 1) return 'late';
      if (offset === 3 || (sorted.length >= 8 && offset === 4)) return 'early';
      return 'middle';
    }
  }
  return null;
}

function evaluateHoldemV87Detectors(
  row: {
    netBB: number;
    invested: number;
    bigBlind: number;
    holeCards: Card[] | null;
    board: Card[] | null;
    heroActions: Array<{ action: string; stage: string; amount?: number; isFullRaise?: boolean }>;
    wentToShowdown: boolean;
    multiBoard?: boolean;
    format?: string | null;
    tournamentId?: string | null;
    nearBubbleOrPayJump?: boolean;
    tournamentStage?: string | null;
    coveredStack?: boolean;
    allInCalloff?: boolean;
    position?: string | null;
    seat?: number | null;
    buttonSeat?: number | null;
    activeSeats?: number[] | null;
    isoRaiseBB?: number | null;
    actions?: HorseReviewInput['actions'] | null;
    heroUserId?: string | null;
  },
  isShortDeck: boolean
): {
  deepOnePairStackoff: boolean;
  passiveOopColdcallBleed: boolean;
  epLimpPassivity: boolean;
  bubbleCoveredCalloff: boolean;
} {
  const bb = row.bigBlind || 1;
  const investedBB = row.invested / bb;
  const folded = row.heroActions.some((a) => a.action === 'fold');
  const postflopActed = row.heroActions.some((a) => a.stage !== 'preflop');
  const heroPre = row.heroActions.filter((a) => a.stage === 'preflop');
  const heroPreRaised = heroPre.some((a) => isAggressiveAction(a));
  const commit = commitStreet(row.heroActions, row.invested);
  const seatZone = resolveHoldemSeatZone(row);

  // 1. nlh_deep_onepair_stackoff: >= 120bb Hold'em postflop stack-off with bare one pair or worse.
  let deepOnePairStackoff = false;
  if (
    !row.multiBoard &&
    row.wentToShowdown &&
    investedBB >= 120 &&
    postflopActed &&
    commit !== 'preflop' &&
    row.holeCards &&
    row.holeCards.length === 2 &&
    row.board &&
    row.board.length >= 3
  ) {
    try {
      const ns = nlhNutStatus(row.holeCards, row.board, isShortDeck);
      deepOnePairStackoff = ns.cat > 0 && ns.cat <= CAT_ONE_PAIR;
    } catch {
      deepOnePairStackoff = false;
    }
  }

  // 2. nlh_passive_oop_coldcall_bleed: cold-calling a raise OOP (SB/early/middle)
  // and check-folding flop without contesting (netBB <= -2.5).
  let passiveOopColdcallBleed = false;
  if (row.netBB <= -2.5 && folded && !heroPreRaised && heroPre.some((a) => isCallAction(a))) {
    const maxPreCall = Math.max(
      0,
      ...heroPre.filter((a) => isCallAction(a)).map((a) => a.amount ?? 0)
    );
    const heroFlop = row.heroActions.filter((a) => a.stage === 'flop');
    const postflopPutChipsIn = row.heroActions.some(
      (a) => a.stage !== 'preflop' && (isAggressiveAction(a) || isCallAction(a))
    );
    const flopCheckFolded =
      heroFlop.length >= 2 &&
      heroFlop[0]?.action === 'check' &&
      heroFlop.some((a) => a.action === 'fold') &&
      !postflopPutChipsIn;
    const oopQualified =
      seatZone !== null
        ? seatZone === 'sb' || seatZone === 'early' || seatZone === 'middle'
        : flopCheckFolded;
    const preflopRaiseCalled = maxPreCall >= bb * 1.5 || investedBB >= 2.5;
    passiveOopColdcallBleed = oopQualified && flopCheckFolded && preflopRaiseCalled;
  }

  // 3. nlh_ep_limp_passivity: open-limping with a weak non-trap hand (not QQ+ and
  // not 54s-T9s) or open-limping EP and folding to a single small iso-raise (<= 5bb).
  let epLimpPassivity = false;
  const firstHeroPre = heroPre[0];
  const heroLimpedFirst =
    Boolean(firstHeroPre) &&
    !heroPreRaised &&
    firstHeroPre.action === 'call' &&
    typeof firstHeroPre.amount === 'number' &&
    firstHeroPre.amount > 0 &&
    firstHeroPre.amount <= bb * 1.05 &&
    seatZone !== 'bb' &&
    seatZone !== 'sb';
  if (heroLimpedFirst) {
    let openLimpUnopened = true;
    let tableSmallSingleIso = false;
    let tableSawRaise = false;
    if (Array.isArray(row.actions) && row.actions.length > 0) {
      const preTable = row.actions.filter((a) => a.stage === 'preflop');
      const heroFirstIdx = row.heroUserId
        ? preTable.findIndex((a) => a.userId === row.heroUserId && a.action === 'call')
        : preTable.findIndex(
            (a) => a.action === 'call' && typeof a.amount === 'number' && a.amount <= bb * 1.05
          );
      if (heroFirstIdx > 0) {
        const prior = preTable.slice(0, heroFirstIdx);
        if (prior.some((a) => isAggressiveAction(a) || a.action === 'call')) {
          openLimpUnopened = false;
        }
      }
      const preRaises = preTable.filter((a) => isAggressiveAction(a));
      tableSawRaise = preRaises.length > 0;
      if (preRaises.length === 1) {
        const raiseAmt = preRaises[0].amount ?? 0;
        tableSmallSingleIso = raiseAmt > bb && raiseAmt <= bb * 5.05;
      }
    }
    if (openLimpUnopened) {
      const weakNonTrapHand =
        row.holeCards !== null &&
        row.holeCards.length === 2 &&
        !isHoldemTrapOrSuitedConnectorLimp(row.holeCards);
      const epZone = seatZone === null || seatZone === 'early';
      const foldedPreAfterLimp =
        heroPre.length >= 2 && heroPre.some((a) => a.action === 'fold') && !postflopActed;
      const smallIsoConfirmed =
        typeof row.isoRaiseBB === 'number'
          ? row.isoRaiseBB > 1 && row.isoRaiseBB <= 5.05
          : tableSawRaise
            ? tableSmallSingleIso
            : investedBB <= 1.5;
      const epLimpFoldSmallIso = epZone && foldedPreAfterLimp && smallIsoConfirmed;
      epLimpPassivity = weakNonTrapHand || epLimpFoldSmallIso;
    }
  }

  // 4. nlh_bubble_covered_calloff: calling off all-in for tournament life in a
  // near-bubble or final-table pay-jump spot as covered stack with a dominated
  // bluff-catcher / bare one-pair (cat <= 2 postflop or non-premium preflop).
  let bubbleCoveredCalloff = false;
  const stageLabel =
    typeof row.tournamentStage === 'string' ? row.tournamentStage.toLowerCase() : '';
  const isTournament = row.format === 'tournament' || Boolean(row.tournamentId);
  const inBubbleOrPayJump =
    row.nearBubbleOrPayJump !== false &&
    (row.nearBubbleOrPayJump === true ||
      stageLabel === 'bubble' ||
      stageLabel === 'near_bubble' ||
      stageLabel === 'final_table' ||
      stageLabel === 'pay_jump');
  const isCovered = row.coveredStack !== false && (row.coveredStack === true || inBubbleOrPayJump);
  if (isTournament && inBubbleOrPayJump && isCovered && row.wentToShowdown) {
    const hasCallAction = row.heroActions.some((a) => isCallAction(a));
    const hasAllInCalloff =
      row.allInCalloff === true ||
      row.heroActions.some((a) => a.action === 'all_in' && a.isFullRaise === undefined);
    const lastCommitAct = [...row.heroActions]
      .reverse()
      .find(
        (a) =>
          a.action === 'bet' || a.action === 'raise' || a.action === 'call' || a.action === 'all_in'
      );
    const calledForTournamentLife =
      hasCallAction &&
      (hasAllInCalloff ||
        (investedBB >= FLAG_BB && Boolean(lastCommitAct && isCallAction(lastCommitAct))));
    if (calledForTournamentLife && row.holeCards && row.holeCards.length === 2) {
      if (commit === 'preflop' || !postflopActed || !row.board || row.board.length < 3) {
        bubbleCoveredCalloff = !isHoldemPremiumPreflopCalloff(row.holeCards);
      } else {
        try {
          const ns = nlhNutStatus(row.holeCards, row.board, isShortDeck);
          bubbleCoveredCalloff = ns.cat > 0 && ns.cat <= CAT_ONE_PAIR;
        } catch {
          bubbleCoveredCalloff = false;
        }
      }
    }
  }

  return {
    deepOnePairStackoff,
    passiveOopColdcallBleed,
    epLimpPassivity,
    bubbleCoveredCalloff,
  };
}

type ReviewActionRef = {
  seat?: number;
  userId?: string;
  action: string;
  amount?: number;
  stage: string;
  isFullRaise?: boolean;
  origin?: string;
};

function clockwisePostflopSeats(seats: number[], buttonSeat: number): number[] {
  const uniq = [...new Set(seats.filter((s) => Number.isFinite(s)))].sort((a, b) => a - b);
  return [...uniq.filter((s) => s > buttonSeat), ...uniq.filter((s) => s <= buttonSeat)];
}

/**
 * Determine whether hero was genuinely out of position (SB/BB or acting before
 * the preflop aggressor on the flop) when flatting a preflop raise with an
 * elite double-suited rundown or connected broadway.
 *
 * When a unit test invokes `detectLeaks` directly with only `heroActions` and
 * supplies no positional metadata (`heroOutOfPosition`, `position`,
 * `allActions`, `buttonSeat`), falls back to `true` so direct unit assertions
 * stay backward-compatible while full hand settlements enforce real OOP order.
 */
function isHeroOutOfPositionForRundown(row: {
  heroUserId?: string | null;
  heroSeat?: number | null;
  buttonSeat?: number | null;
  occupiedSeats?: number[] | null;
  position?: string | null;
  heroOutOfPosition?: boolean;
  allActions?: ReviewActionRef[] | null;
}): boolean {
  if (typeof row.heroOutOfPosition === 'boolean') return row.heroOutOfPosition;

  if (typeof row.position === 'string' && row.position.trim().length > 0) {
    const pos = row.position.trim().toUpperCase();
    if (
      pos === 'BTN' ||
      pos === 'BU' ||
      pos === 'BUTTON' ||
      pos === 'D' ||
      pos === 'DEALER' ||
      pos === 'CO' ||
      pos === 'CUTOFF'
    ) {
      return false;
    }
    if (
      pos === 'SB' ||
      pos === 'BB' ||
      pos === 'SMALL_BLIND' ||
      pos === 'BIG_BLIND' ||
      pos === 'STRADDLE'
    ) {
      return true;
    }
  }

  const heroUid = typeof row.heroUserId === 'string' && row.heroUserId ? row.heroUserId : null;
  const heroSeat = typeof row.heroSeat === 'number' ? row.heroSeat : null;
  const buttonSeat = typeof row.buttonSeat === 'number' ? row.buttonSeat : null;

  const isHeroRef = (a: ReviewActionRef): boolean => {
    if (heroUid && a.userId) return a.userId === heroUid;
    if (heroSeat !== null && typeof a.seat === 'number') return a.seat === heroSeat;
    return false;
  };

  if (Array.isArray(row.allActions) && row.allActions.length > 0) {
    let raiserUid: string | null = null;
    let raiserSeat: number | null = null;
    let heroPostedBlind = false;
    const actionSeats: number[] = [];

    for (const a of row.allActions) {
      if (typeof a.seat === 'number') actionSeats.push(a.seat);
      if (a.stage !== 'preflop') continue;
      const isBlindPost =
        a.origin === 'forced' ||
        a.action === 'post_sb' ||
        a.action === 'post_bb' ||
        a.action === 'sb' ||
        a.action === 'bb' ||
        a.action === 'small_blind' ||
        a.action === 'big_blind' ||
        a.action === 'straddle';
      if (isBlindPost && isHeroRef(a)) {
        heroPostedBlind = true;
      }
      if (!isBlindPost && isAggressiveAction(a) && !isHeroRef(a)) {
        raiserUid = a.userId ?? null;
        raiserSeat = typeof a.seat === 'number' ? a.seat : null;
      }
    }

    // Check actual flop acting order first: acting before the preflop raiser
    // on the flop is the exact operational definition of being OOP against them.
    const flopSeenKeys: string[] = [];
    let heroFlopIdx = -1;
    let raiserFlopIdx = -1;
    for (const a of row.allActions) {
      if (a.stage !== 'flop' || a.origin === 'forced') continue;
      const key = a.userId ?? (typeof a.seat === 'number' ? `seat:${a.seat}` : '');
      if (!key || flopSeenKeys.includes(key)) continue;
      const idx = flopSeenKeys.length;
      flopSeenKeys.push(key);
      if (heroFlopIdx < 0 && isHeroRef(a)) heroFlopIdx = idx;
      if (
        raiserFlopIdx < 0 &&
        ((raiserUid && a.userId === raiserUid) ||
          (raiserSeat !== null && typeof a.seat === 'number' && a.seat === raiserSeat))
      ) {
        raiserFlopIdx = idx;
      }
    }
    if (heroFlopIdx >= 0) {
      if (raiserFlopIdx >= 0) return heroFlopIdx < raiserFlopIdx;
      if (flopSeenKeys.length >= 2) return heroFlopIdx < flopSeenKeys.length - 1;
    }

    if (buttonSeat !== null && heroSeat !== null) {
      if (heroSeat === buttonSeat) return false;
      const seatsPool =
        Array.isArray(row.occupiedSeats) && row.occupiedSeats.length > 0
          ? row.occupiedSeats
          : actionSeats;
      const order = clockwisePostflopSeats(seatsPool, buttonSeat);
      const heroOrderIdx = order.indexOf(heroSeat);
      if (heroOrderIdx >= 0) {
        if (raiserSeat !== null) {
          const raiserOrderIdx = order.indexOf(raiserSeat);
          if (raiserOrderIdx >= 0) return heroOrderIdx < raiserOrderIdx;
        }
        if (order.length >= 2) return heroOrderIdx < order.length - 1;
      }
    }

    if (heroPostedBlind && !(buttonSeat !== null && heroSeat === buttonSeat)) {
      return true;
    }
  }

  if (buttonSeat !== null && heroSeat !== null) {
    if (heroSeat === buttonSeat) return false;
    if (Array.isArray(row.occupiedSeats) && row.occupiedSeats.length >= 2) {
      const order = clockwisePostflopSeats(row.occupiedSeats, buttonSeat);
      const heroOrderIdx = order.indexOf(heroSeat);
      if (heroOrderIdx >= 0) return heroOrderIdx < order.length - 1;
    }
    return true;
  }

  return true;
}

/**
 * Leak detectors. Each looks at ONE flagged (usually losing) hand and answers
 * "is this one of the known bad shapes?". Tags are counted per horse per day
 * in horse_review_rollup, so a horse that keeps producing the same tag is
 * visible at a glance — and a fleet-wide spike in a tag after a deploy is a
 * regression alarm for the brain itself.
 */
export function detectLeaks(row: {
  netBB: number;
  invested: number;
  bigBlind: number;
  variant: string;
  holeCards: Card[] | null;
  board: Card[] | null;
  heroActions: Array<{ action: string; stage: string; amount?: number; isFullRaise?: boolean }>;
  wentToShowdown: boolean;
  /** More than one board was dealt (double-board bomb pot, run it twice). */
  multiBoard?: boolean;
  /** Parsed distinct boards when multiBoard is true. */
  boards?: Card[][] | null;
  format?: string | null;
  tournamentId?: string | null;
  nearBubbleOrPayJump?: boolean;
  tournamentStage?: string | null;
  coveredStack?: boolean;
  allInCalloff?: boolean;
  position?: string | null;
  seat?: number | null;
  heroSeat?: number | null;
  buttonSeat?: number | null;
  activeSeats?: number[] | null;
  occupiedSeats?: number[] | null;
  isoRaiseBB?: number | null;
  actions?: HorseReviewInput['actions'] | null;
  allActions?: ReviewActionRef[] | null;
  heroUserId?: string | null;
  heroOutOfPosition?: boolean;
}): string[] {
  const tags: string[] = [];
  const vi = variantInfo(row.variant);
  const investedBB = row.invested / (row.bigBlind || 1);

  const folded = row.heroActions.some((a) => a.action === 'fold');
  const raisedOrBet = (stage: string) =>
    row.heroActions.some((a) => a.stage === stage && isAggressiveAction(a));

  /*
   * ═══ THE WIN SIDE OF RIVER AGGRESSION (2026-09-01) ═══
   *
   * Every tag below this point is a LEAK, and a leak is only a leak when the
   * hand lost - hence the early return. That is right for the leak tags and
   * it made one number unreadable.
   *
   * MEASURED on 2026-08-31: `river_aggr_lost` carried 1,545 hands and
   * -97,229bb, roughly five times the entire day's horse net of -19,984bb,
   * and it dominated the tag mix of nine of the ten bleeding horses. It is
   * the largest single line in the audit - and it cannot be acted on, because
   * the tag exists only on losses. There is no denominator. A horse that bets
   * every river and a horse that value-bets perfectly produce the same
   * evidence here, since a winning river bet is stored (5,277 wins were) and
   * simply carries no tag at all.
   *
   * Tuning a river cap on that number would be tuning against a sample
   * selected for being negative. So the mirror is recorded: the same line,
   * the same showdown, the winning outcome. `river_aggr_won` plus
   * `river_aggr_lost` is river aggression's actual EV.
   *
   * It is NOT a leak tag and must never be treated as one. It is named for
   * the outcome so no gate can mistake it, and the self-tuner reads tags by
   * exact name (nonnut_flush_stackoff, big_bet_fold, preflop_stackoff), so
   * nothing downstream picks it up by accident.
   */
  /*
   * ═══ EVERY SITUATION TAG CARRIES A DENOMINATOR (2026-09-05) ═══
   *
   * This function used to return here on a win, so 21 of its 23 tags existed
   * ONLY on losing hands. That is a sample selected for being negative, and
   * it makes the whole leak table unrankable: a tag's total is "how often
   * this shape happens in big pots", never "whether this shape is wrong".
   *
   * It was found and fixed twice already, one tag at a time - river_aggr on
   * 2026-09-01, river_raise_war on 2026-09-02 - each time with the note
   * "same fix, same naming rule". Nobody generalised it, so the other
   * twenty-one kept the defect.
   *
   * WHAT IT COST, measured 2026-09-05 over 7 days. Ranking the tags by their
   * loss totals put `river_aggr_lost` first by a distance: 27,486 hands and
   * -1,941,955bb, over three times the next line. With its mirror included,
   * river aggression is +609,194bb overall and PROFITABLE in six of seven
   * variants - only NLH is even slightly negative (-11,816bb over 15,201
   * hands, 52.3% wins, about 1.4 sigma from zero and therefore not a finding
   * at all). Acting on the one-sided ranking would have tightened the horses
   * out of a winning line and made them EASIER to beat, which is the opposite
   * of the point.
   *
   * So every OUTCOME-INDEPENDENT situation is now recorded on both sides:
   * the loss keeps its existing name (the self-tuner reads exact names and is
   * deliberately untouched) and the win records `<name>_won`. The audit can
   * then rank by EV instead of by damage.
   *
   * THE FOLD FAMILY IS NOT MIRRORED, and cannot be: big_bet_fold,
   * big_fold_river, big_fold_early and bet_fold_line all require hero to have
   * FOLDED, and a folded hand never wins. They stay one-sided by nature, and
   * that means they must never be ranked against the mirrored tags - a fold
   * always shows a negative net, because the negative net IS the fold.
   */
  const won = row.netBB > 0;

  /** Record a situation: `name` when the hand lost, `name_won` when it won. */
  const flag = (name: string): void => {
    tags.push(won ? `${name}_won` : name);
  };

  // Big loss with a fold at the end: chips went in and then the hand was
  // surrendered — a blown-off bluff or a bet-fold line that cost a stack.
  // NOT MIRRORED - a folded hand never wins. See the note above `flag`.
  if (!won && folded && investedBB >= FLAG_BB) {
    tags.push('big_bet_fold');

    // V23 DETECTOR SPLIT (2026-08-28): big_bet_fold has two OPPOSITE fixes.
    // "Got bluffed off the best hand on the river" wants looser catches;
    // "built a huge pot on early streets and then had to let it go" wants
    // tighter pot-building. One tag cannot steer the self-tuner both ways.
    const foldStage = [...row.heroActions].reverse().find((a) => a.action === 'fold')?.stage;
    tags.push(foldStage === 'river' ? 'big_fold_river' : 'big_fold_early');
    // The bet-fold LINE: hero bet or raised the very street it then folded
    // on — it put chips in with a hand it could not defend at that price.
    if (foldStage && raisedOrBet(foldStage)) {
      tags.push('bet_fold_line');
    }
  }

  // ═══ V23 PREFLOP-ENTRY DETECTORS (2026-08-28) ═══ how the horse ENTERED
  // the pot it lost big. detectLeaks only sees hero's own actions, so both
  // reads are from the hero side: the amounts say whether the entry was a
  // limp or a cold-call of a raise.
  const heroPre = row.heroActions.filter((a) => a.stage === 'preflop');
  const heroPreRaised = heroPre.some((a) => isAggressiveAction(a));
  const bb = row.bigBlind || 1;
  if (!heroPreRaised && heroPre.some((a) => isCallAction(a)) && investedBB >= 2 * FLAG_BB) {
    const maxPreCall = Math.max(
      0,
      ...heroPre.filter((a) => isCallAction(a)).map((a) => a.amount ?? 0)
    );
    if (maxPreCall <= bb * 1.05) {
      // Entered for one big blind and lost 40bb+ — limped pots are supposed
      // to stay SMALL; a stack went in behind a passive entry.
      flag('limped_pot_bloat');
    } else if (maxPreCall >= bb * 3) {
      // Cold-called a raise (never took the initiative) and lost 40bb+ —
      // the classic dominated-flat: crushed by the range it called.
      flag('coldcall_stackoff');
    }
  }

  // Omaha nut discipline: the horse lost a 20bb+ pot at showdown holding a
  // non-nut flush or a dominated straight on the final board — the exact
  // "small flush pays off the bigger one" hand.
  // ── ONE BOARD OF SEVERAL IS NOT THE HAND (2026-09-30) ──
  // A double-board bomb pot is split between two boards, and `row.board` is
  // board 1 only. Judging hero's made hand there tagged top set on board 2
  // (review 797943) and a set on board 2 (798911) as one-pair stack-offs.
  // Double-board hands were 22% of plo_toppair_no_redraw_stackoff against
  // 5.5% of PLO reviews. The Omaha made-hand blocks stand down when more
  // than one board was dealt.
  if (
    vi.isOmaha &&
    !row.multiBoard &&
    row.wentToShowdown &&
    row.holeCards &&
    row.board &&
    row.board.length >= 3
  ) {
    try {
      const st = omahaNutStatus(row.holeCards, row.board);
      if (st.category === 6 && st.higherFlushRanks >= 2) {
        flag('nonnut_flush_stackoff');
      } else if (st.category === 6 && st.higherFlushRanks === 1) {
        flag('second_nut_flush_stackoff');
      } else if (st.category === 5 && st.flushPossible) {
        // 2026-09-13: the Omaha branch asked only whether the straight was the
        // nut straight, so a horse holding the NUT straight that stacked off
        // into a three-flush board produced no tag at all - `straightIsNut`
        // was true and nothing else tested the board. The NLH mirror below
        // has always asked `flushPossible` FIRST, for the reason that matters
        // more in Omaha than anywhere else: with four hole cards and three of
        // a suit showing, somebody usually has the flush. Measured over the
        // seven days to 2026-09-12: 17,190 Omaha showdown losses of 20bb+ on
        // three-flush boards, 10,951 of them carrying none of the four
        // nut-discipline tags.
        //
        // MEASUREMENT ONLY on purpose. The name is deliberately the existing
        // NLH one, so the tag vocabulary does not grow, and it is deliberately
        // NOT added to PLO_STACKOFF_TAGS: wiring it into the V20 pressure cap
        // or the self-tuner's stackoff gate would change how horses play, and
        // that is a strategy change which needs a league matchup behind it.
        flag('straight_into_flush_stackoff');
      } else if (st.category === 5 && !st.straightIsNut) {
        flag('dominated_straight_stackoff');
      } else if (
        ((st.category === 6 && st.higherFlushRanks === 0) ||
          (st.category === 5 && st.straightIsNut && !st.flushPossible)) &&
        boardHasPair(row.board)
      ) {
        // ── A PAIRED BOARD DEMOTES THE NUTS (2026-09-28) ──
        // V15 demotes a nut flush or nut straight on a paired board: every
        // raise there is a full house. The detector never did, so a nut hand
        // stacking off into a boat carried no tag at all. From the 2026-09-27
        // sweep: 756309 (nut flush on 4d-Qd-Th-5d-5c, -489bb) and 755841
        // (broadway on Kh-As-Qc-Ad-4s, -534bb). MEASUREMENT ONLY: not in
        // PLO_STACKOFF_TAGS, so no dial reads it.
        flag('plo_paired_board_nut_stackoff');
      }
    } catch {
      /* detector is best-effort */
    }
  }

  // Preflop stack-off: 40bb+ went in with all the aggression preflop
  // (no postflop action from the horse at all - or, since 2026-09-11, no
  // postflop action beyond a remainder call; see commitStreet).
  const postflopActed = row.heroActions.some((a) => a.stage !== 'preflop');
  if (
    (!postflopActed || commitStreet(row.heroActions, row.invested) === 'preflop') &&
    investedBB >= 2 * FLAG_BB
  ) {
    flag('preflop_stackoff');
  }

  // River aggression that lost at showdown: bet/raised the river and paid off
  // or was called by better — worth human eyes when it repeats.
  if (row.wentToShowdown && raisedOrBet('river')) {
    // HISTORICAL SPELLING KEPT: the win side has been `river_aggr_won` since
    // 2026-09-01, not `river_aggr_lost_won`. Renaming it would orphan four
    // months of rows, so this pair keeps its own names.
    tags.push(won ? 'river_aggr_won' : 'river_aggr_lost');

    // V21 (2026-08-27): river_aggr_lost lumped ordinary value bets that ran
    // into the top of the range together with RAISE WARS — and the wars are
    // where the -500bb pots live. Two or more aggressive river actions from
    // the horse in one hand is a war it kept escalating.
    const riverAggrCount = riverAggressiveActions(row);
    if (riverAggrCount >= 2) {
      tags.push(won ? 'river_raise_war_won' : 'river_raise_war');
    }
    // V23 (2026-08-28): hero bet the river, then CALLED on the river — the
    // only way that sequence exists is a raise arrived and hero paid it off.
    // The V21 war tag needs two aggressive actions; this catches the
    // bet-then-call shape that pays a raise without escalating.
    const acts = row.heroActions.filter((a) => a.stage === 'river');
    const betIdx = acts.findIndex((a) => isAggressiveAction(a));
    if (betIdx >= 0 && acts.slice(betIdx + 1).some((a) => isCallAction(a))) {
      flag('river_raise_paidoff');
    }
  }

  // V21 NLH nut discipline at showdown — the holdem mirror of the Omaha
  // block above. A 20bb+ showdown loss holding a hand the BOARD demotes:
  // a straight on a three-flush board, a non-nut flush, the bottom boat.
  if (
    !vi.isOmaha &&
    row.wentToShowdown &&
    row.holeCards &&
    row.board &&
    row.board.length >= 5 &&
    investedBB >= FLAG_BB
  ) {
    try {
      const ns = nlhNutStatus(row.holeCards, row.board, vi.isShortDeck);
      const flushCat = vi.isShortDeck ? 7 : 6;
      const boatCat = vi.isShortDeck ? 6 : 7;
      if (ns.cat === 5 && ns.flushPossible) {
        flag('straight_into_flush_stackoff');
      } else if (ns.cat === 5 && ns.heroStraightTop < ns.maxStraightTop) {
        flag('nonnut_straight_stackoff');
      } else if (ns.cat === flushCat && ns.higherFlushRanks >= 1) {
        flag('nonnut_flush_stackoff');
      } else if (ns.cat === boatCat && ns.underfull) {
        flag('underfull_stackoff');
      }
    } catch {
      /* detector is best-effort */
    }
  }

  // V24 KICKER DISCIPLINE (2026-08-30): the 08-29 GTO sweep's three biggest
  // showdown losses were all the same shape — trips on a paired board with a
  // dominated kicker committing a full stack (QT on 2-T-T-5-J for 453.9bb,
  // QJ on J-6-J-T-K for 440bb, AJ on A-3-T-Q-A for 437bb) — and two more in
  // the top five were top pair with a rag kicker jamming 300bb. None of them
  // carried anything beyond the generic river_aggr_lost, because the nut
  // discipline block above knows flushes, straights and boats but nothing on
  // the pair ladder. These tags COUNT the pattern so the self-tuner and the
  // nightly audit can see it; no strategy dial moves here (that needs league
  // measurement per the standing rule).
  if (
    !vi.isOmaha &&
    row.wentToShowdown &&
    row.holeCards &&
    row.holeCards.length === 2 &&
    row.board &&
    row.board.length >= 5 &&
    investedBB >= 2 * FLAG_BB
  ) {
    try {
      const rv = (card: Card): number => RANK_VALUES[card.rank];
      const boardCount = new Map<number, number>();
      for (const bc of row.board) boardCount.set(rv(bc), (boardCount.get(rv(bc)) ?? 0) + 1);
      const [h1, h2] = row.holeCards;
      const r1 = rv(h1);
      const rr2 = rv(h2);
      // Trips by pairing a doubled board rank with EXACTLY one hole card.
      // (Two hole cards of that rank is quads; a kicker that also matches a
      // board rank is a full house — both stronger shapes, both excluded.)
      const tripRank = [...boardCount].find(([r, n]) => n === 2 && (r1 === r) !== (rr2 === r))?.[0];
      if (tripRank !== undefined) {
        const kicker = r1 === tripRank ? rr2 : r1;
        const kickerFillsBoat = (boardCount.get(kicker) ?? 0) >= 1;
        // An ace kicker cannot be out-kicked; anything below it can.
        if (!kickerFillsBoat && kicker < 14) {
          flag('weak_kicker_trips_stackoff');
        }
      } else if (r1 !== rr2) {
        // Top pair on an unpaired top rank with a kicker nine or worse.
        const topBoard = Math.max(...boardCount.keys());
        const pairsTop =
          (boardCount.get(topBoard) ?? 0) === 1 && (r1 === topBoard) !== (rr2 === topBoard);
        if (pairsTop) {
          const kicker = r1 === topBoard ? rr2 : r1;
          if (kicker <= 9 && (boardCount.get(kicker) ?? 0) === 0) {
            flag('top_pair_weak_kicker_stackoff');
          }
        }
      }
    } catch {
      /* detector is best-effort */
    }
  }

  // ═══ NLH ONE PAIR AND BOARD-PAIRED TWO PAIR (2026-09-28) ═══════════════
  //
  // The 2026-09-27 audit counted 647 NLH losses worse than -100bb: 209
  // carried only outcome tags and 247 carried none, against 15-25% untagged
  // in PLO. The V24 block above only knows a RAG kicker (nine or worse) and
  // board trips, so the day's biggest shapes had no name:
  //   - one pair of hero's own going in on the river on a quiet board with a
  //     GOOD kicker or an overpair (736266 KJ, 752381 AJ, 738151 KQ, 741432
  //     KQ, 743300 KK, 753294 KK - each -480 to -610bb);
  //   - two pair where one pair is the BOARD's, so every card that pairs
  //     the board counterfeits or outkicks it (740479 AJ on T-5-2-A-T,
  //     737195 AQ on 4-A-7-7-9, 745046 JT on 6-6-3-J-3, 746040 QJ on
  //     J-2-Q-2-4).
  // MEASUREMENT ONLY, like V24: neither tag is in NLH_STACKOFF_TAGS, so no
  // dial or brain load reads it until a league matchup says it should.
  if (
    !vi.isOmaha &&
    row.wentToShowdown &&
    row.holeCards &&
    row.holeCards.length === 2 &&
    row.board &&
    row.board.length >= 5 &&
    investedBB >= 2 * FLAG_BB
  ) {
    try {
      const ns = nlhNutStatus(row.holeCards, row.board, vi.isShortDeck);
      const rv = (card: Card): number => RANK_VALUES[card.rank];
      const boardCount = new Map<number, number>();
      for (const bc of row.board) boardCount.set(rv(bc), (boardCount.get(rv(bc)) ?? 0) + 1);
      const boardPaired = [...boardCount.values()].some((n) => n >= 2);
      const suitN = new Map<string, number>();
      for (const bc of row.board) suitN.set(bc.suit, (suitN.get(bc.suit) ?? 0) + 1);
      const threeSuited = [...suitN.values()].some((n) => n >= 3);
      const [h1, h2] = row.holeCards;
      const r1 = rv(h1);
      const r2 = rv(h2);
      const hits = [r1, r2].filter((r) => (boardCount.get(r) ?? 0) >= 1).length;
      if (ns.cat === CAT_ONE_PAIR && !boardPaired && !threeSuited) {
        const overpair = r1 === r2 && r1 > Math.max(...boardCount.keys());
        const onePairHit = r1 !== r2 && hits === 1;
        // Top pair with a kicker of nine or worse is V24's tag already.
        const topBoard = Math.max(...boardCount.keys());
        const kicker = r1 === topBoard ? r2 : r2 === topBoard ? r1 : 0;
        const v24Owns = onePairHit && kicker > 0 && kicker <= 9;
        const commit = commitStreet(row.heroActions, row.invested);
        if ((overpair || onePairHit) && !v24Owns && commit === 'river') {
          flag('one_pair_river_stackoff');
        }
        // Retained October 19 audit proposal: name the turn counterpart too.
        // This is the final single-board showdown shape and commitment street,
        // never an assertion about equity at the turn or a reason to tune policy.
        if (!row.multiBoard && (overpair || onePairHit) && !v24Owns && commit === 'turn') {
          flag('one_pair_turn_stackoff');
        }
      } else if (ns.cat === CAT_ONE_PAIR + 1 && boardPaired && r1 !== r2 && hits >= 1) {
        flag('board_paired_two_pair_stackoff');
      }
    } catch {
      /* detector is best-effort */
    }
  }

  // ═══ V38 PLO STACKOFF DISCIPLINE (Dan 2026-09-03) ═══════════════════════
  //
  // Dan flagged hand #5428599 (PLO6 1/2, Midway Union): the horse held
  // A-A-J-9-8-4, opened 2.5x, called a pot 3-bet, called a pot-sized flop bet,
  // then bet the paired turn and called off 86% of a 169 stack into a
  // check-raise all-in from the preflop 3-bettor. It had trip nines. The
  // villain had sixes full. Stated accurately: the horse held roughly ten
  // outs to nines-full, so it was a THIN LOSING CALL and not a drawing-dead
  // one - and the larger error was the 2.5x open that built the pot, which is
  // the sizing fix in HorsePreflop.
  //
  // This is the second instance of a shape the 2026-09-02 audit panel had
  // already proposed off hand 103011 - PLO6, turn stackoff, trips into
  // aggression - and NEITHER hand carried a leak tag, because the Omaha nut
  // block above knows flushes, straights and boats and nothing on the trips
  // or one-pair rungs. These tags COUNT the pattern so the self-tuner, the
  // nightly audit and the horses console can see it repeat. NO STRATEGY DIAL
  // MOVES HERE: a stackoff threshold or a calling range is strategy and needs
  // scenario tests plus a league matchup with significance, per the standing
  // rule. A detector is a measurement.
  if (
    vi.isOmaha &&
    !row.multiBoard &&
    row.wentToShowdown &&
    row.holeCards &&
    row.board &&
    row.board.length >= 5 &&
    investedBB >= PLO_STACKOFF_BB
  ) {
    try {
      // Judge the hand hero HELD when the stack went in, on the board hero
      // could see - see commitStreet above. A preflop commit is not this
      // block's decision.
      const commit = commitStreet(row.heroActions, row.invested);
      const boardAt = boardAsOf(row.board, commit);
      const st = commit === 'preflop' ? null : omahaNutStatus(row.holeCards, boardAt);
      if (st === null) {
        /* preflop_stackoff owns a preflop all-in */
      } else if (st.category === CAT_TRIPS) {
        const threats = omahaBoardThreats(boardAt);
        if (threats.fullHouseLive || threats.flushLive || threats.straightLive) {
          // ── TRIPS AND SETS ARE NOT THE SAME LEAK (2026-09-05) ──
          // Three of a kind is one category number, but the two shapes are
          // different decisions: TRIPS is one hole card on a board pair (the
          // #5428599 shape, and the 09-02 panel's hand 103011 - both of
          // which this tag was written for); a SET is a pocket pair on an
          // unpaired board, hidden, with boat and straight redraws of its
          // own. Measured 2026-09-04: 275 of 419 plo_naked_trips_stackoff
          // tags were sets on unpaired boards (review 235357: top set on
          // Q-J-T), and HorseLogic's PLO_STACKOFF_TAGS reads this tag as a
          // rate into ploStackoffLoad, so V40 was being pushed by a hand it
          // was never meant to count. The board decides which is which: a
          // category-4 hand on a paired board is trips (a pocket pair on a
          // paired board would be a boat or quads, never trips); on an
          // unpaired board it can only be a set.
          flag(boardHasPair(boardAt) ? 'plo_naked_trips_stackoff' : 'plo_set_stackoff');
        }
        // ── A SET OR TRIPS STACKED OFF ON A WET BOARD (2026-11-07) ──
        // The 2026-11-06 review of the twenty biggest losses found review
        // 3370600 with no tag at all: bottom set of twos five-bet the turn on
        // 2h Ts 9h 3s with no flush draw and lost 595bb when the Ks put
        // three spades on the board. plo_set_stackoff reads its threats on
        // the commit-street board only, and that turn shows two of each
        // suit and no three-rank straight window, so it stood down.
        //
        // set_on_wet_board_stackoff, all of:
        //  - the stack went in on the TURN or RIVER (commitStreet; a flop
        //    commit with a set is a different, much stronger decision);
        //  - hero held exactly three of a kind at the commit street (set or
        //    trips) and had not filled up by the river (a full house or
        //    better on the river is a different hand). A river straight that
        //    still lost to the flush (review 3364887) keeps the tag: the
        //    decision was made with a set;
        //  - the board shows three to a flush or three to a straight, read
        //    on the board as of the commit street OR on the river board. A
        //    turn commit is a bet that the draws on the board miss; whether
        //    they arrived is the situation measured, and the mirror
        //    (`_won`) carries the other side so the audit ranks it by EV;
        //  - hero had no redraw of its own when it committed: on a turn
        //    commit no flush draw (nut or dominated) and fewer than eight
        //    straight outs by omahaDrawQuality, the same test
        //    plo_toppair_no_redraw_stackoff uses. The full-house redraw every
        //    set carries is not counted: it is the set's own, never a reason
        //    to tag or untag. A river commit has no redraw by definition.
        // It overlaps plo_set_stackoff and plo_naked_trips_stackoff on a
        // board that was already wet at the commit street (reviews 3364887
        // and 3370281 carry both). Those two are read by HorseLogic's
        // PLO_STACKOFF_TAGS and are deliberately left untouched; this tag is
        // measurement only and steers nothing.
        if (commit === 'turn' || commit === 'river') {
          const finalCat = omahaNutStatus(row.holeCards, row.board).category;
          const atRiver = omahaBoardThreats(row.board);
          const wet =
            threats.flushLive || threats.straightLive || atRiver.flushLive || atRiver.straightLive;
          let redraw = false;
          if (boardAt.length < 5) {
            const draw = omahaDrawQuality(row.holeCards, boardAt, vi.isHiLo);
            redraw = draw.nutFlushDraw || draw.dominatedFlushDraw || draw.straightOuts >= 8;
          }
          // Hi-lo: a made low, or a low draw on a turn commit, is half the
          // pot, the same rule plo_toppair_no_redraw_stackoff applies.
          if (vi.isHiLo && omahaLowLive(row.holeCards, boardAt)) redraw = true;
          if (finalCat < CAT_FULL_HOUSE && wet && !redraw) flag('set_on_wet_board_stackoff');
        }
      } else if (st.category === CAT_FULL_HOUSE) {
        // ── THE PLO UNDER-FULL (2026-09-05) ──
        // The V15 nut block knows flushes and straights; nlhNutStatus's
        // `underfull` is hold'em only; and HorseLogic's dominated21 brake
        // excludes Omaha for full houses. So the day's three biggest PLO
        // losses on 2026-09-04 carried no Omaha tag at all: sixes full
        // re-raising a river on 7-4-2-7-6 into sevens full (review 190517,
        // -527bb), fives full of THREES - the worst boat on 5-6-8-3-5 -
        // raising and then shoving over a river 3-bet (182170, -523bb),
        // sixes full of nines 3-betting a paired turn (190109, -519bb).
        // This is the Omaha mirror of the sixes-full-on-JJ66x incident V21
        // was written for. The test is exhaustive and cheap at this rate:
        // is there ANY two-card holding, from the cards hero cannot see,
        // that makes a bigger full house or quads on this exact board.
        if (!omahaBoatIsNut(row.holeCards, boardAt)) {
          flag('plo_underfull_stackoff');
          const boatPosAt = omahaBoatPosition(row.holeCards, boardAt);
          const minHigherBoats = boardAt.length === 3 ? 1 : 2;
          if (boatPosAt && boatPosAt.lowerBoats === 0 && boatPosAt.boats >= minHigherBoats) {
            flag('plo_underboat_stackoff');
          }
        }
      } else if (st.category === CAT_ONE_PAIR && isOmahaTopPair(row.holeCards, boardAt)) {
        // TOP pair with a full stack in. On the river every redraw has
        // resolved, so a hand that still shows one pair is one that had no
        // wrap, no flush and no nut redraw arrive - the second shape the audit
        // panel proposed (plo_toppair_no_redraw_stackoff). On a flop or turn
        // commit the redraw is still live, so a flush draw or eight or more
        // straight outs is a different decision and is not this tag.
        //
        // 2026-09-30: the test was `category <= CAT_ONE_PAIR`, so overpairs,
        // middle and bottom pairs and high card all carried a TOP-pair tag
        // (reviews 796401, 802448, 804424, 814544). It now requires the
        // name. And in a hi-lo game a made low, or a low draw on a flop or
        // turn commit, is half the pot: that is a redraw too (812864).
        let redrawLive = false;
        if (boardAt.length < 5) {
          const draw = omahaDrawQuality(row.holeCards, boardAt, vi.isHiLo);
          redrawLive = draw.nutFlushDraw || draw.dominatedFlushDraw || draw.straightOuts >= 8;
        }
        if (vi.isHiLo && omahaLowLive(row.holeCards, boardAt)) redrawLive = true;
        if (!redrawLive) flag('plo_toppair_no_redraw_stackoff');
      }
    } catch {
      /* detector is best-effort */
    }
  }

  // V87 Hold'em cash and tournament leak detectors:
  //  - nlh_deep_onepair_stackoff: >=120bb postflop stack-off with bare one pair or worse
  //  - nlh_passive_oop_coldcall_bleed: OOP cold-call followed by flop check-fold (fold-only: a folded hand never wins)
  //  - nlh_ep_limp_passivity: weak non-trap open-limp or EP open-limp folding to <=5bb iso-raise
  //  - nlh_bubble_covered_calloff: covered bubble/pay-jump tournament call-off with bare one-pair or non-premium preflop
  if (!vi.isOmaha) {
    const v87 = evaluateHoldemV87Detectors(row, vi.isShortDeck);
    if (v87.deepOnePairStackoff) {
      flag('nlh_deep_onepair_stackoff');
    }
    if (!won && folded && v87.passiveOopColdcallBleed) {
      tags.push('nlh_passive_oop_coldcall_bleed');
    }
    if (v87.epLimpPassivity) {
      flag('nlh_ep_limp_passivity');
    }
    if (v87.bubbleCoveredCalloff) {
      flag('nlh_bubble_covered_calloff');
    }
  }

  // V86 MULTI-BOARD DEAD-HALF CALLOFF & PASSIVE PLO RUNDOWN DETECTORS
  if (
    vi.isOmaha &&
    row.multiBoard &&
    row.wentToShowdown &&
    row.holeCards &&
    Array.isArray(row.boards) &&
    row.boards.length >= 2 &&
    investedBB >= 2 * FLAG_BB &&
    !raisedOrBet('flop') &&
    !raisedOrBet('turn') &&
    !raisedOrBet('river')
  ) {
    try {
      const fiveCardBoards = row.boards.filter((b) => Array.isArray(b) && b.length >= 5);
      if (
        fiveCardBoards.length >= 2 &&
        fiveCardBoards.some((b) => omahaNutStatus(row.holeCards!, b).category <= CAT_ONE_PAIR)
      ) {
        flag('plo_multiboard_dead_half_call');
      }
    } catch {
      /* detector is best-effort */
    }
  }

  if (
    vi.isOmaha &&
    !row.multiBoard &&
    row.holeCards &&
    !heroPreRaised &&
    heroPre.some((a) => isCallAction(a) && (a.amount ?? 0) >= bb * 2.5) &&
    investedBB >= FLAG_BB &&
    !raisedOrBet('flop') &&
    !raisedOrBet('turn') &&
    !raisedOrBet('river')
  ) {
    try {
      const elite = omahaEliteClassRead(row.holeCards, vi.isHiLo);
      const isPassiveEliteRundown =
        elite.canThreeBet && (elite.cls === 'rundown_ds' || elite.cls === 'broadway_conn_ds');
      const heroWasOop = isHeroOutOfPositionForRundown(row);
      if (isPassiveEliteRundown && heroWasOop) {
        flag('plo_passive_rundown_oop');
      }
    } catch {
      /* detector is best-effort */
    }
  }

  // nonnut_flush_stackoff is reachable from both the Omaha block and the NLH
  // board-demotion block, so a hand can pick it up twice. It always could;
  // the mirror doubles the chance of noticing.
  return [...new Set(tags)];
}

/** Pure: build the rows to insert (exported for tests; no IO). */
export function buildReviewRows(input: HorseReviewInput): HorseReviewRow[] {
  const horses = new Set(input.roster.filter((p) => p.isHorse && p.userId).map((p) => p.userId));
  if (horses.size === 0) return [];

  const returnedBy = new Map<string, number>();
  for (const w of input.winners ?? []) {
    if (!w?.userId) continue;
    returnedBy.set(w.userId, r2((returnedBy.get(w.userId) ?? 0) + (w.amount ?? 0)));
  }

  const bb = input.bigBlind > 0 ? input.bigBlind : 1;
  const dealtCount = input.holeCardsAll.size || input.roster.length;
  const format = reviewFormat(input, dealtCount);
  const activeSeats = [...input.holeCardsAll.values()]
    .map((s) => s.seat)
    .filter((s): s is number => typeof s === 'number');

  // Distinct non-empty boards: board 1 is repeated inside some callers' lists.
  const distinctRawBoards = [
    ...new Map(
      (input.boards ?? [])
        .filter((b) => Array.isArray(b) && b.length > 0)
        .map((b) => [JSON.stringify(b), b] as const)
    ).values(),
  ];
  const multiBoard = distinctRawBoards.length > 1;
  const parsedBoards = multiBoard
    ? distinctRawBoards.map((b) => parseCards(b)).filter((b): b is Card[] => b !== null)
    : null;

  const occupiedSeats = [...input.holeCardsAll.values()]
    .map((v) => v.seat)
    .filter((s): s is number => typeof s === 'number' && Number.isFinite(s));

  const rows: HorseReviewRow[] = [];
  for (const uid of horses) {
    const invested = input.contributions.get(uid) ?? 0;
    const returned = returnedBy.get(uid) ?? 0;
    const net = r2(returned - invested);
    const netBB = net / bb;
    if (Math.abs(netBB) < FLAG_BB) continue;

    const seatInfo = input.holeCardsAll.get(uid);
    const heroActions = (input.actions ?? [])
      .filter((a) => a.userId === uid)
      .map((a) => ({
        action: a.action,
        stage: a.stage,
        amount: a.amount,
        isFullRaise: a.isFullRaise,
      }));
    const folded = heroActions.some((a) => a.action === 'fold');
    const holeCards = seatInfo ? parseCards(seatInfo.cards) : null;
    const board = input.board ? parseCards(input.board) : null;

    const tags = detectLeaks({
      netBB,
      invested,
      bigBlind: bb,
      variant: input.gameVariant,
      holeCards,
      board,
      heroActions,
      wentToShowdown: !folded,
      multiBoard,
      boards: parsedBoards,
      format,
      tournamentId: input.tournamentId ?? null,
      nearBubbleOrPayJump: input.nearBubbleOrPayJump,
      tournamentStage: input.tournamentStage ?? null,
      coveredStack: input.coveredStack,
      seat: seatInfo?.seat ?? null,
      heroSeat: seatInfo?.seat ?? null,
      buttonSeat: input.buttonSeat ?? null,
      activeSeats,
      occupiedSeats,
      actions: input.actions ?? null,
      allActions: input.actions ?? null,
      heroUserId: uid,
    });

    rows.push({
      hand_id: input.handId,
      table_id: input.tableId,
      tournament_id: input.tournamentId ?? null,
      club_id: input.clubId ?? null,
      played_at: input.playedAt,
      game_variant: input.gameVariant,
      format,
      big_blind: bb,
      horse_user_id: uid,
      seat: seatInfo?.seat ?? null,
      net_amount: net,
      net_bb: r2(netBB),
      pot_size: input.potSize ?? null,
      // Store the PARSED shape when parsing succeeded (one consistent shape
      // for the UI and the daily analysis SQL), but NEVER discard evidence:
      // when the parser rejects a payload the raw shape is stored as-is, so
      // the audit's evidence_payload_missing finding can distinguish "parser
      // needs updating" from "data truly absent".
      hole_cards: holeCards ?? seatInfo?.cards ?? null,
      board: board ?? input.board ?? null,
      actions: input.actions ?? null,
      leak_tags: tags,
    });
  }
  return rows;
}

/** Kill switch: HORSE_HAND_REVIEW_ENABLED=false disables all writes. */
const enabled = (): boolean => process.env.HORSE_HAND_REVIEW_ENABLED !== 'false';

// ═══════════════════════════════════════════════════════════════════════════
// V16 REAL NETS (2026-08-26) — per-horse daily aggregate, EVERY hand
// ═══════════════════════════════════════════════════════════════════════════
// The self-tuner's bb100 rule was disabled because action-log reconstruction
// fails chip conservation in 38% of hands. This is the fix the 2026-08-23
// audit called for: the EXACT settlement nets, aggregated per
// horse/day/variant/format in memory and flushed additively every minute.
// Losing one flush window on a crash costs at most ~60s of aggregate — noise
// against a 7-day tuning window — and the additive upsert makes every flush
// idempotent-safe to retry.

interface NetAcc {
  hands: number;
  netBB: number;
  /** weighted-contributed rake paid, in bb (2026-09-05) */
  rakeBB: number;
  /** weighted-contributed bad-beat-jackpot drop paid, in bb (2026-09-06) */
  bbjBB: number;
}

const netAcc = new Map<string, NetAcc>();
const NET_FLUSH_MS = 60_000;
const NET_BATCH_MAX = 500;
/** Bounded during outages: beyond this, oldest keys are dropped (reported). */
const NET_ACC_MAX_KEYS = 8000;
let netFlushTimer: NodeJS.Timeout | null = null;

const netsEnabled = (): boolean => process.env.HORSE_NET_ROLLUP_ENABLED !== 'false';

/** Accumulate one settled hand's exact nets for every horse dealt in. */
export function accumulateHorseNets(input: HorseReviewInput): void {
  try {
    if (!netsEnabled() || !input.handId) return;
    const bb = input.bigBlind > 0 ? input.bigBlind : 1;
    const day = input.playedAt.slice(0, 10);
    const dealtCount = input.holeCardsAll.size || input.roster.length;
    const format = reviewFormat(input, dealtCount);
    const returnedBy = new Map<string, number>();
    for (const w of input.winners ?? []) {
      if (!w?.userId) continue;
      returnedBy.set(w.userId, (returnedBy.get(w.userId) ?? 0) + (w.amount ?? 0));
    }
    // THE RAKE IS PART OF THE RESULT (2026-09-05). The fleet's -32 bb/100 on
    // 2026-09-04 was the day's rake plus BBJ drop to within one percent, and
    // the tuner read it as 221 horses with broken dials. Same allocator as
    // rake_attributions / ca_hand_facts.rake_paid, so every ledger agrees.
    const contributions = [...input.contributions.entries()];
    const rakeShares = allocateWeightedShareCents(Number(input.rakeAmount ?? 0), contributions);
    // THE JACKPOT IS THE OTHER HALF OF THE DROP (2026-09-06). The note above
    // named "rake plus BBJ drop" and only the rake was ever allocated, so the
    // tuner still had 5.6 bb/100 of house take that it read as a leak. Same
    // allocator, same contributions, so bbj_bb agrees with the money pipeline
    // exactly as rake_bb does.
    const bbjShares = allocateWeightedShareCents(Number(input.bbjAmount ?? 0), contributions);
    // A HAND IS EVERY HAND DEALT (2026-09-28). This used to skip a horse whose
    // invested and returned were both zero ("dealt in but never posted"), so
    // every hand a horse folded preflop without posting a blind vanished from
    // `hands`. Measured 2026-09-27 on one horse against hand_history: 3,101
    // cash hands dealt, horse_daily_play 3,101, horse_daily_nets 2,136 - and
    // fleet-wide nets ran at ~0.6x play every day. net_bb was right (such a
    // hand nets zero); the denominator was not, so every bb/100 built on it
    // was inflated about 1.45x, the tuner's 1,500-hand gate read two thirds
    // of the sample, and REGRESS_BB100 (-15) fired on horses near -10.
    // Dealt-in now means what horse_daily_play means by it: holding cards,
    // or - when the caller supplied no deal - having put chips in or taken
    // chips out. A seated player who was not dealt still does not count.
    const dealt = input.holeCardsAll;
    const dealtHorseIds = new Set<string>();
    for (const p of input.roster) {
      if (!p.isHorse || !p.userId) continue;
      const invested = input.contributions.get(p.userId) ?? 0;
      const returned = returnedBy.get(p.userId) ?? 0;
      const dealtIn = dealt.size > 0 ? dealt.has(p.userId) : invested !== 0 || returned !== 0;
      if (!dealtIn) continue;
      dealtHorseIds.add(p.userId);
      const key = `${p.userId}|${day}|${input.gameVariant}|${format}`;
      const acc = netAcc.get(key) ?? { hands: 0, netBB: 0, rakeBB: 0, bbjBB: 0 };
      acc.hands += 1;
      acc.netBB += (returned - invested) / bb;
      acc.rakeBB += (rakeShares.get(p.userId) ?? 0) / bb;
      acc.bbjBB += (bbjShares.get(p.userId) ?? 0) / bb;
      netAcc.set(key, acc);
    }
    accumulateHorsePlay(input, day, format, Number(input.vpipFloor ?? 0) > 0, dealtHorseIds);
    touchHorseSeats(input);
    if (netAcc.size > NET_ACC_MAX_KEYS) {
      // An outage has backed us up far beyond a realistic key space
      // (584 horses x variants x formats x a few days). Drop oldest-first
      // and SAY SO — silent loss is the house failure mode.
      let toDrop = netAcc.size - NET_ACC_MAX_KEYS;
      for (const k of netAcc.keys()) {
        if (toDrop-- <= 0) break;
        netAcc.delete(k);
      }
      reportError(
        new Error(`net accumulator overflow - dropped oldest keys (cap ${NET_ACC_MAX_KEYS})`),
        'HorseHandReview.netOverflow'
      );
    }
    if (!netFlushTimer) {
      // Started by the first settled hand, which may be a tournament table's:
      // bound to the process root so the one flush for every horse never
      // carries that tournament's authority (see bindToProcessRoot).
      netFlushTimer = setInterval(
        bindToProcessRoot(() => {
          void flushHorseNets().catch((err: unknown) =>
            reportError(err, 'HorseHandReview.netFlush')
          );
        }),
        NET_FLUSH_MS
      );
      netFlushTimer.unref?.();
    }
  } catch (err) {
    reportError(err, 'HorseHandReview.accumulateNets');
  }
}

/** Drain up to `max` accumulated keys into RPC row shapes (exported for tests). */
export interface HorseNetRow {
  horse_user_id: string;
  day: string;
  game_variant: string;
  format: string;
  hands: number;
  net_bb: number;
  rake_bb: number;
  /** the jackpot half of the drop, in bb (2026-09-06) */
  bbj_bb: number;
}

export function drainHorseNets(max: number = NET_BATCH_MAX): HorseNetRow[] {
  const rows: HorseNetRow[] = [];
  for (const [key, acc] of netAcc) {
    if (rows.length >= max) break;
    const [horse, day, variant, format] = key.split('|');
    rows.push({
      horse_user_id: horse,
      day,
      game_variant: variant,
      format,
      hands: acc.hands,
      net_bb: r2(acc.netBB),
      rake_bb: r2(acc.rakeBB),
      bbj_bb: r2(acc.bbjBB),
    });
    netAcc.delete(key);
  }
  return rows;
}

async function flushHorseNets(): Promise<void> {
  // The aggregates ride one timer; a quiet minute on one must not starve
  // the others.
  await flushHorsePlay().catch((err: unknown) => reportError(err, 'HorseHandReview.playFlush'));
  await flushSeatTouches().catch((err: unknown) =>
    reportError(err, 'HorseHandReview.seatTouchFlush')
  );
  const rows = drainHorseNets();
  if (rows.length === 0) return;
  const { error } = await supabase.rpc('fn_horse_daily_nets_add', { p_rows: rows });
  if (error) {
    reportError(new Error(error.message), 'HorseHandReview.netFlushRpc');
    // Merge the batch back so a transient outage loses nothing; the additive
    // upsert makes the eventual retry safe.
    for (const row of rows) {
      const key = `${row.horse_user_id}|${row.day}|${row.game_variant}|${row.format}`;
      const acc = netAcc.get(key) ?? { hands: 0, netBB: 0, rakeBB: 0, bbjBB: 0 };
      acc.hands += row.hands;
      acc.netBB += row.net_bb;
      acc.rakeBB += row.rake_bb;
      acc.bbjBB += row.bbj_bb;
      netAcc.set(key, acc);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HORSE DAILY PLAY (2026-09-05) - the tuner's frequencies, compiled here
// ═══════════════════════════════════════════════════════════════════════════
// HorseSelfTuner used to stream the newest 120,000 hand_history rows a night
// and re-derive VPIP / PFR / 3-bet / fold-to-3-bet / WWSF / postflop AF from
// the JSON. On a 263,000-hand day that is eleven hours, so only 383 of 1,000
// horses reached the 300-hand bar. The same accumulator (HorsePlayStats, the
// tuner's own code) now runs on every settled hand and the counts flush
// additively into horse_daily_play, keyed (horse, day, format). The tuner
// reads seven days of a horse in a handful of rows.

const playAcc = new Map<string, PlayStats>();

const playEnabled = (): boolean => process.env.HORSE_PLAY_ROLLUP_ENABLED !== 'false';

function accumulateHorsePlay(
  input: HorseReviewInput,
  day: string,
  format: string,
  floored: boolean,
  dealtHorseIds: ReadonlySet<string>
): void {
  try {
    if (!playEnabled()) return;
    // The same settled-hand population as nets. HorsePlayStats also reads
    // public action actors; that cannot admit an undealt roster member or
    // broaden the no-deal chip-movement fallback into every seated horse.
    const tracked = new Set(dealtHorseIds);
    if (tracked.size === 0) return;
    const players: HandRow['players'] = [];
    for (const [userId, seat] of input.holeCardsAll) players.push({ userId, seat: seat.seat });
    if (players.length === 0) for (const p of input.roster) players.push({ userId: p.userId });
    const row: HandRow = {
      actions: input.actions.map((a) => ({
        userId: a.userId,
        action: a.action,
        amount: a.amount,
        stage: a.stage,
        seat: a.seat,
        isFullRaise: a.isFullRaise,
        origin: a.origin,
        dead: a.dead,
        publicNode: a.publicNode,
      })),
      players,
      winners: input.winners,
      big_blind: input.bigBlind,
      button_seat: typeof input.buttonSeat === 'number' ? input.buttonSeat : null,
    };
    const delta = accumulatePlayStats([row], tracked, new Map());
    // A forced-only hand can end without an ActionRecord. Its dealt seats
    // still owe one denominator entry, exactly as the net accumulator does.
    for (const horse of tracked) {
      if (!delta.has(horse)) delta.set(horse, { ...freshPlay(), hands: 1 });
    }
    for (const [horse, d] of delta) {
      if (d.hands === 0) continue;
      const key = `${horse}|${day}|${format}|${floored ? 'f' : 'n'}`;
      const acc = playAcc.get(key);
      if (!acc) {
        playAcc.set(key, { ...d });
        continue;
      }
      acc.hands += d.hands;
      acc.vpip += d.vpip;
      acc.pfr += d.pfr;
      acc.threeBets += d.threeBets;
      acc.threeBetOpps += d.threeBetOpps;
      acc.openRaises += d.openRaises;
      acc.faced3Bets += d.faced3Bets;
      acc.foldTo3Bets += d.foldTo3Bets;
      acc.sawFlop += d.sawFlop;
      acc.wonWhenSawFlop += d.wonWhenSawFlop;
      acc.postAggr += d.postAggr;
      acc.postPassive += d.postPassive;
      acc.netBB += d.netBB;
    }
    if (playAcc.size > NET_ACC_MAX_KEYS) {
      let toDrop = playAcc.size - NET_ACC_MAX_KEYS;
      for (const k of playAcc.keys()) {
        if (toDrop-- <= 0) break;
        playAcc.delete(k);
      }
      reportError(
        new Error(`play accumulator overflow - dropped oldest keys (cap ${NET_ACC_MAX_KEYS})`),
        'HorseHandReview.playOverflow'
      );
    }
  } catch (err) {
    reportError(err, 'HorseHandReview.accumulatePlay');
  }
}

export interface HorsePlayRow {
  horse_user_id: string;
  day: string;
  format: string;
  /** the table carried a VPIP floor, so these frequencies are not comparable
   *  with the winning-player bands (2026-09-06) */
  floored: boolean;
  hands: number;
  vpip: number;
  pfr: number;
  three_bets: number;
  three_bet_opps: number;
  open_raises: number;
  faced_3bets: number;
  fold_to_3bets: number;
  saw_flop: number;
  won_when_saw_flop: number;
  post_aggr: number;
  post_passive: number;
}

/** Drain accumulated play counts into RPC row shapes (exported for tests). */
export function drainHorsePlay(max: number = NET_BATCH_MAX): HorsePlayRow[] {
  const rows: HorsePlayRow[] = [];
  for (const [key, s] of playAcc) {
    if (rows.length >= max) break;
    const [horse, day, format, fl] = key.split('|');
    rows.push({
      horse_user_id: horse,
      day,
      format,
      floored: fl === 'f',
      hands: s.hands,
      vpip: s.vpip,
      pfr: s.pfr,
      three_bets: s.threeBets,
      three_bet_opps: s.threeBetOpps,
      open_raises: s.openRaises,
      faced_3bets: s.faced3Bets,
      fold_to_3bets: s.foldTo3Bets,
      saw_flop: s.sawFlop,
      won_when_saw_flop: s.wonWhenSawFlop,
      post_aggr: s.postAggr,
      post_passive: s.postPassive,
    });
    playAcc.delete(key);
  }
  return rows;
}

async function flushHorsePlay(): Promise<void> {
  const rows = drainHorsePlay();
  if (rows.length === 0) return;
  const { error } = await supabase.rpc('fn_horse_daily_play_add', { p_rows: rows });
  if (error) {
    reportError(new Error(error.message), 'HorseHandReview.playFlushRpc');
    for (const row of rows) {
      const key = `${row.horse_user_id}|${row.day}|${row.format}|${row.floored ? 'f' : 'n'}`;
      const acc = playAcc.get(key);
      const back: PlayStats = {
        hands: row.hands,
        vpip: row.vpip,
        pfr: row.pfr,
        threeBets: row.three_bets,
        threeBetOpps: row.three_bet_opps,
        openRaises: row.open_raises,
        faced3Bets: row.faced_3bets,
        foldTo3Bets: row.fold_to_3bets,
        sawFlop: row.saw_flop,
        wonWhenSawFlop: row.won_when_saw_flop,
        postAggr: row.post_aggr,
        postPassive: row.post_passive,
        netBB: 0,
      };
      if (!acc) {
        playAcc.set(key, back);
        continue;
      }
      for (const k of Object.keys(back) as Array<keyof PlayStats>) acc[k] += back[k];
    }
  }
}

/**
 * The exact key set fn_hhr_record_atomic accepts: every HorseReviewRow
 * column, no more and no fewer. The function refuses unknown OR missing keys,
 * and JSON drops a key whose value is undefined, so a field left undefined
 * would reach the database as a missing key and refuse the whole hand. The
 * Record type makes the compiler fail here if the interface gains or loses a
 * column without this list following it.
 */
const REVIEW_ROW_KEY_SET: Record<keyof HorseReviewRow, true> = {
  hand_id: true,
  table_id: true,
  tournament_id: true,
  club_id: true,
  played_at: true,
  game_variant: true,
  format: true,
  big_blind: true,
  horse_user_id: true,
  seat: true,
  net_amount: true,
  net_bb: true,
  pot_size: true,
  hole_cards: true,
  board: true,
  actions: true,
  leak_tags: true,
};
export const REVIEW_ROW_KEYS = Object.keys(REVIEW_ROW_KEY_SET) as Array<keyof HorseReviewRow>;

/** One row as fn_hhr_record_atomic receives it: every key present, undefined -> null. */
export function toAtomicPayloadRow(row: HorseReviewRow): Record<keyof HorseReviewRow, unknown> {
  const out = {} as Record<keyof HorseReviewRow, unknown>;
  for (const k of REVIEW_ROW_KEYS) out[k] = row[k] === undefined ? null : row[k];
  return out;
}

interface AtomicReply {
  version: 1;
  rows: unknown[];
}

function isAtomicReply(v: unknown): v is AtomicReply {
  return (
    !!v &&
    typeof v === 'object' &&
    (v as { version?: unknown }).version === 1 &&
    Array.isArray((v as { rows?: unknown }).rows)
  );
}

function safeJson(v: unknown): string {
  try {
    return String(JSON.stringify(v)).slice(0, 300);
  } catch {
    return String(v);
  }
}

let pruneArmed = false;

/**
 * Record 20bb+ horse hands for review. Fire-and-forget, never throws.
 */
export async function recordHorseHandReviews(input: HorseReviewInput): Promise<void> {
  try {
    // V16: the real-nets aggregate sees EVERY hand, not just the 20bb flags,
    // and has its own kill switch (HORSE_NET_ROLLUP_ENABLED).
    if (!input.rollupsInAcceptedFacts) accumulateHorseNets(input);
    else touchHorseSeats(input);
    if (!enabled() || !input.handId) return;
    const rows = buildReviewRows(input);
    if (rows.length === 0) return;

    // ONE ATOMIC PUBLICATION (P14.1, 2026-10-06). The review rows, their
    // permanent receipts and the per-horse/day rollup are written by ONE
    // database function in ONE transaction. This used to be an upsert of the
    // reviews followed by one fn_hhr_rollup_add call per inserted horse: a
    // failed or unanswered second call left a review with no rollup (and the
    // `break` dropped every later horse's rollup with it), and a resend could
    // never reconcile it because the review already existed. Now either all
    // of it lands or none of it does, and a resend of the same hand - a
    // settlement retry, or a reply lost on the wire - finds its receipts and
    // answers 'replayed' without adding anything. So there is deliberately no
    // additive retry here: an error is reported and the hand is left to a
    // later resend, which is safe.
    const payload = rows.map(toAtomicPayloadRow);
    let reply: unknown;
    try {
      const { data, error } = await supabase.rpc('fn_hhr_record_atomic', { p_rows: payload });
      if (error) {
        reportError(new Error(error.message), 'HorseHandReview.record_atomic');
        return;
      }
      reply = data;
    } catch (err) {
      reportError(err, 'HorseHandReview.record_atomic');
      return;
    }
    if (!isAtomicReply(reply)) {
      reportError(
        new Error(`fn_hhr_record_atomic returned an unreadable reply: ${safeJson(reply)}`),
        'HorseHandReview.record_atomic'
      );
      return;
    }

    // Retention: prune once per process lifetime, well after boot.
    if (!pruneArmed) {
      pruneArmed = true;
      // ARMED BY A HAND, RUN FOR THE PROCESS (2026-09-11). The first hand to
      // flag a horse arms this, and that is a tournament table's hand as often
      // as a cash table's; a Node timer keeps the async context it was created
      // in. Unbound, the prune - a DELETE across every horse's review and
      // rollup rows - went out ten minutes later as that tournament's manager:
      // admitted under its lease while it still held one, refused
      // TOURNAMENT_MANAGER_FENCED once it had finished or lost it, which a Spin
      // or an SNG routinely does inside ten minutes. pruneArmed is never
      // reset, so retention then never ran again for the life of the process.
      // Bound to the process root, like the nets flush above.
      setTimeout(
        bindToProcessRoot(() => {
          // supabase-js builders are PromiseLike without .catch — wrap in a
          // real Promise so the rejection handler exists and is typed.
          void (async () => {
            const { error: perr } = await supabase.rpc('sp_prune_horse_hand_reviews');
            if (perr) reportError(new Error(perr.message), 'HorseHandReview.prune');
          })()
            .catch((err: unknown) => reportError(err, 'HorseHandReview.prune'))
            // RECEIPT RETENTION (20261008041150). The replay receipts are
            // pruned after the reviews, in their own statement: the review
            // prune already spends most of service_role's 8 s statement
            // timeout, and a receipt delete inside it could roll it back.
            // The receipt prune removes at most 25,000 receipts whose review
            // row is gone and whose hand is past the 30-day publication
            // horizon, so it runs whether or not the review prune succeeded.
            .then(async () => {
              const { error: rerr } = await supabase.rpc('sp_prune_horse_hand_review_receipts');
              if (rerr) reportError(new Error(rerr.message), 'HorseHandReview.prune_receipts');
            })
            .catch((err: unknown) => reportError(err, 'HorseHandReview.prune_receipts'));
        }),
        10 * 60 * 1000
      );
    }
  } catch (err) {
    reportError(err, 'HorseHandReview.record');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SEAT TOUCH (2026-09-05) - the fleet state says when a horse last acted
// ═══════════════════════════════════════════════════════════════════════════
// ca_horse_fleet_state.last_action_at was NULL on all 1,000 rows, and
// hands_this_session 0 on all, while 564 rows said "seated": the fleet
// manager's minute upsert never carried them and overwrote them with
// nothing. Settlement is the one place that sees every horse-hand, so it
// touches the seat here: one small row per horse per table per flush,
// through fn_ca_fleet_seat_touch, which adds hands and keeps the newest
// timestamp. The upsert now preserves what the touch wrote.

interface SeatTouch {
  hands: number;
  at: string;
}

const touchAcc = new Map<string, SeatTouch>();

const touchEnabled = (): boolean => process.env.HORSE_SEAT_TOUCH_ENABLED !== 'false';

function touchHorseSeats(input: HorseReviewInput): void {
  try {
    if (!touchEnabled() || !input.tableId || input.seatTouch === false) return;
    for (const p of input.roster) {
      if (!p.isHorse || !p.userId) continue;
      const key = `${p.userId}|${input.tableId}`;
      const acc = touchAcc.get(key) ?? { hands: 0, at: input.playedAt };
      acc.hands += 1;
      if (input.playedAt > acc.at) acc.at = input.playedAt;
      touchAcc.set(key, acc);
    }
    if (touchAcc.size > NET_ACC_MAX_KEYS) {
      let toDrop = touchAcc.size - NET_ACC_MAX_KEYS;
      for (const k of touchAcc.keys()) {
        if (toDrop-- <= 0) break;
        touchAcc.delete(k);
      }
    }
  } catch (err) {
    reportError(err, 'HorseHandReview.touchSeats');
  }
}

export interface SeatTouchRow {
  horse_id: string;
  table_id: string;
  hands: number;
  at: string;
}

/** Drain accumulated seat touches into RPC row shapes (exported for tests). */
export function drainSeatTouches(max: number = NET_BATCH_MAX): SeatTouchRow[] {
  const rows: SeatTouchRow[] = [];
  for (const [key, acc] of touchAcc) {
    if (rows.length >= max) break;
    const [horse, table] = key.split('|');
    rows.push({ horse_id: horse, table_id: table, hands: acc.hands, at: acc.at });
    touchAcc.delete(key);
  }
  return rows;
}

async function flushSeatTouches(): Promise<void> {
  const rows = drainSeatTouches();
  if (rows.length === 0) return;
  const { error } = await supabase.rpc('fn_ca_fleet_seat_touch', { p_rows: rows });
  if (error) {
    reportError(new Error(error.message), 'HorseHandReview.seatTouchRpc');
    for (const row of rows) {
      const key = `${row.horse_id}|${row.table_id}`;
      const acc = touchAcc.get(key) ?? { hands: 0, at: row.at };
      acc.hands += row.hands;
      if (row.at > acc.at) acc.at = row.at;
      touchAcc.set(key, acc);
    }
  }
}
