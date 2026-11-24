/**
 * LAW (PLO-OWNER lead-6 2026-11-24): THE FLOP CALL TREE (omahaFlopRealizationIsPriced) IS FAST ENOUGH TO ACT, AND
 * ITS FAST SCORE CHANGES NO ANSWER.
 *
 * The tree priced about 29,000 Omaha hands per flop facing-bet decision with HorseEval.scoreOmahaHiPartial: about
 * 110 ms per PLO5 multiway decision on the owner's Mac (profile: 55% ranking each river on its own pool, 35% scoring
 * the sampled holdings). It now scores on integer cards with precomputed pairs and board triples
 * (HorseOmahaFastScore), keeps each holding's turn score for its turn card so a river adds only the six triples that
 * hold the river card, ranks rivers on the turn pool's own holdings, and never scores a player behind who does not
 * continue. Same random draws, same comparisons: the same answers (5,548 real 4+-way flop decisions replayed, 0
 * differences, 2026-11-24).
 *
 *  1. ORDER: HorseOmahaFastScore orders random PLO4 / PLO5 hands on flops, turns and rivers exactly as HorseEval
 *     (ties included), and the river score built from the turn score equals the full river score.
 *  2. SAME ANSWERS: the committed fixture (32 real 4+-way flop decisions, public snapshot and the deciding Horse's own
 *     cards only, and 16 heads-up league decisions) gives the recorded EV and call, exactly.
 *  3. FAST: over the multiway fixture (PLO5 5-way included), after one warm-up pass, the decision p95 is at most
 *     25 ms and the max at most 60 ms on the owner's Mac. On another machine the bounds scale by the measured cost
 *     of a fixed scoring workload against its cost on that Mac (never below 1), so a slower runner is judged by the
 *     same work, not by its clock.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Card } from '../types.js';
import { scoreOmahaHiPartial } from './HorseEval.js';
import {
  OMAHA_FAST_PAIR_STRIDE,
  omahaFastBestPre,
  omahaFastCard,
  omahaFastPairsInto,
  omahaFastTriplesPre,
} from './HorseOmahaFastScore.js';
import { omahaFlopCallTreeVerdict } from './HorseOmahaFlopCallTree.js';
import { omahaFlopFacingBetEvSpot } from './HorseOmahaFlopFacingBetEv.js';
import { omahaMeasuredLineOf } from './HorseOmahaMeasuredBettorRange.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import type { SeatPlayer } from '../types.js';

interface FixtureRow {
  k: string;
  gs: HorseGameStateV2;
  player: SeatPlayer;
  expected: { ev: number; call: boolean };
}
const FIXTURE = JSON.parse(
  readFileSync(join(__dirname, 'HorseOmahaFlopCallTree.fixture.json'), 'utf8')
) as FixtureRow[];

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

function bestFast(
  hole: Card[],
  board: Card[],
  triples = omahaFastTriplesPre(board.map(omahaFastCard))
) {
  const pairs = new Int32Array(((hole.length * (hole.length - 1)) / 2) * OMAHA_FAST_PAIR_STRIDE);
  const np = omahaFastPairsInto(Int32Array.from(hole.map(omahaFastCard)), 0, hole.length, pairs, 0);
  return omahaFastBestPre(pairs, 0, np, triples);
}

function verdictOf(row: FixtureRow) {
  const { gs, player } = row;
  const spot = omahaFlopFacingBetEvSpot(player, gs);
  if (!spot) return null;
  const bettor = (gs.players ?? []).find((p) => p.seat === spot.bettorSeat);
  return omahaFlopCallTreeVerdict(
    {
      variant: String(gs.gameVariant),
      spot,
      hole: player.cards ?? [],
      board: gs.communityCards ?? [],
      dead: [],
      line: omahaMeasuredLineOf(gs.actionHistory, 'flop', spot.bettorSeat, spot.isRaise),
      record: null,
      readFactor: 1,
      rake: 0,
      left: Math.min(player.stack - spot.paid, bettor?.stack ?? Infinity),
      counters: null,
    },
    { minDefence: true, indifference: true, nutShare: true }
  );
}

/** Milliseconds of a fixed scoring workload (4,000 PLO5 holdings x 10 river triples, 5 passes). */
function referenceWorkMs(): number {
  const rnd = stream(7);
  const board = DECK.slice(0, 5);
  const triples = omahaFastTriplesPre(board.map(omahaFastCard));
  const holdings: Card[][] = [];
  for (let i = 0; i < 4000; i++) {
    const picked = new Set<number>();
    while (picked.size < 5) picked.add(5 + Math.floor(rnd() * 47));
    holdings.push([...picked].map((x) => DECK[x]));
  }
  const pairs = new Int32Array(4000 * 10 * OMAHA_FAST_PAIR_STRIDE);
  holdings.forEach((h, i) =>
    omahaFastPairsInto(Int32Array.from(h.map(omahaFastCard)), 0, 5, pairs, i * 30)
  );
  let sink = 0;
  const t0 = performance.now();
  for (let pass = 0; pass < 5; pass++)
    for (let i = 0; i < 4000; i++) sink += omahaFastBestPre(pairs, i * 30, 10, triples);
  const ms = performance.now() - t0;
  return sink > 0 ? ms : ms;
}
/** referenceWorkMs on the owner's Mac Studio (2026-11-24, Node 26, load 12, not niced: 16.2-18.9 ms). */
const REFERENCE_WORK_MS_MAC = 16;

