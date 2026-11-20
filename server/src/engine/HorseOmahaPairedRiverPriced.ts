/**
 * OMAHA PAIRED-BOARD RIVER, PRICED ON HIS RANGE (2026-11-18, lane PAIRED-RIVER;
 * option omahaPairedBoardRiverIsPriced, default OFF, read `=== true`).
 *
 * Hand #59993188 (PLO5 1/2 fast-table cash): a Horse re-raised aces before the
 * flop, called a 4-bet, called the flop and the turn, made the ace-high flush
 * on a river that paired the board and folded to a bet of 54 percent of the
 * pot at a price of 26.0 percent. Only a full house or quads beat it.
 *
 * Two layers folded it. The facing-bet expected value (HorseOmahaFacingBetEv)
 * ranks the bettor's value bets over ALL five-card holdings: on that board
 * 23.6 percent of random holdings are a full house, so its value region (19.2
 * percent) held nothing the nut flush beats. Behind it the paired-board fold
 * (HorsePloPairedBoardFold, owner 2026-10-25) folds anything short of a full
 * house. The owner's ruling of 2026-11-17 ("EVERY DECISION NEEDS TO BE 100%
 * INDEPENDANT AND DATA AND MATH DERRIVED AND BY RANGES, NEVER BLANKETS")
 * supersedes the categorical fold where a priced verdict exists.
 *
 * This module is that priced verdict, for one spot only: PLO4 / PLO5 cash,
 * one board, the river, heads-up, the FIRST bet of the street (not a raise),
 * made by a person (HorseLogic asks only then: the river frequencies below are
 * measured on people), a paired board, and the Horse holds a straight or a flush that no straight,
 * flush or straight flush of the unseen cards beats (only a full house or
 * quads does). Everything else is untouched.
 *
 *  RANGE   The bettor's holdings are drawn from the unseen cards (the Horse's
 *          own cards, the board and dead cards removed: its blockers to full
 *          houses and to lower flushes and straights are exact) with a
 *          deterministic generator seeded by the cards. No draw from the
 *          brain's random stream; the same cards give the same answer.
 *          BEFORE THE FLOP: when he re-raised (a 3-bet or more) his holdings
 *          are the top `width` by the engine's preflop percentile, the width
 *          the engine already uses for a person's re-raise
 *          (omahaPreflopDefenceRangeWidth at the measured population rate; a
 *          4-bet narrows it by the engine's line rule). An open or a call
 *          does not narrow it.
 *          FLOP AND TURN: on a street he bet or raised, the holdings inside
 *          the strongest share V of that range on THAT board (the engine's
 *          value share for the size of his bet) keep full weight and the rest
 *          keep a weight below 1; on a street he only called, the top caller
 *          share keeps full weight and the rest another weight. A street he
 *          checked carries no weight. The four weights are FITTED to recorded
 *          hands (OMAHA_PAIRED_RIVER_FIT), not stated; in a re-raised pot
 *          (little stack behind, wide continuation bets) the weights of the
 *          streets he bet are raised to a fitted power.
 *  RIVER   What he bets on this river is measured, not assumed. His holdings
 *          fall in four classes on the final board: a full house or better,
 *          a flush or straight, trips or two pair, less. Against a full
 *          house (weight 1) each other class is bet with a relative frequency
 *          k(class, share of the pot) fitted to recorded river bets by people
 *          on paired boards whose cards are known (OMAHA_PAIRED_RIVER_FIT).
 *  PRICE   EV(call) = P(win) x what the call wins after rake + P(tie) x the
 *          split - P(lose) x the call, at the actual price; the call is made
 *          when it exceeds the facing-bet rule's one margin.
 *
 * Pure: no telemetry, no opponent memory, nothing keyed to a player.
 */
