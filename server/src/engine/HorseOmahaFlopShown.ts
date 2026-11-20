/**
 * WHAT A FLOP BET SHOWED, AND WHAT CALLING IT RETURNED (Horse decisions lane, 2026-11-19).
 *
 * The flop facing-bet verdict (omahaFlopFacingBetEv, default off) prices a call against the bettor's range. A
 * read of his flop bet FREQUENCIES alone (HorseOmahaStreetRead: how often he bets a texture) was measured on
 * the 563 audited decisions and made the verdict worse (fixed 1, newly wrong 4; archive
 * plo-handoff-review-01a1cbbd/flopread-01TLQer7J). What the verdict lacks is not how often he bets but WHAT he
 * holds when he does, and what calls of his bets actually returned (flopev3-013U37/FINDINGS.md RC2 and RC3:
 * one regular's flop bets paid a caller's draws out of position -0.39 where the population paid 0.95).
 *
 * This module keeps both, per opponent, from PUBLIC information only:
 *
 *  BET   When he made the FIRST bet of the flop and his hand was shown at the showdown, the class of that hand
 *        on the flop (nut class, strong made, weak made, strong draw, air), kept apart by his line (the last
 *        preflop raiser's continuation bet, or any other first bet) and by the flop's texture.
 *  CALL  For each player who CALLED that first bet before anyone raised it: what the caller paid for the call
 *        and what the hand returned to him from the call on (his payout less everything he put in from the
 *        call), kept apart by who called (a Horse or a person) and by the caller's class and position. The
 *        class is the flop verdict's own (HorseOmahaFlopFacingBetEv.omahaFlopHandClass: made, draw, one pair
 *        or less) and is known only when the caller's hand was shown; a caller whose hand was never shown is
 *        counted in the `unshown` cell, so the record says how much of the money the class cells do not see.
 *
 * PUBLIC ONLY. A hand counts as shown when the hand's public record holds it: hand_history.hole_cards (written
 * from the showdown's revealed holdings only; a mucked or folded hand is never stored there) names the player,
 * and hand_history.showdown lists him as not mucked. A folded player's cards are never read; nothing here is
 * passed a private card. Money is replayed from the public action log and the public winners list.
 *
 * SELECTION. The class cells see only hands that reached a showdown and were tabled. A caller who called the
 * flop and folded a later street is in `unshown`, never in a class cell, so the class cells are biased toward
 * calls that continued. A consumer must weigh them with the `unshown` cell beside them.
 *
 * SMALL AND BOUNDED. Every stored number is an integer. A count is kept in thousandths; a cell ages only on a
 * hand that gave it evidence, by 977/1000 (a half-life of 29.8 such hands), truncated, so a count never exceeds
 * 50 000 and the record never grows. Money is hundredths of a big blind.
 *
 * MEASUREMENT ONLY. The accepted-hand database learner keeps the record beside the exact opponent profile
 * (horse_exact_profiles.flop_shown, migration 20261119192551; public.fn_horse_flop_shown_class, fn_horse_flop_shown_increments and
 * fn_horse_flop_shown_add are the SQL twins of flopShownClassOf, flopShownHandIncrements and
 * addFlopShownEvidence; forward only, no back-fill). A pooled public row carries it into an Omaha decision's own
 * detached state (HorseMindSandbox.pooledFlopShown) and read frame (horse-decision-reads-v20), and
 * HorseMind.omahaFlopShownOf answers it. NO DECISION CALLS THAT ACCESSOR.
 */
import type { Card } from '../types.js';
import { learnablePublicAction, type ExploitHandAction } from './HorseOpponentExploit.js';
import {
  FLOP_TEXTURES,
  flopTextureOf,
  publicFlopOfHistory,
  type FlopTexture,
} from './HorseOmahaStreetRead.js';

// ───────────────────────────── the hand's class on the flop ─────────────────────────────

/** What a flop bettor's shown hand was on the flop. */
export type FlopShownBetClass = 'nut' | 'strong' | 'weak' | 'strongDraw' | 'air';
export const FLOP_SHOWN_BET_CLASSES: readonly FlopShownBetClass[] = [
  'nut',
  'strong',
  'weak',
  'strongDraw',
  'air',
];
/** The flop verdict's own class of a caller's hand (HorseOmahaFlopFacingBetEv.OmahaFlopHandClass). */
export type FlopShownCallerClass = 'made' | 'draw' | 'pair';
export interface FlopShownClass {
  bet: FlopShownBetClass;
  caller: FlopShownCallerClass;
}

