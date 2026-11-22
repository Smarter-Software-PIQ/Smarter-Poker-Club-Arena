/**
 * ═══ A HOLD'EM TOURNAMENT ALL-IN CALL IS PRICED (2026-11-19) ════════════
 *
 * Option holdemTournamentAllInCallIsPriced (default OFF, read `=== true`).
 * Audit E of the Horse Decisions lane (1,522 NLH tournament hands with humans,
 * 10,937 Horse decisions, 48 hours to 2026-11-19 18:45 CST) traced four roots
 * of call/fold mistakes facing an all-in in hold'em tournaments:
 *
 *   1. All-In-Or-Fold tables answered a jam with a fixed strength bar (0.72,
 *      0.85 against two raises) that reads no jammer range, no dead money and
 *      no price: Horses called a lone jam at 8 big blinds or less 10 to 30% of
 *      the time against a Nash call of 56 to 68%.
 *   2. Standard tables priced only a lone open-jam (the Nash caller table). A
 *      jam over the Horse's own open, a re-jam after a raise, a multiway
 *      all-in and a jam with flat callers fell to strength bars, and then to
 *      the Phase 7 tournament utility arbiter, which could fold a +EV call.
 *   3. A committed stack folded the last crumbs getting 2 to 12%.
 *   4. Postflop all-in folds at a good price and river calls with too little
 *      equity: nothing compared the equity with the price.
 *
 * This module is the price. It holds no decision state and reads nobody's
 * identity: the inputs are the Horse's cards, the public action (who jammed,
 * who raised, who called, who is still to act), stacks, the dead money and the
 * tournament's payout state as the engine already carries them.
 *
 * THE RANGES (preflop). Each opponent in the pot is given a range by what he
 * did, from the tables the engine already has (HorseNashPushFoldV2):
 *   - an open-jam (the first raise, all in): the Nash jam range for his
 *     players behind, the effective depth and the dead ante;
 *   - a jam over one raise (a re-jam, including one over the Horse's own
 *     open): the top REJAM_WIDTH(depth) of hands, 18% at 8 big blinds or less
 *     to 6% at 25 big blinds, linear between;
 *   - a jam over two or more raises: the top 5% at 12 big blinds or less to
 *     3.5% at 25;
 *   - a raise that is not all in (the Horse's call is all in for the Horse):
 *     the open-raise width by players behind, the 3-bet width, the 4-bet
 *     width (OPEN_RAISE_WIDTH_BY_BEHIND, THREE_BET_WIDTH, FOUR_BET_WIDTH);
 *   - a caller of a jam: the Nash first-caller range for his seat kind against
 *     an open-jam, capped at 25% of hands; against a re-jam the top half of
 *     the re-jam range;
 *   - a player still to act behind the Horse may overcall: with the top half
 *     of the range he would call the jam with, so the call is priced as a
 *     mixture: nobody behind wakes up, or the widest one behind overcalls.
 * Ranges are ordered, where a width is used, by the Nash caller table's own
 * order (STRENGTH_ORDER: the depth up to which each class calls a jam).
 *
 * THE PRICE. EV(call) - EV(fold) in chips = sum over the scenarios of
 * p x (equity x W - BF x (1 - equity) x C), where C is the call (the rest of
 * the stack at most), W the chips the Horse can win (the contestable pot: dead
 * money and every side pot capped at the Horse's stack, the Horse's own chips
 * already in included) and BF the Horse's bubble factor where a pay jump is
 * live (HorseLogic.payJumpBubbleFactor: losses weighted BF times; 1 where no
 * pay jump is live, in a PKO, a mystery bounty or a bounty-only event, or
 * where the context cannot supply it). The margin is that EV over W + BF x C,
 * so with nobody behind it is exactly equity - required equity, the required
 * equity being BF x C / (W + BF x C).
 *
 * THE EQUITY. Preflop: a seeded Monte Carlo of the Horse's two cards against
 * each opponent's range, exact card removal (a sampled combo that shares a
 * card with the Horse or with another opponent is drawn again), the board
 * completed from the rest of the deck, every showdown scored by
 * HorseEval.scoreHoldem; the seed is a hash of the public spot and the cards,
 * so the same spot always gets the same number and no shared generator is
 * consumed. Postflop: the equity the engine already computed for the decision
 * (the Phase 7 equity evidence of decidePostflop's own pass); none is computed
 * here.
 *
 * WHAT IT DECIDES (HorseLogic):
 *   - preflop, in the reference: every all-in call decision of a two-card
 *     no-limit hold'em tournament hand (All-In-Or-Fold or not, any seat, the
 *     effective stack 25 big blinds or less, or a committed stack at any
 *     depth) is call when the margin is above zero, else fold;
 *   - after the Phase 7 arbiter and Phase 8: the arbiter may change that
 *     answer only while the margin is within LOCK_MARGIN (5 equity points) of
 *     the price; beyond it the priced answer stands. A committed stack (half
 *     or more of the chips it started the hand with already in) whose call
 *     the price favours by any margin calls;
 *   - postflop, only facing an opponent's all-in (a jam) where the call
 *     closes the action (review N3: the engine's equity there is against the
 *     preflop bands, the closest proxy against a jam but not the line range
 *     of a river bet, so a river bet is not priced): a fold whose margin is
 *     above LOCK_MARGIN becomes a call, a call whose margin is below
 *     -LOCK_MARGIN becomes a fold; a committed stack's fold with any positive
 *     margin becomes a call.
 * A raise is never made or removed here: only the call and the fold.
 */
