/**
 * LAW (PLO-OWNER lead-7 2026-11-26): THE FAST JOINT SAMPLE GIVES THE SAME NUMBERS AS THE SAMPLE IT REPLACED.
 *
 * omahaMultiwayValueBetIsPriced (M3: PLO4 / PLO5 cash, checked to the Horse by two to four players) cost p50 74.9 /
 * p95 125.8 / max 214.6 ms where it applied, and omahaFacingBetFieldIsJoint (M1) p95 12.6 ms: both price through
 * omahaPricedJointRows, which rebuilt and re-scored the hand's 1,024-holding pool on every call (M3 calls it up to
 * thirteen times a decision) and scored every sampled holding over every pair and board triple on card objects. The
 * sample now keeps the hand's pool by card ids, scores with HorseOmahaFastScore through a table keyed by a pair's two
 * ranks (one per set of board ranks) plus the one-suit triples, and reads a river holding's score from the pool.
 * Nothing else changed: the same random draws in the same order, the same samples, the same sums.
 *
 *  1. SCORE: on random PLO4 / PLO5 holdings on flops, turns and rivers, the fast score orders any two holdings on a
 *     board exactly as HorseEval.scoreOmahaHiPartial does (equal when equal), and omahaPricedJointCategory is
 *     HorseEval's hand category (a royal flush apart from a straight flush).
 *  2. ROWS: on the committed real states (HorseOmahaFacingBetPriced.states.ndjson.gz: flop, turn and river, PLO4
 *     and PLO5) and on re-dealt copies of them, for the fields the options ask for (heads-up, M1's callers and
 *     players behind with and without M2's flush-draw shares, M3's checked and calling fields of one to four), the
 *     live rows equal the frozen sample's (__tests__/HorseOmahaPricedJointSample.frozen.test-support.ts, the sample
 *     as it was at f39476d4a536) field for field, bit for bit; so do repeated and interleaved calls (the kept pool).
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '../types.js';
import { scoreOmahaHiPartial } from './HorseEval.js';
import { loadPricedStates } from './HorseOmahaFacingBetPriced.test-support.js';
import {
  OMAHA_FAST_PAIR_STRIDE,
  omahaFastBestPre,
  omahaFastCard,
  omahaFastPairsInto,
  omahaFastTriplesPre,
} from './HorseOmahaFastScore.js';
import {
  OMAHA_MEASURED_BINS,
  omahaMeasuredBettorHist,
  omahaMeasuredCallerHist,
  omahaMeasuredCheckerHist,
  omahaMeasuredContinueRate,
  omahaMeasuredFlushDrawShare,
  type OmahaMeasuredStreet,
} from './HorseOmahaMeasuredBettorRange.js';
import {
  omahaPricedJointCategory,
  omahaPricedJointRows,
  type OmahaPricedJointField,
  type OmahaPricedJointRows,
} from './HorseOmahaPricedJointSample.js';
import { frozenOmahaPricedJointRows } from './__tests__/HorseOmahaPricedJointSample.frozen.test-support.js';

const RANKS = '23456789TJQKA';
const SUITS = ['clubs', 'diamonds', 'hearts', 'spades'] as const;
const DECK: Card[] = SUITS.flatMap((s) => [...RANKS].map((r) => ({ rank: r, suit: s }) as Card));

function stream(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

function shuffled(rnd: () => number): number[] {
  const idx = DECK.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx;
}

function fastFull(hole: Card[], board: Card[]): number {
  const n = hole.length;
  const pairs = new Int32Array(((n * (n - 1)) / 2) * OMAHA_FAST_PAIR_STRIDE);
  const np = omahaFastPairsInto(Int32Array.from(hole.map(omahaFastCard)), 0, n, pairs, 0);
  return omahaFastBestPre(pairs, 0, np, omahaFastTriplesPre(board.map(omahaFastCard)));
}

/** The whole result as plain values, so a difference of one bit in any number fails. */
function plain(r: OmahaPricedJointRows | null): unknown {
  if (!r) return null;
  return { ...r, rows: Array.from(r.rows), turnOf: Array.from(r.turnOf) };
}