import type { Card } from '../types.js';
import { omahaPreflopPercentile, scoreOmahaHiPartial } from './HorseEval.js';
import { RANKS, SUITS } from './PokerEngine.js';
import {
  OMAHA_EV_CALLER_SHARE,
  OMAHA_EV_VALUE_SHARE,
  omahaBetSizeBucket,
  type OmahaFacingBetEvSpot,
  type OmahaFacingBetEvVerdict,
} from './HorseOmahaFacingBetEv.js';
import {
  OMAHA_FLOP_EV_CALLER_SHARE,
  OMAHA_FLOP_EV_VALUE_SHARE,
} from './HorseOmahaFlopFacingBetEv.js';
import { omahaPreflopDefenceRangeWidth } from './HorseOmahaPreflopReraiseDefence.js';

const CAT = 0x100000;
const CAT_STRAIGHT = 5;
const CAT_FLUSH = 6;
const CAT_BOAT = 7;
const CAT_QUADS = 8;

/** Bettor holdings drawn for one verdict, and the tries allowed per holding (the preflop cut rejects). */
export const OMAHA_PAIRED_RIVER_SAMPLES = 3000;
export const OMAHA_PAIRED_RIVER_TRIES_PER_SAMPLE = 60;

/**
 * A person's measured re-raise rate by game, the rate the engine's preflop
 * re-raise defence was fitted on (HorseOmahaPreflopReraiseDefence,
 * RANGE_WIDTH_*: 0.117 for PLO4 people over 576 recorded re-raising hands,
 * 0.224 for PLO5 people over 414). Through omahaPreflopDefenceRangeWidth they
 * give a 3-bet width of 0.40 / 0.50 and a 4-bet width of 0.28 / 0.38.
 */
export const OMAHA_PAIRED_RIVER_RERAISE_RATE: Readonly<Record<4 | 5, number>> = {
  4: 0.117,
  5: 0.224,
};

/**
 * The fitted numbers (FIT block below; method and rows in the option's
 * authority file). `fs`, `tt`, `weak`: log k = a + b x min(share of the pot,
 * OMAHA_PAIRED_RIVER_SIZE_CAP) for a flush or straight, trips or two pair,
 * and less, against a full house (k = 1). `aggrOther` / `callOther`: the
 * weight of a holding outside the value share on a street he bet / outside
 * the caller share on a street he called. `reraisedPower`: in a pot re-raised
 * before the flop, aggrOther is raised to this power.
 */
export interface OmahaPairedRiverParams {
  fs: readonly [number, number];
  tt: readonly [number, number];
  weak: readonly [number, number];
  aggrOther: Readonly<Record<'flop' | 'turn', number>>;
  callOther: Readonly<Record<'flop' | 'turn', number>>;
  reraisedPower: number;
}

/** The share of the pot above which the fitted line is flat. */
export const OMAHA_PAIRED_RIVER_SIZE_CAP = 1.5;

/* FIT-BEGIN: the full fit of 2026-11-18 (614 recorded river bets by people on paired boards, 29 people, 2026-10-19 to
 * 2026-11-18; docs/horse-option-authority.d/omahaPairedBoardRiverIsPriced.md, section "The fit") */
export const OMAHA_PAIRED_RIVER_FIT: OmahaPairedRiverParams = Object.freeze({
  fs: [0.516, -1.715] as const,
  tt: [-0.317, -1.729] as const,
  weak: [-1.16, -0.128] as const,
  aggrOther: Object.freeze({ flop: 0.437, turn: 0.476 }),
  callOther: Object.freeze({ flop: 0.652, turn: 0.74 }),
  reraisedPower: 0.397,
});
/* FIT-END */

export type OmahaPairedRiverStreet =
  | { kind: 'aggr'; potFrac: number; raise: boolean }
  | { kind: 'call' }
  | { kind: 'none' };

/** The bettor's public line this hand. */
export interface OmahaPairedRiverLine {
  /** his deepest preflop raise: 0 none, 1 an open or isolation raise, 2 a 3-bet, 3 a 4-bet ... */
  preflopDepth: number;
  flop: OmahaPairedRiverStreet;
  turn: OmahaPairedRiverStreet;
}

