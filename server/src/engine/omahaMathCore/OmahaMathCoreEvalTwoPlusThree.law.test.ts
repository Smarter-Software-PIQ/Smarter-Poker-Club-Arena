/**
 * Lane CORE-POOLED-3 latency law (Nov 21): the table-driven 2+3 evaluator (omahaBest in OmahaMathCoreEval.ts: one
 * no-flush table read per hole pair and board triple, flushes scored apart) gives the same score as the original
 * loop over the reference scorer (omahaBestReference over eval5, itself proven equal to eval5Reference) for every
 * five-card hand in every 2+3 split and on seeded deals of 4, 5 and 6 hole cards against 3, 4 and 5 board cards.
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CoreState } from './OmahaMathCore.js';
import { seededRng } from './OmahaMathCoreEquity.js';
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
import {
  lifetimeRiverShare,
  OMAHA_MATH_CORE_TR_FREQ_K,
  OMAHA_MATH_CORE_TR_POOL,
  OMAHA_MATH_CORE_TR_PRIOR_OPPS,
  priceTurnRiverLifetimeCall,
} from './OmahaMathCoreTurnRiver.js';

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

  it('priceTurnRiverLifetimeCall matches brute-force omahaBestReference bit-identically on PLO5/PLO4 turn and river without BEST_MEMO churn', () => {
    const src = readFileSync(new URL('./OmahaMathCoreTurnRiver.ts', import.meta.url), 'utf8');
    expect(src).toContain('loadBoardTable');
    expect(src).toContain('scorePoolHoldingWithBoard');
    expect(src).toContain('scoreHandWithBoard');
    expect(src).not.toMatch(/\bomahaBest\s*\(/);
    expect(src).not.toMatch(/\bresetOmahaBestMemo\s*\(/);

    const cases: Array<{
      variant: 'plo5' | 'plo4';
      street: 'turn' | 'river';
      hole: number[];
      board: number[];
      commitsStack?: boolean;
      seed: string;
    }> = [
      {
        variant: 'plo5',
        street: 'turn',
        hole: [1, 5, 21, 33, 45],
        board: [0, 4, 8, 12], // 4-card monotone wheel
        seed: 'tr-parity-plo5-turn-mono',
      },
      {
        variant: 'plo4',
        street: 'turn',
        hole: [40, 41, 36, 32],
        board: [48, 49, 50, 51], // quads on turn
        seed: 'tr-parity-plo4-turn-quads',
      },
      {
        variant: 'plo5',
        street: 'river',
        hole: [1, 5, 21, 33, 45],
        board: [0, 4, 8, 12, 16], // 5-card monotone wheel
        commitsStack: true,
        seed: 'tr-parity-plo5-river-mono',
      },
      {
        variant: 'plo4',
        street: 'river',
        hole: [36, 40, 29, 17],
        board: [48, 49, 50, 44, 45], // full house on river
        seed: 'tr-parity-plo4-river-fh',
      },
    ];

    const bins = new Array<number>(14).fill(0);
    bins[13] = 80;
    const counts = { opps: 100, bets: 80, bins };
    const riverCounts = { opps: 70, bets: 35 };
    const net = (p: number) => p * 0.95;

    for (const tc of cases) {
      const holeLen = tc.variant === 'plo5' ? 5 : 4;
      const toCall = 12;
      const pot = 28;
      const heroStack = tc.commitsStack ? 12 : 100;
      const state = {
        variant: tc.variant,
        street: tc.street,
        hole: tc.hole,
        board: tc.board,
        pot,
        toCall,
        heroStack,
        bb: 1,
        heroSeat: 0,
        aggressorSeat: 1,
        line: 'stab',
        wagerFrac: 0.75,
        seed: tc.seed,
        opponents: [{ seat: 1, stack: 100, folded: false, allIn: false, prevAggressor: false }],
      } as unknown as CoreState;

      const got = priceTurnRiverLifetimeCall({
        state,
        counts,
        riverCounts: tc.street === 'turn' ? riverCounts : null,
        net,
      });
      expect(got.applies).toBe(true);
      expect(got.pool).toBe(OMAHA_MATH_CORE_TR_POOL[tc.street]);

      // Independent reference recomputation via omahaBestReference
      const used = new Uint8Array(52);
      for (const c of tc.hole) used[c] = 1;
      for (const c of tc.board) used[c] = 1;
      const unseen: number[] = [];
      for (let c = 0; c < 52; c++) if (!used[c]) unseen.push(c);
      const N = OMAHA_MATH_CORE_TR_POOL[tc.street];
      const rng = seededRng(`${tc.seed}|tr-hud`);
      const deck = unseen.slice();
      const U = deck.length;
      const hold = new Int8Array(N * holeLen);
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < holeLen; i++) {
          const x = i + Math.floor(rng() * (U - i));
          const t = deck[i];
          deck[i] = deck[x];
          deck[x] = t;
          hold[j * holeLen + i] = deck[i];
        }
      }
      const pBase = got.pBase!;
      const f = got.f!;
      const fLo = got.fLo!;
      if (tc.street === 'river') {
        const heroScore = omahaBestReference(tc.hole, holeLen, tc.board, 5);
        let beats = 0;
        let ties = 0;
        const h = new Array<number>(holeLen);
        for (let j = 0; j < N; j++) {
          for (let i = 0; i < holeLen; i++) h[i] = hold[j * holeLen + i];
          const s = omahaBestReference(h, holeLen, tc.board, 5);
          if (s > heroScore) beats++;
          else if (s === heroScore) ties++;
        }
        const prefixEq = (m: number) => {
          const t = Math.max(0, Math.min(ties, m - beats));
          const w = Math.max(0, m - beats - ties);
          return (w + 0.5 * t) / m;
        };
        const polarEq = (fr: number) => {
          const ff = Math.min(1, fr);
          const mVal = pBase * N;
          const eqVal = prefixEq(mVal);
          const mRem = N - mVal;
          const beatsRem = Math.max(0, beats - mVal);
          const tiesRem = Math.max(0, Math.min(ties, beats + ties - mVal));
          const losesRem = Math.max(0, mRem - beatsRem - tiesRem);
          return (pBase / ff) * eqVal + ((ff - pBase) / ff) * ((losesRem + 0.5 * tiesRem) / mRem);
        };
        expect(got.share).toBe(polarEq(f));
      } else {
        const R = U;
        const b5 = [...tc.board, 0];
        const heroR = new Float64Array(R);
        for (let r = 0; r < R; r++) {
          b5[4] = unseen[r];
          heroR[r] = omahaBestReference(tc.hole, holeLen, b5, 5);
        }
        const out = new Int8Array(N * R).fill(-1);
        const eqJ = new Float64Array(N);
        const mine = new Uint8Array(52);
        const h = new Array<number>(holeLen);
        for (let j = 0; j < N; j++) {
          for (let i = 0; i < holeLen; i++) {
            h[i] = hold[j * holeLen + i];
            mine[h[i]] = 1;
          }
          let sum = 0;
          let cnt = 0;
          for (let r = 0; r < R; r++) {
            if (mine[unseen[r]]) continue;
            b5[4] = unseen[r];
            const s = omahaBestReference(h, holeLen, b5, 5);
            const o = heroR[r] > s ? 2 : heroR[r] === s ? 1 : 0;
            out[j * R + r] = o;
            sum += o;
            cnt++;
          }
          eqJ[j] = cnt > 0 ? sum / (2 * cnt) : 0;
          for (let i = 0; i < holeLen; i++) mine[h[i]] = 0;
        }
        const order = Array.from({ length: N }, (_, j) => j).sort(
          (a, c) => eqJ[a] - eqJ[c] || a - c
        );
        const finalPot = pot + toCall;
        const sigma = Math.min(finalPot, heroStack - toCall, 100) / finalPot;
        const kr = OMAHA_MATH_CORE_TR_PRIOR_OPPS['river|hu'];
        const rf = (riverCounts.bets + kr) / (riverCounts.opps + kr);
        const budget = Math.min(
          1,
          rf + OMAHA_MATH_CORE_TR_FREQ_K * Math.sqrt((rf * (1 - rf)) / (riverCounts.opps + kr))
        );
        const evalRefShare = (fr: number) => {
          const ff = Math.min(1, fr);
          const m = Math.max(1, Math.min(N, Math.floor(pBase * N)));
          const wVal = pBase / ff;
          const wEx = (ff - pBase) / ff;
          let tot = 0;
          let wsum = 0;
          for (let r = 0; r < R; r++) {
            let sVal = 0;
            let cVal = 0;
            for (let q = 0; q < m; q++) {
              const o = out[order[q] * R + r];
              if (o < 0) continue;
              sVal += o;
              cVal++;
            }
            if (cVal === 0) continue;
            let eqR = sVal / (2 * cVal);
            let sEx = 0;
            let cEx = 0;
            for (let q = m; q < N; q++) {
              const o = out[order[q] * R + r];
              if (o < 0) continue;
              sEx += o;
              cEx++;
            }
            if (cEx > 0) eqR = wVal * eqR + wEx * (sEx / (2 * cEx));
            tot += cVal * lifetimeRiverShare(eqR, sigma, budget);
            wsum += cVal;
          }
          return wsum > 0 ? tot / wsum : 0;
        };
        expect(got.share).toBe(evalRefShare(f));
        expect(got.evCall).toBe(evalRefShare(fLo) * net(finalPot) - toCall);
      }
    }
  });
});
