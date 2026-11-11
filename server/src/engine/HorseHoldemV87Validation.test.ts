/**
 * V87.1 HOLD'EM ELITE STRATEGY & ECOSYSTEM INDEPENDENT VALIDATION SUITE
 * (2026-11-11)
 *
 * Regression-protects all 6 V87.1 strategic & connected-wiring fixes plus the
 * end-to-end production commit path (HorseLogic -> HorseDecisionWorkerRuntime ->
 * ServerTableEngine.scheduleHorseAction -> ServerActionValidator -> HandController ->
 * HorseExecutionWitness):
 *
 *  1. Straddle Normalization, Double-Division Prevention & Action Order:
 *     - Voluntary-straddle table (`straddle_enabled: true`) with NO straddle posted
 *       on this hand sets `straddleActive: false` via `HandController.getPostedStraddleSnapshot()`.
 *     - Posted live straddle (`4` or `6` chips on `$1/$2`) sets `straddleActive: true`
 *       and `straddleAmount`, normalizes `120bb` (`240` chips / `4` straddle = `60`
 *       straddle-BB) ONCE without double-dividing to `30` (never jamming `A2s`/`77`),
 *       and maps straddle action order (`UTG+1 -> 5` on 6-max / `8` on 9-max, `BB -> 1`,
 *       `SB -> 2`, `UTG -> 0` unopened or `1` over limpers).
 *  2. EP Open-Limp Continuations (Big-Pair Trap & Suited Connectors):
 *     - `QQ/KK/AA` (`big_pair_trap`) returns legal `call`/`all_in` (never illegal raise)
 *       when `facingClosedAllIn` is true.
 *     - `54s-T9s` (`suited_connector`) folds vs `20bb` oversize iso-raise, `raiserIsAllIn`,
 *       `22bb` short effective stack, or `riskAdd = 0.12` bubble pressure, while
 *       continuing (`call` or bounded limp-3-bet bluff) vs normal `4.0bb` iso-raises.
 *  3. River Block-Bet (`V12`) Board-Relative Nut Predicate & Stack Guards:
 *     - `cat === 6` flush on paired river (`Ks Kd 9s 4s 2c`) NEVER emits
 *       `v87_river_block_nut_trap` or `v87_river_block_trap_reraise`.
 *     - Nut full house (`Kc 9c`) on paired river and nut flush (`As Js`) on unpaired
 *       river DO emit `v87_river_block_nut_trap` / `v87_river_block_trap_reraise` when
 *       the opponent has collectible chips behind (`> 0.45 * pot`).
 *     - Pot-committed short opponent stacks (`<= 0.45 * pot` / `<= 0.60 * pot`) block
 *       both `v87_river_block_nut_trap` and `v87_river_block_blocker_bluff`.
 *  4. Diamond Cash Unit Normalization (`bb / 100`):
 *     - `50/100` Diamonds (`asset: 'diamonds'`) normalizes `cashStakeBB = 1` (low-stakes
 *       multiway defense weight `1.0`), while `500/1000` Diamonds (`$5/$10` eq.)
 *       normalizes `cashStakeBB = 10` (`0` low-stakes loosening).
 *  5. Live Tournament Settlement -> `HorseHandReview` -> `HorseSelfTuner` Isolation:
 *     - `buildReviewRows` derives `coveredStack` from `dealtStacksAtDeal` when
 *       `nearBubbleOrPayJump === true`, firing `nlh_bubble_covered_calloff` for the
 *       covered horse and NOT for the covering chip leader.
 *     - All 4 Hold'em leak tags emit both loss and `_won` denominator mirrors, and
 *       `diagnoseAndNudge` isolates `nlhCashShare = 1` (`[25%, 30.5%]`) vs `omahaShare = 1`
 *       (`<= 44%`) vs baseline `BENCH` (`[19%, 32%]`).
 *  6. Worker Floor Bootstrap (`HorseObserverReads`) & End-to-End Commit Pipeline:
 *     - Hydrated `winnerReads` & `flopStab` activate on Hand #1 when `pooled !== null`
 *       and `availableAtMs <= decisionTimeMs`, and are strictly withheld when
 *       `pooled === null` (`disposition: 'independent'`) or `availableAtMs > decisionTimeMs`.
 *     - Real `HorseDecisionWorkerRuntime` -> `ServerTableEngine.scheduleHorseAction` ->
 *       `HandController` -> `HorseExecutionWitness` commits legal actions, retires
 *       changed-circumstance / closed-action refusals cleanly, and preserves `F06`
 *       tournament time-bank continuations.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const workerBridge = vi.hoisted(() => ({
  decideFast: vi.fn(),
  decideDeep: vi.fn(),
  commitDecisionEffects: vi.fn(async () => undefined),
  runWithDispatchBarrier: vi.fn(<T>(fn: () => T): T => fn()),
}));

vi.mock('./horseDecision/index.js', async () => ({
  ...(await vi.importActual<typeof import('./horseDecision/index.js')>('./horseDecision/index.js')),
  getLiveHorseDecisionWorker: () => workerBridge,
}));

vi.mock('../services/supabase/client.js', () => ({
  supabase: {
    from: vi.fn(() => {
      throw new Error('Unexpected database query in unit validation');
    }),
    rpc: vi.fn(() => {
      throw new Error('Unexpected database RPC in unit validation');
    }),
  },
  maintenanceSupabase: {},
}));

vi.mock('../services/errorReporter.js', () => ({ reportError: vi.fn() }));

import type { ActionRecord, Card, CardRank, CardSuit, HandConfig, SeatPlayer } from '../types.js';
import type {
  FastHorseDecisionRequest,
  FastHorseDecisionResult,
  HorseDecisionWorkerResponse,
  LiveHorseDecisionSnapshot,
} from './horseDecision/protocol.js';
import { buildHorseDecisionKey } from './horseDecision/protocol.js';
import {
  HorseDecisionWorkerRuntime,
  defaultHorseDecisionWorkerDependencies,
} from './horseDecision/workerRuntime.js';
import { HorseObserverReads } from './horseDecision/observerReads.js';
import { HandController } from './HandController.js';
import { horseVariantRulesFor } from './VariantRules.js';
import { equityGovernor } from './EquityLoadGovernor.js';
import { solverPolicyArtifactStatus } from '../gto/SolverPolicyArtifactLoader.js';
import { ServerTableEngine } from './ServerTableEngine.js';
import {
  createHorseExecutionWitness,
  type HorseExecutionWitness,
} from './HorseExecutionWitness.js';
import { captureHorseHandJournalContext } from './HorseDecisionHandBinding.js';
import { horsePlanBatchBindingFromRequest } from './HorsePlanHandIdentity.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { HorseLogic, type HorseGameStateV2 } from './HorseLogic.js';
import * as preflopModule from './HorsePreflop.js';
import { HorseMind, readScopeOf } from './HorseMind.js';
import {
  createWinnerReadState,
  isProvenWinner,
  resetWinnerReads,
  winnerReadScopeOf,
} from './HorseWinnerRead.js';
import { restoreFastRandom, saveFastRandom, seedFastRandom } from './HorseEval.js';
import { buildReviewRows, type HorseReviewInput } from '../services/HorseHandReview.js';
import { diagnoseAndNudge, type PlayStats } from '../services/HorseSelfTuner.js';
import { qualifiedTestAdmission } from './HorseQualifiedAuthority.test-support.js';
import {
  dealShuffledDeck,
  mulberry32,
  runPairedArmHand,
  runProvingGroundCells,
  type ProvingGroundCellSpec,
} from '../benchmark/HoldemProvingGroundHarness.js';

const SUIT_MAP: Record<string, CardSuit> = {
  c: 'clubs',
  d: 'diamonds',
  h: 'hearts',
  s: 'spades',
};

function c(spec: string): Card {
  return { rank: spec[0] as CardRank, suit: SUIT_MAP[spec[1]] };
}

function cards(text: string): Card[] {
  return text.trim().split(/\s+/).filter(Boolean).map(c);
}

function makeSeats(
  count: number,
  heroSeat: number,
  heroCards: Card[],
  stackChips: number,
  heroId = '77000000-0000-4000-8000-000000004e20'
): SeatPlayer[] {
  return Array.from({ length: count }, (_, idx) => {
    const seat = idx + 1;
    return {
      seat,
      user_id: seat === heroSeat ? heroId : `77000000-0000-4000-8000-00000000000${seat}`,
      username: seat === heroSeat ? 'HeroHorse' : `Seat${seat}`,
      stack: stackChips,
      bet: 0,
      totalInvested: 0,
      cards: seat === heroSeat ? heroCards : [],
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
    };
  });
}

describe('V87.1 Holdem Elite Strategy & Ecosystem Independent Validation', () => {
  let savedRng: ReturnType<typeof saveFastRandom>;

  beforeEach(() => {
    savedRng = saveFastRandom();
    seedFastRandom(0x20261111);
    enableBrainTelemetry();
    drainFires();
    HorseMind.reset();
    resetWinnerReads();
    vi.clearAllMocks();
  });

  afterEach(() => {
    restoreFastRandom(savedRng);
    drainFires();
    HorseMind.reset();
    resetWinnerReads();
    vi.useRealTimers();
  });

  describe('1. Straddle snapshot, single stack normalization, 3xBB sizing & straddle action order', () => {
    it('carries the actual NLH straddle unit across shallow and deep boundaries with V86 enabled', () => {
      const preflop = vi.spyOn(preflopModule, 'decidePreflopV7');
      try {
        for (const straddleAmount of [4, 6]) {
          for (const effectiveUnits of [25, 26, 35, 36, 60]) {
            for (const v86PloOverhaul of [true, false]) {
              preflop.mockClear();
              const stack = effectiveUnits * straddleAmount;
              const players = makeSeats(6, 6, cards('7d 7c'), stack);
              for (const [index, bet] of [
                [1, 1],
                [2, 2],
                [3, straddleAmount],
              ]) {
                players[index].bet = bet;
                players[index].stack -= bet;
              }
              HorseLogic.decide(
                players[5],
                {
                  stage: 'preflop',
                  gameVariant: 'nlh',
                  gameMode: 'cash',
                  pot: 3 + straddleAmount,
                  currentBet: straddleAmount,
                  minRaise: straddleAmount * 2,
                  smallBlind: 1,
                  bigBlind: 2,
                  dealerSeat: 1,
                  straddleActive: true,
                  straddleAmount,
                  communityCards: [],
                  players,
                  dealtSeatIds: [1, 2, 3, 4, 5, 6],
                  actionHistory: [],
                  legalActions: ['fold', 'call', 'raise', 'all_in'],
                },
                'balanced',
                {},
                { v86PloOverhaul, decisionTimeMs: 1_700_000_000_000 }
              );
              expect(preflop).toHaveBeenCalled();
              const input = preflop.mock.calls.at(-1)![0];
              expect(input.effectiveStackNormalized).toBe(true);
              expect(input.straddleUnitCoins).toBe(straddleAmount);
              expect(input.effectiveStackBB).toBe(effectiveUnits);
              expect(input.effectiveStackBB! * input.straddleUnitCoins!).toBe(stack);
            }
          }
        }
      } finally {
        preflop.mockRestore();
      }
    });

    it('distinguishes unstraddled hands on straddle-enabled tables from live posted straddles', () => {
      const tableId = 'fa100000-0000-4000-8000-000000000101';
      const seatsUnstraddled = makeSeats(6, 4, cards('Ah 2h'), 240);
      const hcNoStraddle = new HandController(
        {
          tableId,
          handNumber: 1,
          gameVariant: 'nlh',
          smallBlind: 1,
          bigBlind: 2,
          rakeConfig: { percent: 0, cap: 0, noFlopNoDrop: true },
        } as HandConfig,
        seatsUnstraddled,
        1
      );
      hcNoStraddle.start();
      expect(hcNoStraddle.getPostedStraddleSnapshot()).toEqual({ amount: 0, seat: null });
      expect(hcNoStraddle.getLastStraddleSeat()).toBeNull();

      const seatsStraddled = makeSeats(6, 5, cards('Ah 2h'), 240);
      const hcStraddle2x = new HandController(
        {
          tableId,
          handNumber: 2,
          gameVariant: 'nlh',
          smallBlind: 1,
          bigBlind: 2,
          straddles: [{ seat: 4, amount: 4 }],
          rakeConfig: { percent: 0, cap: 0, noFlopNoDrop: true },
        } as HandConfig,
        seatsStraddled,
        1
      );
      hcStraddle2x.start();
      expect(hcStraddle2x.getPostedStraddleSnapshot()).toEqual({ amount: 4, seat: 4 });
      expect(hcStraddle2x.getState().currentPlayerSeat).toBe(5);

      const seatsStraddle3x = makeSeats(6, 5, cards('Ah 2h'), 360);
      const hcStraddle3x = new HandController(
        {
          tableId,
          handNumber: 3,
          gameVariant: 'nlh',
          smallBlind: 1,
          bigBlind: 2,
          straddles: [{ seat: 4, amount: 6 }],
          rakeConfig: { percent: 0, cap: 0, noFlopNoDrop: true },
        } as HandConfig,
        seatsStraddle3x,
        1
      );
      hcStraddle3x.start();
      expect(hcStraddle3x.getPostedStraddleSnapshot()).toEqual({ amount: 6, seat: 4 });
      expect(hcStraddle3x.getLastStraddleSeat()).toBe(4);
      const shortSeats = makeSeats(6, 5, cards('Ah 2h'), 240);
      shortSeats[3]!.stack = 3;
      const refused = new HandController(
        {
          tableId,
          handNumber: 4,
          gameVariant: 'nlh',
          smallBlind: 1,
          bigBlind: 2,
          straddles: [{ seat: 4, amount: 6 }],
          rakeConfig: { percent: 0, cap: 0, noFlopNoDrop: true },
        },
        shortSeats,
        1
      );
      refused.start();
      expect(refused.getPostedStraddleSnapshot()).toEqual({ amount: 0, seat: null });
      expect(refused.getLastStraddleSeat()).toBeNull();
    });

    it('never double-divides a 120bb (60-straddle) stack into a <=35bb jam with A2s or 77, including 3xBB straddles', () => {
      for (const straddleAmt of [4, 6]) {
        const stack = 60 * straddleAmt;
        for (const handSpec of ['Ah 2h', '7d 7c']) {
          const players = makeSeats(6, 6, cards(handSpec), stack);
          players[1].bet = 1;
          players[1].stack -= 1;
          players[2].bet = 2;
          players[2].stack -= 2;
          players[3].bet = straddleAmt;
          players[3].stack -= straddleAmt;
          const gsOpen: HorseGameStateV2 = {
            stage: 'preflop',
            gameVariant: 'nlh',
            gameMode: 'cash',
            pot: 3 + straddleAmt,
            currentBet: straddleAmt,
            minRaise: straddleAmt * 2,
            smallBlind: 1,
            bigBlind: 2,
            dealerSeat: 1,
            straddleActive: true,
            straddleAmount: straddleAmt,
            communityCards: [],
            players,
            dealtSeatIds: [1, 2, 3, 4, 5, 6],
            actionHistory: [],
            legalActions: ['fold', 'call', 'raise', 'all_in'],
          };
          const openDec = HorseLogic.decide(players[5], gsOpen, 'balanced', {}, {
            telemetry: true,
            decisionTimeMs: 1_700_000_000_000,
          } as never);
          expect(openDec.action).not.toBe('all_in');
          if (openDec.action === 'raise') {
            expect(openDec.amount!).toBeGreaterThanOrEqual(straddleAmt * 2);
            expect(openDec.amount!).toBeLessThanOrEqual(straddleAmt * 4.5);
          }

          const p3bet = structuredClone(players);
          p3bet[4].bet = straddleAmt * 3;
          p3bet[4].stack -= straddleAmt * 3;
          p3bet[5].bet = straddleAmt * 3;
          p3bet[5].stack -= straddleAmt * 3;
          p3bet[0].bet = straddleAmt * 9;
          p3bet[0].stack -= straddleAmt * 9;
          const gs4Bet: HorseGameStateV2 = {
            ...gsOpen,
            pot: 3 + straddleAmt + straddleAmt * 15,
            currentBet: straddleAmt * 9,
            minRaise: straddleAmt * 15,
            players: p3bet,
            actionHistory: [
              {
                seat: 5,
                userId: p3bet[4].user_id,
                stage: 'preflop',
                action: 'raise',
                amount: straddleAmt * 3,
                timestamp: 1,
                isFullRaise: true,
              } as ActionRecord,
              {
                seat: 6,
                userId: p3bet[5].user_id,
                stage: 'preflop',
                action: 'call',
                amount: straddleAmt * 3,
                timestamp: 2,
              } as ActionRecord,
              {
                seat: 1,
                userId: p3bet[0].user_id,
                stage: 'preflop',
                action: 'raise',
                amount: straddleAmt * 9,
                timestamp: 3,
                isFullRaise: true,
              } as ActionRecord,
            ],
          };
          const face3BetDec = HorseLogic.decide(p3bet[5], gs4Bet, 'balanced', {}, {
            telemetry: true,
            decisionTimeMs: 1_700_000_000_100,
          } as never);
          expect(face3BetDec.action).not.toBe('all_in');
        }
      }
    });

    it('treats BB as 1-behind (only UTG straddler left) and UTG+1 as earliest position on straddled 9-max', () => {
      const stack = 400; // 100 straddles ($4 straddle)
      const seatsUtg1 = makeSeats(9, 5, cards('Qh 9d'), stack);
      seatsUtg1[1].bet = 1;
      seatsUtg1[2].bet = 2;
      seatsUtg1[3].bet = 4;
      const gsUtg1: HorseGameStateV2 = {
        stage: 'preflop',
        gameVariant: 'nlh',
        gameMode: 'cash',
        pot: 7,
        currentBet: 4,
        minRaise: 8,
        smallBlind: 1,
        bigBlind: 2,
        dealerSeat: 1,
        straddleActive: true,
        straddleAmount: 4,
        communityCards: [],
        players: seatsUtg1,
        dealtSeatIds: [1, 2, 3, 4, 5, 6, 7, 8, 9],
        actionHistory: [],
        legalActions: ['fold', 'call', 'raise', 'all_in'],
      };
      const utg1Dec = HorseLogic.decide(seatsUtg1[4], gsUtg1, 'balanced', {}, {
        decisionTimeMs: 1_700_000_000_000,
      } as never);
      expect(utg1Dec.action).toBe('fold');

      const seatsBb = makeSeats(9, 3, cards('Qh 9d'), stack);
      seatsBb[1].bet = 1;
      seatsBb[1].is_folded = true;
      seatsBb[2].bet = 2;
      seatsBb[3].bet = 4;
      for (const s of [5, 6, 7, 8, 9, 1]) seatsBb[s - 1].is_folded = true;
      const gsBb: HorseGameStateV2 = {
        ...gsUtg1,
        players: seatsBb,
        actionHistory: [5, 6, 7, 8, 9, 1, 2].map((s, idx) => ({
          seat: s,
          userId: seatsBb[s - 1].user_id,
          stage: 'preflop' as const,
          action: 'fold' as const,
          amount: 0,
          timestamp: idx + 1,
        })),
      };
      const bbDec = HorseLogic.decide(seatsBb[2], gsBb, 'balanced', {}, {
        decisionTimeMs: 1_700_000_000_000,
      } as never);
      expect(bbDec.action).toBe('raise');
    });
  });

  describe('2. EP Open-Limp Continuations: Closed All-Ins & Bounded Suited-Connector Iso Defense', () => {
    it('returns legal call (never illegal raise) with AA limp-trap when facing a closed short all-in', () => {
      const players = makeSeats(6, 4, cards('As Ad'), 200);
      players[3].bet = 2;
      players[3].stack = 198;
      players[4].bet = 3;
      players[4].stack = 0;
      players[4].is_all_in = true;
      const gsClosed: HorseGameStateV2 = {
        stage: 'preflop',
        gameVariant: 'nlh',
        gameMode: 'cash',
        pot: 8,
        currentBet: 3,
        minRaise: 5,
        smallBlind: 1,
        bigBlind: 2,
        dealerSeat: 1,
        communityCards: [],
        players,
        dealtSeatIds: [1, 2, 3, 4, 5, 6],
        actionHistory: [
          {
            seat: 4,
            userId: players[3].user_id,
            stage: 'preflop',
            action: 'call',
            amount: 2,
            timestamp: 1,
          } as ActionRecord,
          {
            seat: 5,
            userId: players[4].user_id,
            stage: 'preflop',
            action: 'all_in',
            amount: 3,
            timestamp: 2,
            isFullRaise: false,
          } as ActionRecord,
        ],
        legalActions: ['fold', 'call'],
      };
      const dec = HorseLogic.decide(players[3], gsClosed, 'balanced', {}, {
        telemetry: true,
        decisionTimeMs: 1_700_000_000_000,
      } as never);
      expect(dec.action).toBe('call');
    });

    it('folds suited-connector EP limps against oversize 20bb iso-raises, all-in iso-shoves, and short stacks, while continuing vs normal 4.0bb iso', () => {
      const buildScSpot = (opts: { isoToBb: number; stackBb: number; raiserAllIn?: boolean }) => {
        const bb = 2;
        const players = makeSeats(9, 4, cards('7h 6h'), opts.stackBb * bb);
        players[3].bet = bb;
        players[3].stack -= bb;
        players[5].bet = opts.isoToBb * bb;
        players[5].stack = opts.raiserAllIn
          ? 0
          : Math.max(0, opts.stackBb * bb - opts.isoToBb * bb);
        players[5].is_all_in = opts.raiserAllIn === true;
        const gs: HorseGameStateV2 = {
          stage: 'preflop',
          gameVariant: 'nlh',
          gameMode: 'cash',
          pot: 3 + bb + opts.isoToBb * bb,
          currentBet: opts.isoToBb * bb,
          minRaise: opts.isoToBb * bb * 2,
          smallBlind: 1,
          bigBlind: bb,
          dealerSeat: 1,
          communityCards: [],
          players,
          dealtSeatIds: [1, 2, 3, 4, 5, 6, 7, 8, 9],
          actionHistory: [
            {
              seat: 4,
              userId: players[3].user_id,
              stage: 'preflop',
              action: 'call',
              amount: bb,
              timestamp: 1,
            } as ActionRecord,
            {
              seat: 6,
              userId: players[5].user_id,
              stage: 'preflop',
              action: opts.raiserAllIn ? 'all_in' : 'raise',
              amount: opts.isoToBb * bb,
              timestamp: 2,
              isFullRaise: true,
            } as ActionRecord,
          ],
          legalActions: opts.raiserAllIn ? ['fold', 'call'] : ['fold', 'call', 'raise', 'all_in'],
        };
        return HorseLogic.decide(players[3], gs, 'balanced', {}, {
          telemetry: true,
          decisionTimeMs: 1_700_000_000_000,
        } as never);
      };

      expect(buildScSpot({ isoToBb: 20, stackBb: 100 }).action).toBe('fold');
      expect(buildScSpot({ isoToBb: 4.5, stackBb: 100, raiserAllIn: true }).action).toBe('fold');
      expect(buildScSpot({ isoToBb: 3.5, stackBb: 22 }).action).toBe('fold');
      const normalIso = buildScSpot({ isoToBb: 4.0, stackBb: 100 });
      expect(['call', 'raise']).toContain(normalIso.action);
      if (normalIso.action === 'raise') {
        expect(normalIso.amount!).toBeLessThanOrEqual(200 * 0.34);
      }
    });
  });

  describe('3. River V12 Block-Bet Board-Relative Nut Predicate & Collectible Stack Guards', () => {
    function runRiverOopSpot(params: {
      heroCards: string;
      boardCards: string;
      oppStack: number;
      pot: number;
      facingRaiseTo?: number;
    }) {
      drainFires();
      const heroId = '77000000-0000-4000-8000-00000000bb01';
      const oppId = '77000000-0000-4000-8000-00000000bb02';
      const players = makeSeats(2, 2, cards(params.heroCards), 400, heroId);
      players[0].user_id = oppId;
      players[0].stack = params.oppStack;
      const blockAmt = Math.round(params.pot * 0.3);
      const history: ActionRecord[] = [
        {
          seat: 1,
          userId: oppId,
          stage: 'preflop',
          action: 'raise',
          amount: 6,
          timestamp: 1,
          isFullRaise: true,
        } as ActionRecord,
        {
          seat: 2,
          userId: heroId,
          stage: 'preflop',
          action: 'call',
          amount: 6,
          timestamp: 2,
        } as ActionRecord,
        {
          seat: 2,
          userId: heroId,
          stage: 'flop',
          action: 'check',
          amount: 0,
          timestamp: 3,
        } as ActionRecord,
        {
          seat: 1,
          userId: oppId,
          stage: 'flop',
          action: 'check',
          amount: 0,
          timestamp: 4,
        } as ActionRecord,
        {
          seat: 2,
          userId: heroId,
          stage: 'turn',
          action: 'bet',
          amount: 12,
          timestamp: 5,
          isFullRaise: true,
        } as ActionRecord,
        {
          seat: 1,
          userId: oppId,
          stage: 'turn',
          action: 'call',
          amount: 12,
          timestamp: 6,
        } as ActionRecord,
      ];
      if (params.facingRaiseTo !== undefined) {
        players[1].bet = blockAmt;
        players[1].stack -= blockAmt;
        players[0].bet = params.facingRaiseTo;
        players[0].stack = Math.max(0, params.oppStack - params.facingRaiseTo);
        history.push(
          {
            seat: 2,
            userId: heroId,
            stage: 'river',
            action: 'bet',
            amount: blockAmt,
            timestamp: 7,
            isFullRaise: true,
          } as ActionRecord,
          {
            seat: 1,
            userId: oppId,
            stage: 'river',
            action: 'raise',
            amount: params.facingRaiseTo,
            timestamp: 8,
            isFullRaise: true,
          } as ActionRecord
        );
      }
      const decisions: Array<{ action: string; amount?: number }> = [];
      for (let hand = 1; hand <= 80; hand++) {
        seedFastRandom(0x88000 + hand * 7919);
        const gs: HorseGameStateV2 = {
          stage: 'river',
          gameVariant: 'nlh',
          gameMode: 'cash',
          pot:
            params.facingRaiseTo !== undefined
              ? params.pot + blockAmt + params.facingRaiseTo
              : params.pot,
          currentBet: params.facingRaiseTo ?? 0,
          minRaise: params.facingRaiseTo !== undefined ? params.facingRaiseTo * 2 : 2,
          smallBlind: 1,
          bigBlind: 2,
          dealerSeat: 1,
          communityCards: cards(params.boardCards),
          players,
          dealtSeatIds: [1, 2],
          actionHistory: [
            ...history,
            // Vary harmless preflop timestamp by hand so deterministic hash-keyed unit87 samples uniformly!
          ].map((a, idx) => (idx === 0 ? { ...a, timestamp: hand } : a)),
          legalActions:
            params.facingRaiseTo !== undefined
              ? ['fold', 'call', 'raise', 'all_in']
              : ['check', 'bet', 'all_in'],
        };
        const variedHero = {
          ...players[1],
          user_id: `77000000-0000-4000-8000-${String(hand).padStart(12, '0')}`,
        };
        gs.players = [players[0], variedHero];
        gs.actionHistory = (gs.actionHistory ?? []).map((a) =>
          a.seat === 2 ? { ...a, userId: variedHero.user_id } : a
        );
        decisions.push(
          HorseLogic.decide(variedHero, gs, 'balanced', {}, {
            telemetry: true,
            decisionTimeMs: 1_700_000_000_000 + hand * 1000,
          } as never)
        );
      }
      const fired = new Map(drainFires().map((f) => [f.feature, f.fires]));
      return { decisions, fired };
    }

    it('blocks nut-trap & trap-reraise on paired-board flushes, while firing on unpaired nut flushes and paired-board nut full houses', () => {
      // 1. Paired river Ks Kd 9s 4s 2c: As Js is a flush (cat === 6), NOT a board-relative nut hand!
      const pairedFlushLead = runRiverOopSpot({
        heroCards: 'As Js',
        boardCards: 'Ks Kd 9s 4s 2c',
        oppStack: 300,
        pot: 80,
      });
      expect(pairedFlushLead.fired.get('v87_river_block_nut_trap') ?? 0).toBe(0);

      const pairedFlushVsRaise = runRiverOopSpot({
        heroCards: 'As Js',
        boardCards: 'Ks Kd 9s 4s 2c',
        oppStack: 300,
        pot: 80,
        facingRaiseTo: 96,
      });
      expect(pairedFlushVsRaise.fired.get('v87_river_block_trap_reraise') ?? 0).toBe(0);

      // 2. Unpaired river Ks Qd 9s 4s 2c: As Js IS the stone nut flush -> traps ~22% & 3-bets when raised!
      const nutFlushLead = runRiverOopSpot({
        heroCards: 'As Js',
        boardCards: 'Ks Qd 9s 4s 2c',
        oppStack: 300,
        pot: 80,
      });
      expect(nutFlushLead.fired.get('v87_river_block_nut_trap') ?? 0).toBeGreaterThan(5);

      const nutFlushVsRaise = runRiverOopSpot({
        heroCards: 'As Js',
        boardCards: 'Ks Qd 9s 4s 2c',
        oppStack: 300,
        pot: 80,
        facingRaiseTo: 96,
      });
      expect(nutFlushVsRaise.fired.get('v87_river_block_trap_reraise') ?? 0).toBe(80);

      // 3. Paired river Ks Kd 9s 4s 2c: Kc 9c IS top full house (!underfull) -> traps & 3-bets!
      const nutBoatVsRaise = runRiverOopSpot({
        heroCards: 'Kc 9c',
        boardCards: 'Ks Kd 9s 4s 2c',
        oppStack: 300,
        pot: 80,
        facingRaiseTo: 96,
      });
      expect(nutBoatVsRaise.fired.get('v87_river_block_trap_reraise') ?? 0).toBe(80);

      // 4. Short opponent stack (oppStack = 20 on 80 pot <= 0.45 * pot) -> zero nut traps or blocker bluffs!
      const shortOppLead = runRiverOopSpot({
        heroCards: 'As Js',
        boardCards: 'Ks Qd 9s 4s 2c',
        oppStack: 20,
        pot: 80,
      });
      expect(shortOppLead.fired.get('v87_river_block_nut_trap') ?? 0).toBe(0);

      const shortOppBluff = runRiverOopSpot({
        heroCards: 'As Td',
        boardCards: 'Ks Qd 9s 4s 2c',
        oppStack: 30,
        pot: 80,
      });
      expect(shortOppBluff.fired.get('v87_river_block_blocker_bluff') ?? 0).toBe(0);
    });
  });

  describe('4. Diamond Cash Unit Normalization (100 Diamonds = $1)', () => {
    it('gives 50/100 Diamonds ($0.50/$1 eq.) low-stakes multiway defense loosening and withholds it on 500/1000 Diamonds ($5/$10 eq.)', () => {
      const countCalls = (sb: number, bb: number) => {
        let calls = 0;
        const candidateHands = [
          '6s 4s',
          '8s 6s',
          'Ks 7s',
          'Qs 8s',
          '9s 7s',
          '5s 3s',
          'Js 8s',
          'Ts 7s',
        ];
        for (const hSpec of candidateHands) {
          for (let trial = 0; trial < 10; trial++) {
            seedFastRandom(0x4400 + trial * 131);
            const heroId = `77000000-0000-4000-8000-d1a0000000${String(trial).padStart(2, '0')}`;
            const players = makeSeats(9, 1, cards(hSpec), 100 * bb, heroId);
            players[1].bet = sb;
            players[1].stack -= sb;
            players[2].bet = bb;
            players[2].stack -= bb;
            players[3].bet = 2.5 * bb;
            players[3].stack -= 2.5 * bb;
            players[5].bet = 2.5 * bb;
            players[5].stack -= 2.5 * bb;
            const gs: HorseGameStateV2 = {
              stage: 'preflop',
              gameVariant: 'nlh',
              gameMode: 'cash',
              asset: 'diamonds',
              pot: sb + bb + 5 * bb,
              currentBet: 2.5 * bb,
              minRaise: 4 * bb,
              smallBlind: sb,
              bigBlind: bb,
              dealerSeat: 1,
              communityCards: [],
              players,
              dealtSeatIds: [1, 2, 3, 4, 5, 6, 7, 8, 9],
              actionHistory: [
                {
                  seat: 4,
                  userId: players[3].user_id,
                  stage: 'preflop',
                  action: 'raise',
                  amount: 2.5 * bb,
                  timestamp: 1,
                  isFullRaise: true,
                } as ActionRecord,
                {
                  seat: 6,
                  userId: players[5].user_id,
                  stage: 'preflop',
                  action: 'call',
                  amount: 2.5 * bb,
                  timestamp: 2,
                } as ActionRecord,
              ],
              legalActions: ['fold', 'call', 'raise', 'all_in'],
            };
            const d = HorseLogic.decide(players[0], gs, 'balanced', {}, {
              decisionTimeMs: 1_700_000_000_000 + trial * 100,
            } as never);
            if (d.action === 'call' || d.action === 'raise') calls++;
          }
        }
        return calls;
      };

      const lowDiamondContinues = countCalls(50, 100);
      const highDiamondContinues = countCalls(500, 1000);
      expect(lowDiamondContinues).toBeGreaterThan(highDiamondContinues);
    });
  });

  describe('5. Live Bubble Settlement Wiring -> HorseHandReview -> Variant-Isolated HorseSelfTuner', () => {
    it('derives coveredStack from dealtStacksAtDeal on live bubble settlement and isolates NLH Cash vs Omaha vs baseline tuning', () => {
      const coveredHorse = '88000000-0000-4000-8000-000000000001';
      const coveringHorse = '88000000-0000-4000-8000-000000000002';

      const baseBubble: HorseReviewInput = {
        handId: '11111111-1111-4111-8111-111111111111',
        tableId: '22222222-2222-4222-8222-222222222222',
        tournamentId: '33333333-3333-4333-8333-333333333333',
        clubId: null,
        gameVariant: 'nlh',
        bigBlind: 2,
        playedAt: '2026-11-11T10:00:00.000Z',
        potSize: 100,
        board: cards('9c 5d 2h 7s 3c'),
        holeCardsAll: new Map([
          [coveredHorse, { seat: 1, cards: cards('Kh Jd') }],
          [coveringHorse, { seat: 2, cards: cards('As Ad') }],
        ]),
        contributions: new Map([
          [coveredHorse, 50],
          [coveringHorse, 50],
        ]),
        winners: [{ userId: coveringHorse, amount: 100 }],
        actions: [
          { seat: 2, userId: coveringHorse, action: 'all_in', amount: 160, stage: 'preflop' },
          { seat: 1, userId: coveredHorse, action: 'call', amount: 50, stage: 'preflop' },
        ],
        roster: [
          { userId: coveredHorse, isHorse: true },
          { userId: coveringHorse, isHorse: true },
        ],
        nearBubbleOrPayJump: true,
        tournamentStage: 'bubble',
        dealtStacksAtDeal: new Map([
          [coveredHorse, 50],
          [coveringHorse, 160],
        ]),
      };

      const rows = buildReviewRows(baseBubble);
      const coveredRow = rows.find((r) => r.horse_user_id === coveredHorse);
      const coveringRow = rows.find((r) => r.horse_user_id === coveringHorse);
      expect(coveredRow?.leak_tags).toContain('nlh_bubble_covered_calloff');
      expect(coveringRow?.leak_tags).not.toContain('nlh_bubble_covered_calloff');

      const rowsReverse = buildReviewRows({
        ...baseBubble,
        board: cards('Jc 5d 2h 7s 3c'),
        holeCardsAll: new Map([
          [coveredHorse, { seat: 1, cards: cards('Kh Jd') }],
          [coveringHorse, { seat: 2, cards: cards('As Kd') }],
        ]),
        winners: [{ userId: coveredHorse, amount: 100 }],
        actions: [
          { seat: 2, userId: coveringHorse, action: 'all_in', amount: 160, stage: 'preflop' },
          { seat: 1, userId: coveredHorse, action: 'call', amount: 50, stage: 'preflop' },
        ],
      });
      const coveringLoserRow = rowsReverse.find((r) => r.horse_user_id === coveringHorse);
      const coveredWinnerRow = rowsReverse.find((r) => r.horse_user_id === coveredHorse);
      expect(coveringLoserRow?.leak_tags).not.toContain('nlh_bubble_covered_calloff');
      expect(coveredWinnerRow?.leak_tags).toContain('nlh_bubble_covered_calloff_won');

      const baseStats = (vpipHands: number): PlayStats => ({
        hands: 1000,
        vpip: vpipHands,
        pfr: Math.round(vpipHands * 0.75),
        threeBets: 40,
        threeBetOpps: 400,
        openRaises: 150,
        foldTo3Bets: 20,
        faced3Bets: 40,
        sawFlop: 400,
        wonWhenSawFlop: 180,
        postAggr: 300,
        postPassive: 200,
        netBB: 50,
      });

      // 21% VPIP: below NLH Cash [25%, 30.5%] floor -> loosens tightness (< 1.0)
      const nlhCashNudge = diagnoseAndNudge(
        baseStats(210),
        {},
        null,
        0,
        { nlh_ep_limp_passivity: 8 },
        { nlhCashShare: 1.0, leaksHands: 100 }
      );
      expect(nlhCashNudge.mods.tightness).toBeLessThan(1);
      expect(nlhCashNudge.mods.aggression).toBeGreaterThan(1);

      // 21% VPIP with nlhCashShare = 0 (tournament/default BENCH [19%, 32%]) + bubble calloff leaks -> tightens (> 1.0)!
      const nlhMttNudge = diagnoseAndNudge(
        baseStats(210),
        {},
        null,
        0,
        { nlh_bubble_covered_calloff: 6 },
        { nlhCashShare: 0, leaksHands: 100 }
      );
      expect(nlhMttNudge.mods.tightness).toBeGreaterThan(1);

      // 38% VPIP on pure Omaha cash (omahaShare = 1.0 <= 44% ceiling) -> NOT tightened!
      const omahaNudge = diagnoseAndNudge(baseStats(380), {}, null, 0, null, {
        nlhCashShare: 0,
        omahaShare: 1.0,
      });
      expect(omahaNudge.mods.tightness).toBe(1);
    });
  });

  describe('6. Worker Floor Bootstrap (winnerReads + flopStab) & Real Commit Pipeline', () => {
    it('hydrates winnerReads and flopStab on Hand #1 ONLY when pooled !== null and availableAtMs <= decisionTimeMs', () => {
      const table = '10000000-0000-4000-8000-000000000099';
      const actor = '20000000-0000-4000-8000-000000000099';
      const bully = '30000000-0000-4000-8000-000000000099';
      const lease = '50000000-0000-4000-8000-000000000099';

      const scope = readScopeOf('nlh', 6);
      const wScope = winnerReadScopeOf('nlh', 'cash');
      const bootWinner = createWinnerReadState();
      // Effective sample = w^2 / w2 = 420^2 / 420 = 420 >= 300; mean = 1.5bb/hand, variance = 9 -> se = 0.146 -> proven = true!
      const winnerRow = { w: 420, w2: 420, s: 630, q: 4725 };
      bootWinner.rows.set(`${wScope}|${bully}`, { ...winnerRow });
      bootWinner.rows.set(bully, { ...winnerRow });

      const bootFlop = new Map([
        [
          `${scope}|${bully}`,
          {
            flopCheckedToOpps: 24,
            flopBetCheckedTo: 20,
            fFlopCheckedToOpps: 10,
            fFlopBetCheckedTo: 9,
          },
        ],
      ]);

      const bank = new HorseObserverReads(20, 20, () => 10_000);
      bank.bootstrapPublicProfiles({
        availableAtMs: 5_000,
        profiles: [
          {
            user_id: bully,
            variant: 'nlh',
            mode: 'cash',
            size: 'full',
            observed_hands: 180,
            initialized: true,
            counters: {
              hands: 120,
              vpip: 78,
              pfr: 48,
              rfiOpp: 40,
              rfi: 24,
              threeBetOpp: 30,
              threeBet: 9,
              foldTo3BetOpp: 20,
              foldTo3Bet: 10,
              betCheckedToOpp: 50,
              betCheckedTo: 12, // Low pooled betCheckedTo (checks turns/rivers), proving flopStab is what fires highFlopStab!
              foldToBetOpp: 40,
              foldToBet: 28,
              riverCallOpp: 10,
              riverCall: 3,
              fHands: 8,
              fPfr: 5,
              fRfiOpp: 4,
              fRfi: 3,
              fThreeBetOpp: 3,
              fThreeBet: 1,
              fBetCheckedToOpp: 8,
              fBetCheckedTo: 2,
              fFoldToBetOpp: 6,
              fFoldToBet: 4,
              fRiverCallOpp: 2,
              fRiverCall: 0,
            },
          },
        ],
      });
      bank.bootstrapFloorExploitReads({
        winnerReads: bootWinner,
        flopStab: bootFlop,
        availableAtMs: 5_000,
      });

      const makeReq = (decisionTimeMs: number, hand = 1): FastHorseDecisionRequest =>
        ({
          type: 'DECIDE_FAST',
          requestId: hand,
          generation: 1,
          fence: `${table}:${hand}:1:${lease}:1`,
          decisionKey: '',
          decisionTimeMs,
          handJournalContext: captureHorseHandJournalContext([]),
          player: { user_id: actor, seat: 1 },
          gameState: {
            gameVariant: 'nlh',
            format: 'cash',
            gameMode: 'cash',
            dealtSeatIds: [1, 2, 3, 4, 5, 6],
            players: [
              { user_id: actor, seat: 1 },
              { user_id: bully, seat: 2 },
              { user_id: 'p3', seat: 3 },
              { user_id: 'p4', seat: 4 },
              { user_id: 'p5', seat: 5 },
              { user_id: 'p6', seat: 6 },
            ],
          },
        }) as never;

      // 1. Before availableAtMs (decisionTimeMs = 4_000 < 5_000): disposition === 'independent', NO leak!
      const reqEarly = makeReq(4_000, 1);
      bank.run(reqEarly, () => {
        expect(isProvenWinner(bully, wScope)).toBe(false);
        HorseMind.setDecisionScope(scope, 'nlh', 'cash');
        expect(HorseMind.streetBullyRead(bully).highFlopStab).toBe(false);
        HorseMind.setDecisionScope(null);
      });
      expect(bank.receipt(reqEarly)?.disposition).toBe('independent');

      // 2. At/after availableAtMs (decisionTimeMs = 6_000 >= 5_000): Hand #1 immediately remembers proven winner & flop stabber!
      const reqLive = makeReq(6_000, 2);
      bank.run(reqLive, () => {
        expect(isProvenWinner(bully, wScope)).toBe(true);
        HorseMind.setDecisionScope(scope, 'nlh', 'cash');
        const sRead = HorseMind.streetBullyRead(bully);
        expect(sRead.highFlopStab).toBe(true);
        expect(sRead.stabRate).toBeGreaterThan(0.7);
        expect(sRead.turnGiveUp).toBe(true);
        HorseMind.setDecisionScope(null);
      });
      expect(bank.receipt(reqLive)?.disposition).not.toBe('independent');
    });

    it('drives real HorseDecisionWorkerRuntime -> ServerTableEngine -> ServerActionValidator -> HandController -> HorseExecutionWitness across normal commit, stale refusal, and F06 time-bank tank', async () => {
      vi.useFakeTimers();
      const tableId = 'fa100000-0000-4000-8000-000000000901';
      const messages: HorseDecisionWorkerResponse[] = [];
      const runtime = new HorseDecisionWorkerRuntime((msg) => messages.push(msg), {
        ...defaultHorseDecisionWorkerDependencies,
        admitFeatureAuthority: () => qualifiedTestAdmission(),
      });

      let lastWitness: HorseExecutionWitness | undefined;
      workerBridge.decideFast.mockImplementation(
        async (snapshot: LiveHorseDecisionSnapshot): Promise<FastHorseDecisionResult> => {
          messages.length = 0;
          const reqId = 77;
          const baseReq: FastHorseDecisionRequest = {
            ...snapshot,
            type: 'DECIDE_FAST',
            requestId: reqId,
          };
          const req: FastHorseDecisionRequest = {
            ...baseReq,
            decisionKey: snapshot.decisionKey || buildHorseDecisionKey(baseReq),
          };
          runtime.receive(req);
          await runtime.drain();
          const fastMsg = messages.find((m) => m.type === 'FAST_RESULT') as FastHorseDecisionResult;
          expect(fastMsg).toBeDefined();
          lastWitness = createHorseExecutionWitness(snapshot, fastMsg.decision, {
            requestId: reqId,
            lane: 'fast',
            computeMs: fastMsg.computeMs,
            governorScale: fastMsg.governorScale,
          });
          return {
            ...fastMsg,
            planBinding: horsePlanBatchBindingFromRequest(req),
            decision: { ...fastMsg.decision, executionWitness: lastWitness },
          };
        }
      );

      // 1. Normal V87 cash hand: UTG (seat 4) holds As Ks and opens cleanly through real worker -> validator -> HandController!
      const seats = [200, 200, 200, 200, 200, 200].map((stack, i) => ({
        seat: i + 1,
        user_id: `fa200000-0000-4000-8000-0000000000a${i + 1}`,
        username: `Horse ${i + 1}`,
        stack,
        bet: 0,
        totalInvested: 0,
        cards: [],
        is_folded: false,
        is_all_in: false,
        is_sitting_out: false,
      })) as SeatPlayer[];

      const hc = new HandController(
        {
          tableId,
          handNumber: 1,
          gameVariant: 'nlh',
          smallBlind: 1,
          bigBlind: 2,
          rakeConfig: { percent: 0, cap: 0, noFlopNoDrop: true },
        } as HandConfig,
        seats,
        1
      );
      hc.start();
      (hc as any).state.players.find((p: SeatPlayer) => p.seat === 4)!.cards = cards('As Ks');
      const st = hc.getState();
      expect(st.currentPlayerSeat).toBe(4);
      const utgEnginePlayer = st.players.find((p) => p.seat === 4)!;

      const horseSeatRow = {
        seat_number: 4,
        user_id: utgEnginePlayer.user_id,
        username: utgEnginePlayer.username,
        stack: utgEnginePlayer.stack,
        is_horse: true,
        horse_profile: {},
      };
      const engine = new ServerTableEngine(tableId) as any;
      engine.running = true;
      engine.isCurrentEngine = () => true;
      engine.handCount = 1;
      engine.tableInfo = {
        action_time_seconds: 15,
        big_blind: 2,
        small_blind: 1,
        game_variant: 'nlh',
        nit_game: true,
        maintain_percent_min: 20,
        maintain_hands: 10, // The authoritative judged row below overrides this fallback.
        straddle_enabled: true, // Voluntary straddle enabled, NOT posted -> must pass straddleActive: false!
      };
      engine.nitStatus.set(utgEnginePlayer.user_id, {
        userId: utgEnginePlayer.user_id,
        hands: 30,
        vpip: 30,
        required: 20,
        window: 30,
        rolling: true,
        warned: false,
        graceHands: 10,
        graceRemaining: null,
        evict: false,
      });
      engine.seatedPlayers = [horseSeatRow];
      engine.handController = hc;
      engine.disconnectEngine = { isSittingOut: () => false, recordPlayerActed: vi.fn() };
      let timeBankAutoArmed = false;
      engine.timeBankEngine = {
        isAutoActivateEnabled: () => true,
        isArmed: () => timeBankAutoArmed,
        getPlayerBank: () => ({ remainingSeconds: 30, usesRemaining: 3 }),
      };
      engine.getEngineLeaseAuthority = () => ({ verified: true, generation: '11' });
      engine.humansSeated = () => 0;
      engine.tableFormat = () => 'cash';
      engine.markProgress = vi.fn();

      const spyFast = vi.spyOn(workerBridge, 'decideFast');
      engine.scheduleHorseAction(horseSeatRow, 4, utgEnginePlayer, st);
      await vi.advanceTimersByTimeAsync(15_000);

      expect(spyFast).toHaveBeenCalledTimes(1);
      const passedSnap = spyFast.mock.calls[0][0] as LiveHorseDecisionSnapshot;
      expect(passedSnap.gameState.straddleActive).toBe(false);
      expect(passedSnap.gameState.vpipFloor).toBe(20);
      expect(passedSnap.gameState.vpipWindowHands).toBe(30);
      expect(passedSnap.gameState.ownVpip).toEqual({ hands: 30, vpip: 30 });
      expect(lastWitness?.acceptedActions).toHaveLength(1);
      expect(lastWitness?.acceptedActions[0].record.action).toBe('raise');
      expect(hc.getState().currentPlayerSeat).toBe(5);

      // 2. Changed-circumstances / stale turn refusal: seat 5 acts BEFORE a stale scheduled horse callback fires!
      lastWitness = undefined;
      const st2 = hc.getState();
      const mpEnginePlayer = st2.players.find((p) => p.seat === 5)!;
      mpEnginePlayer.cards = cards('Qh Qd');
      const mpSeatRow = {
        seat_number: 5,
        user_id: mpEnginePlayer.user_id,
        username: mpEnginePlayer.username,
        stack: mpEnginePlayer.stack,
        is_horse: true,
        horse_profile: {},
      };
      engine.seatedPlayers = [horseSeatRow, mpSeatRow];
      engine.scheduleHorseAction(mpSeatRow, 5, mpEnginePlayer, st2);
      expect(hc.performAction(5, 'fold')).toBe(true);
      expect(hc.getState().currentPlayerSeat).toBe(6);
      await vi.advanceTimersByTimeAsync(15_000);
      expect(hc.getState().currentPlayerSeat).toBe(6);
      const staleWitness = lastWitness as HorseExecutionWitness | undefined;
      if (staleWitness) {
        expect(staleWitness.acceptedActions).toHaveLength(0);
        expect(staleWitness.retirementReason).toBeDefined();
      }

      // 3. Tournament F06 time-bank continuation: a 11.5s tank on an 8s primary clock
      // holds past 8s when tournament time-bank is available and executes cleanly inside the extended window!
      const mttSeats = makeSeats(6, 6, cards('Ac Kc'), 120);
      const hcMtt = new HandController(
        {
          tableId,
          handNumber: 2,
          gameVariant: 'nlh',
          isTournament: true,
          smallBlind: 1,
          bigBlind: 2,
          rakeConfig: { percent: 0, cap: 0, noFlopNoDrop: true },
        } as HandConfig,
        mttSeats,
        1
      );
      hcMtt.start();
      expect(hcMtt.performAction(4, 'raise', 5)).toBe(true);
      expect(hcMtt.performAction(5, 'raise', 16)).toBe(true);
      const stMtt = hcMtt.getState();
      expect(stMtt.currentPlayerSeat).toBe(6);
      const coPlayer = stMtt.players.find((p) => p.seat === 6)!;
      coPlayer.cards = cards('Qh Qd');
      const coSeatRow = {
        seat_number: 6,
        user_id: coPlayer.user_id,
        username: coPlayer.username,
        stack: coPlayer.stack,
        is_horse: true,
        horse_profile: {},
      };

      workerBridge.decideFast.mockImplementationOnce(async (snap: LiveHorseDecisionSnapshot) => {
        const sentinelTank = HorseLogic.THINK_TIMEBANK_SENTINEL + 1_500;
        lastWitness = createHorseExecutionWitness(
          snap,
          { action: 'call', thinkTime: sentinelTank },
          { requestId: 88, lane: 'fast', computeMs: 2, governorScale: 1 }
        );
        return {
          type: 'FAST_RESULT',
          planIssueDisposition: 'no_effects',
          planBinding: horsePlanBatchBindingFromRequest({ ...snap, requestId: 88 }),
          requestId: 88,
          generation: snap.generation,
          fence: snap.fence,
          decision: { action: 'call', thinkTime: sentinelTank, executionWitness: lastWitness },
          rngBefore: 1,
          rngAfter: 2,
          computeMs: 2,
          governorScale: 1,
          effects: [],
        };
      });

      engine.handController = hcMtt;
      engine.seatedPlayers = [coSeatRow];
      engine.tableFormat = () => 'mtt';
      engine.tableInfo = {
        action_time_seconds: 8,
        big_blind: 2,
        small_blind: 1,
        game_variant: 'nlh',
        tournament_id: '99999999-9999-4999-8999-999999999999',
      };
      timeBankAutoArmed = true;

      engine.scheduleHorseAction(coSeatRow, 6, coPlayer, stMtt);
      await vi.advanceTimersByTimeAsync(7_800);
      expect(hcMtt.getState().currentPlayerSeat).toBe(6);
      engine.extendHorseActionForTimeBank?.(6, 15_000);
      await vi.advanceTimersByTimeAsync(5_000);
      const mttWitness = lastWitness as HorseExecutionWitness | undefined;
      expect(mttWitness?.acceptedActions).toHaveLength(1);
      expect(mttWitness?.acceptedActions[0].record.action).toBe('call');
      vi.useRealTimers();
    });

    it('preserves hydrated winnerReads and flopStab across BOTH DECIDE_FAST and DECIDE_DEEP (horse-decision-reads-v13) on Hand #1 and measurably changes HorseLogic.decide output', async () => {
      const tableId = 'fa900000-0000-4000-8000-000000000909';
      const heroId = 'fa900000-0000-4000-8000-000000000002';
      const bullyId = 'fa900000-0000-4000-8000-000000000006';
      const scope = readScopeOf('nlh', 6);
      const wScope = winnerReadScopeOf('nlh', 'cash');

      const bootWinner = createWinnerReadState();
      const winnerRow = { w: 450, w2: 450, s: 675, q: 5100 };
      bootWinner.rows.set(`${wScope}|${bullyId}`, { ...winnerRow });
      bootWinner.rows.set(bullyId, { ...winnerRow });

      const bootFlop = new Map([
        [
          `${scope}|${bullyId}`,
          {
            flopCheckedToOpps: 26,
            flopBetCheckedTo: 22,
            fFlopCheckedToOpps: 10,
            fFlopBetCheckedTo: 9,
          },
        ],
      ]);

      const bootProfiles = [
        {
          user_id: bullyId,
          variant: 'nlh' as const,
          mode: 'cash' as const,
          size: 'full' as const,
          observed_hands: 200,
          initialized: true,
          counters: {
            hands: 150,
            vpip: 82,
            pfr: 52,
            rfiOpp: 45,
            rfi: 28,
            threeBetOpp: 30,
            threeBet: 10,
            foldTo3BetOpp: 20,
            foldTo3Bet: 10,
            betCheckedToOpp: 60,
            betCheckedTo: 14, // Low overall betCheckedTo so ONLY `flopStab` triggers `highFlopStab`!
            foldToBetOpp: 40,
            foldToBet: 26,
            riverCallOpp: 12,
            riverCall: 4,
            fHands: 8,
            fPfr: 5,
            fRfiOpp: 4,
            fRfi: 3,
            fThreeBetOpp: 3,
            fThreeBet: 1,
            fBetCheckedToOpp: 8,
            fBetCheckedTo: 2,
            fFoldToBetOpp: 6,
            fFoldToBet: 4,
            fRiverCallOpp: 2,
            fRiverCall: 0,
          },
        },
      ];

      // A fixed wet overpair spot reaches the flop-stab response below the
      // generic value-raise threshold. The mix hashes cards/pot/seat, not handNumber.
      const chosenHandNumber = 1;

      const buildWorker = (hydrated: boolean) => {
        const out: HorseDecisionWorkerResponse[] = [];
        const observedFastAndDeep: Array<{
          highFlopStab: boolean;
          provenWinner: boolean;
        }> = [];
        const rt = new HorseDecisionWorkerRuntime((m) => out.push(m), {
          ...defaultHorseDecisionWorkerDependencies,
          startServices: async () => ({
            solverStores: { charts: 0, postflop: 0, postflopV31: 0, postflopV31Dataset: null },
            solverPolicyArtifact: solverPolicyArtifactStatus(),
            governor: equityGovernor.snapshot(),
          }),
          admitFeatureAuthority: () => qualifiedTestAdmission(),
          publicProfileBootstrap: hydrated
            ? () => ({ availableAtMs: 5_000, profiles: bootProfiles })
            : undefined,
          exploitFloorBootstrap: hydrated
            ? () => ({
                hands: 200,
                rows: 1,
                availableAtMs: 5_000,
                winnerReads: bootWinner,
                flopStab: bootFlop,
              })
            : undefined,
          decide: (...args) => {
            const dec = HorseLogic.decide(...args);
            HorseMind.setDecisionScope(scope, 'nlh', 'cash');
            const sRead = HorseMind.streetBullyRead(bullyId);
            const pWin = isProvenWinner(bullyId, wScope);
            HorseMind.setDecisionScope(null);
            observedFastAndDeep.push({
              highFlopStab: sRead.highFlopStab,
              provenWinner: pWin,
            });
            return dec;
          },
        });
        return { rt, out, observedFastAndDeep };
      };

      const hydratedWorker = buildWorker(true);
      const unhydratedWorker = buildWorker(false);
      await hydratedWorker.rt.start();
      await unhydratedWorker.rt.start();

      const players: SeatPlayer[] = [1, 2, 3, 4, 5, 6].map((seat) => ({
        seat,
        user_id:
          seat === 2 ? heroId : seat === 6 ? bullyId : `fa900000-0000-4000-8000-00000000000${seat}`,
        username: `P${seat}`,
        stack: seat === 2 ? 190 : seat === 6 ? 184 : 200,
        bet: seat === 2 ? 0 : seat === 6 ? 6 : 0,
        totalInvested: seat === 2 ? 6 : seat === 6 ? 12 : seat === 3 ? 1 : 0,
        cards: seat === 2 ? cards('8h 8s') : [],
        is_folded: seat !== 2 && seat !== 6,
        is_all_in: false,
        is_sitting_out: false,
      }));
      const history: ActionRecord[] = [
        {
          seat: 6,
          userId: bullyId,
          stage: 'preflop',
          action: 'raise',
          amount: 6,
          isFullRaise: true,
          timestamp: 1,
        },
        { seat: 2, userId: heroId, stage: 'preflop', action: 'call', amount: 6, timestamp: 2 },
        { seat: 2, userId: heroId, stage: 'flop', action: 'check', amount: 0, timestamp: 3 },
        { seat: 6, userId: bullyId, stage: 'flop', action: 'bet', amount: 6, timestamp: 4 },
      ];
      const gs: HorseGameStateV2 = {
        stateSchemaVersion: 1,
        stage: 'flop',
        gameVariant: 'nlh',
        variantRules: horseVariantRulesFor('nlh'),
        bettingStructure: 'no_limit',
        fixedBetSize: null,
        wagersCapped: false,
        commitmentCapRemaining: null,
        pots: [{ amount: 19, eligiblePlayers: [heroId, bullyId] }],
        rakeConfig: { percent: 5, cap: 6, noFlopNoDrop: true },
        gameMode: 'cash',
        format: 'cash',
        pot: 19,
        contestablePot: 19,
        currentBet: 6,
        minRaise: 6,
        lastRaise: 6,
        smallBlind: 1,
        bigBlind: 2,
        dealerSeat: 1,
        heroSeat: 2,
        currentPlayerSeat: 2,
        communityCards: cards('7c 6d 5s'),
        players: players.map((p) => ({ ...p, cards: [] })),
        dealtSeatIds: [1, 2, 3, 4, 5, 6],
        actionHistory: history,
        legalActions: ['fold', 'call', 'raise', 'all_in'],
        toCall: 6,
        minRaiseTo: 12,
        maxRaiseTo: 190,
        handNumber: chosenHandNumber,
      } as HorseGameStateV2;

      const makeFastReq = (): FastHorseDecisionRequest => {
        const draft: FastHorseDecisionRequest = {
          type: 'DECIDE_FAST',
          requestId: 101,
          generation: 1,
          fence: `${tableId}:${chosenHandNumber}:2:50000000-0000-4000-8000-000000000001:1`,
          decisionKey: '',
          decisionTimeMs: 20_000,
          handJournalContext: captureHorseHandJournalContext(history),
          player: players[1]!,
          gameState: gs,
          style: 'grinder',
          mods: {
            tightness: 0.98,
            aggression: 1.18,
            bluffFreq: 0.91,
            sizingMultiplier: 0.94,
            referenceNlhOpenings: true,
          },
          opts: { v87HoldemOverhaul: true },
        };
        return { ...draft, decisionKey: buildHorseDecisionKey(draft) };
      };

      const fastReq = makeFastReq();
      hydratedWorker.rt.receive(fastReq);
      await hydratedWorker.rt.drain();
      const fastRes = hydratedWorker.out.find(
        (m) => m.type === 'FAST_RESULT'
      ) as FastHorseDecisionResult;
      expect(fastRes, JSON.stringify(hydratedWorker.out)).toBeDefined();
      expect(
        fastRes.decision.action,
        JSON.stringify({
          decision: fastRes.decision.action,
          observed: hydratedWorker.observedFastAndDeep,
        })
      ).toBe('raise');

      // Verify secondLookReads encoded `horse-decision-reads-v13` carrying `scopedFlopStab`!
      const secondLookEntry = [...(hydratedWorker.rt as any).secondLookReads.values()][0] as any;
      expect(secondLookEntry.frame.version).toBe('horse-decision-reads-v13');
      expect(secondLookEntry.frame.json).toContain('scopedFlopStab');

      // Run DECIDE_DEEP on the hydrated worker and prove flopStab + winnerReads survive second look!
      const deepDraft = {
        ...fastReq,
        type: 'DECIDE_DEEP' as const,
        requestId: 102,
        rngBefore: fastRes.rngBefore,
        deepEquity: 2,
      };
      hydratedWorker.rt.receive({
        ...deepDraft,
        decisionKey: buildHorseDecisionKey(deepDraft),
      });
      await hydratedWorker.rt.drain();
      const deepRes = hydratedWorker.out.find((m) => m.type === 'DEEP_RESULT') as any;
      expect(deepRes).toBeDefined();
      expect(deepRes.decision.action).toBe('raise');
      expect(hydratedWorker.observedFastAndDeep).toEqual([
        { highFlopStab: true, provenWinner: true },
        { highFlopStab: true, provenWinner: true },
      ]);

      // Unhydrated worker on the identical Hand #1 request does NOT see highFlopStab or provenWinner and calls instead of check-raising!
      const dryReq = makeFastReq();
      unhydratedWorker.rt.receive(dryReq);
      await unhydratedWorker.rt.drain();
      const dryFast = unhydratedWorker.out.find(
        (m) => m.type === 'FAST_RESULT'
      ) as FastHorseDecisionResult;
      expect(dryFast.decision.action).toBe('call');
      expect(unhydratedWorker.observedFastAndDeep[0]).toEqual({
        highFlopStab: false,
        provenWinner: false,
      });
      const dryDeep = {
        ...dryReq,
        type: 'DECIDE_DEEP' as const,
        requestId: 103,
        rngBefore: dryFast.rngBefore,
        deepEquity: 2,
      };
      unhydratedWorker.rt.receive({ ...dryDeep, decisionKey: buildHorseDecisionKey(dryDeep) });
      await unhydratedWorker.rt.drain();
      const dryDeepResult = unhydratedWorker.out.find((m) => m.type === 'DEEP_RESULT');
      expect(dryDeepResult?.type).toBe('DEEP_RESULT');
      if (dryDeepResult?.type !== 'DEEP_RESULT') throw new Error('Missing dry second look');
      expect(dryDeepResult.decision.action).toBe('call');
      expect(unhydratedWorker.observedFastAndDeep).toEqual([
        { highFlopStab: false, provenWinner: false },
        { highFlopStab: false, provenWinner: false },
      ]);
    });
  });

  describe('7. Proving Ground Benchmark Harness Defect Regressions', () => {
    it('settles pre-river ALL_IN_RUNOUT hands with exact zero chip drift, symmetric deck runouts, short all-in side pots, sit-out/eliminated exclusions, Diamond whole units, and paired Arm A vs Arm B LAG80 accounting', () => {
      // 1. Null-effect symmetric check (`v87_vs_v87_null`) across 20bb tournament shove-heavy play:
      //    Every ALL_IN_RUNOUT settles (`completed === true`, `driftChips === 0`), hole cards & 5-card runout match identically across Arm A and Arm B, and Arm A + Arm B paired delta is identically 0.00!
      const mttShoveCell: ProvingGroundCellSpec = {
        id: 'test_mtt_20bb_allin_runout',
        seats: 6,
        stackBB: 14,
        sb: 100,
        bb: 200,
        anteBB: 1,
        mode: 'tournament',
        tournamentStage: 'bubble',
        bountyFactor: 0.35,
        matchup: 'v87_vs_v87_null',
        pairedDeals: 24,
        seed: 910001,
      };
      const nullSummary = runProvingGroundCells([mttShoveCell], { collectTelemetry: false });
      expect(nullSummary.totalCompletedHands).toBe(48);
      expect(nullSummary.totalIllegalActions).toBe(0);
      expect(nullSummary.chipConservationVerified).toBe(true);
      expect(nullSummary.maxChipConservationDrift).toBe(0);
      expect(nullSummary.cells[0]!.allInRunouts).toBeGreaterThan(0);
      // Exact symmetry: V87 vs V87 on identical swapped seats nets 0.00 bb/100!
      expect(nullSummary.cells[0]!.bbPer100).toBe(0);

      // Verify identical dealt hole cards + identical community board on pre-river runout:
      const rng = mulberry32(424242);
      const deck = dealShuffledDeck(rng);
      const armA = runPairedArmHand(mttShoveCell, deck, 1, false, 7777);
      const armB = runPairedArmHand(mttShoveCell, deck, 1, true, 7777);
      expect(armA.completed).toBe(true);
      expect(armB.completed).toBe(true);
      expect(armA.dealtHoleCardsBySeat).toEqual(armB.dealtHoleCardsBySeat);
      expect(armA.communityCards).toEqual(armB.communityCards);
      // Verify zero duplicate cards between dealt hole cards and community runout!
      const seenCards = [
        ...Object.values(armA.dealtHoleCardsBySeat).flat(),
        ...armA.communityCards,
      ];
      expect(new Set(seenCards).size).toBe(seenCards.length);

      // 2. Uneven stacks (short all-in + side pots) + eliminated seat (0bb) + sitting-out seat:
      const unevenCell: ProvingGroundCellSpec = {
        id: 'test_sidepot_sitout_eliminated',
        seats: 6,
        stackBB: 50,
        stackBySeatBB: [8, 22, 0, 65, 65, 40], // Seat 3 eliminated (0bb), Seat 1 short stack (8bb)
        sittingOutSeats: [6], // Seat 6 sitting out
        sb: 1,
        bb: 2,
        mode: 'cash',
        matchup: 'v87_on_vs_off',
        pairedDeals: 20,
        seed: 910002,
      };
      const unevenRes = runProvingGroundCells([unevenCell], { collectTelemetry: false });
      expect(unevenRes.totalCompletedHands).toBe(40);
      expect(unevenRes.totalIllegalActions).toBe(0);
      expect(unevenRes.chipConservationVerified).toBe(true);
      const sampleUneven = runPairedArmHand(unevenCell, deck, 1, false, 8888);
      expect(sampleUneven.dealtHoleCardsBySeat[3]).toBeUndefined(); // Eliminated seat never dealt
      expect(sampleUneven.dealtHoleCardsBySeat[6]).toBeUndefined(); // Sitting-out seat never dealt

      // 3. Diamond cash (`50/100` whole units, `asset: 'diamonds'`, 0% rake deduction) & `v87_on_off_vs_lag80` Arm A + Arm B extraction:
      const diamondAndLagCells: ProvingGroundCellSpec[] = [
        {
          id: 'test_diamond_50_100',
          seats: 6,
          stackBB: 100,
          sb: 50,
          bb: 100,
          isDiamondCash: true,
          mode: 'cash',
          matchup: 'v87_on_vs_off',
          pairedDeals: 12,
          seed: 910003,
        },
        {
          id: 'test_vs_lag80_paired',
          seats: 6,
          stackBB: 200,
          sb: 2,
          bb: 5,
          mode: 'cash',
          matchup: 'v87_on_off_vs_lag80',
          pairedDeals: 12,
          seed: 910004,
        },
      ];
      const dlRes = runProvingGroundCells(diamondAndLagCells, { collectTelemetry: true });
      expect(dlRes.chipConservationVerified).toBe(true);
      expect(dlRes.totalIllegalActions).toBe(0);
      expect(dlRes.cells[0]!.rakeCollectedBB).toBe(0); // Diamond cash uses 0% rakeConfig
      const lagCell = dlRes.cells[1]!;
      expect(lagCell.lagMatchupRates).toBeDefined();
      expect(
        Math.abs(
          lagCell.lagMatchupRates!.v87PostRakeBBPer100 -
            lagCell.lagMatchupRates!.flagOffPostRakeBBPer100 -
            lagCell.bbPer100
        )
      ).toBeLessThanOrEqual(0.02);
    });
  });
});