const RANK_ORDER = '23456789TJQKA';
const SUIT_NAMES: ReadonlySet<string> = new Set(['spades', 'hearts', 'diamonds', 'clubs']);
const rankValue = (c: Card): number => RANK_ORDER.indexOf(c.rank as string) + 2;
const validCard = (c: unknown): c is Card => {
  if (!c || typeof c !== 'object') return false;
  const { rank, suit } = c as { rank?: unknown; suit?: unknown };
  return (
    typeof rank === 'string' &&
    rank.length === 1 &&
    RANK_ORDER.includes(rank) &&
    typeof suit === 'string' &&
    SUIT_NAMES.has(suit)
  );
};
/** Bit r for rank value r; an ace is also bit 1 (the wheel). */
const rankBit = (r: number): number => (1 << r) | (r === 14 ? 2 : 0);
const popcount = (x: number): number => {
  let n = 0;
  for (let b = x; b; b &= b - 1) n++;
  return n;
};
/** The five ranks of the straight whose top card is `top` (5 is the wheel), as a mask. */
const straightWindow = (top: number): number => {
  let w = 0;
  for (let k = 0; k < 5; k++) w |= 1 << (top - k === 1 ? 1 : top - k);
  return w;
};
/**
 * A straight under the two-card rule, by rank masks (HorseOmahaCardImpact.omahaStraightOutRanks' own test): a
 * window that misses at most two board ranks, every missing rank in the hand, two hand ranks inside it.
 */
function straightMade(holeMask: number, boardMask: number): boolean {
  for (let top = 14; top >= 5; top--) {
    const w = straightWindow(top);
    const missing = w & ~boardMask;
    if (popcount(missing) > 2 || (missing & ~holeMask) !== 0) continue;
    if (popcount(holeMask & w) >= 2) return true;
  }
  return false;
}

/** The made-hand category of 2 hole cards with the 3 flop cards (HorseFiveCardScore's numbering: 1 high card,
 *  2 one pair, 3 two pair, 4 three of a kind, 5 straight, 6 flush, 7 full house, 8 four of a kind, 9 straight
 *  flush), computed from rank and suit counts. */
interface FlopFacts {
  cat: number;
  /** the most copies of one rank on the flop: 1 unpaired, 2 paired, 3 trips */
  boardMost: number;
  monotone: boolean;
  holeMask: number;
  boardMask: number;
  holeCount: number[];
  /** the flush suit of a monotone flop when the hand holds two or more of it */
  flushSuit: string | null;
}
function flopFacts(hole: readonly Card[], flop: readonly Card[]): FlopFacts {
  const holeCount = new Array<number>(15).fill(0);
  const boardCount = new Array<number>(15).fill(0);
  let holeMask = 0;
  let boardMask = 0;
  for (const c of hole) {
    holeCount[rankValue(c)]++;
    holeMask |= rankBit(rankValue(c));
  }
  for (const c of flop) {
    boardCount[rankValue(c)]++;
    boardMask |= rankBit(rankValue(c));
  }
  const boardMost = Math.max(...boardCount);
  const monotone = flop[0].suit === flop[1].suit && flop[1].suit === flop[2].suit;
  const flushSuit =
    monotone && hole.filter((c) => c.suit === flop[0].suit).length >= 2
      ? (flop[0].suit as string)
      : null;
  const anyPocketPair = holeCount.some((n) => n >= 2);
  let cat = 1;
  if (boardMost === 3) {
    const r = boardCount.indexOf(3);
    cat = holeCount[r] >= 1 ? 8 : holeCount.some((n, x) => x !== r && n >= 2) ? 7 : 4;
  } else if (boardMost === 2) {
    const r = boardCount.indexOf(2);
    const s = boardCount.indexOf(1);
    if (holeCount[r] >= 2) cat = 8;
    else if ((holeCount[r] >= 1 && holeCount[s] >= 1) || holeCount[s] >= 2) cat = 7;
    else if (holeCount[r] >= 1) cat = 4;
    else if (holeCount[s] >= 1 || anyPocketPair) cat = 3;
    else cat = 2;
  } else {
    let suitedMask = 0;
    if (flushSuit)
      for (const c of hole) if (c.suit === flushSuit) suitedMask |= rankBit(rankValue(c));
    let paired = 0;
    let set = false;
    for (let r = 2; r <= 14; r++)
      if (boardCount[r] === 1) {
        if (holeCount[r] >= 1) paired++;
        if (holeCount[r] >= 2) set = true;
      }
    if (flushSuit && straightMade(suitedMask, boardMask)) cat = 9;
    else if (flushSuit) cat = 6;
    else if (straightMade(holeMask, boardMask)) cat = 5;
    else if (set) cat = 4;
    else if (paired >= 2) cat = 3;
    else if (paired === 1 || anyPocketPair) cat = 2;
  }
  return { cat, boardMost, monotone, holeMask, boardMask, holeCount, flushSuit };
}
/** flopShownCategory: the category alone, for the test that holds it to the evaluator. */
export function flopShownCategory(hole: readonly Card[], flop: readonly Card[]): number {
  return flopFacts(hole, flop).cat;
}

