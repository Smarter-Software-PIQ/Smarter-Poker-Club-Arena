import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildExplicitContinuationPlanV2,
  reevaluateDynamicContinuationNode,
  solveGeometricStreetSizing,
} from './HorseContinuationPlanInvalidation.js';
import { computeActionLinePosterior } from './HorseActionLinePosterior.js';
import { scoreCardRemoval } from './HorseCardRemovalScorer.js';
import {
  seedFastRandom,
  simulateCorrelatedMultiBoardEquity,
  simulateEquity,
  variantInfo,
  type HorseEquityOutcomeCollector,
} from './HorseEval.js';
import { hasPhysicalImpliedDraw } from './HorseOmahaImpliedDraw.js';
import { ploPairedBoardMustFold } from './HorsePloPairedBoardFold.js';
import { evaluateTournamentPostflop } from './HorseTournamentPostflop.js';
import { HorseLogic, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import {
  drainFires,
  enableBrainTelemetry,
  renderBrainWatchcountersPrometheus,
  resetBrainWatchcountersForTest,
} from './BrainTelemetry.js';
import type { ActionRecord, Card, SeatPlayer } from '../types.js';

const SUIT_MAP: Record<string, Card['suit']> = {
  c: 'clubs',
  d: 'diamonds',
  h: 'hearts',
  s: 'spades',
};

function c(spec: string): Card {
  return {
    rank: spec[0] as Card['rank'],
    suit: SUIT_MAP[spec[1]],
  };
}

function cards(list: string[]): Card[] {
  return list.map(c);
}

function makeSeat(
  seatNo: number,
  userId: string,
  stack: number,
  hole: Card[] = [],
  bet = 0
): SeatPlayer {
  return {
    seat: seatNo,
    user_id: userId,
    username: userId,
    stack,
    bet,
    totalInvested: bet,
    cards: hole,
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
    is_horse: userId === 'hero',
  };
}

describe('Phase 2 Postflop Multi-Street Lookahead & Dynamic Re-Evaluation', () => {
  beforeEach(() => {
    HorseMind.reset();
    enableBrainTelemetry();
    drainFires();
    resetBrainWatchcountersForTest();
    seedFastRandom(20261110);
  });

  it('keeps public multi-board pacing independent of which board the hero privately wins', () => {
    const timing = HorseLogic as unknown as {
      computeThinkTime: (...args: unknown[]) => number;
    };
    const computeThinkTime = timing.computeThinkTime;
    // Isolate the timing draw from the preceding Monte Carlo draws while
    // retaining the real decision producer, difficulty handoff and timing
    // consumer. Both private holdings must reach the same public call.
    const timingSpy = vi.spyOn(timing, 'computeThinkTime').mockImplementation((...args) => {
      seedFastRandom(1);
      return Reflect.apply(computeThinkTime, HorseLogic, args);
    });
    try {
      const decisions = [cards(['Js', 'Ts']), cards(['7c', '7h'])].map((hole) => {
        HorseMind.reset();
        seedFastRandom(20261110);
        const hero = makeSeat(1, 'hero', 1000, hole);
        const opponent = makeSeat(2, 'opponent', 1000, [], 20);
        const state: HorseGameStateV2 = {
          stateSchemaVersion: 1,
          players: [hero, opponent],
          communityCards: cards(['As', 'Ks', 'Qs']),
          communityCards2: cards(['2c', '7d', 'Jh']),
          boardCount: 2,
          bombPot: true,
          pot: 100,
          currentBet: 20,
          bigBlind: 2,
          smallBlind: 1,
          dealerSeat: 2,
          stage: 'flop',
          gameVariant: 'nlh',
          gameMode: 'cash',
          actionHistory: [],
          minRaise: 20,
          toCall: 20,
        };
        return HorseLogic.decide(
          hero,
          state,
          'hybrid',
          {},
          {
            v86MultiStreetUnblocked: true,
            v9Timing: true,
            decisionGravityTiming: true,
            observeMind: false,
          }
        );
      });
      expect(timingSpy).toHaveBeenCalledTimes(2);
      for (const decision of decisions) {
        expect(decision.action).toBe('call');
        expect(decision.amount).toBe(20);
        expect(decision.policyFallback).toBeUndefined();
      }
      expect(decisions[0].thinkTime).toBe(decisions[1].thinkTime);
    } finally {
      timingSpy.mockRestore();
    }
  });

  describe('1. Exact Geometric Street Sizing Solver (NL & PL)', () => {
    it('solves smooth multi-street geometry in No-Limit and eliminates micro river stubs', () => {
      // Shallow SPR 1.15 on turn (2 streets left -> flop/turn): commits cleanly without leaving 0.10 SPR stub
      const shallow = solveGeometricStreetSizing({
        pot: 100,
        effectiveStack: 115,
        streetsRemaining: 2,
        isPotLimit: false,
      });
      expect(shallow.commitsAllInNow).toBe(true);
      expect(shallow.projectedRemainingSpr).toBe(0);

      // Medium SPR 3.5 across 2 streets: smooth ~0.68-0.80 pot fraction, zero awkward <0.28 river stub
      const med = solveGeometricStreetSizing({
        pot: 100,
        effectiveStack: 350,
        streetsRemaining: 2,
        isPotLimit: false,
      });
      expect(med.fractionOfPot).toBeGreaterThan(0.55);
      expect(med.fractionOfPot).toBeLessThan(1.1);
      expect(med.projectedRemainingSpr === 0 || med.projectedRemainingSpr > 0.28).toBe(true);
    });

    it('strictly respects the 1.0x pot ceiling in Pot-Limit Omaha across all SPRs', () => {
      for (const spr of [0.8, 1.4, 2.5, 6.0, 12.0]) {
        const solved = solveGeometricStreetSizing({
          pot: 100,
          effectiveStack: spr * 100,
          streetsRemaining: 3,
          isPotLimit: true,
        });
        expect(solved.fractionOfPot).toBeLessThanOrEqual(1.0 + 1e-9);
        expect(solved.projectedRemainingSpr === 0 || solved.projectedRemainingSpr > 0.28).toBe(
          true
        );
      }
    });
  });

  describe('2. Explicit Flop->Turn->River Continuation Plan & Instant Dynamic Re-Evaluation', () => {
    it('builds explicit v2 multi-street plans across archetypes and re-evaluates unexpected check-raises, multiway cold-calls, donks, and scare cards', () => {
      const plan = buildExplicitContinuationPlanV2({
        createdAtMs: 1_000,
        handNumber: 42,
        handId: 'h-42',
        tableId: 't-1',
        actorId: 'hero',
        createdStreet: 'FLOP',
        plannedOriginAction: 'bet',
        plannedOriginAmount: 66,
        archetype: 'semibluff_barrel',
        activePlayerCount: 2,
        pot: 100,
        effectiveStack: 320,
        isPotLimit: true,
        hasNutAdvantage: true,
        vulnerableToFlush: false,
        vulnerableToPair: true,
      });

      expect(plan.v2.planVersion).toBe('horse-continuation-plan-v2');
      expect(plan.v2.targetStreet).toBe('TURN');
      expect(plan.turnTargetFraction).toBeLessThanOrEqual(1.0);

      // (a) Unexpected check-raise when hero has a nut draw + sufficient equity -> calls instead of blind fold!
      const vsRaisePriced = reevaluateDynamicContinuationNode({
        archetype: plan.archetype,
        street: 'flop',
        facingBetChips: 90,
        potBeforeBet: 232,
        effectiveStackChips: 254,
        isPotLimit: true,
        equity: 0.34,
        potOdds: 90 / 322,
        hasCurrentNuts: false,
        hasNutRedraw: true,
        certifiedNutBlocker: false,
        villainRangeCapped: false,
        multiwayIncreased: false,
        facingUnexpectedRaise: true,
        facingUnexpectedDonk: false,
        cardClass: 'blank',
      });
      expect(vsRaisePriced.reevaluated).toBe(true);
      expect(vsRaisePriced.directive).toBe('call_unexpected_raise_priced');

      // (b) Unexpected check-raise when hero holds current nuts -> commits/re-raises!
      const vsRaiseNuts = reevaluateDynamicContinuationNode({
        archetype: 'value_geometric',
        street: 'turn',
        facingBetChips: 120,
        potBeforeBet: 240,
        effectiveStackChips: 300,
        isPotLimit: true,
        equity: 0.78,
        potOdds: 120 / 360,
        hasCurrentNuts: true,
        hasNutRedraw: true,
        certifiedNutBlocker: false,
        villainRangeCapped: false,
        multiwayIncreased: false,
        facingUnexpectedRaise: true,
        facingUnexpectedDonk: false,
        cardClass: 'blank',
      });
      expect(vsRaiseNuts.directive).toBe('reraise_commit_value');

      // (c) Multiway cold-call shift on turn with pure air -> aborts multiway air spew!
      const mwAir = reevaluateDynamicContinuationNode({
        archetype: 'blocker_triple_barrel',
        street: 'turn',
        facingBetChips: 0,
        potBeforeBet: 180,
        effectiveStackChips: 400,
        isPotLimit: false,
        equity: 0.18,
        potOdds: 0,
        hasCurrentNuts: false,
        hasNutRedraw: false,
        certifiedNutBlocker: true,
        villainRangeCapped: false,
        multiwayIncreased: true,
        facingUnexpectedRaise: false,
        facingUnexpectedDonk: false,
        cardClass: 'blank',
      });
      expect(mwAir.reevaluated).toBe(true);
      expect(mwAir.directive).toBe('abort_multiway_air');

      // (d) Small blocker donk-bet into preflop aggressor with strong equity -> attacks small donk!
      const vsSmallDonk = reevaluateDynamicContinuationNode({
        archetype: 'value_geometric',
        street: 'turn',
        facingBetChips: 25,
        potBeforeBet: 100,
        effectiveStackChips: 300,
        isPotLimit: false,
        equity: 0.64,
        potOdds: 25 / 125,
        hasCurrentNuts: false,
        hasNutRedraw: false,
        certifiedNutBlocker: false,
        villainRangeCapped: false,
        multiwayIncreased: false,
        facingUnexpectedRaise: false,
        facingUnexpectedDonk: true,
        cardClass: 'blank',
      });
      expect(vsSmallDonk.directive).toBe('attack_small_donk');

      // (e) Scare card when checked to with certified nut blocker -> leverages scare card!
      const scareBlocker = reevaluateDynamicContinuationNode({
        archetype: 'blocker_triple_barrel',
        street: 'river',
        facingBetChips: 0,
        potBeforeBet: 160,
        effectiveStackChips: 300,
        isPotLimit: false,
        equity: 0.14,
        potOdds: 0,
        hasCurrentNuts: false,
        hasNutRedraw: false,
        certifiedNutBlocker: true,
        villainRangeCapped: true,
        multiwayIncreased: false,
        facingUnexpectedRaise: false,
        facingUnexpectedDonk: false,
        cardClass: 'scare',
      });
      expect(scareBlocker.directive).toBe('scare_nut_blocker_barrel');
    });
  });

  describe('3. Public Action-Line Bayesian Posterior & Combinatorial Card-Removal Scorer', () => {
    it('tracks villain range-cap on passive check-backs and polarization on big river bets', () => {
      const cappedHist: ActionRecord[] = [
        { seat: 2, userId: 'villain', action: 'raise', amount: 6, timestamp: 1, stage: 'preflop' },
        { seat: 5, userId: 'hero', action: 'call', amount: 6, timestamp: 2, stage: 'preflop' },
        { seat: 5, userId: 'hero', action: 'check', amount: 0, timestamp: 3, stage: 'flop' },
        { seat: 2, userId: 'villain', action: 'check', amount: 0, timestamp: 4, stage: 'flop' },
        { seat: 5, userId: 'hero', action: 'check', amount: 0, timestamp: 5, stage: 'turn' },
        { seat: 2, userId: 'villain', action: 'check', amount: 0, timestamp: 6, stage: 'turn' },
      ];
      const capped = computeActionLinePosterior({
        villainUserId: 'villain',
        villainSeat: 2,
        heroSeat: 5,
        stage: 'river',
        board: cards(['Ks', 'Th', '7s', '6d', '2c']),
        pot: 13,
        bigBlind: 2,
        actionHistory: cappedHist,
      });
      const sumCapped =
        capped.nutted +
        capped.overpairTopPair +
        capped.nutDrawWrap +
        capped.floatWeakDraw +
        capped.airBlocker;
      expect(sumCapped).toBeCloseTo(1.0, 5);
      expect(capped.rangeCapped).toBe(true);

      const polarHist: ActionRecord[] = [
        { seat: 2, userId: 'villain', action: 'raise', amount: 6, timestamp: 1, stage: 'preflop' },
        { seat: 5, userId: 'hero', action: 'call', amount: 6, timestamp: 2, stage: 'preflop' },
        { seat: 5, userId: 'hero', action: 'check', amount: 0, timestamp: 3, stage: 'flop' },
        { seat: 2, userId: 'villain', action: 'bet', amount: 10, timestamp: 4, stage: 'flop' },
        { seat: 5, userId: 'hero', action: 'call', amount: 10, timestamp: 5, stage: 'flop' },
        { seat: 5, userId: 'hero', action: 'check', amount: 0, timestamp: 6, stage: 'turn' },
        { seat: 2, userId: 'villain', action: 'bet', amount: 26, timestamp: 7, stage: 'turn' },
        { seat: 5, userId: 'hero', action: 'call', amount: 26, timestamp: 8, stage: 'turn' },
        { seat: 5, userId: 'hero', action: 'check', amount: 0, timestamp: 9, stage: 'river' },
        { seat: 2, userId: 'villain', action: 'bet', amount: 110, timestamp: 10, stage: 'river' },
      ];
      const polar = computeActionLinePosterior({
        villainUserId: 'villain',
        villainSeat: 2,
        heroSeat: 5,
        stage: 'river',
        board: cards(['Ks', 'Th', '7s', '6s', '2c']),
        pot: 195,
        bigBlind: 2,
        actionHistory: polarHist,
      });
      expect(polar.polarized).toBe(true);
      expect(polar.nutted).toBeGreaterThan(capped.nutted);
    });

    it('rewards nut-flush blockers on completed flush boards and penalizes blocking missed draws on bricked rivers', () => {
      // Completed 3-spade river: bare As blocks nut flush without making a flush
      const nutBlockNlh = scoreCardRemoval(
        cards(['As', '5d']),
        cards(['Ks', '9s', '4s', '2h', '7c']),
        variantInfo('nlh')
      );
      expect(nutBlockNlh.blocksNutFlush).toBe(true);
      expect(nutBlockNlh.certifiedNutBluffBlocker).toBe(true);
      expect(nutBlockNlh.netFoldEquityDelta).toBeGreaterThan(0);

      // PLO6 bare As (only 1 spade in 6 cards!) still blocks 100% of nut flushes on unpaired 3-spade board
      const nutBlockPlo6 = scoreCardRemoval(
        cards(['As', 'Kd', 'Qh', 'Jc', '6d', '3h']),
        cards(['Ks', '9s', '4s', '2h', '7c']),
        variantInfo('plo6')
      );
      expect(nutBlockPlo6.blocksNutFlush).toBe(true);

      // Bricked front-door heart draw (`Kh 9h 4c 2d 7s`): holding `Qh Jh` blocks villain's missed heart folds!
      const missedSuitBlocker = scoreCardRemoval(
        cards(['Qh', 'Jh']),
        cards(['Kh', '9h', '4c', '2d', '7s']),
        variantInfo('nlh')
      );
      const cleanUnblocker = scoreCardRemoval(
        cards(['Qc', 'Jd']),
        cards(['Kh', '9h', '4c', '2d', '7s']),
        variantInfo('nlh')
      );
      expect(missedSuitBlocker.foldBlockerPenalty).toBeGreaterThan(
        cleanUnblocker.foldBlockerPenalty
      );
      expect(cleanUnblocker.netFoldEquityDelta).toBeGreaterThan(
        missedSuitBlocker.netFoldEquityDelta
      );
    });
  });

  describe('4. Correlated Multi-Board Equity & High-Only Omaha Continuation Capture', () => {
    it('prices correlated 2-board and 3-board scoop vs quarter shares from a single shared deck deal', () => {
      seedFastRandom(77);
      const strongMulti = simulateCorrelatedMultiBoardEquity(
        cards(['As', 'Ad', 'Ks', 'Kd']),
        [cards(['Ah', '7s', '2s']), cards(['Ac', 'Kd', '3h'])],
        1,
        variantInfo('plo4'),
        120
      );
      const weakMulti = simulateCorrelatedMultiBoardEquity(
        cards(['9c', '8d', '4h', '2c']),
        [cards(['Ah', 'Ks', 'Qs']), cards(['Ac', 'Kd', 'Jh']), cards(['Ts', '9s', '8s'])],
        2,
        variantInfo('plo4'),
        120
      );
      expect(strongMulti.pScoop).toBeGreaterThan(0.5);
      expect(strongMulti.meanEquity).toBeGreaterThan(weakMulti.meanEquity);
      expect(weakMulti.pScoop).toBeLessThan(0.15);
    });

    it('captures next-street continuation strength samples for high-only PLO4, PLO5, and PLO6', () => {
      for (const variant of ['plo4', 'plo5', 'plo6'] as const) {
        seedFastRandom(99);
        const hole =
          variant === 'plo4'
            ? cards(['As', 'Ks', 'Qh', 'Jd'])
            : variant === 'plo5'
              ? cards(['As', 'Ks', 'Qh', 'Jd', 'Tc'])
              : cards(['As', 'Ks', 'Qh', 'Jd', 'Tc', '9c']);
        const collector: HorseEquityOutcomeCollector = {
          maxSamples: 16,
          captureContinuation: true,
          samples: [],
        };
        const eq = simulateEquity(
          hole,
          cards(['Ts', '8s', '2d']),
          1,
          variantInfo(variant),
          32,
          undefined,
          false,
          undefined,
          undefined,
          collector
        );
        expect(eq).toBeGreaterThan(0.2);
        expect(collector.samples.length).toBe(16);
        expect(collector.samples[0].continuationStreets?.length).toBeGreaterThanOrEqual(1);
      }
    });
  });

  describe('5. Surgical Guard Refinements, Variant Fidelity & End-to-End 8-Cell Matrix', () => {
    it('exempts top boat (0 higher full houses, only 1 quad combo) from HorsePloPairedBoardFold while still folding underfulls', () => {
      // Board: Ah 9h 9c 6d 2s. Hero holds As Ad Ks Qd -> Aces full of Nines (boatsAbove.boats === 0, quads === 1)
      const topBoatMustFold = ploPairedBoardMustFold({
        gameVariant: 'plo4',
        hiLo: false,
        multiBoard: false,
        board: cards(['Ah', '9h', '9c', '6d', '2s']),
        hero: makeSeat(1, 'hero', 300, cards(['As', 'Ad', 'Ks', 'Qd'])),
        players: [makeSeat(1, 'hero', 300), makeSeat(2, 'opp', 300, [], 150)],
        currentBet: 150,
        toCall: 150,
        pot: 300,
      });
      expect(topBoatMustFold).toBe(false);

      // Underfull without boat (`As Ks Qd Jc` = trips/two-pair only) still folds to a committing bet
      const nonBoatMustFold = ploPairedBoardMustFold({
        gameVariant: 'plo4',
        hiLo: false,
        multiBoard: false,
        board: cards(['Ah', '9h', '9c', '6d', '2s']),
        hero: makeSeat(1, 'hero', 300, cards(['As', 'Ks', 'Qd', 'Jc'])),
        players: [makeSeat(1, 'hero', 300), makeSeat(2, 'opp', 300, [], 150)],
        currentBet: 150,
        toCall: 150,
        pot: 300,
      });
      expect(nonBoatMustFold).toBe(true);
    });

    it('denies dominated flush-draw implied credit in PLO5/PLO6 without nut straight backup while preserving PLO4', () => {
      const dominatedDraw = {
        nutFlushDraw: false,
        dominatedFlushDraw: true,
        boardBlockedNutFlushDraw: false,
        straightOuts: 2,
        nutStraightOuts: 0,
        wrap: false,
        bigWrap: false,
        nutty: false,
        nutLowDraw: false,
        madeNutLow: false,
      };
      expect(hasPhysicalImpliedDraw(true, dominatedDraw, 4)).toBe(true);
      expect(hasPhysicalImpliedDraw(true, dominatedDraw, 5)).toBe(false);
      expect(hasPhysicalImpliedDraw(true, dominatedDraw, 6)).toBe(false);
    });

    it('executes legal, integer-clean postflop decisions across all 8 {nlh, plo4, plo5, plo6} x {cash, tournament} cells and records Prometheus counters', () => {
      const holeByVariant: Record<string, Card[]> = {
        nlh: cards(['As', 'Ks']),
        plo4: cards(['As', 'Ks', 'Qh', 'Jd']),
        plo5: cards(['As', 'Ks', 'Qh', 'Jd', 'Tc']),
        plo6: cards(['As', 'Ks', 'Qh', 'Jd', 'Tc', '9d']),
      };
      const board = cards(['Ah', 'Kd', '7s', '2c']);

      for (const variant of ['nlh', 'plo4', 'plo5', 'plo6'] as const) {
        for (const mode of ['cash', 'tournament'] as const) {
          seedFastRandom(101);
          const hero = makeSeat(2, 'hero', 240, holeByVariant[variant], 0);
          const opp = makeSeat(5, 'opp', 240, [], mode === 'tournament' ? 20 : 0);
          const hist: ActionRecord[] =
            mode === 'tournament'
              ? [
                  {
                    seat: 2,
                    userId: 'hero',
                    action: 'raise',
                    amount: 12,
                    timestamp: 1,
                    stage: 'preflop',
                  },
                  {
                    seat: 5,
                    userId: 'opp',
                    action: 'call',
                    amount: 12,
                    timestamp: 2,
                    stage: 'preflop',
                  },
                  {
                    seat: 2,
                    userId: 'hero',
                    action: 'bet',
                    amount: 16,
                    timestamp: 3,
                    stage: 'flop',
                  },
                  {
                    seat: 5,
                    userId: 'opp',
                    action: 'call',
                    amount: 16,
                    timestamp: 4,
                    stage: 'flop',
                  },
                  {
                    seat: 5,
                    userId: 'opp',
                    action: 'bet',
                    amount: 20,
                    timestamp: 5,
                    stage: 'turn',
                  },
                ]
              : [
                  {
                    seat: 2,
                    userId: 'hero',
                    action: 'raise',
                    amount: 6,
                    timestamp: 1,
                    stage: 'preflop',
                  },
                  {
                    seat: 5,
                    userId: 'opp',
                    action: 'call',
                    amount: 6,
                    timestamp: 2,
                    stage: 'preflop',
                  },
                  {
                    seat: 5,
                    userId: 'opp',
                    action: 'check',
                    amount: 0,
                    timestamp: 3,
                    stage: 'flop',
                  },
                  {
                    seat: 2,
                    userId: 'hero',
                    action: 'bet',
                    amount: 8,
                    timestamp: 4,
                    stage: 'flop',
                  },
                  {
                    seat: 5,
                    userId: 'opp',
                    action: 'call',
                    amount: 8,
                    timestamp: 5,
                    stage: 'flop',
                  },
                  {
                    seat: 5,
                    userId: 'opp',
                    action: 'check',
                    amount: 0,
                    timestamp: 6,
                    stage: 'turn',
                  },
                ];
          const gs: HorseGameStateV2 = {
            stateSchemaVersion: 1,
            players: [hero, opp],
            communityCards: board,
            pot: mode === 'tournament' ? 78 : 29,
            currentBet: mode === 'tournament' ? 20 : 0,
            toCall: mode === 'tournament' ? 20 : 0,
            minRaise: mode === 'tournament' ? 20 : 2,
            minRaiseTo: mode === 'tournament' ? 40 : 2,
            maxRaiseTo: variant === 'nlh' ? 240 : mode === 'tournament' ? 118 : 29,
            legalActions:
              mode === 'tournament'
                ? ['fold', 'call', 'raise', 'all_in']
                : ['check', 'bet', 'all_in'],
            stage: 'turn',
            gameVariant: variant,
            bettingStructure: variant === 'nlh' ? 'no_limit' : 'pot_limit',
            chipUnit: mode === 'tournament' ? 1 : 0.01,
            bigBlind: mode === 'tournament' ? 10 : 2,
            dealerSeat: 2,
            actionHistory: hist,
            gameMode: mode,
            format: mode === 'tournament' ? 'mtt' : 'cash',
            sevenDeuceEnabled: mode === 'cash' && variant === 'nlh',
            sevenDeuceBountyBB: mode === 'cash' && variant === 'nlh' ? 2 : null,
          };

          const d = HorseLogic.decide(
            hero,
            gs,
            'hybrid',
            { referenceNlhOpenings: true, persona: { straddleRate: 0, gtoAdherence: 0.7 } },
            { telemetry: true }
          );
          expect(['check', 'call', 'bet', 'raise', 'all_in']).toContain(d.action);
          if (mode === 'tournament' && typeof d.amount === 'number') {
            expect(Number.isInteger(d.amount)).toBe(true);
          }
          if (
            variant !== 'nlh' &&
            (d.action === 'bet' || d.action === 'raise') &&
            typeof d.amount === 'number'
          ) {
            expect(d.amount).toBeLessThanOrEqual(gs.maxRaiseTo! + 1e-6);
          }
        }
      }

      // Verify tournament postflop eligibility for PLO4/5/6 and Prometheus metric rendering:
      const tourneyPlo5Hero = makeSeat(2, 'hero', 300, cards(['As', 'Ks', 'Qh', 'Jd', 'Tc']));
      const tourneyPlo5Gs: HorseGameStateV2 = {
        stateSchemaVersion: 1,
        players: [tourneyPlo5Hero, makeSeat(5, 'opp', 300)],
        dealtSeatIds: [2, 5],
        communityCards: cards(['Ah', 'Kd', '7s']),
        pot: 40,
        currentBet: 0,
        toCall: 0,
        minRaise: 10,
        minRaiseTo: 10,
        maxRaiseTo: 40,
        legalActions: ['check', 'bet'],
        stage: 'flop',
        gameVariant: 'plo5',
        bettingStructure: 'pot_limit',
        chipUnit: 1,
        bigBlind: 10,
        dealerSeat: 2,
        gameMode: 'tournament',
        format: 'mtt',
        tournament: {
          schemaVersion: 1,
          playersLeft: 18,
          spotsPaid: 9,
          payoutPct: [30, 20, 14, 10, 8, 6, 5, 4, 3],
          stacks: [300, 300, 400, 250],
        },
      };
      const tp5 = evaluateTournamentPostflop(
        tourneyPlo5Hero,
        tourneyPlo5Gs,
        { action: 'check', thinkTime: 0 },
        null,
        'shadow',
        () => 0
      );
      expect(tp5.ledger.reason).not.toBe('unsupported_variant');

      const promText = renderBrainWatchcountersPrometheus().join('\n');
      expect(promText).toContain('poker_horse_plan_reevaluated_total');
      expect(promText).toContain('mode="tournament"');
      expect(promText).not.toMatch(/mode="(flop|turn|river)"/);
    });
  });
});