import type { Card, CardRank, CardSuit } from '../types.js';
import {
  holdemCardId,
  packHoldemBoardBits,
  scoreHoldemPlus2Ids,
  type HoldemBoardBits,
} from './HorseEval.js';
import { NASH_PUSH_FOLD_V2 } from './HorseNashPushFoldV2.data.js';
import {
  nashV2CallProbability,
  nashV2CallUpTo,
  nashV2JamProbability,
  nashV2JamUpTo,
  type NashCallerKind,
} from './HorseNashPushFoldV2.js';
import { SeededRandom } from './equity/SeededRandom.js';

/** Preflop: the effective stack (big blinds) up to which an all-in call is priced; a committed stack at any depth. */
export const HOLDEM_TOURNAMENT_ALL_IN_CALL_MAX_BB = 25;
/** Equity points beyond which no later owner (the Phase 7 arbiter, Phase 8) may reverse the priced call or fold. */
export const HOLDEM_TOURNAMENT_ALL_IN_LOCK_MARGIN = 0.05;
/** Own chips in, as a share of the chips the Horse started the hand with, that make a stack committed. */
export const HOLDEM_TOURNAMENT_ALL_IN_COMMITTED_SHARE = 0.5;
/** A re-jam over one raise: the top share of hands at 8 big blinds or less and at 25, linear between. */
export const REJAM_WIDTH_SHORT = 0.18;
export const REJAM_WIDTH_DEEP = 0.06;
/** A jam over two or more raises: the top share at 12 big blinds or less and at 25, linear between. */
export const OVER_THREE_BET_JAM_WIDTH_SHORT = 0.05;
export const OVER_THREE_BET_JAM_WIDTH_DEEP = 0.035;
/** A raise that is not all in, by the raiser's players behind (1 = the small blind ... 8 or more = early). */
export const OPEN_RAISE_WIDTH_BY_BEHIND: readonly number[] = [
  0.4, 0.4, 0.44, 0.3, 0.24, 0.2, 0.17, 0.15, 0.13,
];
/** A 3-bet that is not all in (14% with six or fewer dealt), and a 4-bet or more. */
export const THREE_BET_WIDTH = 0.08;
export const THREE_BET_WIDTH_SHORT_HANDED = 0.14;
export const FOUR_BET_WIDTH = 0.04;
/** The widest range a caller of a jam is given. */
export const CALLER_WIDTH_CAP = 0.25;
/** A player behind overcalls with this share (the top part) of the range he would call the jam with. */
export const OVERCALL_SHARE = 0.5;
/** An overcall scenario less likely than this is not priced apart. */
export const OVERCALL_MIN_PROBABILITY = 0.02;
/** Monte Carlo deals: heads-up and with two or more opponents. */
export const ALL_IN_EQUITY_ITERATIONS_HEADS_UP = 3000;
export const ALL_IN_EQUITY_ITERATIONS_MULTIWAY = 2400;

export type HoldemClassRange = Float64Array;

/** The 169 classes, in the Nash table's order ('AA', 'AKs', ..., 'AKo', ...). */
export const HOLDEM_CLASSES: readonly string[] = NASH_PUSH_FOLD_V2.classes;
const RANK_CHARS = 'AKQJT98765432';
const SUIT_LIST: readonly CardSuit[] = ['hearts', 'diamonds', 'clubs', 'spades'];

