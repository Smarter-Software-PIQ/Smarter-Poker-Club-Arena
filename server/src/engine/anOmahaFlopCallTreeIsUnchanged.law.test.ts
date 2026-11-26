/**
 * LAW (PLO-OWNER lead-7 2026-11-26): THE FAST FLOP CALL TREE GIVES THE SAME NUMBERS AS THE TREE IT REPLACED.
 *
 * omahaFlopRealizationIsPriced (PLO4 / PLO5 cash, flop, facing a bet) cost p50 16.7 / p95 23.9 / max 52.4 ms where
 * it applied, over the live shadow breaker's bar. The tree now scores each holding as the larger of (a) its best
 * hand with every five cards scored as if unsuited, the largest over its two-card pairs of a per-board table entry
 * keyed by the pair's two ranks (a river entry built from the turn entry and the six triples that hold the river
 * card), and (b) its best hand over the board triples of the one suit with three or more board cards, from its pairs
 * of that suit only (an unsuited hand in those triples scores no more than (a)). It also tests card use with bit sets
 * and finds a holding's strength in its pool by binary search. Nothing else changed: the same random draws, the same
 * samples, so the same EV, the same call and the same receipt numbers.
 *
 *  1. SCORE: on random PLO4 / PLO5 holdings, turns and rivers, (a) and (b) give exactly the full score of
 *     HorseOmahaFastScore over every board triple.
 *  2. VERDICT: on the committed fixture (48 real decisions) and on 288 re-dealt copies of it (other hole cards and
 *     boards, the same spot), with the companion options on and off, the live verdict equals the frozen tree's
 *     (__tests__/HorseOmahaFlopCallTree.frozen.ts, the tree as it was at c0885e9375f9) field for field: call, EV,
 *     margin, samples, turn barrel and call shares, nut-share loss.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Card, SeatPlayer } from '../types.js';
import {
  OMAHA_FAST_PAIR_STRIDE,
  omahaFastBestPre,
  omahaFastCard,
  omahaFastOneSuit,
  omahaFastPairsInto,
  omahaFastRankOnly,
  omahaFastTriplesPre,
} from './HorseOmahaFastScore.js';
import { omahaFlopCallTreeVerdict } from './HorseOmahaFlopCallTree.js';
import { omahaFlopFacingBetEvSpot } from './HorseOmahaFlopFacingBetEv.js';
import { omahaMeasuredLineOf } from './HorseOmahaMeasuredBettorRange.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import { frozenOmahaFlopCallTreeVerdict } from './__tests__/HorseOmahaFlopCallTree.frozen.js';

interface FixtureRow {
  k: string;
  gs: HorseGameStateV2;
  player: SeatPlayer;
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

function shuffled(rnd: () => number): number[] {
  const idx = DECK.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx;
}

describe('LAW: the fast flop call tree gives the same numbers as the tree it replaced', () => {
  it('1. the rank-only pair table and the one-suit pairs give the full score', () => {
    const rnd = stream(1126);
    const rankPair = new Int32Array(3);
    for (let it = 0; it < 6000; it++) {
      const nh = it % 2 ? 4 : 5;
      const idx = shuffled(rnd);
      // flush-heavy boards a third of the time: deal the board from one or two suits
      const pool = it % 3 === 0 ? idx.filter((i) => Math.floor(i / 13) <= it % 2) : idx;
      const board = pool.slice(0, 5).map((i) => DECK[i]);
      const used = new Set(pool.slice(0, 5));
      const hole = idx
        .filter((i) => !used.has(i))
        .slice(0, nh)
        .map((i) => DECK[i]);
      const ints = board.map(omahaFastCard);
      const pairs = new Int32Array(((nh * (nh - 1)) / 2) * OMAHA_FAST_PAIR_STRIDE);
      const np = omahaFastPairsInto(Int32Array.from(hole.map(omahaFastCard)), 0, nh, pairs, 0);
      for (const nb of [4, 5]) {
        const all = omahaFastTriplesPre(ints.slice(0, nb));
        const full = omahaFastBestPre(pairs, 0, np, all);
        const turnRanks = omahaFastRankOnly(omahaFastTriplesPre(ints.slice(0, 4)));
        const riverRanks = omahaFastRankOnly(omahaFastTriplesPre(ints, true));
        let fast = 0;
        for (let w = 0; w < np * OMAHA_FAST_PAIR_STRIDE; w += OMAHA_FAST_PAIR_STRIDE) {
          rankPair[0] = pairs[w];
          rankPair[1] = pairs[w + 1];
          rankPair[2] = -1;
          let v = omahaFastBestPre(rankPair, 0, 1, turnRanks);
          if (nb === 5) v = omahaFastBestPre(rankPair, 0, 1, riverRanks, v);
          if (v > fast) fast = v;
        }
        const mono = omahaFastOneSuit(all);
        if (mono.length > 0)
          for (let w = 0; w < np * OMAHA_FAST_PAIR_STRIDE; w += OMAHA_FAST_PAIR_STRIDE)
            if (pairs[w + 2] === mono[3]) fast = omahaFastBestPre(pairs, w, 1, mono, fast);
        expect(fast, `${JSON.stringify(board.slice(0, nb))} ${JSON.stringify(hole)}`).toBe(full);
      }
    }
  });

  it('2. the live verdict equals the frozen tree on the fixture and on re-dealt copies of it', () => {
    const rnd = stream(20261126);
    let compared = 0;
    let calls = 0;
    for (const row of FIXTURE) {
      const { gs, player } = row;
      const spot = omahaFlopFacingBetEvSpot(player, gs);
      expect(spot, row.k).not.toBeNull();
      const bettor = (gs.players ?? []).find((p) => p.seat === spot!.bettorSeat);
      const base = {
        variant: String(gs.gameVariant),
        spot: spot!,
        hole: player.cards ?? [],
        board: gs.communityCards ?? [],
        dead: [] as Card[],
        line: omahaMeasuredLineOf(gs.actionHistory, 'flop', spot!.bettorSeat, spot!.isRaise),
        record: null,
        readFactor: 1,
        rake: 0.05,
        left: Math.min(player.stack - spot!.paid, bettor?.stack ?? Infinity),
        counters: null,
      };
      const deals = [base];
      for (let d = 0; d < 6; d++) {
        const idx = shuffled(rnd);
        const n = base.hole.length;
        deals.push({
          ...base,
          hole: idx.slice(0, n).map((i) => DECK[i]),
          board: idx.slice(n, n + 3).map((i) => DECK[i]),
          dead: d % 3 === 0 ? idx.slice(n + 3, n + 5).map((i) => DECK[i]) : [],
          record: d % 2 ? { shown: 6, value: 4 } : null,
          readFactor: d % 2 ? 0.8 : 1,
        });
      }
      for (const [k, input] of deals.entries()) {
        const o = { minDefence: k % 2 === 0, indifference: k % 3 !== 1, nutShare: k % 4 !== 3 };
        const live = omahaFlopCallTreeVerdict(input, o);
        const frozen = frozenOmahaFlopCallTreeVerdict(input, o);
        expect(live, `${row.k} deal ${k}`).toEqual(frozen);
        compared++;
        if (live?.call) calls++;
      }
    }
    expect(compared).toBe(FIXTURE.length * 7);
    // both answers occur, so the comparison is not of one constant
    expect(calls).toBeGreaterThan(0);
    expect(calls).toBeLessThan(compared);
  }, 240_000);
});