interface LineAction {
  stage: string;
  action: string;
  amount: number;
  seat: number;
  isFullRaise?: boolean;
}

/**
 * The bettor's line from the public action history. `pot` is the pot now (it
 * holds every wager made so far, the river bet faced included).
 */
export function omahaPairedRiverLineOf(
  history: readonly LineAction[] | undefined,
  bettorSeat: number,
  pot: number
): OmahaPairedRiverLine {
  const h = history ?? [];
  let depth = 0;
  let preflopDepth = 0;
  for (const a of h) {
    if (String(a.stage) !== 'preflop') continue;
    if (
      a.action === 'raise' ||
      a.action === 'bet' ||
      (a.action === 'all_in' && a.isFullRaise !== undefined)
    ) {
      depth++;
      if (a.seat === bettorSeat) preflopDepth = depth;
    }
  }
  /** One street: what every seat put in, and the bettor's part in it. */
  const street = (
    st: string
  ): {
    put: number;
    kind: 'aggr' | 'call' | 'none';
    raise: boolean;
    wager: number;
    before: number;
  } => {
    const totals = new Map<number, number>();
    let level = 0;
    let wagers = 0;
    let put = 0;
    let kind: 'aggr' | 'call' | 'none' = 'none';
    let raise = false;
    let wager = 0;
    let before = 0;
    for (const a of h) {
      if (String(a.stage) !== st) continue;
      const prev = totals.get(a.seat) ?? 0;
      const amt = Number.isFinite(a.amount) ? Math.max(0, a.amount) : 0;
      if (a.action === 'call') {
        totals.set(a.seat, prev + amt);
        put += amt;
        if (a.seat === bettorSeat && amt > 0 && kind === 'none') kind = 'call';
      } else if (a.action === 'bet' || a.action === 'raise' || a.action === 'all_in') {
        const now = Math.max(prev, amt);
        totals.set(a.seat, now);
        if (now > level + 0.005) {
          wagers++;
          if (a.seat === bettorSeat && kind !== 'aggr') {
            kind = 'aggr';
            raise = wagers >= 2;
            wager = now - level;
            before = put;
          }
          level = now;
        } else if (a.seat === bettorSeat && now > prev && kind === 'none') kind = 'call';
        put += now - prev;
      }
    }
    return { put, kind, raise, wager, before };
  };
  const river = street('river');
  const turn = street('turn');
  const flop = street('flop');
  const potBeforeTurn = pot - river.put - turn.put;
  const potBeforeFlop = potBeforeTurn - flop.put;
  const of = (s: ReturnType<typeof street>, potBefore: number): OmahaPairedRiverStreet => {
    if (s.kind === 'aggr') {
      const base = potBefore + s.before;
      const potFrac = base > 0.005 ? s.wager / base : 1;
      return { kind: 'aggr', potFrac: Number.isFinite(potFrac) ? potFrac : 1, raise: s.raise };
    }
    return s.kind === 'call' ? { kind: 'call' } : { kind: 'none' };
  };
  return { preflopDepth, flop: of(flop, potBeforeFlop), turn: of(turn, potBeforeTurn) };
}

const key = (c: Card): string => `${c.rank}:${c.suit}`;

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

function unseenOf(seen: readonly Card[]): Card[] {
  const s = new Set(seen.map(key));
  const out: Card[] = [];
  for (const suit of SUITS)
    for (const rank of RANKS) {
      const c = { rank, suit } as Card;
      if (!s.has(key(c))) out.push(c);
    }
  return out;
}