interface Ask {
  label: string;
  hist: readonly number[];
  field: OmahaPricedJointField;
  salt?: number;
}

/** The fields the options ask for on a street, at a size. */
function asks(variant: string, street: OmahaMeasuredStreet, frac: number): Ask[] {
  const out: Ask[] = [];
  const none = { always: [], behind: 0, continueRate: 0, behindHist: null };
  for (const line of ['agg', 'non', 'raise'] as const)
    for (const into of ['hu', 'mw'] as const) {
      const h = omahaMeasuredBettorHist(variant, street, line, frac, into);
      if (h) out.push({ label: `bettor ${line} ${into}`, hist: h, field: none });
    }
  const caller = omahaMeasuredCallerHist(variant, street, frac, 'mw');
  const cont = omahaMeasuredContinueRate(variant, street, frac, 'mw');
  const bettor = omahaMeasuredBettorHist(variant, street, 'agg', frac, 'mw');
  if (caller && bettor) {
    const fd =
      street === 'river'
        ? null
        : Array.from({ length: OMAHA_MEASURED_BINS }, (_, b) =>
            omahaMeasuredFlushDrawShare(variant, street, b)
          );
    // M1 (and M2): callers, earlier all-ins and players behind
    for (const [a, b] of [
      [1, 0],
      [0, 1],
      [1, 1],
      [2, 1],
      [1, 3],
      [3, 2],
    ] as const)
      for (const flush of [false, true]) {
        if (flush && !fd) continue;
        out.push({
          label: `M1 ${a} in ${b} behind${flush ? ' M2' : ''}`,
          hist: bettor,
          field: {
            always: Array.from({ length: a }, () => caller),
            behind: b,
            continueRate: cont ?? 0.4,
            behindHist: b % 2 ? caller : null,
            flushDrawByBin: flush ? fd : null,
          },
        });
      }
    // M3: j callers without the nut bin
    const r = Math.max(0, Math.min(1, caller[0]));
    if (r < 1) {
      const callers = caller.map((x, b) => (b === 0 ? 0 : x / (1 - r)));
      for (let j = 1; j <= 4; j++)
        out.push({
          label: `M3 ${j} callers`,
          hist: callers,
          field: {
            always: Array.from({ length: j - 1 }, () => callers),
            behind: 0,
            continueRate: 0,
            behindHist: null,
          },
        });
    }
  }
  for (const k of [2, 3, 4]) {
    const checked = omahaMeasuredCheckerHist(variant, street, k);
    if (checked)
      out.push({
        label: `M3 ${k} checked`,
        hist: checked,
        field: {
          always: Array.from({ length: k - 1 }, () => checked),
          behind: 0,
          continueRate: 0,
          behindHist: null,
        },
      });
  }
  // a one-bin range, a value-only and a weak-only range, a salted seed
  const one = new Array(OMAHA_MEASURED_BINS).fill(0);
  one[0] = 1;
  const last = new Array(OMAHA_MEASURED_BINS).fill(0);
  last[OMAHA_MEASURED_BINS - 1] = 1;
  out.push({ label: 'one strong bin', hist: one, field: none });
  out.push({ label: 'one weak bin', hist: last, field: { ...none, always: [one] } });
  out.push({
    label: 'uniform salted',
    hist: new Array(OMAHA_MEASURED_BINS).fill(1 / OMAHA_MEASURED_BINS),
    field: { ...none, always: [last], behind: 1, continueRate: 0.5 },
    salt: 7,
  });
  return out;
}