/** The highest rank of a suit that is not on the flop. */
function topMissingOfSuit(flop: readonly Card[], suit: string): number {
  for (let r = 14; r >= 2; r--)
    if (!flop.some((c) => c.suit === suit && rankValue(c) === r)) return r;
  return 0;
}
/** Straight outs by the repository's one rule (HorseOmahaBigDrawAggression.omahaComboStraightOuts, no dead
 *  cards): each rank not on the board whose arrival makes a straight, counted by the cards of it not in hand. */
function straightOuts(f: FlopFacts): number {
  if (straightMade(f.holeMask, f.boardMask)) return 0;
  let outs = 0;
  for (let r = 2; r <= 14; r++) {
    if (f.boardMask & (1 << r)) continue;
    if (straightMade(f.holeMask, f.boardMask | rankBit(r))) outs += 4 - f.holeCount[r];
  }
  return outs;
}

/** Straight outs that make a strong draw by themselves (a wrap, HorseOmahaBigDrawAggression.OMAHA_COMBO_WRAP_OUTS). */
export const FLOP_SHOWN_WRAP_OUTS = 13;
/** Straight outs that make a draw (the flop verdict's class), and a strong draw beside a flush draw. */
export const FLOP_SHOWN_DRAW_OUTS = 8;

/**
 * The class of a hand on a flop, or null when it cannot be named: not 4 to 6 hole cards and 3 flop cards, a
 * card that is not a rank and a suit name, or a card dealt twice.
 *
 * caller (identical to omahaFlopHandClass): `made` two pair or better under the two-card rule; `draw` anything
 * below that with a flush draw (two of a suit in hand, exactly two on the flop) or 8 or more straight outs;
 * `pair` the rest.
 *
 * bet:
 *  nut         full house or better; a flush holding the highest card of the suit that is not on the flop; on a
 *              flop that is not monotone, the highest straight the flop allows, or top set on an unpaired flop
 *  strong      any other three of a kind or better that uses his cards (three of a kind that lies on the board
 *              does not count), and two pair on an unpaired flop
 *  strongDraw  below strong, with a flush draw that is to the nut or comes with 8 or more straight outs, or
 *              with 13 or more straight outs
 *  weak        below strong, no strong draw: one pair on an unpaired flop, or two pair on a paired flop (his
 *              pair with the board's)
 *  air         the rest: no pair of his own, a weaker draw or nothing
 */
export function flopShownClassOf(
  hole: readonly unknown[] | null | undefined,
  flop: readonly unknown[] | null | undefined
): FlopShownClass | null {
  if (!Array.isArray(hole) || !Array.isArray(flop)) return null;
  if (hole.length < 4 || hole.length > 6 || flop.length !== 3) return null;
  if (!hole.every(validCard) || !flop.every(validCard)) return null;
  const h = hole as Card[];
  const b = flop as Card[];
  if (new Set([...h, ...b].map((c) => `${c.rank}${c.suit}`)).size !== h.length + 3) return null;
  const f = flopFacts(h, b);
  const outs = straightOuts(f);
  let drawSuit: string | null = null;
  for (const suit of SUIT_NAMES)
    if (
      b.filter((c) => c.suit === suit).length === 2 &&
      h.filter((c) => c.suit === suit).length >= 2
    )
      drawSuit = suit;
  const holds = (suit: string, r: number): boolean =>
    h.some((c) => c.suit === suit && rankValue(c) === r);
  const caller: FlopShownCallerClass =
    f.cat >= 3 ? 'made' : drawSuit !== null || outs >= FLOP_SHOWN_DRAW_OUTS ? 'draw' : 'pair';

  let bet: FlopShownBetClass;
  const topBoard = Math.max(...b.map(rankValue));
  let nutStraight = false;
  if (f.cat === 5)
    for (let top = 14; top >= 5; top--) {
      const missing = straightWindow(top) & ~f.boardMask;
      if (popcount(missing) !== 2) continue;
      // the highest straight this flop allows: his when both missing ranks are in his hand
      nutStraight = (missing & ~f.holeMask) === 0;
      break;
    }
  if (
    f.cat >= 7 ||
    (f.cat === 6 && holds(f.flushSuit!, topMissingOfSuit(b, f.flushSuit!))) ||
    (!f.monotone && f.cat === 5 && nutStraight) ||
    (!f.monotone && f.cat === 4 && f.boardMost === 1 && f.holeCount[topBoard] >= 2)
  )
    bet = 'nut';
  else if (
    (f.cat >= 4 && !(f.cat === 4 && f.boardMost === 3)) ||
    (f.cat === 3 && f.boardMost === 1)
  )
    bet = 'strong';
  else if (
    (drawSuit !== null &&
      (holds(drawSuit, topMissingOfSuit(b, drawSuit)) || outs >= FLOP_SHOWN_DRAW_OUTS)) ||
    outs >= FLOP_SHOWN_WRAP_OUTS
  )
    bet = 'strongDraw';
  else if ((f.boardMost === 1 && f.cat === 2) || (f.boardMost === 2 && f.cat === 3)) bet = 'weak';
  else bet = 'air';
  return { bet, caller };
}

