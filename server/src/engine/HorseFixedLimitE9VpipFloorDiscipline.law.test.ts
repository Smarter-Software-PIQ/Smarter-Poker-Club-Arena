/**
 * LAW (Fixed-Limit Pattern E9): On a floored Fixed-Limit cash table
 * (`vpipFloor > 0`, `flh` / `flo8`), VPIP floor enforcement never buys VPIP by
 * cold-calling a preflop 2-bet, 3-bet or 4-bet cap (all of which sit at 2..4 BB
 * under No-Limit's 6-BB call-down ceiling), still buys unraised <= 1 BB limps,
 * and `vpipFloorLimpEv` prices a preflop raise behind a Fixed-Limit limp at
 * `2 * bigBlind` rather than No-Limit's `bigBlind * (4 + callersBefore)`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  HorseLogic,
  vpipFloorCallDown,
  vpipFloorLimpEv,
  type HorseGameStateV2,
} from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import { horseVariantRulesFor } from './VariantRules.js';
import { BB, cards } from './HuVariantSpot.test-support.js';
import type { HorseDecision, SeatPlayer } from '../types.js';

afterEach(() => HorseMind.reset());

describe('Fixed-Limit Pattern E9: VPIP floor never cold-calls raises and prices FL limps at 2 BB', () => {
  it('vpipFloorCallDown refuses 2-bet, 3-bet and 4-bet cap pots in FLH and FLO8 while buying unraised 1-BB limps', () => {
    const foldDecision: HorseDecision = { action: 'fold', thinkTime: 0 };
    for (const gameVariant of ['flh', 'flo8'] as const) {
      // Unraised 1-BB pot under VPIP floor -> buys the 1-BB limp
      const unraised = vpipFloorCallDown(
        foldDecision,
        { bet: 0, stack: 200 },
        {
          stage: 'preflop',
          currentBet: BB,
          bigBlind: BB,
          vpipFloor: 40,
          vpipWindowHands: 30,
          gameVariant,
          bettingStructure: 'fixed_limit',
          ownVpip: { hands: 20, vpip: 10 },
        },
        () => 0.01
      );
      expect(unraised.action).toBe('call');
      expect(unraised.amount).toBe(BB);

      // Raised 2-bet (4), 3-bet (6), and 4-bet cap (8) — all <= 6 * BB (12), yet MUST stay a fold in Fixed-Limit!
      for (const raisedBet of [2 * BB, 3 * BB, 4 * BB]) {
        const raised = vpipFloorCallDown(
          foldDecision,
          { bet: 0, stack: 200 },
          {
            stage: 'preflop',
            currentBet: raisedBet,
            bigBlind: BB,
            vpipFloor: 40,
            vpipWindowHands: 30,
            gameVariant,
            bettingStructure: 'fixed_limit',
            ownVpip: { hands: 20, vpip: 5 },
          },
          () => 0.001
        );
        expect(raised.action).toBe('fold');
      }
    }
  });

  it('full HorseLogic.decide on a floored FLH table folds 72o to a 3-bet instead of buying VPIP with a cold-call', () => {
    const hero: SeatPlayer = {
      seat: 5,
      user_id: '50000000-0000-4000-8000-000000000005',
      username: 'Hero',
      stack: 200,
      bet: 0,
      totalInvested: 0,
      cards: cards('7c 2d'),
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
    };
    const gs = {
      stateSchemaVersion: 1,
      dealtSeatIds: [1, 2, 3, 4, 5, 6],
      heroSeat: 5,
      currentPlayerSeat: 5,
      legalActions: ['fold', 'call', 'raise'],
      toCall: 6,
      minRaiseTo: 8,
      maxRaiseTo: 8,
      bettingStructure: 'fixed_limit',
      fixedBetSize: BB,
      fixedLimitSmallBet: BB,
      wagersCapped: false,
      contestablePot: 13,
      variantRules: horseVariantRulesFor('flh'),
      players: [
        {
          seat: 1,
          user_id: 'u1',
          username: 'P1',
          stack: 199,
          bet: 1,
          totalInvested: 1,
          cards: [],
          is_folded: false,
          is_all_in: false,
          is_sitting_out: false,
        },
        {
          seat: 2,
          user_id: 'u2',
          username: 'P2',
          stack: 198,
          bet: 2,
          totalInvested: 2,
          cards: [],
          is_folded: false,
          is_all_in: false,
          is_sitting_out: false,
        },
        {
          seat: 3,
          user_id: 'u3',
          username: 'P3',
          stack: 196,
          bet: 4,
          totalInvested: 4,
          cards: [],
          is_folded: false,
          is_all_in: false,
          is_sitting_out: false,
        },
        {
          seat: 4,
          user_id: 'u4',
          username: 'P4',
          stack: 194,
          bet: 6,
          totalInvested: 6,
          cards: [],
          is_folded: false,
          is_all_in: false,
          is_sitting_out: false,
        },
        { ...hero, cards: [] },
        {
          seat: 6,
          user_id: 'u6',
          username: 'P6',
          stack: 200,
          bet: 0,
          totalInvested: 0,
          cards: [],
          is_folded: false,
          is_all_in: false,
          is_sitting_out: false,
        },
      ],
      communityCards: [],
      communityCards2: [],
      communityCards3: [],
      bombPot: false,
      boardCount: 1,
      pot: 13,
      currentBet: 6,
      minRaise: BB,
      lastRaise: BB,
      stage: 'preflop',
      gameVariant: 'flh',
      smallBlind: 1,
      bigBlind: BB,
      dealerSeat: 6,
      vpipFloor: 45,
      vpipWindowHands: 10,
      ownVpip: { hands: 8, vpip: 0 },
      actionHistory: [
        {
          seat: 3,
          userId: 'u3',
          action: 'raise',
          amount: 4,
          stage: 'preflop',
          timestamp: 1,
          isFullRaise: true,
        },
        {
          seat: 4,
          userId: 'u4',
          action: 'raise',
          amount: 6,
          stage: 'preflop',
          timestamp: 2,
          isFullRaise: true,
        },
      ],
      gameMode: 'cash',
      format: 'cash',
      ante: 0,
      straddleActive: false,
    } as unknown as HorseGameStateV2;

    seedFastRandom(1);
    const d = HorseLogic.decide(
      hero,
      gs,
      'balanced',
      { tightness: 1, aggression: 1, bluffFreq: 1, sizingMultiplier: 1 },
      { mind: false, decisionTimeMs: Date.UTC(2026, 10, 20, 18, 0, 0) }
    );
    expect(d.action).toBe('fold');
  });

  it('vpipFloorLimpEv prices a raise behind a Fixed-Limit limp at 2 BB (1 BB to call) instead of No-Limit 4+limpers BB', () => {
    const cont: [number, number] = [0.4, 0.85];
    const raise: [number, number] = [0.85, 1];
    const limper = {
      rfi: 0.15,
      vpip: 0.45,
      owes: 0,
      actsAfterHeroPostflop: false,
      continueBand: cont,
      raiseBand: raise,
    };
    const behindRaiser = {
      rfi: 0.5,
      vpip: 0.6,
      owes: 2,
      actsAfterHeroPostflop: true,
      continueBand: cont,
      raiseBand: raise,
    };
    const eqFn = () => 0.36;

    const noLimitModel = vpipFloorLimpEv({
      price: 2,
      bigBlind: 2,
      pot: 5,
      limpers: [limper],
      behind: [behindRaiser],
      potLimit: false,
      fixedLimit: false,
      equity: eqFn,
    });
    const fixedLimitModel = vpipFloorLimpEv({
      price: 2,
      bigBlind: 2,
      pot: 5,
      limpers: [limper],
      behind: [behindRaiser],
      potLimit: false,
      fixedLimit: true,
      equity: eqFn,
    });

    // In NL (callersBefore = 2), raiseTo = 2 * (4 + 2) = 12 (call = 10 -> evCall < 0 -> evRaised = 0.5 * -2 = -1.0).
    // In FL, raiseTo = 4 (call = 2 into potAfter = 7 + 4 + 2 = 13 -> evCall = 0.36 * 0.75 * 13 - 2 = +1.51 > 0)!
    expect(noLimitModel.evRaised).toBeCloseTo(-1.0, 6);
    expect(fixedLimitModel.evRaised).toBeGreaterThan(noLimitModel.evRaised + 0.7);
    expect(fixedLimitModel.evLimp).toBeGreaterThan(noLimitModel.evLimp + 0.7);
  });
});
