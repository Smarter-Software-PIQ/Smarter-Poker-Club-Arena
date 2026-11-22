/**
 * LAW: V36 MULTI-BOARD BLUFF-TRIM MULTIPLIER IS PRICED DETERMINISTICALLY WHEN
 * `multiBoardBluffTrimIsPriced` IS ON, AND BYTE-IDENTICAL WHEN OFF OR ON SINGLE-BOARD HANDS
 * (2026-11-22).
 *
 * Criteria: CRITERIA-MULTIBOARD-BLUFF-TRIM-PRICED.md (HORSE DECISIONS lane).
 *
 * Invariants proven here:
 *   1. OFF / unset / false is 100% byte-identical across single-board, 2-board, and 3-board
 *      NLH and PLO4 hands, including exact `fastRandom()` consumption and next-draw RNG state.
 *   2. Single-board hands (`!multiBoard36`) are 100% byte-identical even when
 *      `multiBoardBluffTrimIsPriced: true` (exact decision, exact RNG state, zero priced receipts).
 *   3. Pure pricing module `HorseMultiBoardBluffTrimPriced.ts` is 100% deterministic (zero
 *      `fastRandom()` calls, zero `opponentHud/` imports, zero opponent hole-card reads).
 *   4. Strict monotonicity in `nBoards`, `oppCount`, opponent fold rate, `heroBubbleFactor`,
 *      public board correlation, hero cross-board blockers, `wetness`, and effective SPR.
 *   5. Strictly bounded in `[0.0, 1.0]`, never exceeding legacy `0.35` / `0.50` unless
 *      `F_all > FE_be`, dropping to `~0.0` in hopeless 3-board multiway calling-station spots
 *      (and exact `0.0` when an opponent is all-in), while preserving profitable HU bluffs
 *      against tight folders.
 *   6. End-to-end `HorseLogic.decide` emits `v36_multiboard_bluff_trim_priced` with zero
 *      double-counting of legacy `v36_multiboard_bluff_trim`, produces 100% legal actions under
 *      `PokerEngine.validateAction`, cuts multiway calling-station bluffs, and increases HU
 *      tight-folder bluffs across deterministic RNG sweeps.
 *   7. `multiBoardBluffTrimIsPriced` stays strictly dark in `OPTION_SWITCH_REFUSED` (never in
 *      `OPTION_SWITCH_NAMES`, zero SQL migrations).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { _clearGtoPostflop } from './GtoPostflop.js';
import { _clearGtoPostflopV31 } from './GtoPostflopV31.js';
import { fastRandom, seedFastRandom } from './HorseEval.js';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import {
  MULTI_BOARD_BLUFF_BREAK_EVEN_MUL,
  MULTI_BOARD_BLUFF_REF_POT_FRAC,
  computeEffectiveBoards,
  estimateSingleBoardFoldProb,
  mapMultiBoardBluffEvToMultiplier,
  priceMultiBoardBluffTrim,
  type MultiBoardBluffTrimOpponentInput,
  type PriceMultiBoardBluffTrimInput,
} from './HorseMultiBoardBluffTrimPriced.js';
import { freshExploitCounters } from './HorseOpponentExploit.js';
import {
  OPTION_SWITCH_NAMES,
  OPTION_SWITCH_REFUSED,
  optionSwitchRefusal,
} from './HorseOptionSwitch.js';
import { calculateBettingState, validateAction } from './PokerEngine.js';
import type { ActionRecord, Card, CardRank, CardSuit, SeatPlayer } from '../types.js';

const REPO = fileURLToPath(new URL('../../..', import.meta.url));
const SUITS: Record<string, CardSuit> = {
  c: 'clubs',
  d: 'diamonds',
  h: 'hearts',
  s: 'spades',
};

function cards(text: string): Card[] {
  const out: Card[] = [];
  for (let i = 0; i + 1 < text.length; i += 2) {
    out.push({ rank: text[i] as CardRank, suit: SUITS[text[i + 1]!]! });
  }
  return out;
}

function firesMap(): Record<string, number> {
  return Object.fromEntries(drainFires().map((r) => [r.feature, r.fires]));
}

function seat(
  n: number,
  id: string,
  stack: number,
  bet: number,
  invested: number,
  hole = '',
  folded = false,
  allIn = false
): SeatPlayer {
  return {
    seat: n,
    user_id: id,
    username: id,
    stack,
    bet,
    totalInvested: invested,
    cards: hole ? cards(hole) : [],
    is_folded: folded,
    is_all_in: allIn,
    is_sitting_out: false,
  };
}

function stableDecision(d: ReturnType<typeof HorseLogic.decide>) {
  return {
    action: d.action,
    amount: d.amount ?? null,
    thinkTime: d.thinkTime,
    continuationGuard: d.continuationGuard ?? null,
  };
}

function makeBoardState(opts: {
  variant?: 'nlh' | 'plo4' | 'plo5';
  heroHole: string;
  board1: string;
  board2?: string | null;
  board3?: string | null;
  pot?: number;
  currentBet?: number;
  heroStack?: number;
  oppStack?: number;
  stage?: 'flop' | 'turn' | 'river';
  oppIds?: string[];
  oppHoles?: string[];
  format?: 'cash' | 'mtt';
}) {
  const variant = opts.variant ?? 'nlh';
  const stage = opts.stage ?? 'flop';
  const pot = opts.pot ?? 100;
  const currentBet = opts.currentBet ?? 0;
  const heroStack = opts.heroStack ?? 500;
  const oppStack = opts.oppStack ?? 500;
  const oppIds = opts.oppIds ?? ['40000000-0000-4000-8000-0000000000a1'];
  const heroId = '40000000-0000-4000-8000-0000000000b1';
  const heroSeatNum = oppIds.length + 1;

  const opps = oppIds.map((id, idx) =>
    seat(
      idx + 1,
      id,
      oppStack,
      idx === 0 ? currentBet : 0,
      Math.floor(pot / (oppIds.length + 1)) + (idx === 0 ? currentBet : 0),
      opts.oppHoles?.[idx] ?? (variant === 'nlh' ? '9c8c' : '9c8c7d6d')
    )
  );
  const hero = seat(
    heroSeatNum,
    heroId,
    heroStack,
    0,
    Math.floor(pot / (oppIds.length + 1)),
    opts.heroHole
  );

  const actionHistory: ActionRecord[] = [
    {
      stage: 'preflop',
      seat: heroSeatNum,
      userId: heroId,
      action: 'raise',
      amount: 10,
      timestamp: 1000,
    },
    ...opps.map((o, idx) => ({
      stage: 'preflop' as const,
      seat: o.seat,
      userId: o.user_id,
      action: 'call' as const,
      amount: 10,
      timestamp: 1001 + idx,
    })),
  ];
  if (stage === 'flop') {
    opps.forEach((o, idx) => {
      actionHistory.push({
        stage: 'flop',
        seat: o.seat,
        userId: o.user_id,
        action: idx === 0 && currentBet > 0 ? 'bet' : 'check',
        amount: idx === 0 ? currentBet : 0,
        timestamp: 1010 + idx,
      });
    });
  } else if (stage === 'turn') {
    opps.forEach((o, idx) => {
      actionHistory.push({
        stage: 'flop',
        seat: o.seat,
        userId: o.user_id,
        action: 'check',
        amount: 0,
        timestamp: 1010 + idx,
      });
    });
    actionHistory.push({
      stage: 'flop',
      seat: heroSeatNum,
      userId: heroId,
      action: 'check',
      amount: 0,
      timestamp: 1019,
    });
    opps.forEach((o, idx) => {
      actionHistory.push({
        stage: 'turn',
        seat: o.seat,
        userId: o.user_id,
        action: idx === 0 && currentBet > 0 ? 'bet' : 'check',
        amount: idx === 0 ? currentBet : 0,
        timestamp: 1020 + idx,
      });
    });
  } else {
    for (const s of ['flop', 'turn'] as const) {
      opps.forEach((o, idx) => {
        actionHistory.push({
          stage: s,
          seat: o.seat,
          userId: o.user_id,
          action: 'check',
          amount: 0,
          timestamp: s === 'flop' ? 1010 + idx : 1020 + idx,
        });
      });
      actionHistory.push({
        stage: s,
        seat: heroSeatNum,
        userId: heroId,
        action: 'check',
        amount: 0,
        timestamp: s === 'flop' ? 1019 : 1029,
      });
    }
    opps.forEach((o, idx) => {
      actionHistory.push({
        stage: 'river',
        seat: o.seat,
        userId: o.user_id,
        action: idx === 0 && currentBet > 0 ? 'bet' : 'check',
        amount: idx === 0 ? currentBet : 0,
        timestamp: 1030 + idx,
      });
    });
  }

  const gs = {
    handNumber: 912345,
    stage,
    pot,
    currentBet,
    minRaise: Math.max(2, currentBet),
    bigBlind: 2,
    smallBlind: 1,
    dealerSeat: heroSeatNum,
    gameVariant: variant,
    format: opts.format ?? 'cash',
    bombPot: opts.board2 !== null && opts.board2 !== undefined,
    communityCards: cards(opts.board1),
    ...(opts.board2 !== null && opts.board2 !== undefined
      ? { communityCards2: cards(opts.board2) }
      : {}),
    ...(opts.board3 ? { communityCards3: cards(opts.board3) } : {}),
    players: [...opps, hero],
    actionHistory,
  };
  return { hero, opps, gs };
}

function seedOpponentProfile(
  userId: string,
  variant: 'nlh' | 'plo4',
  size: 'hu' | 'short' | 'full',
  foldToBet: number,
  foldToBetOpp: number,
  riverCall: number,
  riverCallOpp: number
) {
  HorseMind.importDurableOpponentProfiles([
    {
      user_id: userId,
      variant,
      mode: 'cash',
      size,
      observed_hands: Math.max(60, foldToBetOpp),
      initialized: true,
      counters: {
        ...freshExploitCounters(),
        hands: Math.max(60, foldToBetOpp),
        vpip: 40,
        pfr: 15,
        foldToBetOpp,
        foldToBet,
        riverCallOpp,
        riverCall,
      },
    },
  ]);
}

describe('LAW: multiBoardBluffTrimIsPriced (V36 Multi-Board Bluff-Trim Priced Replacement)', () => {
  beforeEach(() => {
    HorseMind.reset();
    _clearGtoPostflop();
    _clearGtoPostflopV31();
    enableBrainTelemetry();
    drainFires();
  });

  afterEach(() => {
    HorseMind.reset();
    drainFires();
  });

  describe('public-info discipline, zero-RNG determinism, and strict [0, 1] bounds', () => {
    it('module source has zero fastRandom(), zero opponentHud/ imports, and zero opponent hole-card reads', () => {
      const src = readFileSync(
        join(REPO, 'server/src/engine/HorseMultiBoardBluffTrimPriced.ts'),
        'utf8'
      );
      const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
      expect(codeOnly).not.toMatch(/\bfastRandom\s*\(/);
      expect(codeOnly).not.toMatch(/opponentHud\//);
      expect(codeOnly).not.toMatch(/v86Hash01/);
      expect(codeOnly).not.toMatch(/opp\.cards|opponents\[[^\]]+\]\.cards/);
    });

    it('is 100% deterministic and consumes zero fastRandom() draws', () => {
      const input: PriceMultiBoardBluffTrimInput = {
        boards: [cards('Kh9d4c'), cards('Qs7h2s')],
        heroCards: cards('AsJh'),
        street: 'flop',
        inPosition: true,
        potSize: 100,
        effStack: 400,
        wetness: 0.35,
        oppCount: 1,
        opponents: [
          {
            exploitCounters: {
              foldToBet: 48,
              foldToBetOpp: 60,
              riverCall: 10,
              riverCallOpp: 50,
            },
          },
        ],
        heroBubbleFactor: 1.0,
      };

      seedFastRandom(777);
      const before = fastRandom();
      seedFastRandom(777);
      const r1 = priceMultiBoardBluffTrim(input);
      const after1 = fastRandom();
      seedFastRandom(777);
      const r2 = priceMultiBoardBluffTrim(input);
      const after2 = fastRandom();

      expect(after1).toBe(before);
      expect(after2).toBe(before);
      expect(r1).toEqual(r2);
    });

    it('is strictly bounded in [0.0, 1.0] across extreme inputs and never exceeds 0.35 when F_all <= FE_be', () => {
      const folderOpp: MultiBoardBluffTrimOpponentInput = {
        exploitCounters: { foldToBet: 1000, foldToBetOpp: 1000, riverCall: 0, riverCallOpp: 1000 },
      };
      const stationOpp: MultiBoardBluffTrimOpponentInput = {
        exploitCounters: { foldToBet: 0, foldToBetOpp: 1000, riverCall: 1000, riverCallOpp: 1000 },
      };
      const allInOpp: MultiBoardBluffTrimOpponentInput = { canRespond: false };

      for (const street of ['flop', 'turn', 'river'] as const) {
        for (const oppCount of [1, 2, 3, 5]) {
          for (const bf of [1, 1.4, 2.5, 5.0]) {
            for (const oppProfile of [folderOpp, stationOpp, allInOpp, {}]) {
              const res = priceMultiBoardBluffTrim({
                boards: [cards('AhKd7c'), cards('AsKh7s')],
                heroCards: cards('AcKc'),
                street,
                inPosition: true,
                potSize: 100,
                effStack: 500,
                wetness: 0.0,
                oppCount,
                opponents: Array.from({ length: oppCount }, () => oppProfile),
                heroBubbleFactor: bf,
              });
              expect(res.multiplier).toBeGreaterThanOrEqual(0);
              expect(res.multiplier).toBeLessThanOrEqual(1);
              expect(res.effBoards).toBeGreaterThanOrEqual(1);
              expect(res.effBoards).toBeLessThanOrEqual(2);
              expect(res.allBoardsFoldProb).toBeGreaterThanOrEqual(0);
              expect(res.allBoardsFoldProb).toBeLessThanOrEqual(1);
              if (res.allBoardsFoldProb <= res.breakEvenFoldProb) {
                expect(res.multiplier).toBeLessThanOrEqual(
                  MULTI_BOARD_BLUFF_BREAK_EVEN_MUL + 1e-12
                );
              }
              if (oppProfile === allInOpp) {
                expect(res.allBoardsFoldProb).toBe(0);
                expect(res.multiplier).toBe(0);
              }
            }
          }
        }
      }

      // Exact boundary checks on mapping function
      const feBe = (1 * MULTI_BOARD_BLUFF_REF_POT_FRAC) / (1 + MULTI_BOARD_BLUFF_REF_POT_FRAC);
      expect(mapMultiBoardBluffEvToMultiplier(0, feBe, -0.65)).toBe(0);
      expect(mapMultiBoardBluffEvToMultiplier(feBe, feBe, 0)).toBeCloseTo(
        MULTI_BOARD_BLUFF_BREAK_EVEN_MUL,
        12
      );
      expect(mapMultiBoardBluffEvToMultiplier(1, feBe, 1)).toBeCloseTo(1, 12);
    });
  });

  describe('strict monotonicity in every required dimension', () => {
    const baseInput: PriceMultiBoardBluffTrimInput = {
      boards: [cards('Kh8d3c'), cards('Qs7h2s')],
      heroCards: cards('6c5d'),
      street: 'flop',
      inPosition: true,
      potSize: 100,
      effStack: 500,
      wetness: 0.35,
      oppCount: 1,
      opponents: [
        {
          exploitCounters: {
            foldToBet: 45,
            foldToBetOpp: 60,
            riverCall: 15,
            riverCallOpp: 60,
          },
        },
      ],
      heroBubbleFactor: 1.0,
    };

    it('strictly decreases as nBoards increases (2 -> 3 -> 4)', () => {
      const r2 = priceMultiBoardBluffTrim({
        ...baseInput,
        boards: [cards('Kh8d3c'), cards('Qs7h2s')],
      });
      const r3 = priceMultiBoardBluffTrim({
        ...baseInput,
        boards: [cards('Kh8d3c'), cards('Qs7h2s'), cards('Jd9c4h')],
      });
      const r4 = priceMultiBoardBluffTrim({
        ...baseInput,
        boards: [cards('Kh8d3c'), cards('Qs7h2s'), cards('Jd9c4h'), cards('AcTs6d')],
      });

      expect(r2.effBoards).toBeLessThan(r3.effBoards);
      expect(r3.effBoards).toBeLessThan(r4.effBoards);
      expect(r2.allBoardsFoldProb).toBeGreaterThan(r3.allBoardsFoldProb);
      expect(r3.allBoardsFoldProb).toBeGreaterThan(r4.allBoardsFoldProb);
      expect(r2.multiplier).toBeGreaterThan(r3.multiplier);
      expect(r3.multiplier).toBeGreaterThan(r4.multiplier);
    });

    it('strictly decreases as oppCount increases (1 -> 2 -> 3 -> 4)', () => {
      const opp = baseInput.opponents![0]!;
      const results = [1, 2, 3, 4].map((oppCount) =>
        priceMultiBoardBluffTrim({
          ...baseInput,
          oppCount,
          opponents: Array.from({ length: oppCount }, () => opp),
        })
      );
      for (let i = 0; i < results.length - 1; i++) {
        expect(results[i]!.allBoardsFoldProb).toBeGreaterThan(results[i + 1]!.allBoardsFoldProb);
        expect(results[i]!.multiplier).toBeGreaterThan(results[i + 1]!.multiplier);
      }
    });

    it('strictly increases as opponent fold rate increases across flop, turn, and river', () => {
      for (const street of ['flop', 'turn', 'river'] as const) {
        const rates = [0.1, 0.3, 0.5, 0.7, 0.9];
        const results = rates.map((rate) =>
          priceMultiBoardBluffTrim({
            ...baseInput,
            street,
            opponents: [
              {
                exploitCounters: {
                  foldToBet: Math.round(rate * 80),
                  foldToBetOpp: 80,
                  riverCall: Math.round((1 - rate) * 80),
                  riverCallOpp: 80,
                },
              },
            ],
          })
        );
        for (let i = 0; i < results.length - 1; i++) {
          expect(results[i]!.perOpponentSingleBoardFold[0]!).toBeLessThan(
            results[i + 1]!.perOpponentSingleBoardFold[0]!
          );
          expect(results[i]!.allBoardsFoldProb).toBeLessThan(results[i + 1]!.allBoardsFoldProb);
          expect(results[i]!.multiplier).toBeLessThan(results[i + 1]!.multiplier);
        }
      }
    });

    it('strictly decreases as heroBubbleFactor increases (1.0 -> 1.25 -> 1.6 -> 2.2)', () => {
      const bfs = [1.0, 1.25, 1.6, 2.2];
      const results = bfs.map((heroBubbleFactor) =>
        priceMultiBoardBluffTrim({ ...baseInput, heroBubbleFactor })
      );
      for (let i = 0; i < results.length - 1; i++) {
        expect(results[i]!.breakEvenFoldProb).toBeLessThan(results[i + 1]!.breakEvenFoldProb);
        expect(results[i]!.evPerPot).toBeGreaterThan(results[i + 1]!.evPerPot);
        expect(results[i]!.multiplier).toBeGreaterThan(results[i + 1]!.multiplier);
      }
    });

    it('strictly increases with public board correlation (disjoint -> 1 shared rank -> 2 shared ranks -> 3 shared + paired/flush)', () => {
      const boardPairs: Card[][][] = [
        [cards('Kh8d3c'), cards('Qs7h2s')], // 0 shared ranks, unpaired, rainbow
        [cards('Kh8d3c'), cards('Ks7h2s')], // 1 shared rank
        [cards('Kh8d3c'), cards('Ks8h2s')], // 2 shared ranks
        [cards('Kh8d3c'), cards('Ks8h3s')], // 3 shared ranks
        [cards('KhKd8h'), cards('KsKc8h')], // shared ranks + paired + shared dominant suit
      ];
      const results = boardPairs.map((boards) =>
        priceMultiBoardBluffTrim({
          ...baseInput,
          boards,
          flopTexture: 'unpaired_nonmono', // hold flopTexture fixed to isolate correlation monotonicity
        })
      );
      for (let i = 0; i < results.length - 1; i++) {
        expect(results[i]!.boardCorrelation).toBeLessThan(results[i + 1]!.boardCorrelation);
        expect(results[i]!.effBoards).toBeGreaterThan(results[i + 1]!.effBoards);
        expect(results[i]!.allBoardsFoldProb).toBeLessThan(results[i + 1]!.allBoardsFoldProb);
        expect(results[i]!.multiplier).toBeLessThan(results[i + 1]!.multiplier);
      }
    });

    it('strictly increases with hero cross-board blockers (0 boards -> 1 board -> 2 boards blocked)', () => {
      const boards = [cards('Ah8d3c'), cards('Ks7h2s')];
      const none = priceMultiBoardBluffTrim({ ...baseInput, boards, heroCards: cards('6c5d') });
      const one = priceMultiBoardBluffTrim({ ...baseInput, boards, heroCards: cards('Ac5d') });
      const two = priceMultiBoardBluffTrim({ ...baseInput, boards, heroCards: cards('AcKd') });

      expect(none.heroBlockerCoverage).toBeLessThan(one.heroBlockerCoverage);
      expect(one.heroBlockerCoverage).toBeLessThan(two.heroBlockerCoverage);
      expect(none.effBoards).toBeGreaterThan(one.effBoards);
      expect(one.effBoards).toBeGreaterThan(two.effBoards);
      expect(none.multiplier).toBeLessThan(one.multiplier);
      expect(one.multiplier).toBeLessThan(two.multiplier);

      const bd = computeEffectiveBoards(boards, cards('AcKd'));
      expect(bd.effBoards).toBeGreaterThanOrEqual(1);
      expect(bd.effBoards).toBeLessThan(2);
    });

    it('strictly decreases with wetness and strictly increases with low-SPR depth', () => {
      const dry = priceMultiBoardBluffTrim({ ...baseInput, wetness: 0.1 });
      const med = priceMultiBoardBluffTrim({ ...baseInput, wetness: 0.5 });
      const wet = priceMultiBoardBluffTrim({ ...baseInput, wetness: 0.9 });
      expect(dry.multiplier).toBeGreaterThan(med.multiplier);
      expect(med.multiplier).toBeGreaterThan(wet.multiplier);

      const shallow = estimateSingleBoardFoldProb({
        street: 'turn',
        inPosition: true,
        potSize: 100,
        effStack: 50,
        wetness: 0.4,
        headsUp: true,
      });
      const mid = estimateSingleBoardFoldProb({
        street: 'turn',
        inPosition: true,
        potSize: 100,
        effStack: 180,
        wetness: 0.4,
        headsUp: true,
      });
      const deep = estimateSingleBoardFoldProb({
        street: 'turn',
        inPosition: true,
        potSize: 100,
        effStack: 400,
        wetness: 0.4,
        headsUp: true,
      });
      expect(shallow).toBeLessThan(mid);
      expect(mid).toBeLessThan(deep);
    });
  });

  describe('poker regime behavior: calling-station multiway trim vs HU tight-folder preservation', () => {
    it('crushes bluff multiplier to ~0 in hopeless 3-board multiway calling-station spots', () => {
      const station: MultiBoardBluffTrimOpponentInput = {
        exploitCounters: { foldToBet: 10, foldToBetOpp: 80, riverCall: 70, riverCallOpp: 80 },
      };
      const res = priceMultiBoardBluffTrim({
        boards: [cards('Kh9d4c'), cards('Qs7h2s'), cards('Jd8c3h')],
        heroCards: cards('6c5d'),
        street: 'flop',
        inPosition: true,
        potSize: 100,
        effStack: 400,
        wetness: 0.5,
        oppCount: 3,
        opponents: [station, station, station],
        heroBubbleFactor: 1.0,
      });
      expect(res.allBoardsFoldProb).toBeLessThan(0.001);
      expect(res.evPerPot).toBeLessThan(-0.64);
      expect(res.multiplier).toBeLessThan(0.001);
    });

    it('preserves profitable HU bluffs against tight folders (rising above legacy 0.5 / 0.35 while <= 1.0)', () => {
      const tightFolder: MultiBoardBluffTrimOpponentInput = {
        exploitCounters: { foldToBet: 72, foldToBetOpp: 80, riverCall: 8, riverCallOpp: 80 },
      };
      const hu2 = priceMultiBoardBluffTrim({
        boards: [cards('AhKd7c'), cards('As9h3d')],
        heroCards: cards('Ac5s'),
        street: 'flop',
        inPosition: true,
        potSize: 100,
        effStack: 500,
        wetness: 0.25,
        oppCount: 1,
        opponents: [tightFolder],
        heroBubbleFactor: 1.0,
      });
      expect(hu2.allBoardsFoldProb).toBeGreaterThan(hu2.breakEvenFoldProb);
      expect(hu2.evPerPot).toBeGreaterThan(0.35);
      expect(hu2.multiplier).toBeGreaterThan(0.75);
      expect(hu2.multiplier).toBeLessThanOrEqual(1.0);

      const hu3 = priceMultiBoardBluffTrim({
        boards: [cards('AhKd7c'), cards('As9h3d'), cards('Ac6s2h')],
        heroCards: cards('Ad5s'),
        street: 'flop',
        inPosition: true,
        potSize: 100,
        effStack: 500,
        wetness: 0.25,
        oppCount: 1,
        opponents: [tightFolder],
        heroBubbleFactor: 1.0,
      });
      expect(hu3.allBoardsFoldProb).toBeGreaterThan(hu3.breakEvenFoldProb);
      expect(hu3.multiplier).toBeGreaterThan(0.6);
      expect(hu3.multiplier).toBeLessThan(hu2.multiplier);
      expect(hu3.multiplier).toBeLessThanOrEqual(1.0);
    });
  });

  describe('end-to-end HorseLogic byte-identity, receipts, and privacy', () => {
    it('OFF / unset / false is 100% byte-identical across single-board, 2-board, and 3-board hands (exact fastRandom state)', () => {
      const cases = [
        makeBoardState({
          variant: 'nlh',
          heroHole: '6c5d',
          board1: 'Kh9d4c',
          board2: null,
          stage: 'flop',
        }),
        makeBoardState({
          variant: 'nlh',
          heroHole: '6c5d',
          board1: 'Kh9d4c',
          board2: 'Qs7h2s',
          stage: 'flop',
        }),
        makeBoardState({
          variant: 'plo4',
          heroHole: '6c5d4s3h',
          board1: 'Kh9d2c',
          board2: 'Qs7h3s',
          board3: 'Jd8c2h',
          stage: 'turn',
        }),
      ];

      for (let i = 0; i < cases.length; i++) {
        const c = cases[i]!;
        const seed = 3100 + i * 17;

        seedFastRandom(seed);
        drainFires();
        const dUnset = HorseLogic.decide(c.hero, c.gs, 'balanced', undefined, {
          telemetry: true,
          observeMind: false,
        });
        const rngUnset = fastRandom();
        const firesUnset = firesMap();

        seedFastRandom(seed);
        drainFires();
        const dFalse = HorseLogic.decide(c.hero, c.gs, 'balanced', undefined, {
          telemetry: true,
          observeMind: false,
          multiBoardBluffTrimIsPriced: false,
        });
        const rngFalse = fastRandom();
        const firesFalse = firesMap();

        expect(stableDecision(dFalse)).toEqual(stableDecision(dUnset));
        expect(rngFalse).toBe(rngUnset);
        // Strip one-time process-level Omaha reservoir init telemetry before comparing fires maps.
        delete firesUnset.upgrade04_omaha_reservoir_4_seen;
        delete firesFalse.upgrade04_omaha_reservoir_4_seen;
        expect(firesFalse).toEqual(firesUnset);
        expect(firesUnset.v36_multiboard_bluff_trim_priced ?? 0).toBe(0);
      }
    });

    it('single-board hands (!multiBoard36) are 100% byte-identical even when multiBoardBluffTrimIsPriced is ON', () => {
      const singleCases = [
        makeBoardState({
          variant: 'nlh',
          heroHole: 'Ac5d',
          board1: 'Kh9d4c',
          board2: null,
          stage: 'flop',
        }),
        makeBoardState({
          variant: 'plo4',
          heroHole: 'AcKd5s4h',
          board1: 'Qh9d4c2s7h',
          board2: null,
          stage: 'river',
        }),
      ];

      for (let i = 0; i < singleCases.length; i++) {
        const c = singleCases[i]!;
        const seed = 4200 + i * 29;

        seedFastRandom(seed);
        drainFires();
        const dOff = HorseLogic.decide(c.hero, c.gs, 'balanced', undefined, {
          telemetry: true,
          observeMind: false,
          multiBoardBluffTrimIsPriced: false,
        });
        const rngOff = fastRandom();
        const firesOff = firesMap();

        seedFastRandom(seed);
        drainFires();
        const dOn = HorseLogic.decide(c.hero, c.gs, 'balanced', undefined, {
          telemetry: true,
          observeMind: false,
          multiBoardBluffTrimIsPriced: true,
        });
        const rngOn = fastRandom();
        const firesOn = firesMap();

        expect(stableDecision(dOn)).toEqual(stableDecision(dOff));
        expect(rngOn).toBe(rngOff);
        expect(firesOn).toEqual(firesOff);
        expect(firesOn.v36_multiboard_bluff_trim_priced ?? 0).toBe(0);
        expect(firesOn.v36_multiboard_bluff_trim ?? 0).toBe(0);
      }
    });

    it('emits v36_multiboard_bluff_trim_priced with zero legacy double-counting and ignores opponent hole cards', () => {
      const oppId = '40000000-0000-4000-8000-0000000000f1';
      seedOpponentProfile(oppId, 'nlh', 'hu', 72, 80, 8, 80);

      const s1 = makeBoardState({
        variant: 'nlh',
        heroHole: 'Ac5s',
        board1: 'Kh9d4c',
        board2: 'Ks7h2d',
        stage: 'flop',
        oppIds: [oppId],
        oppHoles: ['QhQd'],
      });
      const s2 = makeBoardState({
        variant: 'nlh',
        heroHole: 'Ac5s',
        board1: 'Kh9d4c',
        board2: 'Ks7h2d',
        stage: 'flop',
        oppIds: [oppId],
        oppHoles: ['3s2c'],
      });

      seedFastRandom(5050);
      drainFires();
      const d1 = HorseLogic.decide(s1.hero, s1.gs, 'balanced', undefined, {
        telemetry: true,
        observeMind: false,
        multiBoardBluffTrimIsPriced: true,
      });
      const fires1 = firesMap();

      seedFastRandom(5050);
      drainFires();
      const d2 = HorseLogic.decide(s2.hero, s2.gs, 'balanced', undefined, {
        telemetry: true,
        observeMind: false,
        multiBoardBluffTrimIsPriced: true,
      });
      const fires2 = firesMap();

      expect(fires1.v36_multiboard_bluff_trim_priced).toBe(1);
      expect(fires1.v36_multiboard_bluff_trim ?? 0).toBe(0);
      expect(stableDecision(d1)).toEqual(stableDecision(d2));
      expect(fires1).toEqual(fires2);

      const bs = calculateBettingState(100, 0, 0, 2, 2, false);
      expect(validateAction(d1.action, d1.amount, 500, bs).valid).toBe(true);
    });

    it('reduces bluff frequency in 3-board multiway station spots and increases HU tight-folder bluffs across deterministic RNG sweep', () => {
      const folderId = '40000000-0000-4000-8000-0000000000e1';
      seedOpponentProfile(folderId, 'nlh', 'hu', 76, 80, 4, 80);
      const folderSpot = makeBoardState({
        variant: 'nlh',
        heroHole: 'Ac5s',
        board1: 'Kh8d2c',
        board2: 'Ks7h3d',
        stage: 'flop',
        oppIds: [folderId],
        pot: 100,
        heroStack: 500,
        oppStack: 500,
      });

      const st1 = '40000000-0000-4000-8000-0000000000e2';
      const st2 = '40000000-0000-4000-8000-0000000000e3';
      seedOpponentProfile(st1, 'nlh', 'short', 8, 80, 72, 80);
      seedOpponentProfile(st2, 'nlh', 'short', 8, 80, 72, 80);
      const stationSpot = makeBoardState({
        variant: 'nlh',
        heroHole: '6c5d',
        board1: 'Kh9d2c',
        board2: 'Qs7h3s',
        board3: 'Jd8c4h',
        stage: 'flop',
        oppIds: [st1, st2],
        pot: 100,
        heroStack: 500,
        oppStack: 500,
      });

      const bs = calculateBettingState(100, 0, 0, 2, 2, false);
      let folderBetsOff = 0;
      let folderBetsOn = 0;
      let stationBetsOff = 0;
      let stationBetsOn = 0;

      for (let seed = 1; seed <= 120; seed++) {
        seedFastRandom(seed);
        const fOff = HorseLogic.decide(folderSpot.hero, folderSpot.gs, 'balanced', undefined, {
          observeMind: false,
          multiBoardBluffTrimIsPriced: false,
        });
        seedFastRandom(seed);
        const fOn = HorseLogic.decide(folderSpot.hero, folderSpot.gs, 'balanced', undefined, {
          observeMind: false,
          multiBoardBluffTrimIsPriced: true,
        });
        expect(validateAction(fOn.action, fOn.amount, 500, bs).valid).toBe(true);
        if (fOff.action === 'bet' || fOff.action === 'all_in') folderBetsOff++;
        if (fOn.action === 'bet' || fOn.action === 'all_in') folderBetsOn++;

        seedFastRandom(seed);
        const sOff = HorseLogic.decide(stationSpot.hero, stationSpot.gs, 'balanced', undefined, {
          observeMind: false,
          multiBoardBluffTrimIsPriced: false,
        });
        seedFastRandom(seed);
        const sOn = HorseLogic.decide(stationSpot.hero, stationSpot.gs, 'balanced', undefined, {
          observeMind: false,
          multiBoardBluffTrimIsPriced: true,
        });
        expect(validateAction(sOn.action, sOn.amount, 500, bs).valid).toBe(true);
        if (sOff.action === 'bet' || sOff.action === 'all_in') stationBetsOff++;
        if (sOn.action === 'bet' || sOn.action === 'all_in') stationBetsOn++;
      }

      expect(folderBetsOn).toBeGreaterThan(folderBetsOff);
      expect(stationBetsOn).toBeLessThanOrEqual(stationBetsOff);
      expect(stationBetsOn).toBe(0);
    });
  });

  describe('dark zero-migration option switch discipline', () => {
    it('stays strictly in OPTION_SWITCH_REFUSED (never in OPTION_SWITCH_NAMES)', () => {
      const flagName: keyof HorseDecideOpts = 'multiBoardBluffTrimIsPriced';
      expect(OPTION_SWITCH_NAMES).not.toContain(flagName);
      expect(Object.keys(OPTION_SWITCH_REFUSED)).toContain(flagName);
      expect(optionSwitchRefusal(flagName)).toBeTruthy();
    });
  });
});