// ───────────────────────────── the record ─────────────────────────────

export type FlopShownLine = 'cbet' | 'first';
export const FLOP_SHOWN_LINES: readonly FlopShownLine[] = ['cbet', 'first'];
export type FlopShownCallerKind = 'horse' | 'person';
export const FLOP_SHOWN_CALLER_KINDS: readonly FlopShownCallerKind[] = ['horse', 'person'];
export type FlopShownCallCell = 'made' | 'drawIp' | 'drawOop' | 'pair' | 'unshown';
export const FLOP_SHOWN_CALL_CELLS: readonly FlopShownCallCell[] = [
  'made',
  'drawIp',
  'drawOop',
  'pair',
  'unshown',
];
/** bet: line x texture x class, one count each. */
export const FLOP_SHOWN_BET_LENGTH = 40;
/** call: caller kind x cell x [calls, paid, net, n]. */
export const FLOP_SHOWN_CALL_LENGTH = 40;
const CALL_FIELDS = 4;

/**
 * The stored record (horse_exact_profiles.flop_shown), two flat lists of integers.
 *
 * bet[(line * 4 + texture) * 5 + class]: shown first flop bets of that line, texture and class, in thousandths.
 * call[(kind * 5 + cell) * 4 + k]: k 0 `calls` in thousandths; 1 `paid`, what the calls cost, and 2 `net`, what
 * the hands returned from the call on, both in hundredths of a big blind and aged like the calls; 3 `n`, the
 * calls ever counted in the cell, never aged.
 */
export interface FlopShownCounters {
  bet: number[];
  call: number[];
}
export function emptyFlopShown(): FlopShownCounters {
  return {
    bet: new Array<number>(FLOP_SHOWN_BET_LENGTH).fill(0),
    call: new Array<number>(FLOP_SHOWN_CALL_LENGTH).fill(0),
  };
}
export const flopShownBetIndex = (
  line: FlopShownLine,
  texture: FlopTexture,
  klass: FlopShownBetClass
): number =>
  (FLOP_SHOWN_LINES.indexOf(line) * 4 + FLOP_TEXTURES.indexOf(texture)) * 5 +
  FLOP_SHOWN_BET_CLASSES.indexOf(klass);
export const flopShownCallIndex = (kind: FlopShownCallerKind, cell: FlopShownCallCell): number =>
  (FLOP_SHOWN_CALLER_KINDS.indexOf(kind) * 5 + FLOP_SHOWN_CALL_CELLS.indexOf(cell)) * CALL_FIELDS;

/** One unit of a count as stored. */
export const FLOP_SHOWN_UNIT = 1000;
/** A cell that takes evidence first ages by 977/1000, truncated: a half-life of 29.8 such hands. */
export const FLOP_SHOWN_DECAY_NUM = 977;
export const FLOP_SHOWN_DECAY_DEN = 1000;
/** One call's price and its return are each held to 1 000 big blinds (in hundredths). */
export const FLOP_SHOWN_MONEY_CAP = 100000;
/** The never-aged count stops here. */
export const FLOP_SHOWN_N_CAP = 1000000;
/** Bounds a stored number can reach by the rules above (8 callers of one bet at most), with room. */
const BET_MAX = 50000;
const CALLS_MAX = 400000;
const MONEY_MAX = 40000000;

const plainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const intIn = (v: unknown, lo: number, hi: number): boolean =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
/**
 * A stored record is usable only when it is exactly {bet, call}, each list its full length, every number an
 * integer inside the bounds the rules can reach. The validation every reader of horse_exact_profiles.flop_shown
 * applies; a record that fails is read as absent.
 */