describe('the flop call tree is fast enough to act, and its fast score changes no answer', () => {
  it('1. the fast score orders random PLO4 / PLO5 hands exactly as HorseEval, on flops, turns and rivers', () => {
    const rnd = stream(2026);
    let compared = 0;
    for (let it = 0; it < 6000; it++) {
      const nb = 3 + (it % 3);
      const nh = it % 2 ? 4 : 5;
      const idx = DECK.map((_, i) => i);
      for (let i = idx.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [idx[i], idx[j]] = [idx[j], idx[i]];
      }
      const board = idx.slice(0, nb).map((i) => DECK[i]);
      const h1 = idx.slice(nb, nb + nh).map((i) => DECK[i]);
      const h2 = idx.slice(nb + nh, nb + 2 * nh).map((i) => DECK[i]);
      const e = Math.sign(scoreOmahaHiPartial(h1, board) - scoreOmahaHiPartial(h2, board));
      const f = Math.sign(bestFast(h1, board) - bestFast(h2, board));
      expect(f, `${JSON.stringify(board)} ${JSON.stringify(h1)} ${JSON.stringify(h2)}`).toBe(e);
      if (nb === 5) {
        const ints = board.map(omahaFastCard);
        const pairs = new Int32Array(((nh * (nh - 1)) / 2) * OMAHA_FAST_PAIR_STRIDE);
        const np = omahaFastPairsInto(Int32Array.from(h1.map(omahaFastCard)), 0, nh, pairs, 0);
        const turn = omahaFastBestPre(pairs, 0, np, omahaFastTriplesPre(ints.slice(0, 4)));
        const river = omahaFastBestPre(pairs, 0, np, omahaFastTriplesPre(ints, true), turn);
        expect(river).toBe(bestFast(h1, board));
      }
      compared++;
    }
    expect(compared).toBe(6000);
  });

  it('2. the committed real decisions give the recorded EV and call, exactly', () => {
    expect(FIXTURE.length).toBeGreaterThanOrEqual(40);
    for (const row of FIXTURE) {
      const v = verdictOf(row);
      expect(v, row.k).not.toBeNull();
      expect(v!.ev, row.k).toBe(row.expected.ev);
      expect(v!.call, row.k).toBe(row.expected.call);
    }
  }, 120_000);

  it('3. a multiway decision takes p95 <= 25 ms and max <= 60 ms (scaled by the reference work)', () => {
    const multiway = FIXTURE.filter(
      (r) => (r.gs.players ?? []).filter((p) => !p.is_folded && !p.is_sitting_out).length >= 4
    );
    expect(multiway.length).toBeGreaterThanOrEqual(30);
    for (const row of multiway) verdictOf(row); // warm-up
    const ref = Math.min(referenceWorkMs(), referenceWorkMs(), referenceWorkMs());
    const scale = Math.max(1, ref / REFERENCE_WORK_MS_MAC);
    const times: number[] = [];
    for (let pass = 0; pass < 2; pass++)
      for (const row of multiway) {
        const t0 = performance.now();
        verdictOf(row);
        times.push(performance.now() - t0);
      }
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(0.95 * (times.length - 1))];
    const max = times[times.length - 1];
    expect(
      p95,
      `p95 ${p95.toFixed(1)} ms, reference scale ${scale.toFixed(2)}`
    ).toBeLessThanOrEqual(25 * scale);
    expect(
      max,
      `max ${max.toFixed(1)} ms, reference scale ${scale.toFixed(2)}`
    ).toBeLessThanOrEqual(60 * scale);
  }, 120_000);
});