/** Every two-card pair of `unseen` scored on `board` (symmetric n x n). */
function pairTable(unseen: readonly Card[], board: Card[]): Float64Array {
  const n = unseen.length;
  const t = new Float64Array(n * n);
  const two: Card[] = [unseen[0], unseen[0]];
  for (let i = 0; i < n; i++) {
    two[0] = unseen[i];
    for (let j = i + 1; j < n; j++) {
      two[1] = unseen[j];
      const s = scoreOmahaHiPartial(two, board);
      t[i * n + j] = s;
      t[j * n + i] = s;
    }
  }
  return t;
}

/**
 * The spot's hand test: a paired five-card board, the Horse holds a straight
 * or a flush, and every unseen two-card pair that beats it makes a full house
 * or quads (no better straight, flush or straight flush exists). Hands of four
 * or five cards only.
 */
export function omahaPairedRiverNutClass(hole: Card[], board: Card[], dead: Card[] = []): boolean {
  if (!Array.isArray(hole) || (hole.length !== 4 && hole.length !== 5)) return false;
  if (!Array.isArray(board) || board.length !== 5) return false;
  if (new Set(board.map((c) => c.rank)).size === 5) return false;
  const hero = scoreOmahaHiPartial(hole, board);
  const cat = Math.floor(hero / CAT);
  if (cat !== CAT_STRAIGHT && cat !== CAT_FLUSH) return false;
  const unseen = unseenOf([...hole, ...board, ...dead]);
  const two: Card[] = [unseen[0], unseen[0]];
  for (let i = 0; i < unseen.length; i++) {
    two[0] = unseen[i];
    for (let j = i + 1; j < unseen.length; j++) {
      two[1] = unseen[j];
      const s = scoreOmahaHiPartial(two, board);
      if (s <= hero) continue;
      const c = Math.floor(s / CAT);
      if (c !== CAT_BOAT && c !== CAT_QUADS) return false;
    }
  }
  return true;
}

/** The bettor's classes on the final board: 0 a full house or better, 1 a flush or straight, 2 trips or two pair, 3 less. */
export type OmahaPairedRiverClass = 0 | 1 | 2 | 3;
export function omahaPairedRiverClassOf(score: number): OmahaPairedRiverClass {
  const c = Math.floor(score / CAT);
  return c >= CAT_BOAT ? 0 : c >= CAT_STRAIGHT ? 1 : c >= 3 ? 2 : 3;
}

/**
 * The counted range before any fitted number is applied: bettor holdings by
 * cell. Cell = ((flopIn x 2 + turnIn) x 4 + class) x 3 + outcome, flopIn /
 * turnIn 1 when the holding is inside the street's top share (or the street
 * carries no information), class as omahaPairedRiverClassOf, outcome 0 the
 * Horse wins, 1 ties, 2 loses.
 */
export interface OmahaPairedRiverCells {
  samples: number;
  tries: number;
  preflopWidth: number;
  reraised: boolean;
  flop: 'aggr' | 'call' | 'none';
  turn: 'aggr' | 'call' | 'none';
  cells: number[];
}

export interface OmahaPairedRiverRange {
  samples: number;
  preflopWidth: number;
  /** the line-weighted mass of each class before the river bet (sums to 1) */
  mass: [number, number, number, number];
  /** inside each class, the mass the Horse beats and ties */
  win: [number, number, number, number];
  tie: [number, number, number, number];
}

/** The share of his holdings that keeps full weight on a street, by what he did there; null: no information. */
export function omahaPairedRiverStreetShare(
  st: 'flop' | 'turn',
  l: OmahaPairedRiverStreet
): number | null {
  if (l.kind === 'none') return null;
  if (l.kind === 'call')
    return st === 'flop' ? OMAHA_FLOP_EV_CALLER_SHARE : OMAHA_EV_CALLER_SHARE.turn;
  const bucket = l.raise ? 'raise' : omahaBetSizeBucket(l.potFrac);
  return st === 'flop' ? OMAHA_FLOP_EV_VALUE_SHARE[bucket] : OMAHA_EV_VALUE_SHARE.turn[bucket];
}