export function validFlopShown(r: unknown): r is FlopShownCounters {
  if (!plainObject(r) || Object.keys(r).length !== 2) return false;
  const { bet, call } = r as { bet?: unknown; call?: unknown };
  if (!Array.isArray(bet) || bet.length !== FLOP_SHOWN_BET_LENGTH) return false;
  if (!Array.isArray(call) || call.length !== FLOP_SHOWN_CALL_LENGTH) return false;
  if (!bet.every((v) => intIn(v, 0, BET_MAX))) return false;
  for (let i = 0; i < FLOP_SHOWN_CALL_LENGTH; i += CALL_FIELDS)
    if (
      !intIn(call[i], 0, CALLS_MAX) ||
      !intIn(call[i + 1], 0, MONEY_MAX) ||
      !intIn(call[i + 2], -MONEY_MAX, MONEY_MAX) ||
      !intIn(call[i + 3], 0, FLOP_SHOWN_N_CAP)
    )
      return false;
  return true;
}
/** A detached copy of a valid record. */
export function copyFlopShown(r: FlopShownCounters): FlopShownCounters {
  return { bet: [...r.bet], call: [...r.call] };
}

// ───────────────────────────── one completed hand ─────────────────────────────

/** One hand's evidence about its flop bettor, in whole units: bet holds a single 1 (or none); call holds, per
 *  cell, the calls, their price and their return in hundredths of a big blind, and the calls again. */
export type FlopShownIncrement = FlopShownCounters;

const VOLUNTARY: ReadonlySet<string> = new Set(['fold', 'check', 'call', 'bet', 'raise', 'all_in']);
const aggressive = (a: ExploitHandAction): boolean =>
  a.action === 'bet' || a.action === 'raise' || (a.action === 'all_in' && a.isFullRaise === true);
/** An amount of the public record: a finite number under 1e12, else 0; never negative. */
const amountOf = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e12 ? Math.max(0, v) : 0;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
/** Hundredths of a big blind, rounded half up. */
const bbHundredths = (chips: number, bigBlind: number): number =>
  Math.floor((chips * 100) / bigBlind + 0.5);

/** The public record of one completed hand, as hand_history keeps it. */
export interface FlopShownHand {
  /** hand_history.actions */
  actions: unknown;
  /** hand_history.community_cards and community_cards2 */
  communityCards: unknown;
  communityCards2?: unknown;
  /** hand_history.hole_cards: the holdings the showdown revealed, by player */
  holeCards: unknown;
  /** hand_history.showdown: who was at the showdown and who mucked */
  showdown: unknown;
  /** hand_history.winners: what each player was paid */
  winners: unknown;
  /** hand_history.big_blind */
  bigBlind: unknown;
}

/** His cards when the hand's public record shows them: named in the revealed holdings, and listed at the
 *  showdown with `mucked: false` written out. Null otherwise: a folded or mucked hand, and an entry whose
 *  `mucked` is missing or anything but the boolean false, is never read (public.fn_horse_flop_shown_public_class,
 *  migration 20261119213206 onward, is the twin). */
function publicHoleCards(hand: FlopShownHand, userId: string): unknown[] | null {
  if (!plainObject(hand.holeCards) || !Object.hasOwn(hand.holeCards, userId)) return null;
  const cards = hand.holeCards[userId];
  if (!Array.isArray(cards)) return null;
  if (!Array.isArray(hand.showdown)) return null;
  const entry = hand.showdown.find((e) => plainObject(e) && e.user_id === userId);
  if (!plainObject(entry) || entry.mucked !== false) return null;
  return cards;
}

/**
 * One completed hand -> the evidence about its flop bettor, keyed by his id (at most one player), or an empty
 * map when the hand has none: no single flop, a bomb pot, no first bet on the flop, or nothing learnable.
 *
 * The bettor is the player whose admitted bet (the pooled counters' admission: voluntary, attributed, never
 * forced) is the first wager of the flop (a hand whose first flop wager is anything else, such as an all-in
 * short of a bet, has no evidence); he is on the `cbet` line when he made the last admitted raise before the
 * flop, else on `first`. A caller is a player whose admitted `call` answers that bet before any raise or all-in
 * of the flop; his kind is the call's origin (horse_policy: a Horse; player or pre_action: a person; any other
 * origin is not counted). He is in position when no player acts for the first time on the flop after him. His
 * price is the call; his return is what the winners list paid him less everything he put in from the call on,
 * uncalled bets returned to him taken off. Calls are counted only when the winners list and the big blind are
 * on the record.
 */
