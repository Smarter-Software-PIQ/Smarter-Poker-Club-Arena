/**
 * Lane CORE-POOLED-3 latency law (Nov 21): the table-driven 2+3 evaluator (omahaBest in OmahaMathCoreEval.ts: one
 * no-flush table read per hole pair and board triple, flushes scored apart) gives the same score as the original
 * loop over the reference scorer (omahaBestReference over eval5, itself proven equal to eval5Reference) for every
 * five-card hand in every 2+3 split and on seeded deals of 4, 5 and 6 hole cards against 3, 4 and 5 board cards.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildPoolFastData,
  createBoardTable,
  createFiveBoardTriples,
  eval5Reference,
  getPoolPairKeys,
  loadBoardTable,
  loadFiveBoardTriples,
  omahaBest,
  omahaBestReference,
  scoreHandWithBoard,
  scorePairKeysOnFiveBoard,
  scorePoolHoldingWithBoard,
  setOmahaBestMemoForTests,
  sortIndicesDescStable,
} from './OmahaMathCoreEval.js';

const rngOf = (seed: number) => {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return s / 4294967296;
  };
};

describe('table-driven 2+3 evaluator equals the reference loop', () => {
  beforeAll(() => setOmahaBestMemoForTests(false));
  afterAll(() => setOmahaBestMemoForTests(true));

  it('on all 2,598,960 five-card hands in each of the ten 2+3 splits', () => {
    let n = 0;
    let bad = 0;
    const cs = [0, 0, 0, 0, 0];
    const hole = [0, 0];
    const board = [0, 0, 0];
    for (cs[0] = 0; cs[0] < 48; cs[0]++)
      for (cs[1] = cs[0] + 1; cs[1] < 49; cs[1]++)
        for (cs[2] = cs[1] + 1; cs[2] < 50; cs[2]++)
          for (cs[3] = cs[2] + 1; cs[3] < 51; cs[3]++)
            for (cs[4] = cs[3] + 1; cs[4] < 52; cs[4]++) {
              const want = eval5Reference(cs[0], cs[1], cs[2], cs[3], cs[4]);
              for (let i = 0; i < 4; i++)
                for (let j = i + 1; j < 5; j++) {
                  hole[0] = cs[i];
                  hole[1] = cs[j];
                  let b = 0;
                  for (let k = 0; k < 5; k++) if (k !== i && k !== j) board[b++] = cs[k];
                  if (omahaBest(hole, 2, board, 3) !== want) bad++;
                }
              n++;
            }
    expect(n).toBe(2_598_960);
    expect(bad).toBe(0);
  }, 600_000);

  for (const [name, suits, deals] of [
    ['a full deck', 4, 300_000],
    ['two suits only (flush-heavy)', 2, 150_000],
    ['one suit only (every hand a flush)', 1, 30_000],
  ] as const)
    it(`on ${deals.toLocaleString('en-US')} seeded deals from ${name}, 4-6 hole cards against 3-5 board cards, any card order`, () => {
      const rng = rngOf(20261121 + suits);
      let bad = 0;
      for (let d = 0; d < deals; d++) {
        const holeLen = 4 + (d % 3);
        const boardLen = 3 + (Math.floor(d / 3) % 3);
        const used = new Set<number>();
        const cards: number[] = [];
        while (cards.length < holeLen + boardLen) {
          const c = Math.floor(rng() * 13) * 4 + Math.floor(rng() * suits);
          if (!used.has(c)) {
            used.add(c);
            cards.push(c);
          }
        }
        const hole = cards.slice(0, holeLen);
        const board = cards.slice(holeLen);
        if (
          omahaBest(hole, holeLen, board, boardLen) !==
          omahaBestReference(hole, holeLen, board, boardLen)
        )
          bad++;
      }
      expect(bad).toBe(0);
    }, 600_000);

  it('board-table batch evaluator, five-board early-out scorer, and stable index sort equal references', () => {
    const rng = rngOf(20261122);
    const tbl = createBoardTable();
    const bt = createFiveBoardTriples();
    let bad = 0;
    for (const hc of [4, 5, 6]) {
      const poolSize = 40;
      for (let bCase = 0; bCase < 150; bCase++) {
        const boardLen = 3 + (bCase % 3);
        const suits = bCase % 5 === 0 ? 1 : bCase % 3 === 0 ? 2 : 4;
        const used = new Set<number>();
        const board: number[] = [];
        // Include trips-on-board edge cases explicitly on early iterations
        if (bCase < 6) {
          const r = (bCase * 2) % 13;
          for (let s = 0; s < 3; s++) {
            const c = r * 4 + s;
            used.add(c);
            board.push(c);
          }
        }
        while (board.length < boardLen) {
          const c = Math.floor(rng() * 13) * 4 + Math.floor(rng() * suits);
          if (!used.has(c)) {
            used.add(c);
            board.push(c);
          }
        }
        const deck: number[] = [];
        for (let c = 0; c < 52; c++) if (!used.has(c)) deck.push(c);
        const cards = new Int8Array(poolSize * hc);
        const tmp = deck.slice();
        for (let i = 0; i < poolSize; i++) {
          for (let k = 0; k < hc; k++) {
            const j = k + Math.floor(rng() * (tmp.length - k));
            const t = tmp[k];
            tmp[k] = tmp[j];
            tmp[j] = t;
            cards[i * hc + k] = tmp[k];
          }
        }
        const fast = buildPoolFastData(cards, poolSize, hc);
        const pairKeys = getPoolPairKeys(fast, cards);
        loadBoardTable(tbl, board, boardLen);
        if (boardLen === 5)
          loadFiveBoardTriples(bt, board[0], board[1], board[2], board[3], board[4]);
        for (let i = 0; i < poolSize; i++) {
          const slice = cards.subarray(i * hc, i * hc + hc);
          const ref = omahaBestReference(slice, hc, board, boardLen);
          if (scorePoolHoldingWithBoard(fast, cards, i, tbl) !== ref) bad++;
          if (scoreHandWithBoard(slice, hc, tbl) !== ref) bad++;
          if (boardLen === 5) {
            const sFull = scorePairKeysOnFiveBoard(
              pairKeys,
              i * fast.nPairs,
              fast.nPairs,
              cards,
              i * hc,
              hc,
              fast.suitMask[i],
              bt,
              -1
            );
            if (sFull !== ref) bad++;
            // Verify early-out preserves exact >, ===, < relation against arbitrary thresholds
            for (const thr of [ref - 1, ref, ref + 1]) {
              const sCut = scorePairKeysOnFiveBoard(
                pairKeys,
                i * fast.nPairs,
                fast.nPairs,
                cards,
                i * hc,
                hc,
                fast.suitMask[i],
                bt,
                thr
              );
              const wantSign = ref > thr ? 1 : ref === thr ? 0 : -1;
              const gotSign = sCut > thr ? 1 : sCut === thr ? 0 : -1;
              if (gotSign !== wantSign) bad++;
            }
          }
        }
      }
    }
    expect(bad).toBe(0);
    // Verify sortIndicesDescStable matches Array.sort descending with ties preserved in ascending index order
    const vals = new Float64Array(500);
    for (let i = 0; i < vals.length; i++) vals[i] = Math.floor(rng() * 25) / 25;
    const expected = Array.from({ length: vals.length }, (_, i) => i).sort(
      (x, y) => vals[y] - vals[x]
    );
    expect([...sortIndicesDescStable(vals, vals.length)]).toEqual(expected);
  });
});