export function holdemClassComboCount(cls: string): number {
  return cls.length === 2 ? 6 : cls.endsWith('s') ? 4 : 12;
}

/** The class of two hole cards in the Nash table's labels, or null. */
export function holdemClassOf(a: Card, b: Card): string | null {
  const ia = RANK_CHARS.indexOf(a.rank);
  const ib = RANK_CHARS.indexOf(b.rank);
  if (ia < 0 || ib < 0) return null;
  const hi = RANK_CHARS[Math.min(ia, ib)];
  const lo = RANK_CHARS[Math.max(ia, ib)];
  if (ia === ib) return `${hi}${lo}`;
  return `${hi}${lo}${a.suit === b.suit ? 's' : 'o'}`;
}

/** Every combo of a class, engine cards. */
function combosOf(cls: string): Array<[Card, Card]> {
  const r1 = cls[0] as CardRank;
  const r2 = cls[1] as CardRank;
  const out: Array<[Card, Card]> = [];
  if (cls.length === 2) {
    for (let i = 0; i < 4; i++)
      for (let j = i + 1; j < 4; j++)
        out.push([
          { rank: r1, suit: SUIT_LIST[i] },
          { rank: r2, suit: SUIT_LIST[j] },
        ]);
  } else if (cls.endsWith('s')) {
    for (const s of SUIT_LIST)
      out.push([
        { rank: r1, suit: s },
        { rank: r2, suit: s },
      ]);
  } else {
    for (const s1 of SUIT_LIST)
      for (const s2 of SUIT_LIST)
        if (s1 !== s2)
          out.push([
            { rank: r1, suit: s1 },
            { rank: r2, suit: s2 },
          ]);
  }
  return out;
}
const COMBOS: ReadonlyArray<ReadonlyArray<[Card, Card]>> = HOLDEM_CLASSES.map(combosOf);

/**
 * The classes strongest first: the depth up to which each class calls an
 * early-position jam (8 behind, big blind, no ante), then a small-blind jam
 * (1 behind), then the depth it jams to from early position. The Nash caller
 * table's own order, no second strength scale.
 */
export const STRENGTH_ORDER: readonly number[] = (() => {
  const key = HOLDEM_CLASSES.map((cls) => [
    nashV2CallUpTo(cls, 8, 'bb', 0) ?? 0,
    nashV2CallUpTo(cls, 1, 'bb', 0) ?? 0,
    nashV2JamUpTo(cls, 9, 0) ?? 0,
  ]);
  return HOLDEM_CLASSES.map((_, i) => i).sort((a, b) => {
    for (let k = 0; k < 3; k++) if (key[b][k] !== key[a][k]) return key[b][k] - key[a][k];
    return a - b;
  });
})();

const TOTAL_COMBOS = 1326;

/** Combo-weighted share (0..1) of all hands a range holds. */
export function holdemRangeWidth(range: HoldemClassRange): number {
  let w = 0;
  for (let i = 0; i < 169; i++) w += range[i] * holdemClassComboCount(HOLDEM_CLASSES[i]);
  return w / TOTAL_COMBOS;
}

/** The top `width` (0..1) of hands in STRENGTH_ORDER, the last class taken in part. */
export function holdemTopRange(width: number): HoldemClassRange {
  const out = new Float64Array(169);
  let left = Math.max(0, Math.min(1, width)) * TOTAL_COMBOS;
  for (const i of STRENGTH_ORDER) {
    if (left <= 0) break;
    const n = holdemClassComboCount(HOLDEM_CLASSES[i]);
    out[i] = Math.min(1, left / n);
    left -= n;
  }
  return out;
}

const clampDepth = (depthBB: number): number => Math.max(1.5, Math.min(25, depthBB));
const lerp = (x: number, x0: number, x1: number, y0: number, y1: number): number =>
  x <= x0 ? y0 : x >= x1 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);