export function flopShownHandIncrements(hand: FlopShownHand): Map<string, FlopShownIncrement> {
  const out = new Map<string, FlopShownIncrement>();
  const flop = publicFlopOfHistory(hand.communityCards, hand.communityCards2);
  const texture = flopTextureOf(flop);
  if (!flop || !texture || !Array.isArray(hand.actions)) return out;
  let lastPreflopRaiser: string | null = null;
  let bettor: string | null = null;
  let line: FlopShownLine = 'first';
  let raised = false;
  let stage: string | null = null;
  let street = new Map<string, number>();
  const order: string[] = [];
  const callers: { id: string; kind: FlopShownCallerKind; paid: number }[] = [];
  const fromCall = new Map<string, number>();
  for (const a of hand.actions as ExploitHandAction[]) {
    if (!plainObject(a)) continue;
    if (a.action === 'bomb_ante') return out;
    if (typeof a.userId !== 'string' || !a.userId) continue;
    if (typeof a.action !== 'string' || typeof a.stage !== 'string') continue;
    const id = a.userId;
    if (a.stage === 'preflop') {
      if (learnablePublicAction(a) && aggressive(a)) lastPreflopRaiser = id;
      continue;
    }
    if (a.stage !== 'flop' && a.stage !== 'turn' && a.stage !== 'river') continue;
    if (a.stage !== stage) {
      stage = a.stage;
      street = new Map();
    }
    const amount = amountOf(a.amount);
    if (a.action === 'return') {
      if (fromCall.has(id)) fromCall.set(id, fromCall.get(id)! - amount);
      continue;
    }
    if (!VOLUNTARY.has(a.action)) continue;
    // bet / raise / all-in amounts are street totals, a call is an increment (HorseOpponentStyle.riverFirstBetFractions)
    const prev = street.get(id) ?? 0;
    const wager = a.action === 'bet' || a.action === 'raise' || a.action === 'all_in';
    const inc =
      a.action === 'fold' || a.action === 'check' ? 0 : wager ? Math.max(0, amount - prev) : amount;
    street.set(id, prev + inc);
    if (fromCall.has(id)) fromCall.set(id, fromCall.get(id)! + inc);
    if (a.stage !== 'flop') continue;
    if (!order.includes(id)) order.push(id);
    const admitted = learnablePublicAction(a);
    if (bettor === null) {
      if (admitted && aggressive(a)) {
        bettor = id;
        line = lastPreflopRaiser === id ? 'cbet' : 'first';
      } else if (wager) return out; // a first wager that is not an admitted bet: the flop has no clean first bet
    } else if (!raised) {
      if (wager) raised = true;
      else if (a.action === 'call' && id !== bettor && admitted && !fromCall.has(id)) {
        const kind: FlopShownCallerKind | null =
          a.origin === 'horse_policy'
            ? 'horse'
            : a.origin === 'player' || a.origin === 'pre_action'
              ? 'person'
              : null;
        if (kind) {
          callers.push({ id, kind, paid: inc });
          fromCall.set(id, inc);
        }
      }
    }
  }
  if (bettor === null) return out;
  const inc = emptyFlopShown();
  let learned = false;
  const shown = publicHoleCards(hand, bettor);
  const klass = shown ? flopShownClassOf(shown, flop) : null;
  if (klass) {
    inc.bet[flopShownBetIndex(line, texture, klass.bet)] = 1;
    learned = true;
  }
  const bigBlind =
    typeof hand.bigBlind === 'number' && Number.isFinite(hand.bigBlind) ? hand.bigBlind : 0;
  if (Array.isArray(hand.winners) && bigBlind > 0 && bigBlind < 1e9)
    for (const c of callers) {
      let paidOut = 0;
      for (const w of hand.winners)
        if (plainObject(w) && w.userId === c.id) paidOut += amountOf(w.amount);
      const cards = publicHoleCards(hand, c.id);
      const callerClass = cards ? flopShownClassOf(cards, flop) : null;
      const inPosition = order[order.length - 1] === c.id;
      const cell: FlopShownCallCell = !callerClass
        ? 'unshown'
        : callerClass.caller === 'made'
          ? 'made'
          : callerClass.caller === 'pair'
            ? 'pair'
            : inPosition
              ? 'drawIp'
              : 'drawOop';
      const i = flopShownCallIndex(c.kind, cell);
      inc.call[i] += 1;
      inc.call[i + 1] += clamp(bbHundredths(c.paid, bigBlind), 0, FLOP_SHOWN_MONEY_CAP);
      inc.call[i + 2] += clamp(
        bbHundredths(paidOut - fromCall.get(c.id)!, bigBlind),
        -FLOP_SHOWN_MONEY_CAP,
        FLOP_SHOWN_MONEY_CAP
      );
      inc.call[i + 3] += 1;
      learned = true;
    }
  if (learned) out.set(bettor, inc);
  return out;
}