/**
 * The bettor's holdings on this river against the Horse's cards, counted by
 * cell. Null when the cards are not a four- or five-card river hand or too
 * few holdings could be drawn. It does not test the spot (the caller does).
 */
export function omahaPairedRiverCells(
  hole: Card[],
  board: Card[],
  dead: Card[],
  line: OmahaPairedRiverLine
): OmahaPairedRiverCells | null {
  const size = hole.length;
  if ((size !== 4 && size !== 5) || board.length !== 5) return null;
  const unseen = unseenOf([...hole, ...board, ...dead]);
  const n = unseen.length;
  if (n < size + 2) return null;
  const hero = scoreOmahaHiPartial(hole, board);
  const river = pairTable(unseen, board);
  const shares = [
    omahaPairedRiverStreetShare('flop', line.flop),
    omahaPairedRiverStreetShare('turn', line.turn),
  ];
  const tables = [
    shares[0] === null ? null : pairTable(unseen, board.slice(0, 3)),
    shares[1] === null ? null : pairTable(unseen, board.slice(0, 4)),
  ];
  const reraised = line.preflopDepth >= 2;
  const preflopWidth = reraised
    ? omahaPreflopDefenceRangeWidth(
        OMAHA_PAIRED_RIVER_RERAISE_RATE[size as 4 | 5],
        line.preflopDepth
      )
    : 1;
  const lo = 1 - preflopWidth;
  const rnd = generator(seedOf([...hole, ...board]));
  const want = OMAHA_PAIRED_RIVER_SAMPLES;
  const budget = want * OMAHA_PAIRED_RIVER_TRIES_PER_SAMPLE;
  const idx = new Int32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  const riverScore = new Float64Array(want);
  const streetScore = [new Float64Array(want), new Float64Array(want)];
  const cards: Card[] = new Array(size);
  let got = 0;
  let tries = 0;
  for (; got < want && tries < budget; tries++) {
    for (let i = 0; i < size; i++) {
      const j = i + Math.floor(rnd() * (n - i));
      const t = idx[i];
      idx[i] = idx[j];
      idx[j] = t;
    }
    if (lo > 1e-9) {
      for (let i = 0; i < size; i++) cards[i] = unseen[idx[i]];
      if (omahaPreflopPercentile(cards, false) < lo) continue;
    }
    let r = 0;
    let f = 0;
    let t = 0;
    for (let a = 0; a < size; a++)
      for (let b = a + 1; b < size; b++) {
        const at = idx[a] * n + idx[b];
        if (river[at] > r) r = river[at];
        if (tables[0] && tables[0][at] > f) f = tables[0][at];
        if (tables[1] && tables[1][at] > t) t = tables[1][at];
      }
    riverScore[got] = r;
    streetScore[0][got] = f;
    streetScore[1][got] = t;
    got++;
  }
  if (got < want / 2) return null;
  // The bar of each street: the score of the holding at the top share of his range on that board.
  const bars = shares.map((share, k) => {
    if (share === null) return -Infinity;
    const sorted = Array.from(streetScore[k].subarray(0, got)).sort((x, y) => y - x);
    return sorted[Math.min(got - 1, Math.max(0, Math.ceil(share * got) - 1))];
  });
  const cells: number[] = new Array(48).fill(0);
  for (let i = 0; i < got; i++) {
    const fi = streetScore[0][i] >= bars[0] ? 1 : 0;
    const ti = streetScore[1][i] >= bars[1] ? 1 : 0;
    const c = omahaPairedRiverClassOf(riverScore[i]);
    const o = hero > riverScore[i] ? 0 : hero === riverScore[i] ? 1 : 2;
    cells[((fi * 2 + ti) * 4 + c) * 3 + o]++;
  }
  return {
    samples: got,
    tries,
    preflopWidth,
    reraised,
    flop: line.flop.kind,
    turn: line.turn.kind,
    cells,
  };
}

