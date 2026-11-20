/**
 * OMAHA BIG-DRAW AGGRESSION (2026-11-15, PLO Strategy lane).
 *
 * Owner, 2026-11-15 11:55 Chicago (PLO Strategy chat): the Horses play their
 * combo draws and nut draws too conservatively; winning players play their
 * nut combination draws hard and fast, which gives them several ways to win
 * the pot instead of relying on hitting the card.
 *
 * Measured on the full human-table sweep (PLO4/PLO5 cash, 4,573 hands, 584
 * Horse flop and turn decisions with a big draw): facing a bet the Horse
 * raised 12 of 198 times (6%) and folded 61; checked to it bet 51% at about
 * half the pot (42% out of position, 39% multiway). The winning humans raised
 * the same draws 26% to 60% of the time and bet them at 80% to 100% of the
 * pot.
 *
 * This module is the one decision behind a NEW opt-in option
 * (HorseDecideOpts.omahaBigDrawAggression, read `=== true`, default OFF): for
 * a declared class of big draws, a check or a call is compared with a
 * pot-sized bet or raise by expected value, and the wager is made only when
 * its expected value is the higher one. It is not "always raise draws".
 *
 * BIG DRAW (omahaBigDraw; flop or turn, unpaired board, hero below trips):
 * outs are counted by enumeration of every unseen next card with the Omaha
 * two-card rule. A NUT out makes the nut flush or the nut straight on a board
 * that is still unpaired, the straight only when no flush is possible.
 *   nfd_wrap       nut flush draw and 9+ straight outs
 *   nfd_straight   nut flush draw and 8 straight outs
 *   nfd_pair       nut flush draw and top pair, an overpair or two pair
 *   nut_wrap       13+ straight outs, 9+ of them to the nuts
 *   pair_nut_wrap  top pair, an overpair or two pair and 9+ nut straight outs
 *   fd_nut_wrap    a flush draw below the nuts and 9+ nut straight outs
 * EXCLUDED, always today's play: a paired board; trips, a set or better (a
 * made hand); a bare gutshot or open-ender; a flush draw below the nuts
 * without nine nut straight outs; a bare nut flush draw (no pair, under eight
 * straight outs); the river and preflop; hi-lo, PLO6, tournaments, bomb pots,
 * several boards, all-in-or-fold, capped wagers; three or more opponents;
 * two opponents unless the draw is at the nut end (nutEnd: 70% or more of
 * its straight and flush outs are nut outs, at least nine of them); a
 * decision facing a raise of the Horse's own bet.
 *
 * EXPECTED VALUE (omahaBigDrawVerdict), chips relative to folding now, with
 * P the pot on the table, c the amount to call, T the wager (the pot-limit
 * maximum; the whole stack when a pot wager leaves no more than one resulting
 * pot behind on the flop or half of one on the turn, since a later street puts
 * it in anyway), cost what T costs the Horse and x what the caller adds:
 *   aggressive = F * P + (1 - F) * (E_called * (P + cost + x) - cost)
 *   check      = R * E_all * P
 *   call       = R * E_bet * (P + c) - c
 * F is the chance every opponent folds: each opponent's measured fold to a
 * bet (the posterior mean of his decayed counters, already shrunk to the
 * Horse mean when he is little known; the population prior without a read),
 * scaled down for a raise (a bettor folds his own bet to a raise 0.42 times
 * as often as a checker folds to a bet: 0.175 against 0.42 in the sweep).
 * E_called is the Horse's equity against the range that continues (two pair
 * or better, the nut flush draw, top pair or an overpair with a flush draw;
 * against a raise: trips or better, top two pair, the nut flush draw with a
 * pair), E_bet against the first of those ranges, E_all against any hand; all
 * three from one seeded sample of opponent hands and run-outs. R is the share
 * of a draw's equity realised passively: 1 in position, 0.8 out of position.
 * The wager is made when aggressive > passive + 2% of the pot and > 0.
 * Against a measured station (F low) with equity under the price of getting
 * it in, the passive line keeps the higher value and is kept.
 *
 * OWNER RULING 2026-11-15 12:30 Chicago: "RAISING WITH DRAWS SHOULD NEVER
 * HAPPEN OUT OF POSITION. ONLY IN POSITION WHEN ITS COMBO DRAWS, NOT NAKED
 * NUT FLUSH DRAWS." So this rule never raises out of position (any live
 * opponent acts after the Horse on later streets), raises in position only
 * with a combo draw (omahaComboDrawForRaise: a flush draw with a straight
 * draw of eight or more outs; since 2026-11-16 a pair with a nut flush draw
 * and a pair with a wrap are not combo draws), and adds no bet out of position
 * either (today's play stays). omahaDrawRaiseBar is the same ruling for the
 * brain's EXISTING draw raises (option omahaNoDrawRaiseOutOfPosition): a hand
 * below two pair with a flush draw or 8+ straight outs does not raise out of
 * position, and in position does not raise a bare flush draw (no top pair or
 * better, under eight straight outs; since 2026-11-16 any flush draw without
 * an eight-out straight draw, a pair or not). Two pair or better is a made hand and
 * is never barred.
 *
 * Pure: no state, no brain random draws, no telemetry.
 */