/** A stored or supplied number: an integer of at most 1e9 in size, else 0. */
const whole = (v: unknown): number =>
  typeof v === 'number' && Number.isInteger(v) && Math.abs(v) <= 1e9 ? v : 0;
const aged = (v: number): number => Math.trunc((v * FLOP_SHOWN_DECAY_NUM) / FLOP_SHOWN_DECAY_DEN);

/**
 * The TypeScript twin of public.fn_horse_flop_shown_add(base, delta): one hand's evidence added to a stored
 * record. A hand with no evidence returns the base itself, so a record that has learned nothing stays null.
 * Otherwise a fresh record. bet: the five classes of a line and texture that took a shown bet age together,
 * then the bet's class takes one unit. call: a cell that took calls ages its calls, price and return, then
 * takes the hand's (calls in units), and its never-aged count grows by the calls. Every other number is
 * unchanged. A stored or supplied number that is not an integer of at most 1e9 in size counts as 0. Neither
 * argument is mutated.
 */
export function addFlopShownEvidence(
  base: FlopShownCounters | null | undefined,
  inc: FlopShownIncrement | null | undefined
): FlopShownCounters | null {
  if (!inc || !Array.isArray(inc.bet) || !Array.isArray(inc.call)) return base ?? null;
  const out = emptyFlopShown();
  const baseBet = base && Array.isArray(base.bet) ? base.bet : [];
  const baseCall = base && Array.isArray(base.call) ? base.call : [];
  let learned = false;
  for (let g = 0; g < FLOP_SHOWN_BET_LENGTH; g += 5) {
    let any = false;
    for (let k = 0; k < 5; k++) if (whole(inc.bet[g + k]) > 0) any = true;
    for (let k = 0; k < 5; k++) {
      const b = whole(baseBet[g + k]);
      out.bet[g + k] = any
        ? Math.min(BET_MAX, aged(b) + Math.max(0, whole(inc.bet[g + k])) * FLOP_SHOWN_UNIT)
        : b;
    }
    if (any) learned = true;
  }
  for (let i = 0; i < FLOP_SHOWN_CALL_LENGTH; i += CALL_FIELDS) {
    const calls = whole(inc.call[i]);
    const b = [0, 1, 2, 3].map((k) => whole(baseCall[i + k]));
    if (calls > 0) {
      learned = true;
      out.call[i] = Math.min(CALLS_MAX, aged(b[0]) + calls * FLOP_SHOWN_UNIT);
      out.call[i + 1] = clamp(aged(b[1]) + whole(inc.call[i + 1]), 0, MONEY_MAX);
      out.call[i + 2] = clamp(aged(b[2]) + whole(inc.call[i + 2]), -MONEY_MAX, MONEY_MAX);
      out.call[i + 3] = Math.min(FLOP_SHOWN_N_CAP, b[3] + calls);
    } else for (let k = 0; k < CALL_FIELDS; k++) out.call[i + k] = b[k];
  }
  if (!learned) return base ?? null;
  return out;
}

// ───────────────────────────── the wire row ─────────────────────────────

/** One record on the read-frame wire: the 40 bet numbers, then the 40 call numbers. */
export const FLOP_SHOWN_ROW_LENGTH = FLOP_SHOWN_BET_LENGTH + FLOP_SHOWN_CALL_LENGTH;
export function flopShownRow(r: FlopShownCounters): number[] {
  return [...r.bet, ...r.call];
}
/** The record a wire list carries, or null when the list is not a valid record. */
export function flopShownFromRow(row: readonly number[]): FlopShownCounters | null {
  if (!Array.isArray(row) || row.length !== FLOP_SHOWN_ROW_LENGTH) return null;
  const out = {
    bet: row.slice(0, FLOP_SHOWN_BET_LENGTH),
    call: row.slice(FLOP_SHOWN_BET_LENGTH),
  };
  return validFlopShown(out) ? out : null;
}

