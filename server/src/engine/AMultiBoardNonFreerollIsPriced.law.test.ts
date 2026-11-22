/**
 * LAW: V86 MULTI-BOARD NON-FREEROLL DEAD-HALF FOLD & STRONG-BOARD BET/RAISE BRANCHES ARE PRICED
 * DETERMINISTICALLY WHEN `multiBoardNonFreerollIsPriced` IS ON, AND BYTE-IDENTICAL WHEN OFF, ON
 * SINGLE-BOARD HANDS, OR ON FREEROLL HANDS (2026-11-22).
 *
 * Criteria: CRITERIA-MULTIBOARD-NONFREEROLL-PRICED.md (HORSE DECISIONS lane).
 *
 * Invariants proven here:
 *   1. OFF / unset / false is 100% byte-identical across single-board, freeroll, and non-freeroll
 *      multi-board hands, including exact `fastRandom()` consumption and next-draw RNG state.
 *   2. Single-board hands (`!multiBoard36`) are 100% byte-identical even when
 *      `multiBoardNonFreerollIsPriced: true` (exact decision, exact RNG state, zero priced receipts).
 *   3. Freeroll hands (`lockShare36 >= 1 / nBoards36`) are 100% byte-identical even when
 *      `multiBoardNonFreerollIsPriced: true` (exact decision, exact RNG state, zero V86 priced receipts).
 *   4. Pure pricing module `HorseMultiBoardNonFreerollPriced.ts` is deterministic (zero
 *      `fastRandom()` calls, zero `v86Hash01()` calls, zero `opponentHud/` imports, zero hole-card reads).
 *   5. Profitable dead-half calls that legacy V86 blanket-folded (e.g., 0.85/0.15 vs 0.6x pot on
 *      river) are called (EV(call) > 0, zero realization penalty on river), while truly -EV weak
 *      multi-board hands fold (EV(call) <= 0 and no legal raise > 0).
 *   6. Continuous non-river `deadBoardRealizationPenalty` has no cliff at 0.18, is strictly 0 on
 *      river and when calling all-in, and is monotonic in min/max board equity, street, position,
 *      and multiway count.
 *   7. Monotonicity in board equity, opponent fold rate, wetness/free-card erosion (0 on river),
 *      and `heroBubbleFactor`; strict `!canRaise` (`raisedAfterAggr`) and Pot-Limit max-bet /
 *      max-raise cap enforcement in PLO4/PLO5 multi-board bomb pots.
 *   8. End-to-end `HorseLogic.decide` emits all 5 priced receipts (`v86_multiboard_priced_fold`,
 *      `v86_multiboard_priced_call`, `v86_multiboard_priced_raise`, `v86_multiboard_priced_open_bet`,
 *      `v86_multiboard_priced_open_check`) cleanly and legally under `PokerEngine.validateAction`.
 *   9. `multiBoardNonFreerollIsPriced` stays strictly dark in `OPTION_SWITCH_REFUSED` (never in
 *      `OPTION_SWITCH_NAMES`, zero SQL migrations).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { potLimitRaiseTo } from './BettingStructure.js';
import { _clearGtoPostflop } from './GtoPostflop.js';
import { _clearGtoPostflopV31 } from './GtoPostflopV31.js';
import { fastRandom, seedFastRandom } from './HorseEval.js';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import {
  deadBoardRealizationPenalty,
  multiBoardAverageEquity,
  nonFreerollFreeCardPenalty,
  nonFreerollOpenCalledEquity,
  nonFreerollRaiseCalledEquity,
  priceMultiBoardNonFreerollFacingBet,
  priceMultiBoardNonFreerollOpen,
  riskAdjustedUtility,
  type PriceMultiBoardNonFreerollFacingBetInput,
  type PriceMultiBoardNonFreerollOpenInput,
} from './HorseMultiBoardNonFreerollPriced.js';
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
  folded = false
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
    is_all_in: false,
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

function multiBoardState(opts: {
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
  format?: 'cash' | 'mtt';
  oppId?: string;
}) {
  const variant = opts.variant ?? 'nlh';
  const stage = opts.stage ?? 'river';
  const heroId = 'horse-v86-mb-hero';
  const oppId = opts.oppId ?? '40000000-0000-4000-8000-0000000000b1';
  const currentBet = opts.currentBet ?? 0;
  const pot = opts.pot ?? (currentBet > 0 ? 100 + currentBet : 100);
  const heroStack = opts.heroStack ?? 400;
  const oppStack = opts.oppStack ?? 400;

  const hero = seat(2, heroId, heroStack, 0, 50, opts.heroHole);
  const opp = seat(1, oppId, oppStack, currentBet, 50 + currentBet);
  const actionHistory: ActionRecord[] = [];
  if (stage === 'flop') {
    actionHistory.push(
      currentBet > 0
        ? {
            stage: 'flop',
            seat: 1,
            userId: oppId,
            action: 'bet',
            amount: currentBet,
            timestamp: 1001,
          }
        : { stage: 'flop', seat: 1, userId: oppId, action: 'check', amount: 0, timestamp: 1001 }
    );
  } else {
    actionHistory.push(
      { stage: 'flop', seat: 1, userId: oppId, action: 'check', amount: 0, timestamp: 1001 },
      { stage: 'flop', seat: 2, userId: heroId, action: 'check', amount: 0, timestamp: 1002 }
    );
    if (stage === 'turn') {
      actionHistory.push(
        currentBet > 0
          ? {
              stage: 'turn',
              seat: 1,
              userId: oppId,
              action: 'bet',
              amount: currentBet,
              timestamp: 1003,
            }
          : { stage: 'turn', seat: 1, userId: oppId, action: 'check', amount: 0, timestamp: 1003 }
      );
    } else {
      actionHistory.push(
        { stage: 'turn', seat: 1, userId: oppId, action: 'check', amount: 0, timestamp: 1003 },
        { stage: 'turn', seat: 2, userId: heroId, action: 'check', amount: 0, timestamp: 1004 },
        currentBet > 0
          ? {
              stage: 'river',
              seat: 1,
              userId: oppId,
              action: 'bet',
              amount: currentBet,
              timestamp: 1005,
            }
          : { stage: 'river', seat: 1, userId: oppId, action: 'check', amount: 0, timestamp: 1005 }
      );
    }
  }

  const gs = {
    handNumber: 889201,
    stage,
    pot,
    currentBet,
    minRaise: Math.max(2, currentBet),
    bigBlind: 2,
    smallBlind: 1,
    dealerSeat: 2,
    gameVariant: variant,
    format: opts.format ?? 'cash',
    bombPot: opts.board2 !== null && opts.board2 !== undefined,
    communityCards: cards(opts.board1),
    ...(opts.board2 !== null && opts.board2 !== undefined
      ? { communityCards2: cards(opts.board2) }
      : {}),
    ...(opts.board3 ? { communityCards3: cards(opts.board3) } : {}),
    players: [opp, hero],
    actionHistory,
  };
  return { hero, opp, oppId, gs };
}

describe('LAW: multiBoardNonFreerollIsPriced (V86 Multi-Board Non-Freeroll Priced Replacement)', () => {
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

  describe('pure pricing invariants & public-info discipline', () => {
    const baseOpen: PriceMultiBoardNonFreerollOpenInput = {
      boardEquities: [0.82, 0.52],
      pot: 100,
      heroStack: 400,
      effectiveStack: 400,
      minBet: 2,
      isPotLimit: false,
      geomFrac: 0.78,
      oppCount: 1,
      wetness: 0.4,
      street: 'turn',
      inPosition: true,
      spr: 4,
      heroBubbleFactor: 1,
    };

    const baseFacing: PriceMultiBoardNonFreerollFacingBetInput = {
      boardEquities: [0.85, 0.15],
      pot: 160,
      currentBet: 60,
      playerBet: 0,
      toCall: 60,
      minRaise: 60,
      heroStack: 400,
      deepestOppStack: 400,
      isPotLimit: false,
      oppCount: 1,
      street: 'river',
      inPosition: true,
      canRaise: true,
      heroBubbleFactor: 1,
    };

    it('contains zero fastRandom calls, zero v86Hash01 calls, and zero opponentHud imports', () => {
      const raw = readFileSync(
        join(REPO, 'server/src/engine/HorseMultiBoardNonFreerollPriced.ts'),
        'utf8'
      );
      const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      expect(code).not.toMatch(/\bfastRandom\s*\(/);
      expect(code).not.toMatch(/\bv86Hash01\s*\(/);
      expect(code).not.toMatch(/from\s+['"][^'"]*opponentHud\//);
      expect(code).not.toMatch(/\.cards\b/);
    });

    it('is 100% deterministic and never consumes fastRandom()', () => {
      seedFastRandom(24680);
      const rOpen1 = priceMultiBoardNonFreerollOpen(baseOpen);
      const rFace1 = priceMultiBoardNonFreerollFacingBet(baseFacing);
      const nextWithCall = fastRandom();

      seedFastRandom(24680);
      const nextWithoutCall = fastRandom();
      expect(nextWithCall).toBe(nextWithoutCall);

      seedFastRandom(987654);
      expect(priceMultiBoardNonFreerollOpen(baseOpen)).toEqual(rOpen1);
      expect(priceMultiBoardNonFreerollFacingBet(baseFacing)).toEqual(rFace1);
    });

    it('riskAdjustedUtility reduces identically to e*(P+2w)-w at bf=1 and scales the loss side when bf>1', () => {
      const e = 0.5;
      const p = 100;
      const w = 60;
      expect(riskAdjustedUtility(e, p, w, 1)).toBeCloseTo(e * (p + 2 * w) - w, 10);
      const u1 = riskAdjustedUtility(e, p, w, 1);
      const u15 = riskAdjustedUtility(e, p, w, 1.5);
      const u2 = riskAdjustedUtility(e, p, w, 2.0);
      expect(u15).toBeLessThan(u1);
      expect(u2).toBeLessThan(u15);
      expect(u1 - u15).toBeCloseTo((1 - e) * 0.5 * w, 10);
    });

    it('calls profitable dead-half river hands (0.85/0.15 vs 0.6x pot) and folds truly -EV weak hands', () => {
      // Profitable dead-half on river: 85% / 15% = 50% avg equity vs 0.6x pot needing 27.3%.
      // Legacy V86 blanket-folded (potFrac >= 0.6 && min < 0.18 && max < 0.88).
      const riverDeadHalf = priceMultiBoardNonFreerollFacingBet(baseFacing);
      expect(riverDeadHalf.deadBoardPenalty).toBe(0);
      expect(riverDeadHalf.averageEquity).toBeCloseTo(0.5, 10);
      expect(riverDeadHalf.callRealizedEquity).toBeCloseTo(0.5, 10);
      expect(riverDeadHalf.evCall).toBeCloseTo(50, 8);
      expect(riverDeadHalf.action).toBe('call');

      // Truly -EV weak multi-board hand: 30% / 10% = 20% avg equity vs 0.8x pot needing 30.8%.
      const weakRiver = priceMultiBoardNonFreerollFacingBet({
        ...baseFacing,
        boardEquities: [0.3, 0.1],
        pot: 180,
        currentBet: 80,
        toCall: 80,
        minRaise: 80,
      });
      expect(weakRiver.evCall).toBeLessThan(0);
      expect(weakRiver.action).toBe('fold');

      // Non-river OOP deep-stacked dead-half with barely-breakeven raw equity folds due to
      // continuous realization penalty.
      const oopFlopDead = priceMultiBoardNonFreerollFacingBet({
        ...baseFacing,
        boardEquities: [0.62, 0.02],
        pot: 200,
        currentBet: 100,
        toCall: 100,
        minRaise: 100,
        street: 'flop',
        inPosition: false,
      });
      expect(oopFlopDead.deadBoardPenalty).toBeGreaterThan(0.05);
      expect(oopFlopDead.evCall).toBeLessThan(0);
      expect(oopFlopDead.action).toBe('fold');
    });

    it('deadBoardRealizationPenalty is strictly 0 on river and all-in, continuous across 0.18, and monotonic', () => {
      expect(
        deadBoardRealizationPenalty({
          boardEquities: [0.85, 0.01],
          street: 'river',
          inPosition: false,
          oppCount: 3,
          effectiveBehindAfterAction: 500,
          potAfterAction: 200,
        })
      ).toBe(0);

      expect(
        deadBoardRealizationPenalty({
          boardEquities: [0.6, 0.01],
          street: 'flop',
          inPosition: false,
          oppCount: 2,
          effectiveBehindAfterAction: 0,
          potAfterAction: 200,
        })
      ).toBe(0);

      expect(
        deadBoardRealizationPenalty({
          boardEquities: [0.8, 0.25],
          street: 'flop',
          inPosition: false,
          oppCount: 2,
          effectiveBehindAfterAction: 500,
          potAfterAction: 200,
        })
      ).toBe(0);

      // Continuous across legacy 0.18 cliff (no discontinuity).
      const pBelow = deadBoardRealizationPenalty({
        boardEquities: [0.7, 0.179],
        street: 'flop',
        inPosition: true,
        oppCount: 1,
        effectiveBehindAfterAction: 300,
        potAfterAction: 200,
      });
      const pAbove = deadBoardRealizationPenalty({
        boardEquities: [0.7, 0.181],
        street: 'flop',
        inPosition: true,
        oppCount: 1,
        effectiveBehindAfterAction: 300,
        potAfterAction: 200,
      });
      expect(Math.abs(pBelow - pAbove)).toBeLessThan(0.002);

      // Monotonic in minBoardEq, street (flop > turn > river), position (OOP > IP).
      const pDead = deadBoardRealizationPenalty({
        boardEquities: [0.7, 0.02],
        street: 'flop',
        inPosition: false,
        oppCount: 1,
        effectiveBehindAfterAction: 300,
        potAfterAction: 200,
      });
      const pTurn = deadBoardRealizationPenalty({
        boardEquities: [0.7, 0.02],
        street: 'turn',
        inPosition: false,
        oppCount: 1,
        effectiveBehindAfterAction: 300,
        potAfterAction: 200,
      });
      const pIp = deadBoardRealizationPenalty({
        boardEquities: [0.7, 0.02],
        street: 'flop',
        inPosition: true,
        oppCount: 1,
        effectiveBehindAfterAction: 300,
        potAfterAction: 200,
      });
      expect(pDead).toBeGreaterThan(pTurn);
      expect(pTurn).toBeGreaterThan(0);
      expect(pDead).toBeGreaterThan(pIp);
      expect(pIp).toBeGreaterThan(pBelow);
    });

    it('satisfies monotonicity in board equity, fold rate, wetness/free-card risk, and heroBubbleFactor', () => {
      // Equity monotonicity
      expect(multiBoardAverageEquity([0.85, 0.45])).toBeCloseTo(0.65, 10);
      expect(nonFreerollOpenCalledEquity([0.85, 0.65], 0.75)).toBeGreaterThan(
        nonFreerollOpenCalledEquity([0.85, 0.25], 0.75)
      );
      expect(nonFreerollRaiseCalledEquity([0.85, 0.65], 0.3)).toBeGreaterThan(
        nonFreerollRaiseCalledEquity([0.85, 0.25], 0.3)
      );

      // Fold-rate monotonicity (facing bet): borderline strong hand calls vs station, raises vs folder
      const station = {
        exploitCounters: {
          ...freshExploitCounters(),
          foldToBetOpp: 60,
          foldToBet: 4,
          riverCallOpp: 60,
          riverCall: 56,
          betCheckedToOpp: 60,
          betCheckedTo: 10,
        },
      };
      const folder = {
        exploitCounters: {
          ...freshExploitCounters(),
          foldToBetOpp: 60,
          foldToBet: 50,
          riverCallOpp: 60,
          riverCall: 8,
          betCheckedToOpp: 60,
          betCheckedTo: 10,
        },
      };
      const borderlineFacing: PriceMultiBoardNonFreerollFacingBetInput = {
        ...baseFacing,
        boardEquities: [0.84, 0.42],
        street: 'turn',
      };
      const vsStation = priceMultiBoardNonFreerollFacingBet({
        ...borderlineFacing,
        opponents: [station],
      });
      const vsFolder = priceMultiBoardNonFreerollFacingBet({
        ...borderlineFacing,
        opponents: [folder],
      });
      expect(vsFolder.evRaise).toBeGreaterThan(vsStation.evRaise);

      // Wetness / free-card erosion monotonicity (0 on river)
      expect(nonFreerollFreeCardPenalty(0.9, 2, 'river')).toBe(0);
      const dryPen = nonFreerollFreeCardPenalty(0.1, 1, 'flop');
      const wetPen = nonFreerollFreeCardPenalty(0.9, 1, 'flop');
      expect(wetPen).toBeGreaterThan(dryPen);
      const dryOpen = priceMultiBoardNonFreerollOpen({
        ...baseOpen,
        boardEquities: [0.65, 0.45],
        wetness: 0.05,
        opponents: [station],
      });
      const wetOpen = priceMultiBoardNonFreerollOpen({
        ...baseOpen,
        boardEquities: [0.65, 0.45],
        wetness: 0.95,
        opponents: [station],
      });
      expect(wetOpen.evCheck).toBeLessThan(dryOpen.evCheck);

      // heroBubbleFactor monotonicity: high bubble factor shifts marginal raise -> call and marginal call -> fold
      const strongFacing: PriceMultiBoardNonFreerollFacingBetInput = {
        ...baseFacing,
        boardEquities: [0.84, 0.48],
        street: 'turn',
        opponents: [folder],
      };
      const chipEv = priceMultiBoardNonFreerollFacingBet({
        ...strongFacing,
        heroBubbleFactor: 1,
      });
      const highBubble = priceMultiBoardNonFreerollFacingBet({
        ...strongFacing,
        heroBubbleFactor: 2.4,
      });
      expect(chipEv.action).toBe('raise');
      expect(highBubble.evRaise).toBeLessThan(chipEv.evRaise);
      expect(highBubble.action).toBe('call');

      const thinCallFacing: PriceMultiBoardNonFreerollFacingBetInput = {
        ...baseFacing,
        boardEquities: [0.44, 0.2],
        pot: 160,
        currentBet: 60,
        toCall: 60,
        street: 'river',
      };
      expect(
        priceMultiBoardNonFreerollFacingBet({ ...thinCallFacing, heroBubbleFactor: 1 }).action
      ).toBe('call');
      expect(
        priceMultiBoardNonFreerollFacingBet({ ...thinCallFacing, heroBubbleFactor: 2.0 }).action
      ).toBe('fold');
    });

    it('strictly enforces canRaise=false (!raisedAfterAggr) and Pot-Limit max-bet / max-raise caps', () => {
      const noRaise = priceMultiBoardNonFreerollFacingBet({
        ...baseFacing,
        boardEquities: [0.9, 0.72],
        street: 'turn',
        canRaise: false,
      });
      expect(noRaise.action).toBe('call');
      expect(noRaise.candidates.length).toBe(0);

      // Pot-Limit open cap: betAmount <= pot even with huge stacks.
      const plOpen = priceMultiBoardNonFreerollOpen({
        ...baseOpen,
        boardEquities: [0.9, 0.78],
        pot: 100,
        heroStack: 1000,
        effectiveStack: 1000,
        isPotLimit: true,
        geomFrac: 2.5,
      });
      expect(plOpen.action).toBe('bet');
      expect(plOpen.betAmount).toBeLessThanOrEqual(100);
      for (const c of plOpen.candidates) {
        expect(c.amount).toBeLessThanOrEqual(100);
      }

      // Pot-Limit facing-bet raise cap: raiseTo <= potLimitRaiseTo(pot, currentBet, toCall).
      const plCap = potLimitRaiseTo(160, 60, 60); // 60 + 160 + 60 = 280
      const plFacing = priceMultiBoardNonFreerollFacingBet({
        ...baseFacing,
        boardEquities: [0.9, 0.78],
        pot: 160,
        currentBet: 60,
        playerBet: 0,
        toCall: 60,
        minRaise: 60,
        heroStack: 1500,
        deepestOppStack: 1500,
        isPotLimit: true,
        street: 'turn',
      });
      expect(plFacing.action).toBe('raise');
      expect(plFacing.maxLegalRaiseTo).toBeCloseTo(plCap, 6);
      expect(plFacing.raiseTo).toBeLessThanOrEqual(plCap + 1e-6);
      for (const c of plFacing.candidates) {
        expect(c.raiseTo).toBeLessThanOrEqual(plCap + 1e-6);
      }

      // Deep-stack NLH non-freeroll hands must never spew-shove 16x pot overbets: unclamped
      // MDF range tightening gives an interior optimum around pot-sized wagers.
      const deepNlhOpen = priceMultiBoardNonFreerollOpen({
        ...baseOpen,
        boardEquities: [0.85, 0.7],
        pot: 100,
        heroStack: 1600,
        effectiveStack: 1600,
        isPotLimit: false,
      });
      expect(deepNlhOpen.action).toBe('bet');
      expect(deepNlhOpen.betAmount).toBeLessThanOrEqual(150);

      const deepNlhFacing = priceMultiBoardNonFreerollFacingBet({
        ...baseFacing,
        boardEquities: [0.88, 0.7],
        pot: 160,
        currentBet: 60,
        toCall: 60,
        minRaise: 60,
        heroStack: 1600,
        deepestOppStack: 1600,
        isPotLimit: false,
        street: 'turn',
      });
      expect(deepNlhFacing.action).toBe('raise');
      expect(deepNlhFacing.raiseTo).toBeLessThanOrEqual(400);
    });
  });

  describe('end-to-end HorseLogic.decide byte-identity, receipts, and legality', () => {
    it('OFF / unset / false are 100% byte-identical (including exact fastRandom state)', () => {
      const cases = [
        // Non-freeroll multi-board facing bet (dead-half river)
        multiBoardState({
          variant: 'plo4',
          heroHole: 'AhKhQcJd',
          board1: '9h6h2h4c2d',
          board2: 'KsTc7s5d3c',
          currentBet: 60,
          pot: 160,
          stage: 'river',
        }),
        // Non-freeroll multi-board open (flop)
        multiBoardState({
          variant: 'nlh',
          heroHole: 'AsKd',
          board1: 'AcKh7c',
          board2: 'AhQc4d',
          currentBet: 0,
          pot: 100,
          stage: 'flop',
        }),
        // Single-board NLH
        multiBoardState({
          variant: 'nlh',
          heroHole: 'AsKd',
          board1: 'AcKh7c3d2s',
          board2: null,
          currentBet: 60,
          pot: 160,
          stage: 'river',
        }),
      ];

      for (const c of cases) {
        seedFastRandom(77711);
        drainFires();
        const dUnset = HorseLogic.decide(c.hero, c.gs, 'balanced', undefined, {
          telemetry: true,
          observeMind: false,
        });
        const rngUnset = fastRandom();

        seedFastRandom(77711);
        drainFires();
        const dFalse = HorseLogic.decide(c.hero, c.gs, 'balanced', undefined, {
          telemetry: true,
          observeMind: false,
          multiBoardNonFreerollIsPriced: false,
        });
        const rngFalse = fastRandom();

        expect(stableDecision(dFalse)).toEqual(stableDecision(dUnset));
        expect(rngFalse).toBe(rngUnset);
      }
    });

    it('single-board hands (!multiBoard36) are 100% byte-identical when ON (including fastRandom state)', () => {
      const singleCases = [
        multiBoardState({
          variant: 'nlh',
          heroHole: 'AhKh',
          board1: 'QhJh4h9c2d',
          board2: null,
          currentBet: 60,
          pot: 160,
          stage: 'river',
        }),
        multiBoardState({
          variant: 'plo4',
          heroHole: 'AsKsQhJd',
          board1: 'AdKd7c',
          board2: null,
          currentBet: 0,
          pot: 100,
          stage: 'flop',
        }),
      ];

      for (const c of singleCases) {
        seedFastRandom(31415);
        drainFires();
        const dOff = HorseLogic.decide(c.hero, c.gs, 'balanced', undefined, {
          telemetry: true,
          observeMind: false,
        });
        const rngOff = fastRandom();

        seedFastRandom(31415);
        drainFires();
        const dOn = HorseLogic.decide(c.hero, c.gs, 'balanced', undefined, {
          telemetry: true,
          observeMind: false,
          multiBoardNonFreerollIsPriced: true,
        });
        const rngOn = fastRandom();
        const firesOn = firesMap();

        expect(stableDecision(dOn)).toEqual(stableDecision(dOff));
        expect(rngOn).toBe(rngOff);
        expect(firesOn.v86_multiboard_priced_fold ?? 0).toBe(0);
        expect(firesOn.v86_multiboard_priced_call ?? 0).toBe(0);
        expect(firesOn.v86_multiboard_priced_raise ?? 0).toBe(0);
        expect(firesOn.v86_multiboard_priced_open_bet ?? 0).toBe(0);
        expect(firesOn.v86_multiboard_priced_open_check ?? 0).toBe(0);
      }
    });

    it('freeroll hands (lockShare36 >= 1/N) are 100% byte-identical when ON', () => {
      const freerollCases = [
        // Open freeroll: Royal flush locked on board 1, missed board 2
        multiBoardState({
          variant: 'nlh',
          heroHole: 'AsKs',
          board1: 'QsJsTs3d',
          board2: '9c8c7d6h',
          currentBet: 0,
          pot: 100,
          stage: 'turn',
        }),
        // Facing-bet freeroll: Royal flush locked on board 1, missed board 2
        multiBoardState({
          variant: 'plo4',
          heroHole: 'AsKsAhKh',
          board1: 'QsJsTs3d2c',
          board2: '9c8c7d6h4c',
          currentBet: 60,
          pot: 160,
          stage: 'river',
        }),
      ];

      for (const c of freerollCases) {
        seedFastRandom(55511);
        drainFires();
        const dOff = HorseLogic.decide(c.hero, c.gs, 'balanced', undefined, {
          telemetry: true,
          observeMind: false,
        });
        const rngOff = fastRandom();

        seedFastRandom(55511);
        drainFires();
        const dOn = HorseLogic.decide(c.hero, c.gs, 'balanced', undefined, {
          telemetry: true,
          observeMind: false,
          multiBoardNonFreerollIsPriced: true,
        });
        const rngOn = fastRandom();
        const firesOn = firesMap();

        expect(stableDecision(dOn)).toEqual(stableDecision(dOff));
        expect(rngOn).toBe(rngOff);
        expect(firesOn.v86_multiboard_priced_fold ?? 0).toBe(0);
        expect(firesOn.v86_multiboard_priced_call ?? 0).toBe(0);
        expect(firesOn.v86_multiboard_priced_raise ?? 0).toBe(0);
        expect(firesOn.v86_multiboard_priced_open_bet ?? 0).toBe(0);
        expect(firesOn.v86_multiboard_priced_open_check ?? 0).toBe(0);
      }
    });

    it('calls profitable dead-half river hand that legacy V86 blanket-folded (v86_multiboard_priced_call) and folds truly weak hand (v86_multiboard_priced_fold)', () => {
      // Profitable dead-half river in PLO4: Hero has top straight on a 3-flush board 1 (~0.75-0.84
      // equity, below 0.88 maxBoardEq86 cliff & below 0.93 LOCK_EQ36) and air on board 2 (<0.18
      // minBoardEq86) facing a 0.6x pot bet (60 into 100, pot=160).
      const deadHalfProfitable = multiBoardState({
        variant: 'plo4',
        heroHole: 'Th9d6c4s',
        board1: '8h7h6hJd2c',
        board2: 'AsKsQd5d3s',
        currentBet: 60,
        pot: 160,
        stage: 'river',
      });

      seedFastRandom(101);
      drainFires();
      const dOff = HorseLogic.decide(
        deadHalfProfitable.hero,
        deadHalfProfitable.gs,
        'balanced',
        undefined,
        {
          telemetry: true,
          observeMind: false,
        }
      );
      const firesOff = firesMap();
      expect(firesOff.v86_multiboard_dead_half_fold ?? 0).toBeGreaterThanOrEqual(1);
      expect(dOff.action).toBe('fold');

      seedFastRandom(101);
      drainFires();
      const dOn = HorseLogic.decide(
        deadHalfProfitable.hero,
        deadHalfProfitable.gs,
        'balanced',
        undefined,
        {
          telemetry: true,
          observeMind: false,
          multiBoardNonFreerollIsPriced: true,
        }
      );
      const firesOn = firesMap();
      expect(firesOn.v86_multiboard_dead_half_fold ?? 0).toBe(0);
      expect(firesOn.v86_multiboard_priced_call ?? 0).toBeGreaterThanOrEqual(1);
      expect(dOn.action).toBe('call');

      // Truly weak multi-board river hand facing 0.8x pot bet folds cleanly.
      const weakRiver = multiBoardState({
        variant: 'plo4',
        heroHole: '2c3d4s5h',
        board1: 'AsKsQdJd9c',
        board2: 'KhQhTs8s7d',
        currentBet: 80,
        pot: 180,
        stage: 'river',
      });
      seedFastRandom(202);
      drainFires();
      const dWeak = HorseLogic.decide(weakRiver.hero, weakRiver.gs, 'balanced', undefined, {
        telemetry: true,
        observeMind: false,
        multiBoardNonFreerollIsPriced: true,
      });
      const firesWeak = firesMap();
      expect(firesWeak.v86_multiboard_priced_fold ?? 0).toBeGreaterThanOrEqual(1);
      expect(dWeak.action).toBe('fold');
    });

    it('emits v86_multiboard_priced_raise and respects Pot-Limit cap in PLO4/PLO5 multi-board bomb pots', () => {
      // Strong non-freeroll two-board turn hand in PLO5: sets on both boards (both below 0.93 lock).
      const strongPlo5 = multiBoardState({
        variant: 'plo5',
        heroHole: 'KdKcQdQcJs',
        board1: 'Kh8h5d2c',
        board2: 'Qh9s6d3c',
        currentBet: 60,
        pot: 160,
        heroStack: 1500,
        oppStack: 1500,
        stage: 'turn',
      });

      const bs = calculateBettingState(160, 60, 0, 2, 60, true);
      const plCap = potLimitRaiseTo(160, 60, 60);

      seedFastRandom(303);
      drainFires();
      const dOn1 = HorseLogic.decide(strongPlo5.hero, strongPlo5.gs, 'balanced', undefined, {
        telemetry: true,
        observeMind: false,
        multiBoardNonFreerollIsPriced: true,
      });
      const firesOn1 = firesMap();
      expect(firesOn1.v86_multiboard_priced_raise ?? 0).toBeGreaterThanOrEqual(1);
      expect(dOn1.action).toBe('raise');
      expect(dOn1.amount).toBeDefined();
      expect(dOn1.amount!).toBeLessThanOrEqual(plCap + 0.005);
      expect(validateAction(dOn1.action, dOn1.amount, 1500, bs).valid).toBe(true);

      // Determinism check: identical action & sizing across different RNG seeds (zero fastRandom/hash drift).
      seedFastRandom(999999);
      drainFires();
      const dOn2 = HorseLogic.decide(strongPlo5.hero, strongPlo5.gs, 'balanced', undefined, {
        telemetry: true,
        observeMind: false,
        multiBoardNonFreerollIsPriced: true,
      });
      expect(dOn2.action).toBe(dOn1.action);
      expect(dOn2.amount).toBe(dOn1.amount);
    });

    it('emits v86_multiboard_priced_open_bet and v86_multiboard_priced_open_check cleanly and legally', () => {
      // Strong two-board non-freeroll open on flop in PLO4 -> bets legally within Pot-Limit cap.
      const strongOpen = multiBoardState({
        variant: 'plo4',
        heroHole: 'JsJdTsTd',
        board1: 'Jh9h7c',
        board2: 'Th8c6s',
        currentBet: 0,
        pot: 100,
        heroStack: 1000,
        oppStack: 1000,
        stage: 'flop',
      });
      const bsOpen = calculateBettingState(100, 0, 0, 2, 2, true);
      seedFastRandom(404);
      drainFires();
      const dBet = HorseLogic.decide(strongOpen.hero, strongOpen.gs, 'balanced', undefined, {
        telemetry: true,
        observeMind: false,
        multiBoardNonFreerollIsPriced: true,
      });
      const firesBet = firesMap();
      expect(firesBet.v86_multiboard_priced_open_bet ?? 0).toBeGreaterThanOrEqual(1);
      expect(dBet.action).toBe('bet');
      expect(dBet.amount!).toBeLessThanOrEqual(100.005);
      expect(validateAction(dBet.action, dBet.amount, 1000, bsOpen).valid).toBe(true);

      // Weak two-board non-freeroll open on flop against a calling station -> checks cleanly.
      const stationId = '40000000-0000-4000-8000-0000000000c2';
      HorseMind.importDurableOpponentProfiles([
        {
          user_id: stationId,
          variant: 'nlh',
          mode: 'cash',
          size: 'hu',
          observed_hands: 80,
          initialized: true,
          counters: {
            ...freshExploitCounters(),
            hands: 80,
            vpip: 60,
            pfr: 10,
            foldToBetOpp: 60,
            foldToBet: 3,
            riverCallOpp: 60,
            riverCall: 57,
            betCheckedToOpp: 60,
            betCheckedTo: 6,
          },
        },
      ]);
      const weakOpen = multiBoardState({
        variant: 'nlh',
        heroHole: '3c2d',
        board1: 'AsKsQh',
        board2: 'JdTc8s',
        currentBet: 0,
        pot: 100,
        stage: 'flop',
        oppId: stationId,
      });
      seedFastRandom(505);
      drainFires();
      const dCheck = HorseLogic.decide(weakOpen.hero, weakOpen.gs, 'balanced', undefined, {
        telemetry: true,
        observeMind: false,
        multiBoardNonFreerollIsPriced: true,
      });
      const firesCheck = firesMap();
      expect(firesCheck.v86_multiboard_priced_open_check ?? 0).toBeGreaterThanOrEqual(1);
      expect(dCheck.action).toBe('check');
      const bsNlhOpen = calculateBettingState(100, 0, 0, 2, 2, false);
      expect(validateAction(dCheck.action, dCheck.amount, 400, bsNlhOpen).valid).toBe(true);
    });
  });

  describe('dark zero-migration option switch discipline', () => {
    it('stays strictly in OPTION_SWITCH_REFUSED (never in OPTION_SWITCH_NAMES)', () => {
      const flagName: keyof HorseDecideOpts = 'multiBoardNonFreerollIsPriced';
      expect(OPTION_SWITCH_NAMES).not.toContain(flagName);
      expect(Object.keys(OPTION_SWITCH_REFUSED)).toContain(flagName);
      expect(optionSwitchRefusal(flagName)).toBeTruthy();
    });
  });
});