export function rejamWidth(depthBB: number): number {
  return lerp(depthBB, 8, 25, REJAM_WIDTH_SHORT, REJAM_WIDTH_DEEP);
}
export function overThreeBetJamWidth(depthBB: number): number {
  return lerp(depthBB, 12, 25, OVER_THREE_BET_JAM_WIDTH_SHORT, OVER_THREE_BET_JAM_WIDTH_DEEP);
}
export function openRaiseWidth(raiserBehind: number): number {
  const i = Math.max(1, Math.min(OPEN_RAISE_WIDTH_BY_BEHIND.length - 1, Math.round(raiserBehind)));
  return OPEN_RAISE_WIDTH_BY_BEHIND[i];
}

/** The Nash open-jam range (HorseNashPushFoldV2, chip EV). */
export function holdemOpenJamRange(
  jammerBehind: number,
  depthBB: number,
  anteBB: number
): HoldemClassRange {
  const out = new Float64Array(169);
  const behind = Math.max(1, jammerBehind);
  const depth = clampDepth(depthBB);
  for (let i = 0; i < 169; i++)
    out[i] = nashV2JamProbability({ hand: HOLDEM_CLASSES[i], behind, depthBB: depth, anteBB }) ?? 0;
  return out;
}

/** The Nash first-caller range against an open-jam, capped at CALLER_WIDTH_CAP. */
export function holdemFirstCallerRange(
  jammerBehind: number,
  callerKind: NashCallerKind,
  depthBB: number,
  anteBB: number
): HoldemClassRange {
  const out = new Float64Array(169);
  const depth = clampDepth(depthBB);
  for (let i = 0; i < 169; i++)
    out[i] =
      nashV2CallProbability({
        hand: HOLDEM_CLASSES[i],
        jammerBehind: Math.max(1, jammerBehind),
        callerKind,
        depthBB: depth,
        anteBB,
      }) ?? 0;
  return holdemRangeWidth(out) > CALLER_WIDTH_CAP ? holdemTopRange(CALLER_WIDTH_CAP) : out;
}

/** The strongest `share` of a range's own combos, in STRENGTH_ORDER. */
export function holdemTopOfRange(range: HoldemClassRange, share: number): HoldemClassRange {
  const out = new Float64Array(169);
  let left = holdemRangeWidth(range) * TOTAL_COMBOS * Math.max(0, Math.min(1, share));
  for (const i of STRENGTH_ORDER) {
    if (left <= 0) break;
    const n = range[i] * holdemClassComboCount(HOLDEM_CLASSES[i]);
    if (n <= 0) continue;
    const take = Math.min(n, left);
    out[i] = take / holdemClassComboCount(HOLDEM_CLASSES[i]);
    left -= take;
  }
  return out;
}

const cardId = (c: Card): number => {
  const r = RANK_CHARS.indexOf(c.rank);
  const s = SUIT_LIST.indexOf(c.suit);
  return r < 0 || s < 0 ? -1 : r * 4 + s;
};
const DECK: readonly Card[] = (() => {
  const out: Card[] = [];
  for (let r = 0; r < 13; r++)
    for (let s = 0; s < 4; s++) out.push({ rank: RANK_CHARS[r] as CardRank, suit: SUIT_LIST[s] });
  return out;
})();
const DECK_ID_TO_EVAL_ID = new Uint8Array(52);
for (let i = 0; i < 52; i++) DECK_ID_TO_EVAL_ID[i] = holdemCardId(DECK[i]);

const COMBO_DECK_IDS: ReadonlyArray<Uint8Array> = COMBOS.map((list) => {
  const out = new Uint8Array(list.length * 2);
  for (let k = 0; k < list.length; k++) {
    out[k * 2] = cardId(list[k][0]);
    out[k * 2 + 1] = cardId(list[k][1]);
  }
  return out;
});

interface WeightedCombos {
  idA: Uint8Array;
  idB: Uint8Array;
  evalA: Uint8Array;
  evalB: Uint8Array;
  cumulative: Float64Array;
  total: number;
}