/**
 * The games the accepted-hand learner keeps the record for: every variant public.fn_horse_exact_accept_hand
 * admits ('nlh','plo4','plo5','plo6','plo8','flh','flo8','short_deck','pineapple') that flopShownCarriedFor
 * carries to a decision. Any other game (Hold'em, short deck, pineapple) never accumulates flop_shown or the
 * fold-to-raise price record: nothing reads them there. The SQL gate in the accepted-hand learner names exactly this list
 * (whatAFlopBetShowedIsKeptAndDelivered.law.test.ts, law 10, pins the two together).
 */
export const FLOP_SHOWN_LEARNED_VARIANTS: readonly string[] = Object.freeze([
  'plo4',
  'plo5',
  'plo6',
  'plo8',
  'flo8',
]);

/** The games whose decisions carry the record: the Omaha family (HorseOmahaStreetRead.streetReadCarriedFor's rule). */
export function flopShownCarriedFor(variant: string | null | undefined): boolean {
  const v = (variant ?? '').toLowerCase();
  return v.startsWith('plo') || v === 'flo8' || v.includes('omaha');
}

// ───────────────────────────── the reader ─────────────────────────────

/** What his shown first flop bets of one line and texture were. */
export interface FlopShownBetRead {
  /** shown bets of this line and texture, aged (whole bets, not thousandths) */
  shown: number;
  /** the same, by class */
  byClass: Record<FlopShownBetClass, number>;
}
/** His shown first flop bets on one line and texture; every count 0 when he has none. Null for a record that is
 *  not valid. Applies no threshold and no prior: see flopShownShare. */
export function flopShownBetRead(
  r: FlopShownCounters | null | undefined,
  line: FlopShownLine,
  texture: FlopTexture
): FlopShownBetRead | null {
  if (!r || !validFlopShown(r)) return null;
  const byClass = {} as Record<FlopShownBetClass, number>;
  let shown = 0;
  for (const k of FLOP_SHOWN_BET_CLASSES) {
    byClass[k] = r.bet[flopShownBetIndex(line, texture, k)] / FLOP_SHOWN_UNIT;
    shown += byClass[k];
  }
  return { shown, byClass };
}
/** Aged shown bets a line and texture need before flopShownShare answers. */
export const FLOP_SHOWN_MIN_SHOWN = 8;
/** Pseudo-observations at the prior share. */
export const FLOP_SHOWN_PRIOR_MASS = 6;
/**
 * The share of his shown bets of one line and texture that were of the given classes, against a prior share the
 * caller supplies for HIS KIND (a person's and a Horse's are different numbers and are the caller's to measure;
 * this module holds none): (hits + mass x prior) / (shown + mass). Null while the line and texture hold fewer
 * than FLOP_SHOWN_MIN_SHOWN aged shown bets, or when the prior is not a share: unknown stays unknown.
 */
export function flopShownShare(
  read: FlopShownBetRead | null | undefined,
  classes: readonly FlopShownBetClass[],
  prior: number
): { share: number; shown: number } | null {
  if (!read || !(prior >= 0 && prior <= 1)) return null;
  if (!(read.shown >= FLOP_SHOWN_MIN_SHOWN)) return null;
  let hits = 0;
  for (const k of new Set(classes)) hits += read.byClass[k] ?? 0;
  return {
    share: (hits + FLOP_SHOWN_PRIOR_MASS * prior) / (read.shown + FLOP_SHOWN_PRIOR_MASS),
    shown: read.shown,
  };
}

/** What calls of his first flop bets returned in one cell. */
export interface FlopShownCallRead {
  /** aged calls (whole calls) */
  calls: number;
  /** what those calls cost and what the hands returned from the call on, in big blinds, aged like the calls */
  paidBb: number;
  netBb: number;
  /** calls ever counted in the cell */
  n: number;
  /** netBb / calls and netBb / paidBb; null with no calls or no price */
  netPerCallBb: number | null;
  returnOnCall: number | null;
}
/** One cell of what calls of his first flop bets returned to callers of one kind. Null for a record that is not
 *  valid. Applies no threshold: `calls` and `n` are the sample. The class cells hold shown hands only. */
export function flopShownCallRead(
  r: FlopShownCounters | null | undefined,
  kind: FlopShownCallerKind,
  cell: FlopShownCallCell
): FlopShownCallRead | null {
  if (!r || !validFlopShown(r)) return null;
  const i = flopShownCallIndex(kind, cell);
  const calls = r.call[i] / FLOP_SHOWN_UNIT;
  const paidBb = r.call[i + 1] / 100;
  const netBb = r.call[i + 2] / 100;
  return {
    calls,
    paidBb,
    netBb,
    n: r.call[i + 3],
    netPerCallBb: calls > 0 ? netBb / calls : null,
    returnOnCall: paidBb > 0 ? netBb / paidBb : null,
  };
}
