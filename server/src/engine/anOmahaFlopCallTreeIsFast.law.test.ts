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
 *  3. FAST, RELATIVELY (lead-7 2026-11-26; theServerSuiteAssertsNoTightWallClockBound forbids millisecond bounds):
 *     the live tree scores the rank-only part of every hand from a per-board table of pair-ranks and only the
 *     suited pairs against one-suit triples (anOmahaFlopCallTreeIsUnchanged: the same numbers). Over the multiway
 *     fixture (PLO5 5-way included) it costs at most RATIO_TREE of the frozen tree it replaced
 *     (__tests__/HorseOmahaFlopCallTree.frozen.ts), alternating rounds, the fastest round of each kept
 *     (src/testing/relativeCost.ts). Measured 0.3-0.4 on Apple Silicon (fixture p95 17.2 -> 4.8 ms).
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
import { frozenOmahaFlopCallTreeVerdict } from './__tests__/HorseOmahaFlopCallTree.frozen.js';
import { measureRelativeCost } from '../testing/relativeCost.js';
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

function verdictOf(row: FixtureRow, tree = omahaFlopCallTreeVerdict) {
  const { gs, player } = row;
  const spot = omahaFlopFacingBetEvSpot(player, gs);
  if (!spot) return null;
  const bettor = (gs.players ?? []).find((p) => p.seat === spot.bettorSeat);
  return tree(
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

/** The live tree's cost over the multiway fixture, at most this share of the frozen tree's (measured 0.3-0.4). */
const RATIO_TREE = 0.6;

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

  it('3. over the multiway fixture the tree costs a bounded share of the frozen tree it replaced', () => {
    const multiway = FIXTURE.filter(
      (r) => (r.gs.players ?? []).filter((p) => !p.is_folded && !p.is_sitting_out).length >= 4
    );
    expect(multiway.length).toBeGreaterThanOrEqual(30);
    const cost = measureRelativeCost(
      () => {
        for (const row of multiway) verdictOf(row);
      },
      () => {
        for (const row of multiway) verdictOf(row, frozenOmahaFlopCallTreeVerdict);
      },
      { warmupRounds: 1, rounds: 3 }
    );
    console.info(
      `[flop call tree] live ${cost.subjectMs.toFixed(1)} ms, frozen ${cost.referenceMs.toFixed(1)} ms, ` +
        `ratio ${cost.ratio.toFixed(3)} (limit ${RATIO_TREE}, fastest of ${cost.rounds})`
    );
    expect(cost.ratio).toBeLessThan(RATIO_TREE);
  }, 120_000);
});