function weightedCombos(range: HoldemClassRange, deadFlags: Uint8Array): WeightedCombos {
  const idA: number[] = [];
  const idB: number[] = [];
  const weights: number[] = [];
  for (let i = 0; i < 169; i++) {
    const w = range[i];
    if (!(w > 0)) continue;
    const pairs = COMBO_DECK_IDS[i];
    for (let k = 0; k < pairs.length; k += 2) {
      const a = pairs[k];
      const b = pairs[k + 1];
      if (deadFlags[a] || deadFlags[b]) continue;
      idA.push(a);
      idB.push(b);
      weights.push(w);
    }
  }
  const len = weights.length;
  const outA = new Uint8Array(len);
  const outB = new Uint8Array(len);
  const evalA = new Uint8Array(len);
  const evalB = new Uint8Array(len);
  const cumulative = new Float64Array(len);
  let total = 0;
  for (let i = 0; i < len; i++) {
    const a = idA[i];
    const b = idB[i];
    outA[i] = a;
    outB[i] = b;
    evalA[i] = DECK_ID_TO_EVAL_ID[a];
    evalB[i] = DECK_ID_TO_EVAL_ID[b];
    total += weights[i];
    cumulative[i] = total;
  }
  return { idA: outA, idB: outB, evalA, evalB, cumulative, total };
}

function drawCombo(w: WeightedCombos, rng: SeededRandom): number {
  const x = rng.next() * w.total;
  const cum = w.cumulative;
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] > x) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

const rangeEqBoardBits: HoldemBoardBits = {
  once: 0,
  twice: 0,
  thrice: 0,
  four: 0,
  sm0: 0,
  sm1: 0,
  sm2: 0,
  sm3: 0,
  sc0: 0,
  sc1: 0,
  sc2: 0,
  sc3: 0,
  count: 0,
};

/**
 * The Horse's showdown share (0..1) against every range at once, by seeded
 * Monte Carlo with exact card removal. Null when a range holds no combo the
 * Horse's cards and the board leave possible, or no deal could be completed.
 */