import type { Card, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import { RANKS, RANK_VALUES, SUITS } from './PokerEngine.js';
import { omahaRankMask, omahaStraightOutRanks } from './HorseOmahaCardImpact.js';
import { omahaNutStatus, scoreOmahaHi, scoreOmahaHiPartial, variantInfo } from './HorseEval.js';
import {
  omahaCategoricalCashOnlyExcludes,
  omahaIcmPremiumOf,
} from './HorseOmahaTournamentScope.js';
import {
  omahaStrategyGameInScope,
  omahaStrategyConstant,
  omahaStrategyHoleCount,
  omahaStrategyHoleCountServed,
} from './HorseOmahaStrategyGame.js';

export const OMAHA_BIG_DRAW_VARIANTS: ReadonlySet<string> = new Set(['plo4', 'plo5']);
/** Fold to a bet when no read exists. The sweep's humans, heads-up, folded to
 * a Horse bet of 70% of the pot or more 120 of 297 times on the flop and 113
 * of 254 on the turn (0.42 pooled). */
export const OMAHA_BIG_DRAW_PRIOR_FOLD_TO_BET = 0.42;
/** A bettor facing a raise folds this share as often as a checker facing a
 * bet. The sweep's humans, heads-up, folded their own bet to a Horse raise 20
 * of 114 times (0.175): 0.42 of the fold to a bet. The opponent memory keeps
 * no fold-to-raise counter, so the measured fold to a bet is scaled. */
export const OMAHA_BIG_DRAW_RAISE_FOLD_SCALE = 0.42;
/** Share of a draw's equity realised by the passive line out of position. */
export const OMAHA_BIG_DRAW_OOP_REALISATION = 0.8;
/** The wager must beat the passive line by this share of the pot. */
export const OMAHA_BIG_DRAW_MARGIN = 0.02;
export const OMAHA_BIG_DRAW_SAMPLES = 700;
export const OMAHA_BIG_DRAW_RUNOUTS = 3;
/** Nut-out share of a draw's outs that makes it the nut end (two opponents). */
export const OMAHA_BIG_DRAW_NUT_END_SHARE = 0.7;

export type OmahaBigDrawClass =
  | 'nfd_wrap'
  | 'nfd_straight'
  | 'nfd_pair'
  | 'nut_wrap'
  | 'pair_nut_wrap'
  | 'fd_nut_wrap';

export interface OmahaBigDraw {
  cls: OmahaBigDrawClass;
  /** unseen next cards that make the nut flush or the nut straight (board unpaired) */
  nutOuts: number;
  nutFlushOuts: number;
  nutStraightOuts: number;
  /** unseen next cards that make any straight */
  straightOuts: number;
  /** unseen next cards that make any flush */
  flushOuts: number;
  /** top pair, an overpair or two pair now */
  pair: boolean;
  /** at least nine nut outs and 70% of the straight and flush outs are nut outs */
  nutEnd: boolean;
}

const key = (c: Card): string => `${c.rank}:${c.suit}`;
const rv = (c: Card): number => RANKS.indexOf(c.rank);
const catOf = (hole: Card[], board: Card[]): number =>
  Math.floor(scoreOmahaHiPartial(hole, board) / 0x100000);
const unpaired = (board: readonly Card[]): boolean =>
  new Set(board.map((c) => c.rank)).size === board.length;

function unseenDeck(seen: readonly Card[]): Card[] {
  const s = new Set(seen.map(key));
  const out: Card[] = [];
  for (const rank of RANKS)
    for (const suit of SUITS) {
      const c = { rank, suit } as Card;
      if (!s.has(key(c))) out.push(c);
    }
  return out;
}

/** Top pair (a hole card pairs the highest board rank), an overpair, or two pair. */
function strongPair(hole: readonly Card[], board: readonly Card[], cat: number): boolean {
  if (cat === 3) return true;
  if (cat !== 2) return false;
  const top = Math.max(...board.map(rv));
  if (hole.some((c) => rv(c) === top)) return true;
  const n = new Map<number, number>();
  for (const c of hole) n.set(rv(c), (n.get(rv(c)) ?? 0) + 1);
  for (const [r, k] of n) if (k >= 2 && r > top) return true;
  return false;
}

/** Next-card outs by enumeration with the two-card rule. */
function drawOuts(h: Card[], b: Card[], dead: readonly Card[]) {
  let nutFlushOuts = 0;
  let nutStraightOuts = 0;
  let straightOuts = 0;
  let flushOuts = 0;
  for (const card of unseenDeck([...h, ...b, ...dead])) {
    const next = [...b, card];
    const st = omahaNutStatus(h, next);
    if (st.category === 6) {
      flushOuts++;
      if (st.higherFlushRanks === 0 && unpaired(next)) nutFlushOuts++;
    } else if (st.category === 5) {
      straightOuts++;
      if (st.straightIsNut && !st.flushPossible && unpaired(next)) nutStraightOuts++;
    }
  }
  return { nutFlushOuts, nutStraightOuts, straightOuts, flushOuts };
}

/**
 * In position after the flop: no live opponent acts after hero on a later
 * street (the button, or the live seat nearest before it, acts last).
 */
export function omahaHeroInPosition(
  heroSeat: number,
  dealerSeat: number | null | undefined,
  liveOpponentSeats: readonly number[]
): boolean {
  if (typeof dealerSeat !== 'number' || !Number.isFinite(dealerSeat)) return false;
  const after = (seat: number): number => (((seat - dealerSeat - 1) % 32) + 32) % 32;
  return liveOpponentSeats.every((s) => after(s) < after(heroSeat));
}

/**
 * THE ONE DEFINITION of the combo draw that may raise in position (owner
 * rulings 2026-11-15 12:30 Chicago, "only in position when its combo draws,
 * not naked nut flush draws", and 12:52, turn and river facing a bet raise
 * only with the nuts; made precise 2026-11-16, review note on item 7): a hand
 * below two pair holding a flush draw (five or more flush outs) TOGETHER with
 * a straight draw of eight or more outs, a 13+ out wrap with a flush draw
 * included. A made pair adds nothing: a pair with a nut flush draw is not a
 * combo draw, nor a pair with a nut flush draw and a gutshot (it does not
 * raise: the draw-raise bar makes the raise a call), nor
 * a pair with a wrap and no flush draw, nor a bare flush draw or a bare wrap.
 * Straight outs here are counted by rank under the two-card rule, a card that
 * also completes the flush included (omahaComboStraightOuts), so the flush
 * cards of an open-ender are not lost to the flush. Used by the draw-raise bar
 * here (omahaNoDrawRaiseOutOfPosition), by omahaBigDrawVerdict's in-position
 * raise (omahaBigDrawAggression) and by omahaTurnRiverRaiseNeedsNuts's turn
 * exception.
 */
export function omahaComboDrawForRaise(
  hole: readonly Card[],
  board: readonly Card[],
  dead: readonly Card[] = []
): boolean {
  try {
    const h = [...hole];
    const b = [...board];
    if (b.length !== 3 && b.length !== 4) return false;
    if (catOf(h, b) >= 3) return false;
    const o = drawOuts(h, b, dead);
    if (o.flushOuts < 5) return false;
    const straight = omahaComboStraightOuts(hole, board, dead);
    return straight >= 8 || straight >= OMAHA_COMBO_WRAP_OUTS;
  } catch {
    return false;
  }
}

/** A wrap: thirteen or more straight outs (with a flush draw, a combo draw;
 * every wrap is also an eight-out straight draw, so this names the case). */
export const OMAHA_COMBO_WRAP_OUTS = 13;

/**
 * Unseen next cards that give the hand a straight under the two-card rule,
 * counted by rank (a card that also completes a flush is counted), less the
 * hand's own copies and the known dead cards of each such rank.
 */
export function omahaComboStraightOuts(
  hole: readonly Card[],
  board: readonly Card[],
  dead: readonly Card[] = []
): number {
  const seen = new Set([...hole, ...board, ...dead].map(key));
  let outs = 0;
  for (const r of omahaStraightOutRanks(omahaRankMask(hole), omahaRankMask(board)))
    for (const suit of SUITS)
      for (const rank of RANKS) if (RANK_VALUES[rank] === r && !seen.has(`${rank}:${suit}`)) outs++;
  return outs;
}

export type OmahaDrawRaiseBar = 'out_of_position' | 'bare_flush_draw' | 'bare_straight_draw';

/**
 * The owner ruling of 2026-11-15 12:30 for a raise the brain is about to make
 * on a PLO4/PLO5 cash flop or turn: 'out_of_position' or 'bare_flush_draw'
 * when the hand is a draw (below two pair, with a flush draw or 8+ straight
 * outs) that may not raise, 'bare_straight_draw' for a bare straight draw or
 * wrap in position; null when the raise stands (a made hand, no draw, a combo
 * draw in position, or outside the rule's games).
 */
export function omahaDrawRaiseBar(i: {
  variant: string;
  street: string;
  hole: readonly Card[];
  board: readonly Card[];
  dead?: readonly Card[];
  inPosition: boolean;
  hiLo: boolean;
  multiBoard: boolean;
  bombPot: boolean;
  tournament: boolean;
  allInOrFold: boolean;
}): OmahaDrawRaiseBar | null {
  try {
    if (!omahaStrategyGameInScope(OMAHA_BIG_DRAW_VARIANTS, { gameVariant: i.variant })) return null;
    if (i.street !== 'flop' && i.street !== 'turn') return null;
    if (i.hiLo || i.multiBoard || i.bombPot || i.tournament || i.allInOrFold) return null;
    if (i.hole.length !== omahaStrategyHoleCount({ gameVariant: i.variant })) return null;
    if (i.board.length !== 3 && i.board.length !== 4) return null;
    const h = [...i.hole];
    const b = [...i.board];
    const cat = catOf(h, b);
    if (cat >= 3) return null;
    const o = drawOuts(h, b, i.dead ?? []);
    const flush = o.flushOuts >= 5;
    if (!flush && o.straightOuts < 8) return null;
    if (!i.inPosition) return 'out_of_position';
    if (omahaComboDrawForRaise(i.hole, i.board, i.dead ?? [])) return null;
    return flush ? 'bare_flush_draw' : 'bare_straight_draw';
  } catch {
    return null;
  }
}

/** omahaDrawRaiseBar for a decision state (null: the raise stands). */
export function omahaDrawRaiseBarOf(
  player: SeatPlayer,
  gs: HorseGameStateV2
): OmahaDrawRaiseBar | null {
  try {
    const live = (gs.players ?? []).filter(
      (p) => p.seat !== player.seat && !p.is_folded && !p.is_sitting_out
    );
    if (live.length === 0) return null;
    return omahaDrawRaiseBar({
      variant: String(gs.gameVariant ?? ''),
      street: String(gs.stage ?? ''),
      hole: player.cards ?? [],
      board: gs.communityCards ?? [],
      dead: player.knownDeadCards ?? [],
      inPosition: omahaHeroInPosition(
        player.seat,
        gs.dealerSeat,
        live.map((p) => p.seat)
      ),
      hiLo: gs.variantRules
        ? gs.variantRules.splitLow8OrBetter
        : variantInfo(gs.gameVariant).isHiLo,
      multiBoard: !!(gs.communityCards2?.length || gs.communityCards3?.length),
      bombPot: gs.bombPot === true,
      // HorseLogic.isTournamentMode: the engine's explicit mode wins;
      // omahaStrategyInTournaments opens its public tournament scope; the bar is a
      // categorical rule (omahaTournamentsExcludeCategoricalRules on: never in a tournament).
      tournament: omahaCategoricalCashOnlyExcludes(player, gs),
      allInOrFold: gs.allInOrFold === true,
    });
  } catch {
    return null;
  }
}

/**
 * The big draw the hand holds on a flop or turn, or null (see the exclusions
 * in the file header). `dead` cards are removed from the outs.
 */
export function omahaBigDraw(
  hole: readonly Card[],
  board: readonly Card[],
  dead: readonly Card[] = []
): OmahaBigDraw | null {
  try {
    if (!Array.isArray(hole) || !omahaStrategyHoleCountServed(hole.length)) return null;
    if (!Array.isArray(board) || (board.length !== 3 && board.length !== 4)) return null;
    if (!unpaired(board)) return null;
    const h = [...hole];
    const b = [...board];
    const cat = catOf(h, b);
    if (cat >= 4 || cat < 1) return null;
    const { nutFlushOuts, nutStraightOuts, straightOuts, flushOuts } = drawOuts(h, b, dead);
    const nfd = nutFlushOuts >= 5;
    const fd = flushOuts >= 5;
    const pair = strongPair(hole, board, cat);
    const nutOuts = nutFlushOuts + nutStraightOuts;
    let cls: OmahaBigDrawClass | null = null;
    if (nfd && straightOuts >= 9) cls = 'nfd_wrap';
    else if (nfd && straightOuts >= 8) cls = 'nfd_straight';
    else if (nfd && pair) cls = 'nfd_pair';
    else if (straightOuts >= 13 && nutStraightOuts >= 9) cls = 'nut_wrap';
    else if (pair && nutStraightOuts >= 9) cls = 'pair_nut_wrap';
    else if (fd && nutStraightOuts >= 9) cls = 'fd_nut_wrap';
    if (cls === null) return null;
    const all = straightOuts + flushOuts;
    return {
      cls,
      nutOuts,
      nutFlushOuts,
      nutStraightOuts,
      straightOuts,
      flushOuts,
      pair,
      nutEnd: nutOuts >= 9 && all > 0 && nutOuts / all >= OMAHA_BIG_DRAW_NUT_END_SHARE,
    };
  } catch {
    return null;
  }
}

function seedOf(cards: readonly Card[]): number {
  let h = 2166136261;
  for (const c of cards)
    for (const ch of key(c)) {
      h ^= ch.charCodeAt(0);
      h = Math.imul(h, 16777619);
    }
  return h >>> 0 || 1;
}

function generator(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The flush-draw suits of a board (exactly two cards) and the highest rank of each not on it. */
function drawSuits(board: readonly Card[]): Array<{ suit: string; top: number }> {
  const out: Array<{ suit: string; top: number }> = [];
  for (const suit of SUITS) {
    const on = board.filter((c) => c.suit === suit);
    if (on.length !== 2) continue;
    let top = RANKS.length - 1;
    while (on.some((c) => rv(c) === top)) top--;
    out.push({ suit, top });
  }
  return out;
}

/**
 * The straight outs at which an opponent hand that holds nothing else of the
 * continuing range continues against a bet; 0: straight draws are not in the
 * continuing range (PLO4/PLO5, as the option was measured). Read per game
 * through omahaStrategyConstant('bigDrawContinueStraightOuts'); the PLO6
 * lane's value is 13, the wrap line of omahaBigDraw (H15).
 */
export const OMAHA_BIG_DRAW_CONTINUE_STRAIGHT_OUTS = 0;

/**
 * The next cards that give this hand a straight under the two-card rule: for
 * every rank that completes one, the four cards of it less the copies the
 * hand holds itself. By rank (a card that also completes a flush is counted).
 */
export function omahaBigDrawStraightOutCards(opp: readonly Card[], board: readonly Card[]): number {
  let outs = 0;
  for (const r of omahaStraightOutRanks(omahaRankMask(opp), omahaRankMask(board)))
    outs += 4 - opp.filter((c) => RANK_VALUES[c.rank] === r).length;
  return outs;
}

/**
 * 0 = does not continue; 1 = continues against a bet; 2 = continues against a raise too.
 * `straightOutsToContinue` (default 0: off, the range as it was): a hand
 * outside the range with at least that many straight outs continues against a bet.
 */
export function omahaBigDrawContinues(
  opp: readonly Card[],
  board: readonly Card[],
  straightOutsToContinue = 0
): 0 | 1 | 2 {
  const cat = catOf([...opp], [...board]);
  if (cat >= 4) return 2;
  let fd = false;
  let nfd = false;
  for (const { suit, top } of drawSuits(board)) {
    const mine = opp.filter((c) => c.suit === suit);
    if (mine.length < 2) continue;
    fd = true;
    if (mine.some((c) => rv(c) === top)) nfd = true;
  }
  if (cat === 3) {
    const ranks = [...new Set(board.map(rv))].sort((a, b) => b - a);
    const topTwo = ranks.slice(0, 2).every((r) => opp.some((c) => rv(c) === r));
    return topTwo || nfd ? 2 : 1;
  }
  if (nfd) return cat === 2 ? 2 : 1;
  if (cat === 2 && fd && strongPair(opp, board, cat)) return 1;
  if (
    straightOutsToContinue > 0 &&
    omahaBigDrawStraightOutCards(opp, board) >= straightOutsToContinue
  )
    return 1;
  return 0;
}

export interface OmahaBigDrawEquities {
  /** against any hand */
  all: number;
  /** against the range that continues against a bet (also the betting range faced) */
  bet: number;
  /** against the range that continues against a raise */
  raise: number;
}

/**
 * The sample behind omahaBigDrawEquities, by range: index 0 any hand, 1 the range that continues
 * against a bet, 2 the range that continues against a raise (each range holds the next). `got` the
 * opponent hands counted, `won` the Horse's share summed over them. Filled only when the caller
 * passes one (omahaSampledRaiseIsPricedAtEverySize); the three shares returned do not depend on it.
 */
export interface OmahaBigDrawCounts {
  got: number[];
  won: number[];
}

/**
 * Hero's showdown share (ties half) against one opponent hand, by one seeded
 * sample of opponent hands and run-outs, split by the range the opponent hand
 * is in. A range with too few samples takes the wider range's figure. Null
 * when the deck cannot fill a sample.
 */
export function omahaBigDrawEquities(
  hole: readonly Card[],
  board: readonly Card[],
  dead: readonly Card[] = [],
  samples: number = OMAHA_BIG_DRAW_SAMPLES,
  counts?: OmahaBigDrawCounts
): OmahaBigDrawEquities | null {
  const deck = unseenDeck([...hole, ...board, ...dead]);
  const size = hole.length;
  const need = 5 - board.length;
  if (need < 1 || deck.length < size + need) return null;
  const rnd = generator(seedOf([...hole, ...board]));
  const draw = (n: number, from: Card[], start: number): void => {
    for (let i = start; i < start + n; i++) {
      const j = i + Math.floor(rnd() * (from.length - i));
      const t = from[i]!;
      from[i] = from[j]!;
      from[j] = t;
    }
  };
  const won = [0, 0, 0];
  const got = [0, 0, 0];
  const h = [...hole];
  // Straight draws in the continuing range: none in PLO4/PLO5 (the key reads 0).
  const continueStraightOuts = omahaStrategyConstant('bigDrawContinueStraightOuts', {
    gameVariant: `plo${size}`,
  });
  for (let k = 0; k < samples; k++) {
    const d = deck.slice();
    draw(size, d, 0);
    const opp = d.slice(0, size);
    const level = omahaBigDrawContinues(opp, board, continueStraightOuts);
    let share = 0;
    for (let r = 0; r < OMAHA_BIG_DRAW_RUNOUTS; r++) {
      draw(need, d, size);
      const run = [...board, ...d.slice(size, size + need)];
      const a = scoreOmahaHi(h, run);
      const o = scoreOmahaHi(opp, run);
      share += a > o ? 1 : a === o ? 0.5 : 0;
    }
    share /= OMAHA_BIG_DRAW_RUNOUTS;
    for (let lv = 0; lv <= level; lv++) {
      won[lv]! += share;
      got[lv]!++;
    }
  }
  if (got[0]! === 0) return null;
  const all = won[0]! / got[0]!;
  const bet = got[1]! >= 40 ? won[1]! / got[1]! : all;
  const raise = got[2]! >= 40 ? won[2]! / got[2]! : bet;
  if (counts) {
    counts.got = got;
    counts.won = won;
  }
  return { all, bet, raise };
}

/**
 * omahaBluffIsPricedAgainstTheTarget (default OFF): the river twin of omahaBigDrawEquities. On a
 * complete board no run-out is dealt: one seeded sample of opponent hands from the unseen cards (the
 * same stream, seeded from the Horse's cards and the board, never the brain's random stream), the
 * Horse's showdown share (ties half) against each. The shares are returned ordered by the opponent
 * hand's own strength on the board, strongest first, so a caller can take the share against the
 * strongest part of the range. Null unless the board is five cards and the deck fills a sample.
 */
export function omahaBigDrawRiverShares(
  hole: readonly Card[],
  board: readonly Card[],
  dead: readonly Card[] = [],
  samples: number = OMAHA_BIG_DRAW_SAMPLES
): { all: number; strongestFirst: number[] } | null {
  if (board.length !== 5) return null;
  const deck = unseenDeck([...hole, ...board, ...dead]);
  const size = hole.length;
  if (size < 2 || deck.length < size) return null;
  const rnd = generator(seedOf([...hole, ...board]));
  const mine = scoreOmahaHi([...hole], [...board]);
  const rows: Array<{ o: number; share: number }> = [];
  for (let k = 0; k < samples; k++) {
    const d = deck.slice();
    for (let i = 0; i < size; i++) {
      const j = i + Math.floor(rnd() * (d.length - i));
      const t = d[i]!;
      d[i] = d[j]!;
      d[j] = t;
    }
    const o = scoreOmahaHi(d.slice(0, size), [...board]);
    rows.push({ o, share: mine > o ? 1 : mine === o ? 0.5 : 0 });
  }
  if (rows.length === 0) return null;
  const all = rows.reduce((a, r) => a + r.share, 0) / rows.length;
  rows.sort((a, b) => b.o - a.o);
  return { all, strongestFirst: rows.map((r) => r.share) };
}

export interface OmahaBigDrawInput {
  variant: string;
  street: string;
  hole: readonly Card[];
  board: readonly Card[];
  dead?: readonly Card[];
  /** the decision examined: only a check or a call can change */
  action: string;
  /** omahaDrawRaiseIsPriced: position and the combo-draw class are not bars; out of position the
   *  called wager realizes OMAHA_BIG_DRAW_OOP_REALISATION of its share when chips stay behind. */
  priced?: boolean;
  /** chips on the table, the wager faced included */
  pot: number;
  toCall: number;
  /** hero's chips behind and already in on this street */
  stack: number;
  heroBet: number;
  currentBet: number;
  /** the pot-limit maximum wager ("to" amount) and the minimum */
  minRaiseTo: number;
  maxRaiseTo: number;
  legalActions: readonly string[];
  /** every live opponent: chips behind, chips in on this street, all-in, fold to a bet (null: no read) */
  opponents: ReadonlyArray<{
    stack: number;
    bet: number;
    allIn: boolean;
    foldToBet: number | null;
  }>;
  inPosition: boolean;
  hiLo: boolean;
  multiBoard: boolean;
  bombPot: boolean;
  tournament: boolean;
  allInOrFold: boolean;
  wagersCapped: boolean;
  /**
   * omahaStrategyInTournaments: the engine's tournament survival premium
   * (icmRisk, HorseOmahaTournamentScope.omahaTournamentIcmRisk); 0 or absent
   * in cash. Each line is charged premium x sqrt(stack share risked) on the
   * money at stake when it goes to showdown.
   */
  icmRisk?: number;
  /**
   * Lazy pricing (2026-11-16): asked with the one wager the verdict could
   * make (its action and chips are fixed before any equity is counted),
   * true when a later owner-ruled or street-plan check would replace that
   * wager in the final decision anyway. The verdict then returns withheld
   * 'final_check' without counting the equities: the final decision is the
   * check either way. Absent, or false, the verdict is priced as before.
   */
  finalCheckVetoes?: (wager: { action: 'bet' | 'raise' | 'all_in'; amount?: number }) => boolean;
  /**
   * omahaBetSizeByPublicState (wave two): the public size of this wager, a
   * raise-to amount or the all-in. Present, it is the size priced and
   * returned in place of the pot-sized wager. Absent: as before.
   */
  publicTo?: number | 'all_in';
}

export type OmahaBigDrawWithheld =
  | 'multiway'
  | 'not_nut_end'
  | 'no_wager'
  | 'reraise'
  | 'out_of_position'
  | 'not_combo'
  | 'no_equity'
  | 'passive_ev'
  | 'final_check';

export interface OmahaBigDrawVerdict {
  draw: OmahaBigDraw;
  /** the wager to make, or null: the passive decision stands */
  wager: { action: 'bet' | 'raise' | 'all_in'; amount?: number } | null;
  withheld: OmahaBigDrawWithheld | null;
  foldEquity: number;
  equities: OmahaBigDrawEquities | null;
  evAggressive: number;
  evPassive: number;
}

const fin = (v: unknown): number => (Number.isFinite(v) ? Math.max(0, v as number) : 0);

/**
 * The verdict for one decision, or null when the spot or the hand is outside
 * the rule (nothing to report). A non-null verdict with `wager === null`
 * names why the passive decision stands.
 */
export function omahaBigDrawVerdict(i: OmahaBigDrawInput): OmahaBigDrawVerdict | null {
  if (!omahaStrategyGameInScope(OMAHA_BIG_DRAW_VARIANTS, { gameVariant: i.variant })) return null;
  if (i.street !== 'flop' && i.street !== 'turn') return null;
  if (i.hiLo || i.multiBoard || i.bombPot || i.tournament || i.allInOrFold || i.wagersCapped)
    return null;
  if (i.action !== 'check' && i.action !== 'call') return null;
  const pot = fin(i.pot);
  const toCall = fin(i.toCall);
  const stack = fin(i.stack);
  const heroBet = fin(i.heroBet);
  if (pot <= 0 || stack <= 0 || i.opponents.length === 0) return null;
  if (i.action === 'check' ? toCall > 0.005 : toCall <= 0.005) return null;
  if (i.opponents.some((o) => o.allIn || fin(o.stack) <= 0)) return null;
  const draw = omahaBigDraw(i.hole, i.board, i.dead ?? []);
  if (draw === null) return null;
  const held = (withheld: OmahaBigDrawWithheld, extra: Partial<OmahaBigDrawVerdict> = {}) => ({
    draw,
    wager: null,
    withheld,
    foldEquity: 0,
    equities: null,
    evAggressive: 0,
    evPassive: 0,
    ...extra,
  });
  if (i.opponents.length >= 3) return held('multiway');
  if (i.opponents.length === 2 && !draw.nutEnd) return held('not_nut_end');
  if (toCall > 0.005 && heroBet > 0.005) return held('reraise');
  // Owner 2026-11-15 12:30: no draw raise and no new draw lead out of
  // position; in position a raise only with a combo draw.
  if (!i.inPosition && i.priced !== true) return held('out_of_position');
  if (toCall > 0.005 && i.priced !== true && !omahaComboDrawForRaise(i.hole, i.board, i.dead ?? []))
    return held('not_combo');
  const facing = toCall > 0.005;
  const total = heroBet + stack;
  const max = fin(i.maxRaiseTo);
  const min = fin(i.minRaiseTo);
  const legal = (a: string) => i.legalActions.includes(a);
  const wagerAction = facing ? 'raise' : 'bet';
  if (!(max > fin(i.currentBet) + 0.005) || max < min) return held('no_wager');
  if (!legal(wagerAction) && !legal('all_in')) return held('no_wager');
  // The most any opponent can match.
  const cover = Math.max(...i.opponents.map((o) => fin(o.stack) + fin(o.bet)));
  let to = Math.min(max, total);
  let jam: boolean;
  if (i.publicTo !== undefined) {
    // omahaBetSizeByPublicState: the public size is the one size this wager
    // will have, so it is the size priced (the stack where it commits).
    to = i.publicTo === 'all_in' ? total : Math.min(total, fin(i.publicTo));
    jam = to >= total - 0.005;
  } else {
    // A pot wager that leaves a later street all in anyway is the whole stack.
    const costPot = to - heroBet;
    const xPot = Math.max(0, Math.min(to, cover) - fin(i.currentBet));
    const behind = total - to;
    const potAfter = pot + costPot + xPot;
    jam = to >= total - 0.005 || behind <= (i.street === 'flop' ? 1 : 0.5) * potAfter + 0.005;
  }
  if (jam) to = total;
  if (jam && !legal('all_in')) {
    if (!legal(wagerAction)) return held('no_wager');
    to = Math.min(max, total);
  } else if (!jam && !legal(wagerAction)) return held('no_wager');
  const matched = Math.min(to, cover);
  if (!(matched > fin(i.currentBet) + 0.005)) return held('no_wager');
  const cost = matched - heroBet;
  const x = matched - fin(i.currentBet);
  // The only wager this verdict can return, known before the equities.
  const allIn = jam && legal('all_in') && to >= total - 0.005;
  const wager: { action: 'bet' | 'raise' | 'all_in'; amount?: number } = allIn
    ? { action: 'all_in' }
    : { action: wagerAction, amount: Math.round(Math.max(min, to) * 100) / 100 };
  if (i.finalCheckVetoes !== undefined && i.finalCheckVetoes(wager)) return held('final_check');
  const equities = omahaBigDrawEquities(i.hole, i.board, i.dead ?? []);
  if (equities === null) return held('no_equity');
  let foldEquity = 1;
  for (const o of i.opponents) {
    const f = Math.min(0.95, Math.max(0, o.foldToBet ?? OMAHA_BIG_DRAW_PRIOR_FOLD_TO_BET));
    foldEquity *= facing ? f * OMAHA_BIG_DRAW_RAISE_FOLD_SCALE : f;
  }
  const called = facing ? equities.raise : equities.bet;
  const risk = Number.isFinite(i.icmRisk) && (i.icmRisk as number) > 0 ? (i.icmRisk as number) : 0;
  const stackNow = fin(i.stack);
  const charge = (chips: number, atStake: number): number =>
    risk > 0 ? omahaIcmPremiumOf(risk, chips, stackNow) * atStake : 0;
  const evAggressive =
    foldEquity * pot +
    (1 - foldEquity) *
      ((i.priced === true && !i.inPosition && !jam ? OMAHA_BIG_DRAW_OOP_REALISATION : 1) *
        called *
        (pot + cost + x) -
        cost -
        charge(cost, pot + cost + x));
  const realised = i.inPosition ? 1 : OMAHA_BIG_DRAW_OOP_REALISATION;
  const evPassive = facing
    ? realised * equities.bet * (pot + toCall) - toCall - charge(toCall, pot + toCall)
    : realised * equities.all * pot;
  const numbers = { foldEquity, equities, evAggressive, evPassive };
  if (
    !(
      evAggressive >
      evPassive + omahaStrategyConstant('bigDrawMargin', { gameVariant: i.variant }) * pot
    ) ||
    !(evAggressive > 0)
  )
    return held('passive_ev', numbers);
  return {
    draw,
    wager,
    withheld: null,
    ...numbers,
  };
}