describe('LAW: the fast joint sample gives the same numbers as the sample it replaced', () => {
  it('1. the fast score orders holdings as HorseEval does, and the category is HorseEval`s', () => {
    const rnd = stream(1126);
    let compared = 0;
    const seen = new Set<number>();
    for (let it = 0; it < 4000; it++) {
      const nh = it % 2 ? 4 : 5;
      const idx = shuffled(rnd);
      // flush-heavy boards a third of the time (one or two suits), straight-flush boards among them
      const from = it % 3 === 0 ? idx.filter((i) => Math.floor(i / 13) <= it % 2) : idx;
      const nb = 3 + (it % 3);
      const board = from.slice(0, nb).map((i) => DECK[i]);
      const used = new Set(from.slice(0, nb));
      const rest = (it % 4 === 0 ? [...from, ...idx] : idx).filter((i) => !used.has(i));
      const holes: Card[][] = [];
      for (let h = 0; h < 6; h++) holes.push(rest.slice(h * nh, h * nh + nh).map((i) => DECK[i]));
      const slow = holes.map((h) => scoreOmahaHiPartial(h, board));
      const fast = holes.map((h) => fastFull(h, board));
      for (let a = 0; a < holes.length; a++) {
        expect(omahaPricedJointCategory(fast[a]) + 1, JSON.stringify([holes[a], board])).toBe(
          Math.floor(slow[a] / 0x100000)
        );
        seen.add(Math.floor(slow[a] / 0x100000));
        for (let b = a + 1; b < holes.length; b++) {
          expect(Math.sign(fast[a] - fast[b]), JSON.stringify([holes[a], holes[b], board])).toBe(
            Math.sign(slow[a] - slow[b])
          );
          compared++;
        }
      }
    }
    expect(compared).toBe(4000 * 15);
    // every category from high card to straight flush was met (a royal flush is checked directly below)
    for (let c = 1; c <= 9; c++) expect(seen.has(c), `category ${c}`).toBe(true);
    const c = (rank: string, suit: (typeof SUITS)[number]): Card => ({ rank, suit }) as Card;
    const royalBoard = [c('A', 'spades'), c('K', 'spades'), c('Q', 'spades'), c('2', 'hearts')];
    const royal = [c('J', 'spades'), c('T', 'spades'), c('3', 'clubs'), c('4', 'clubs')];
    const flush9 = [c('9', 'spades'), c('8', 'spades'), c('3', 'diamonds'), c('4', 'diamonds')];
    expect(Math.floor(scoreOmahaHiPartial(royal, royalBoard) / 0x100000)).toBe(10);
    expect(omahaPricedJointCategory(fastFull(royal, royalBoard))).toBe(9);
    const sfBoard = [c('K', 'spades'), c('Q', 'spades'), c('J', 'spades'), c('2', 'hearts')];
    const sf = [c('T', 'spades'), c('9', 'spades'), c('3', 'clubs'), c('4', 'clubs')];
    expect(Math.floor(scoreOmahaHiPartial(sf, sfBoard) / 0x100000)).toBe(9);
    expect(omahaPricedJointCategory(fastFull(sf, sfBoard))).toBe(8);
    expect(omahaPricedJointCategory(fastFull(flush9, sfBoard))).toBe(5);
  });

  it('2. the live rows equal the frozen sample on the committed states and on re-dealt copies', () => {
    const states = loadPricedStates();
    const rnd = stream(20261126);
    const byCell = new Map<string, number>();
    let compared = 0;
    let nonNull = 0;
    const check = (hole: Card[], board: Card[], dead: Card[], a: Ask, label: string): void => {
      const want = plain(frozenOmahaPricedJointRows(hole, board, dead, a.hist, a.field, a.salt));
      const got = plain(omahaPricedJointRows(hole, board, dead, a.hist, a.field, a.salt));
      expect(got, `${label} ${a.label}`).toStrictEqual(want);
      compared++;
      if (want) nonNull++;
    };
    for (const s of states) {
      const variant = String(s.gs.gameVariant).toLowerCase();
      const street = String(s.gs.stage) as OmahaMeasuredStreet;
      const cell = `${variant}|${street}`;
      const seenInCell = byCell.get(cell) ?? 0;
      // every committed river and turn state is cheap; the flop is the slow street of the frozen sample
      if (seenInCell >= (street === 'flop' ? 14 : 24)) continue;
      byCell.set(cell, seenInCell + 1);
      const hole = s.player.cards ?? [];
      const board = s.gs.communityCards ?? [];
      const dead = s.player.knownDeadCards ?? [];
      const frac = [0.33, 0.5, 0.75, 1.3][seenInCell % 4];
      const list = asks(variant, street, frac);
      // a rotating subset of the fields per state, every field met in every cell
      const mine = list.filter((_, i) => (i + seenInCell) % 3 === 0);
      for (const a of mine) check(hole, board, dead, a, s.k);
      // the kept pool: the first field again after the others, and after another hand
      if (mine.length > 1) check(hole, board, dead, mine[0], `${s.k} again`);
      // a re-dealt copy: other hole cards and board, the same street and game, two dead cards half the time
      const idx = shuffled(rnd);
      const flushy = seenInCell % 3 === 0 ? idx.filter((i) => Math.floor(i / 13) <= 1) : idx;
      const b2 = flushy.slice(0, board.length).map((i) => DECK[i]);
      const usedIdx = new Set(flushy.slice(0, board.length));
      const rest = idx.filter((i) => !usedIdx.has(i));
      const h2 = rest.slice(0, hole.length).map((i) => DECK[i]);
      const d2 = seenInCell % 2 ? rest.slice(hole.length, hole.length + 2).map((i) => DECK[i]) : [];
      const a2 = list[(seenInCell * 7) % list.length];
      check(h2, b2, d2, a2, `${s.k} re-dealt`);
      if (mine.length > 0) check(hole, board, dead, mine[mine.length - 1], `${s.k} back`);
    }
    expect([...byCell.keys()].sort()).toEqual([
      'plo4|flop',
      'plo4|river',
      'plo4|turn',
      'plo5|flop',
      'plo5|river',
      'plo5|turn',
    ]);
    expect(compared).toBeGreaterThan(1200);
    expect(nonNull).toBeGreaterThan(1000);
    console.info(`[joint rows unchanged] compared ${compared} samples, ${nonNull} priced`);
  }, 600_000);

  it('3. what the sample refuses, it still refuses', () => {
    const c = (rank: string, suit: string): Card => ({ rank, suit }) as Card;
    const hist = new Array(OMAHA_MEASURED_BINS).fill(1 / OMAHA_MEASURED_BINS);
    const none = { always: [], behind: 0, continueRate: 0, behindHist: null };
    const hole = [c('A', 'spades'), c('K', 'spades'), c('7', 'hearts'), c('6', 'hearts')];
    const board = [c('Q', 'spades'), c('J', 'diamonds'), c('2', 'clubs')];
    const cases: Array<[string, Card[], Card[], Card[], readonly number[], OmahaPricedJointField]> =
      [
        ['three hole cards', hole.slice(0, 3), board, [], hist, none],
        ['two board cards', hole, board.slice(0, 2), [], hist, none],
        ['a short histogram', hole, board, [], hist.slice(1), none],
        ['a card twice', hole, [hole[0], board[1], board[2]], [], hist, none],
        ['a rank that is not a rank', [c('10', 'spades'), ...hole.slice(1)], board, [], hist, none],
        ['a suit letter', [c('A', 's'), ...hole.slice(1)], board, [], hist, none],
        ['a dead card that is not a card', hole, board, [c('1', 'clubs')], hist, none],
        ['an empty histogram', hole, board, [], hist.map(() => 0), none],
        [
          'six in the field',
          hole,
          board,
          [],
          hist,
          { ...none, always: [hist, hist, hist], behind: 3 },
        ],
        ['a dead card held', hole, board, [hole[0]], hist, none],
      ];
    for (const [label, h, b, d, hi, f] of cases)
      expect(plain(omahaPricedJointRows(h, b, d, hi, f)), label).toStrictEqual(
        plain(frozenOmahaPricedJointRows(h, b, d, hi, f))
      );
    expect(omahaPricedJointRows(hole.slice(0, 3), board, [], hist, none)).toBeNull();
    expect(omahaPricedJointRows(hole, board, [], hist, none)).not.toBeNull();
  });
});