export function holdemRangeEquity(
  hero: readonly Card[],
  board: readonly Card[],
  ranges: readonly HoldemClassRange[],
  seed: number,
  iterations: number
): number | null {
  if (hero.length !== 2 || ranges.length === 0 || board.length > 5) return null;
  const deadFlags = new Uint8Array(52);
  const deadList = new Uint8Array(7);
  let deadCount = 0;
  const heroId0 = cardId(hero[0]);
  const heroId1 = cardId(hero[1]);
  if (heroId0 < 0 || heroId1 < 0 || heroId0 === heroId1) return null;
  deadFlags[heroId0] = 1;
  deadFlags[heroId1] = 1;
  deadList[deadCount++] = heroId0;
  deadList[deadCount++] = heroId1;
  const boardLen = board.length;
  const boardEvalIds = new Uint8Array(5);
  for (let i = 0; i < boardLen; i++) {
    const id = cardId(board[i]);
    if (id < 0 || deadFlags[id]) return null;
    deadFlags[id] = 1;
    deadList[deadCount++] = id;
    boardEvalIds[i] = DECK_ID_TO_EVAL_ID[id];
  }
  const numPools = ranges.length;
  const pools: WeightedCombos[] = new Array(numPools);
  for (let p = 0; p < numPools; p++) {
    const pool = weightedCombos(ranges[p], deadFlags);
    if (!(pool.total > 0)) return null;
    pools[p] = pool;
  }
  const rng = new SeededRandom(seed);
  const used = new Uint8Array(52);
  const villainEval0 = new Uint8Array(numPools);
  const villainEval1 = new Uint8Array(numPools);
  const heroEval0 = DECK_ID_TO_EVAL_ID[heroId0];
  const heroEval1 = DECK_ID_TO_EVAL_ID[heroId1];
  let share = 0;
  let dealt = 0;
  for (let it = 0; it < iterations; it++) {
    used.fill(0);
    for (let d = 0; d < deadCount; d++) used[deadList[d]] = 1;
    let ok = true;
    for (let p = 0; p < numPools; p++) {
      const pool = pools[p];
      let placed = false;
      for (let attempt = 0; attempt < 24 && !placed; attempt++) {
        const k = drawCombo(pool, rng);
        const a = pool.idA[k];
        const b = pool.idB[k];
        if (used[a] || used[b]) continue;
        used[a] = 1;
        used[b] = 1;
        villainEval0[p] = pool.evalA[k];
        villainEval1[p] = pool.evalB[k];
        placed = true;
      }
      if (!placed) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    for (let i = boardLen; i < 5; i++) {
      let id: number;
      do id = rng.nextInt(52);
      while (used[id]);
      used[id] = 1;
      boardEvalIds[i] = DECK_ID_TO_EVAL_ID[id];
    }
    packHoldemBoardBits(boardEvalIds, 5, rangeEqBoardBits);
    const heroScore = scoreHoldemPlus2Ids(rangeEqBoardBits, heroEval0, heroEval1, false);
    let best = true;
    let ties = 1;
    for (let p = 0; p < numPools; p++) {
      const s = scoreHoldemPlus2Ids(rangeEqBoardBits, villainEval0[p], villainEval1[p], false);
      if (s > heroScore) {
        best = false;
        break;
      }
      if (s === heroScore) ties++;
    }
    if (best) share += 1 / ties;
    dealt++;
  }
  return dealt > 0 ? share / dealt : null;
}

/** One way the hand can go after the call: its probability, the Horse's equity and the chips it can win. */
export interface AllInCallScenario {
  probability: number;
  equity: number;
  winnable: number;
}

export interface AllInCallPrice {
  /** The Horse's equity with nobody behind waking up (the first scenario). */
  equity: number;
  /** BF x C / (W + BF x C) for the first scenario. */
  requiredEquity: number;
  bubbleFactor: number;
  /** EV(call) - EV(fold) in chips, losses weighted by the bubble factor. */
  ev: number;
  /** ev / (W + BF x C): equity points above the price (equity - required equity with nobody behind). */
  margin: number;
  call: number;
  winnable: number;
  verdict: 'call' | 'fold';
}

/** The price of the call (see the file header). Null for a call or pot that is not a positive finite number. */
export function priceAllInCall(args: {
  call: number;
  bubbleFactor: number;
  scenarios: readonly AllInCallScenario[];
}): AllInCallPrice | null {
  const { call, scenarios } = args;
  const bf = Number.isFinite(args.bubbleFactor) && args.bubbleFactor >= 1 ? args.bubbleFactor : 1;
  if (!(call > 0) || !Number.isFinite(call) || scenarios.length === 0) return null;
  const first = scenarios[0];
  if (!(first.winnable > 0) || !Number.isFinite(first.winnable)) return null;
  let ev = 0;
  let mass = 0;
  for (const s of scenarios) {
    if (!(s.probability > 0)) continue;
    const eq = Math.max(0, Math.min(1, s.equity));
    ev += s.probability * (eq * s.winnable - bf * (1 - eq) * call);
    mass += s.probability;
  }
  if (!(mass > 0)) return null;
  ev /= mass;
  const scale = first.winnable + bf * call;
  const margin = ev / scale;
  return {
    equity: first.equity,
    requiredEquity: (bf * call) / scale,
    bubbleFactor: bf,
    ev,
    margin,
    call,
    winnable: first.winnable,
    verdict: margin > 0 ? 'call' : 'fold',
  };
}

/** A preflop action, public. `amount` is the street total the action made (the engine's ActionRecord). */
export interface PreflopPublicAction {
  seat: number;
  action: string;
  amount: number;
}

/** Each opponent's role in the pot, from the public preflop action. */
export type PreflopRole =
  | { kind: 'open_jam' | 'rejam' | 'jam_over_three_bet' | 'raise'; raiseIndex: number }
  | { kind: 'caller'; ofJam: boolean }
  | { kind: 'limper' };

/**
 * What each seat did last that counts: its last raise (with the raise's order
 * and whether the raise was all in) or, after it, a call. A raise is an
 * action whose street total is above the level before it; an all-in at or
 * under the level is a call.
 */
export function preflopRoles(
  history: readonly PreflopPublicAction[],
  allInSeats: ReadonlySet<number>,
  bigBlind: number
): Map<number, PreflopRole> {
  const roles = new Map<number, PreflopRole>();
  let level = bigBlind;
  let raises = 0;
  let lastRaiseWasJam = false;
  for (const a of history) {
    const aggressive = a.action === 'raise' || a.action === 'bet' || a.action === 'all_in';
    if (aggressive && a.amount > level + 1e-9) {
      raises++;
      level = a.amount;
      const jam = a.action === 'all_in' || allInSeats.has(a.seat);
      lastRaiseWasJam = jam;
      roles.set(a.seat, {
        kind: !jam
          ? 'raise'
          : raises === 1
            ? 'open_jam'
            : raises === 2
              ? 'rejam'
              : 'jam_over_three_bet',
        raiseIndex: raises,
      });
    } else if (a.action === 'call' || a.action === 'all_in') {
      roles.set(
        a.seat,
        raises === 0 ? { kind: 'limper' } : { kind: 'caller', ofJam: lastRaiseWasJam }
      );
    }
  }
  return roles;
}
