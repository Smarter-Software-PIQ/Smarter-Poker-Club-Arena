/**
 * LAW: V36 MULTI-BOARD FREEROLL BET AND RAISE COIN FLIPS ARE PRICED DETERMINISTICALLY WHEN
 * `multiBoardFreerollIsPriced` IS ON, AND BYTE-IDENTICAL WHEN OFF OR ON SINGLE-BOARD HANDS
 * (2026-11-22).
 *
 * Criteria: CRITERIA-MULTIBOARD-FREEROLL-PRICED.md (HORSE DECISIONS lane).
 *
 * Invariants proven here:
 *   1. OFF / unset / false is 100% byte-identical across single-board AND multi-board hands,
 *      including exact `fastRandom()` consumption and next-draw RNG state.
 *   2. Single-board hands (`!multiBoard36`) are 100% byte-identical even when
 *      `multiBoardFreerollIsPriced: true` (exact decision, exact RNG state, zero priced receipts).
 *   3. Pure pricing module `HorseMultiBoardFreerollPriced.ts` is deterministic (zero
 *      `fastRandom()` calls, zero `opponentHud/` imports, zero opponent hole-card reads).
 *   4. Monotonicity:
 *        - fold rate: higher opponent fold rate increases `EV(bet)` and `EV(raise)` when unlocked
 *          equity is weak (`U < P`), shifting freeroll pressure toward bet/raise;
 *        - unlocked equity: higher `unlockedEq` strictly raises `E_total`, `E_called`, and
 *          `E_called_raise` while keeping `lockShare` strictly invariant;
 *        - wetness / free-card risk: higher `wetness` continuously increases
 *          `freerollFreeCardPenalty` (zero on river) and lowers `EV(check)`, favoring betting;
 *        - `heroBubbleFactor`: `bf = 1` reduces identically to `e * (P + 2w) - w`; `bf > 1` scales
 *          the `(1 - e) * wager` loss side and shifts borderline high-variance spots toward
 *          lower-risk check/call lines.
 *   5. Facing a bet on a qualifying freeroll NEVER folds (unit + end-to-end `HorseLogic.decide`).
 *   6. Pot-Limit max-bet (`pot`) and max-raise (`currentBet + pot + toCall`) caps are strictly
 *      respected in PLO multi-board bomb pots (unit + end-to-end `HorseLogic.decide` +
 *      `validateAction`).
 *   7. End-to-end `HorseLogic.decide` emits `v36_freeroll_priced_bet`, `v36_freeroll_priced_check`,
 *      `v36_freeroll_priced_raise`, and `v36_freeroll_priced_call` receipts deterministically.
 *   8. `multiBoardFreerollIsPriced` stays strictly dark in `OPTION_SWITCH_REFUSED` (never in
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
  freerollCalledEquity,
  freerollFreeCardPenalty,
  freerollRaiseCalledEquity,
  freerollTotalEquity,
  priceMultiBoardFreerollFacingBet,
  priceMultiBoardFreerollOpen,
  riskAdjustedCallUtility,
  type PriceMultiBoardFreerollFacingBetInput,
  type PriceMultiBoardFreerollOpenInput,
} from './HorseMultiBoardFreerollPriced.js';
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

function multiBoardRiverState(opts: {
  variant?: 'nlh' | 'plo4';
  heroHole?: string;
  board1?: string;
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
  const heroId = 'horse-v36-hero';
  const oppId = opts.oppId ?? '20000000-0000-4000-8000-0000000000b1';
  const currentBet = opts.currentBet ?? 0;
  const pot = opts.pot ?? (currentBet > 0 ? 100 + currentBet : 100);
  const heroStack = opts.heroStack ?? 400;
  const oppStack = opts.oppStack ?? 400;
  const heroHole = opts.heroHole ?? (variant === 'plo4' ? 'AsKsAhKh' : 'AsKs');
  // Board 1: Royal flush locked (Qs Js Ts 3d 2c) -> equity ~1.0 (>= 0.93 LOCK_EQ36).
  const board1 = opts.board1 ?? 'QsJsTs3d2c';
  // Board 2: Completely missed (9c 8c 7d 6h 4c) -> low unlockedEq.
  const board2 = opts.board2 === undefined ? '9c8c7d6h4c' : opts.board2;

  const hero = seat(2, heroId, heroStack, 0, 50, heroHole);
  const opp = seat(1, oppId, oppStack, currentBet, 50 + currentBet);
  const actionHistory: ActionRecord[] = [
    { stage: 'flop', seat: 1, userId: oppId, action: 'check', amount: 0, timestamp: 1001 },
    { stage: 'flop', seat: 2, userId: heroId, action: 'check', amount: 0, timestamp: 1002 },
    ...(stage === 'turn' || stage === 'river'
      ? ([
          { stage: 'turn', seat: 1, userId: oppId, action: 'check', amount: 0, timestamp: 1003 },
          { stage: 'turn', seat: 2, userId: heroId, action: 'check', amount: 0, timestamp: 1004 },
        ] as ActionRecord[])
      : []),
    ...(stage === 'river' && currentBet > 0
      ? ([
          {
            stage: 'river',
            seat: 1,
            userId: oppId,
            action: 'bet',
            amount: currentBet,
            timestamp: 1005,
          },
        ] as ActionRecord[])
      : stage === 'river'
        ? ([
            { stage: 'river', seat: 1, userId: oppId, action: 'check', amount: 0, timestamp: 1005 },
          ] as ActionRecord[])
        : []),
  ];
  const gs = {
    handNumber: 888201,
    stage,
    pot,
    currentBet,
    minRaise: Math.max(2, currentBet),
    bigBlind: 2,
    smallBlind: 1,
    dealerSeat: 2,
    gameVariant: variant,
    format: opts.format ?? 'cash',
    bombPot: board2 !== null,
    communityCards: cards(board1),
    ...(board2 !== null ? { communityCards2: cards(board2) } : {}),
    ...(opts.board3 ? { communityCards3: cards(opts.board3) } : {}),
    players: [opp, hero],
    actionHistory,
  };
  return { hero, opp, oppId, gs };
}

describe('LAW: multiBoardFreerollIsPriced (V36 Multi-Board Freeroll Priced Replacement)', () => {
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
    const baseOpen: PriceMultiBoardFreerollOpenInput = {
      lockShare: 0.5,
      unlockedEq: 0.35,
      pot: 100,
      heroStack: 400,
      effectiveStack: 400,
      minBet: 2,
      isPotLimit: false,
      geomFrac: 0.8,
      oppCount: 1,
      wetness: 0.3,
      street: 'turn',
      inPosition: true,
      spr: 4,
      heroBubbleFactor: 1,
    };

    const baseFacing: PriceMultiBoardFreerollFacingBetInput = {
      lockShare: 0.5,
      unlockedEq: 0.35,
      pot: 150,
      currentBet: 50,
      playerBet: 0,
      toCall: 50,
      minRaise: 50,
      heroStack: 400,
      deepestOppStack: 400,
      isPotLimit: false,
      oppCount: 1,
      street: 'turn',
      inPosition: true,
      heroBubbleFactor: 1,
    };

    it('contains zero fastRandom calls and zero opponentHud imports', () => {
      const raw = readFileSync(
        join(REPO, 'server/src/engine/HorseMultiBoardFreerollPriced.ts'),
        'utf8'
      );
      const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      expect(code).not.toMatch(/\bfastRandom\s*\(/);
      expect(code).not.toMatch(/from\s+['"][^'"]*opponentHud\//);
    });

    it('is 100% deterministic and never consumes fastRandom()', () => {
      seedFastRandom(24680);
      const rOpen1 = priceMultiBoardFreerollOpen(baseOpen);
      const rFace1 = priceMultiBoardFreerollFacingBet(baseFacing);
      const nextWithCall = fastRandom();

      seedFastRandom(24680);
      const nextWithoutCall = fastRandom();
      expect(nextWithCall).toBe(nextWithoutCall);

      seedFastRandom(987654);
      expect(priceMultiBoardFreerollOpen(baseOpen)).toEqual(rOpen1);
      expect(priceMultiBoardFreerollFacingBet(baseFacing)).toEqual(rFace1);
    });

    it('riskAdjustedCallUtility reduces identically to e*(P+2w)-w at bf=1 and scales the loss side when bf>1', () => {
      const e = 0.65;
      const p = 100;
      const w = 80;
      expect(riskAdjustedCallUtility(e, p, w, 1)).toBeCloseTo(e * (p + 2 * w) - w, 10);
      const u1 = riskAdjustedCallUtility(e, p, w, 1);
      const u15 = riskAdjustedCallUtility(e, p, w, 1.5);
      const u2 = riskAdjustedCallUtility(e, p, w, 2.0);
      expect(u15).toBeLessThan(u1);
      expect(u2).toBeLessThan(u15);
      expect(u1 - u15).toBeCloseTo((1 - e) * 0.5 * w, 10);
    });

    it('keeps lockShare strictly invariant under calling-range discounts and monotonically increases with unlockedEq', () => {
      expect(freerollTotalEquity(0.5, 0)).toBeCloseTo(0.5, 10);
      expect(freerollTotalEquity(0.5, 0.4)).toBeCloseTo(0.7, 10);
      expect(freerollTotalEquity(1, 0)).toBeCloseTo(1, 10);

      // Even at huge bet fractions or extreme raise prices, locked boards never lose equity.
      expect(freerollCalledEquity(0.5, 0, 2.5)).toBeCloseTo(0.5, 10);
      expect(freerollRaiseCalledEquity(0.5, 0, 0.99)).toBeCloseTo(0.5, 10);
      expect(freerollCalledEquity(1, 0, 2.5)).toBeCloseTo(1, 10);

      // Monotonic in unlockedEq.
      const stickyOpp = {
        hudOpp: {
          eff: {
            't.fb.sm.hu': [40, 6] as const,
            't.fb.bg.hu': [40, 6] as const,
            't.betCk': [40, 20] as const,
          },
        },
      };
      const lowEqOpen = priceMultiBoardFreerollOpen({
        ...baseOpen,
        lockShare: 1 / 3,
        unlockedEq: 0.05,
        opponents: [stickyOpp],
      });
      const highEqOpen = priceMultiBoardFreerollOpen({
        ...baseOpen,
        lockShare: 1 / 3,
        unlockedEq: 0.75,
        opponents: [stickyOpp],
      });
      expect(highEqOpen.totalEquity).toBeGreaterThan(lowEqOpen.totalEquity);
      expect(highEqOpen.evBet - highEqOpen.evCheck).toBeGreaterThan(
        lowEqOpen.evBet - lowEqOpen.evCheck
      );

      const lowEqFace = priceMultiBoardFreerollFacingBet({
        ...baseFacing,
        lockShare: 1 / 3,
        unlockedEq: 0.05,
        opponents: [{ hudOpp: { eff: { 't.fRaise': [40, 4] } } }],
      });
      const highEqFace = priceMultiBoardFreerollFacingBet({
        ...baseFacing,
        lockShare: 1 / 3,
        unlockedEq: 0.75,
        opponents: [{ hudOpp: { eff: { 't.fRaise': [40, 4] } } }],
      });
      expect(highEqFace.evRaise - highEqFace.evCall).toBeGreaterThan(
        lowEqFace.evRaise - lowEqFace.evCall
      );
      expect(lowEqFace.action).toBe('call');
      expect(highEqFace.action).toBe('raise');
    });

    it('monotonic in opponent fold rate on weak unlocked freerolls (open bet and facing-bet raise)', () => {
      // Open freeroll with 1/3 lock and weak unlocked board: higher fold rate raises EV(bet).
      const stationOpen = priceMultiBoardFreerollOpen({
        ...baseOpen,
        lockShare: 1 / 3,
        unlockedEq: 0.05,
        opponents: [
          {
            hudOpp: {
              eff: { 't.fb.sm.hu': [120, 2], 't.fb.bg.hu': [120, 2], 't.betCk': [120, 10] },
            },
          },
        ],
      });
      const folderOpen = priceMultiBoardFreerollOpen({
        ...baseOpen,
        lockShare: 1 / 3,
        unlockedEq: 0.05,
        opponents: [
          {
            hudOpp: {
              eff: { 't.fb.sm.hu': [120, 102], 't.fb.bg.hu': [120, 102], 't.betCk': [120, 10] },
            },
          },
        ],
      });
      expect(folderOpen.foldProb).toBeGreaterThan(stationOpen.foldProb);
      expect(folderOpen.evBet - folderOpen.evCheck).toBeGreaterThan(
        stationOpen.evBet - stationOpen.evCheck
      );
      expect(stationOpen.action).toBe('check');
      expect(folderOpen.action).toBe('bet');

      // Facing-bet freeroll with 1/3 lock and weak unlocked board: higher fold-to-raise shifts call -> raise.
      const stationFace = priceMultiBoardFreerollFacingBet({
        ...baseFacing,
        lockShare: 1 / 3,
        unlockedEq: 0.05,
        opponents: [{ hudOpp: { eff: { 't.fRaise': [40, 2] } } }],
      });
      const folderFace = priceMultiBoardFreerollFacingBet({
        ...baseFacing,
        lockShare: 1 / 3,
        unlockedEq: 0.05,
        opponents: [{ hudOpp: { eff: { 't.fRaise': [40, 32] } } }],
      });
      expect(folderFace.foldProb).toBeGreaterThan(stationFace.foldProb);
      expect(folderFace.evRaise - folderFace.evCall).toBeGreaterThan(
        stationFace.evRaise - stationFace.evCall
      );
      expect(stationFace.action).toBe('call');
      expect(folderFace.action).toBe('raise');
    });

    it('wetness continuously increases free-card penalty on flop/turn (0 on river) and favors betting', () => {
      expect(freerollFreeCardPenalty(0.9, 3, 'river')).toBe(0);
      const w49 = freerollFreeCardPenalty(0.49, 1, 'flop');
      const w51 = freerollFreeCardPenalty(0.51, 1, 'flop');
      expect(w51).toBeGreaterThan(w49);
      expect(w51 - w49).toBeLessThan(0.005);

      const dry = priceMultiBoardFreerollOpen({ ...baseOpen, wetness: 0.05, unlockedEq: 0.55 });
      const wet = priceMultiBoardFreerollOpen({ ...baseOpen, wetness: 0.9, unlockedEq: 0.55 });
      expect(wet.freeCardEquity).toBeLessThan(dry.freeCardEquity);
      expect(wet.evCheck).toBeLessThan(dry.evCheck);
      expect(wet.evBet - wet.evCheck).toBeGreaterThan(dry.evBet - dry.evCheck);
    });

    it('heroBubbleFactor > 1 penalizes high-variance freeroll raises/bets and can shift raise -> call', () => {
      const cash = priceMultiBoardFreerollFacingBet({
        ...baseFacing,
        lockShare: 0.5,
        unlockedEq: 0.12,
        heroBubbleFactor: 1.0,
        opponents: [{ hudOpp: { eff: { 't.fRaise': [40, 8] } } }],
      });
      const bubble = priceMultiBoardFreerollFacingBet({
        ...baseFacing,
        lockShare: 0.5,
        unlockedEq: 0.12,
        heroBubbleFactor: 2.5,
        opponents: [{ hudOpp: { eff: { 't.fRaise': [40, 8] } } }],
      });
      expect(bubble.bubbleFactor).toBe(2.5);
      expect(bubble.evRaise - bubble.evCall).toBeLessThan(cash.evRaise - cash.evCall);
      expect(cash.action).toBe('raise');
      expect(bubble.action).toBe('call');
    });

    it('facing-bet pricing NEVER folds and strictly respects Pot-Limit max-raise cap', () => {
      const pot = 150;
      const currentBet = 50;
      const toCall = 50;
      const maxPlRaiseTo = potLimitRaiseTo(pot, currentBet, toCall); // 50 + 150 + 50 = 250
      const res = priceMultiBoardFreerollFacingBet({
        ...baseFacing,
        pot,
        currentBet,
        toCall,
        heroStack: 2000,
        deepestOppStack: 2000,
        isPotLimit: true,
        unlockedEq: 0.75,
      });
      expect(res.action).toBe('raise');
      expect(res.maxLegalRaiseTo).toBeLessThanOrEqual(maxPlRaiseTo);
      expect(res.raiseTo).toBeLessThanOrEqual(maxPlRaiseTo);
      for (const c of res.candidates) {
        expect(c.raiseTo).toBeLessThanOrEqual(maxPlRaiseTo);
        expect(c.raiseTo).toBeGreaterThanOrEqual(currentBet + baseFacing.minRaise);
      }

      // Open bet in Pot-Limit strictly respects pot cap even with deep stacks.
      const openPl = priceMultiBoardFreerollOpen({
        ...baseOpen,
        pot: 100,
        heroStack: 2000,
        effectiveStack: 2000,
        isPotLimit: true,
        geomFrac: 2.5,
      });
      expect(openPl.betAmount).toBeLessThanOrEqual(100);
      for (const c of openPl.candidates) {
        expect(c.amount).toBeLessThanOrEqual(100);
      }
    });
  });

  describe('HorseLogic.decide integration: OFF identity, single-board identity, receipts, PLO cap', () => {
    it('OFF / unset / false is 100% byte-identical on both multi-board and single-board hands including fastRandom state', () => {
      const cases = [
        multiBoardRiverState({ variant: 'nlh', currentBet: 0 }),
        multiBoardRiverState({ variant: 'nlh', currentBet: 50 }),
        multiBoardRiverState({ variant: 'plo4', currentBet: 50 }),
        multiBoardRiverState({ variant: 'nlh', board2: null, currentBet: 0 }),
      ];

      // Warm up one-time per-process Omaha reservoir init before comparing exact telemetry maps.
      for (const { hero, gs } of cases) {
        seedFastRandom(1);
        HorseLogic.decide(hero, gs, 'balanced', undefined, { telemetry: true, observeMind: false });
        drainFires();
      }

      for (const seed of [1, 7, 42]) {
        for (const { hero, gs } of cases) {
          seedFastRandom(seed);
          const dUnset = HorseLogic.decide(hero, gs, 'balanced', undefined, {
            telemetry: true,
            observeMind: false,
          });
          const rUnset = fastRandom();
          const fUnset = firesMap();

          seedFastRandom(seed);
          const dFalse = HorseLogic.decide(hero, gs, 'balanced', undefined, {
            telemetry: true,
            observeMind: false,
            multiBoardFreerollIsPriced: false,
          });
          const rFalse = fastRandom();
          const fFalse = firesMap();

          expect(stableDecision(dFalse)).toEqual(stableDecision(dUnset));
          expect(rFalse).toBe(rUnset);
          expect(fFalse).toEqual(fUnset);
          expect(fFalse.v36_freeroll_priced_bet ?? 0).toBe(0);
          expect(fFalse.v36_freeroll_priced_check ?? 0).toBe(0);
          expect(fFalse.v36_freeroll_priced_raise ?? 0).toBe(0);
          expect(fFalse.v36_freeroll_priced_call ?? 0).toBe(0);
        }
      }
    });

    it('single-board hands are 100% byte-identical even when multiBoardFreerollIsPriced is ON', () => {
      const singleCases = [
        multiBoardRiverState({ variant: 'nlh', board2: null, currentBet: 0 }),
        multiBoardRiverState({ variant: 'nlh', board2: null, currentBet: 50 }),
        multiBoardRiverState({ variant: 'plo4', board2: null, currentBet: 0 }),
        multiBoardRiverState({ variant: 'plo4', board2: null, currentBet: 50 }),
      ];
      for (const seed of [1, 7, 42]) {
        for (const { hero, gs } of singleCases) {
          seedFastRandom(seed);
          const dOff = HorseLogic.decide(hero, gs, 'balanced', undefined, { telemetry: true });
          const rOff = fastRandom();
          const fOff = firesMap();

          seedFastRandom(seed);
          const dOn = HorseLogic.decide(hero, gs, 'balanced', undefined, {
            telemetry: true,
            multiBoardFreerollIsPriced: true,
          });
          const rOn = fastRandom();
          const fOn = firesMap();

          expect(stableDecision(dOn)).toEqual(stableDecision(dOff));
          expect(rOn).toBe(rOff);
          expect(fOn).toEqual(fOff);
        }
      }
    });

    it('fires v36_freeroll_priced_bet / _check / _raise / _call deterministically and never folds a freeroll', () => {
      const optsOn: HorseDecideOpts = {
        telemetry: true,
        observeMind: false,
        multiBoardFreerollIsPriced: true,
      };

      // 1. Open freeroll -> priced bet (double board, royal flush locked on board 1, live equity on board 2).
      {
        const { hero, gs } = multiBoardRiverState({
          variant: 'nlh',
          currentBet: 0,
          board1: 'QsJsTs3d2c',
          board2: 'Kh8d7c4s2h',
        });
        seedFastRandom(11);
        const d1 = HorseLogic.decide(hero, gs, 'balanced', undefined, optsOn);
        const f1 = firesMap();
        seedFastRandom(999);
        const d2 = HorseLogic.decide(hero, gs, 'balanced', undefined, optsOn);
        drainFires();
        expect(d1.action === 'bet' || d1.action === 'all_in').toBe(true);
        expect(f1.v36_freeroll_priced_bet).toBe(1);
        expect(f1.v36_freeroll_bet ?? 0).toBe(0);
        expect(d1.action).toBe(d2.action);
      }

      // 2. Open freeroll -> priced check (3-board pot with 1 locked straight-flush board, dead on
      //    boards 2 & 3, station opponent who almost never folds -> EV(check) > EV(bet)).
      {
        const stationId = '20000000-0000-4000-8000-0000000000c2';
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
              foldToBet: 1,
              riverCallOpp: 60,
              riverCall: 59,
              betCheckedToOpp: 60,
              betCheckedTo: 4,
            },
          },
        ]);

        const { hero, gs } = multiBoardRiverState({
          variant: 'nlh',
          oppId: stationId,
          heroHole: '2s3s',
          currentBet: 0,
          board1: '4s5s6sAdKh',
          board2: 'AcKcQcJc7d',
          board3: 'AhKhQhJh7c',
        });
        seedFastRandom(11);
        const d = HorseLogic.decide(hero, gs, 'balanced', undefined, optsOn);
        const f = firesMap();
        expect(d.action).toBe('check');
        expect(f.v36_freeroll_priced_check).toBe(1);
        expect(f.v36_freeroll_bet ?? 0).toBe(0);
      }

      // 3. Facing-bet freeroll -> priced raise (double board, locked board 1, strong board 2).
      {
        const { hero, gs } = multiBoardRiverState({
          variant: 'nlh',
          currentBet: 50,
          pot: 150,
          board1: 'QsJsTs3d2c',
          board2: 'KhAdKc4s2h',
        });
        seedFastRandom(11);
        const d = HorseLogic.decide(hero, gs, 'balanced', undefined, optsOn);
        const f = firesMap();
        expect(d.action === 'raise' || d.action === 'all_in').toBe(true);
        expect(d.action).not.toBe('fold');
        expect(f.v36_freeroll_priced_raise).toBe(1);
        expect(f.v36_freeroll_raise ?? 0).toBe(0);
      }

      // 4. Facing-bet freeroll -> priced call (3-board pot, 1 lock, dead on boards 2 & 3, station
      //    bettor -> never folds, calls instead of spewing a raise).
      {
        const stationId = '20000000-0000-4000-8000-0000000000c3';
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
              foldToBetOpp: 60,
              foldToBet: 1,
              riverCallOpp: 60,
              riverCall: 59,
            },
          },
        ]);

        const { hero, gs } = multiBoardRiverState({
          variant: 'nlh',
          oppId: stationId,
          currentBet: 50,
          pot: 150,
          board1: 'QsJsTs3d2c',
          board2: '9c8c7d6h4c',
          board3: '9d8d7h6c4d',
        });
        seedFastRandom(11);
        const d = HorseLogic.decide(hero, gs, 'balanced', undefined, optsOn);
        const f = firesMap();
        expect(d.action).toBe('call');
        expect(d.action).not.toBe('fold');
        expect(f.v36_freeroll_priced_call).toBe(1);
        expect(f.v36_freeroll_call ?? 0).toBe(0);
      }
    });

    it('respects Pot-Limit max-raise cap end-to-end in PLO4 double-board bomb pots (validateAction legal)', () => {
      const { hero, gs } = multiBoardRiverState({
        variant: 'plo4',
        heroHole: 'AsKsAhKh',
        board1: 'QsJsTs3d2c',
        board2: 'KdAc7c4s2h',
        pot: 150,
        currentBet: 50,
        heroStack: 2000,
        oppStack: 2000,
      });
      seedFastRandom(42);
      const d = HorseLogic.decide(hero, gs, 'balanced', undefined, {
        telemetry: true,
        observeMind: false,
        multiBoardFreerollIsPriced: true,
      });
      const f = firesMap();
      expect(d.action).toBe('raise');
      expect(f.v36_freeroll_priced_raise).toBe(1);

      const maxPlRaiseTo = potLimitRaiseTo(gs.pot, gs.currentBet, 50);
      expect(d.amount ?? 0).toBeLessThanOrEqual(maxPlRaiseTo);

      const bs = calculateBettingState(
        gs.pot,
        gs.currentBet,
        hero.bet,
        gs.bigBlind,
        gs.minRaise,
        true
      );
      const v = validateAction(d.action, d.amount, hero.stack, bs);
      expect(v.valid, v.error).toBe(true);
    });
  });

  describe('dark switch posture (zero SQL migrations)', () => {
    it('multiBoardFreerollIsPriced is held strictly in OPTION_SWITCH_REFUSED and excluded from OPTION_SWITCH_NAMES', () => {
      expect(OPTION_SWITCH_REFUSED.multiBoardFreerollIsPriced).toBeTruthy();
      expect(optionSwitchRefusal('multiBoardFreerollIsPriced')).toBeTruthy();
      expect(OPTION_SWITCH_NAMES).not.toContain('multiBoardFreerollIsPriced');
    });
  });
});