/** The weight of a holding outside a street's top share. */
export function omahaPairedRiverOutsideWeight(
  st: 'flop' | 'turn',
  kind: 'aggr' | 'call' | 'none',
  reraised: boolean,
  params: OmahaPairedRiverParams = OMAHA_PAIRED_RIVER_FIT
): number {
  const clamp = (x: number): number => Math.min(1, Math.max(0, Number.isFinite(x) ? x : 1));
  if (kind === 'none') return 1;
  if (kind === 'call') return clamp(params.callOther[st]);
  const g = clamp(params.aggrOther[st]);
  return reraised ? clamp(Math.pow(g, Math.max(0, params.reraisedPower))) : g;
}

/** The line-weighted range from the counted cells and the fitted weights. Null when nothing is left. */
export function omahaPairedRiverRangeOf(
  counted: OmahaPairedRiverCells,
  params: OmahaPairedRiverParams = OMAHA_PAIRED_RIVER_FIT
): OmahaPairedRiverRange | null {
  const gf = omahaPairedRiverOutsideWeight('flop', counted.flop, counted.reraised, params);
  const gt = omahaPairedRiverOutsideWeight('turn', counted.turn, counted.reraised, params);
  const mass: [number, number, number, number] = [0, 0, 0, 0];
  const win: [number, number, number, number] = [0, 0, 0, 0];
  const tie: [number, number, number, number] = [0, 0, 0, 0];
  let total = 0;
  for (let fi = 0; fi < 2; fi++)
    for (let ti = 0; ti < 2; ti++) {
      const w = (fi ? 1 : gf) * (ti ? 1 : gt);
      for (let c = 0; c < 4; c++) {
        const at = ((fi * 2 + ti) * 4 + c) * 3;
        const all = counted.cells[at] + counted.cells[at + 1] + counted.cells[at + 2];
        mass[c] += w * all;
        win[c] += w * counted.cells[at];
        tie[c] += w * counted.cells[at + 1];
        total += w * all;
      }
    }
  if (!(total > 0)) return null;
  for (let c = 0; c < 4; c++) {
    mass[c] /= total;
    win[c] /= total;
    tie[c] /= total;
  }
  return { samples: counted.samples, preflopWidth: counted.preflopWidth, mass, win, tie };
}

/** The bettor's line-conditioned range on this river against the Horse's cards (cells, then weights). */
export function omahaPairedRiverRange(
  hole: Card[],
  board: Card[],
  dead: Card[],
  line: OmahaPairedRiverLine,
  params: OmahaPairedRiverParams = OMAHA_PAIRED_RIVER_FIT
): OmahaPairedRiverRange | null {
  const counted = omahaPairedRiverCells(hole, board, dead, line);
  return counted ? omahaPairedRiverRangeOf(counted, params) : null;
}

/** The relative river bet frequency of each class against a full house (1), at this share of the pot. */
export function omahaPairedRiverBetWeights(
  potFrac: number,
  params: OmahaPairedRiverParams = OMAHA_PAIRED_RIVER_FIT
): [number, number, number, number] {
  const x = Math.min(
    OMAHA_PAIRED_RIVER_SIZE_CAP,
    Math.max(0, Number.isFinite(potFrac) ? potFrac : 0)
  );
  const k = (p: readonly [number, number]): number => Math.exp(p[0] + p[1] * x);
  return [1, k(params.fs), k(params.tt), k(params.weak)];
}

export interface OmahaPairedRiverVerdict {
  call: boolean;
  ev: number;
  margin: number;
  pWin: number;
  pTie: number;
  price: number;
  /** the share of his river bets that is a full house or better, as priced */
  boatShare: number;
  /** his range before the river bet: the mass of each class */
  mass: [number, number, number, number];
  /** the relative bet frequency of each class used */
  weights: [number, number, number, number];
  preflopWidth: number;
  samples: number;
}

/**
 * The priced verdict from a counted range: EV(call) at the actual price
 * against what he bets on this river. `margin` is in chips (the facing-bet
 * rule's one margin for this pot).
 */
export function omahaPairedRiverVerdict(
  range: OmahaPairedRiverRange,
  spot: { potFrac: number; paid: number; winnable: number },
  ctx: { rake?: number; margin: number },
  params: OmahaPairedRiverParams = OMAHA_PAIRED_RIVER_FIT
): OmahaPairedRiverVerdict {
  const weights = omahaPairedRiverBetWeights(spot.potFrac, params);
  let bets = 0;
  let w = 0;
  let t = 0;
  for (let c = 0; c < 4; c++) {
    bets += weights[c] * range.mass[c];
    w += weights[c] * range.win[c];
    t += weights[c] * range.tie[c];
  }
  const pWin = bets > 0 ? w / bets : 0;
  const pTie = bets > 0 ? t / bets : 0;
  const rake = Math.max(0, Math.min(0.2, Number.isFinite(ctx.rake) ? (ctx.rake as number) : 0));
  const win = spot.winnable * (1 - rake);
  const pLose = Math.max(0, 1 - pWin - pTie);
  const ev = pWin * win + pTie * ((win - spot.paid) / 2) - pLose * spot.paid;
  return {
    call: ev > ctx.margin,
    ev,
    margin: ctx.margin,
    pWin,
    pTie,
    price: spot.paid / (spot.winnable + spot.paid),
    boatShare: bets > 0 ? (weights[0] * range.mass[0]) / bets : 1,
    mass: range.mass,
    weights,
    preflopWidth: range.preflopWidth,
    samples: range.samples,
  };
}

/**
 * The rule's one entry: the facing-bet verdict of a spot this module covers,
 * priced on the bettor's line-conditioned range; null outside the spot (the
 * facing-bet verdict then stands as it is). The spot: the river, heads-up,
 * the first bet of the street, four or five cards, a paired board, and a
 * straight or flush only a full house or quads beats; not the lead into the
 * turn aggressor the facing-bet rule reviewed (hand 59730132). `base` is the
 * facing-bet verdict of the same decision: its margin is the margin here.
 */
export function omahaPairedRiverPricedOver(
  spot: OmahaFacingBetEvSpot,
  base: OmahaFacingBetEvVerdict,
  hole: Card[],
  board: Card[],
  dead: Card[],
  history: readonly LineAction[] | undefined,
  pot: number,
  rake: number,
  heroSeat: number
): OmahaFacingBetEvVerdict | null {
  if (spot.street !== 'river' || spot.isRaise) return null;
  if (spot.callers + spot.allIns + spot.behind > 0) return null;
  if (!omahaPairedRiverNutClass(hole, board, dead)) return null;
  // Hand 59730132 (HorseOmahaFacingBetEv, pairedRiverDonkIntoAggressor): a player who only called
  // the earlier streets and leads 40 percent of the pot or more into the Horse that bet the turn
  // keeps the reviewed facing-bet verdict; this option does not price that spot.
  if (
    spot.potFrac >= 0.4 &&
    spot.aggressorStreets === 0 &&
    spot.callerStreets >= 1 &&
    omahaPairedRiverLineOf(history, heroSeat, pot).turn.kind === 'aggr'
  )
    return null;
  const range = omahaPairedRiverRange(
    hole,
    board,
    dead,
    omahaPairedRiverLineOf(history, spot.bettorSeat, pot)
  );
  if (!range) return null;
  const v = omahaPairedRiverVerdict(range, spot, { rake, margin: base.margin });
  return {
    ...base,
    call: v.call,
    ev: v.ev,
    pWin: v.pWin,
    pTie: v.pTie,
    pairedRiverPriced: {
      boatShare: v.boatShare,
      preflopWidth: v.preflopWidth,
      samples: v.samples,
    },
  };
}
