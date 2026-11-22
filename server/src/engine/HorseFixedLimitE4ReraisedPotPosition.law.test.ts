/**
 * LAW (Fixed-Limit Pattern E4): In multi-raised Fixed-Limit preflop pots
 * (`raises >= 2`), postflop position is computed by exact seat order relative
 * to the button and the re-raiser (`fixedLimitReraisedPositionOf`), not by
 * `position === 'late'`, and callers of an earlier bet who have not yet
 * answered the re-raise do not mark an in-position seat out of position.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { HorseMind } from './HorseMind.js';
import { decidePreflopV7 } from './HorsePreflop.js';
import { fixedLimitReraisedPositionOf } from './HorseFixedLimitStructure.js';
import { HandController } from './HandController.js';
import { Deck, calculateContestablePot } from './PokerEngine.js';
import { HorseLogic, type HorseGameStateV2 } from './HorseLogic.js';
import { seedFastRandom } from './HorseEval.js';
import { horseVariantRulesFor } from './VariantRules.js';
import { BB, cards } from './HuVariantSpot.test-support.js';
import type { Card, SeatPlayer } from '../types.js';

const uid = (seat: number) => `40000000-0000-4000-8000-00000000000${seat}`;

function buildTableHand(seatCount: number, dealerSeat: number, holeBySeat: Record<number, Card[]>) {
  const originalShuffle = Deck.prototype.shuffle;
  Deck.prototype.shuffle = function () {
    const deck = (this as unknown as { cards: Card[] }).cards;
    const seats = Array.from({ length: seatCount }, (_, idx) => idx + 1);
    const dIdx = seats.indexOf(dealerSeat);
    const dealOrder = [...seats.slice(dIdx + 1), ...seats.slice(0, dIdx + 1)];
    const prefix: Card[] = [];
    for (let r = 0; r < 2; r++) {
      for (const s of dealOrder) prefix.push(holeBySeat[s][r]);
    }
    const rest = deck.filter((c) => !prefix.some((p) => p.rank === c.rank && p.suit === c.suit));
    deck.splice(0, deck.length, ...prefix, ...rest);
  };
  const players = Array.from({ length: seatCount }, (_, i) => ({
    seat: i + 1,
    user_id: uid(i + 1),
    username: `P${i + 1}`,
    stack: 200,
    bet: 0,
    totalInvested: 0,
    cards: [],
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
  })) as SeatPlayer[];
  const controller = new HandController(
    {
      tableId: '41000000-0000-4000-8000-000000000001',
      handNumber: 4001,
      gameVariant: 'flh',
      smallBlind: 1,
      bigBlind: BB,
      ante: 0,
      isTournament: false,
      rakeConfig: { percent: 0, cap: 0, noFlopNoDrop: true },
    } as never,
    players,
    dealerSeat
  );
  try {
    controller.start();
  } finally {
    Deck.prototype.shuffle = originalShuffle;
  }
  return controller;
}

function decideAtState(controller: HandController, seed = 7) {
  const state = controller.getState();
  const actor = controller.getCurrentPlayer()!;
  const menu = controller.getAuthoritativeActionState(actor.user_id)!;
  const hero = {
    ...actor,
    cards: actor.cards.map((c) => ({ ...c })),
    knownDeadCards: [],
  } as SeatPlayer;
  const gs = {
    stateSchemaVersion: 1,
    dealtSeatIds: state.players.map((p) => p.seat),
    blindSeats: controller.getBlindSeatsSnapshot(),
    ...controller.getChipRulesSnapshot(),
    heroSeat: actor.seat,
    currentPlayerSeat: actor.seat,
    legalActions: [...menu.legalActions],
    toCall: menu.toCall,
    minRaiseTo: menu.minRaiseTo,
    maxRaiseTo: menu.maxRaiseTo,
    bettingStructure: menu.structure,
    fixedBetSize: menu.fixedBetSize,
    fixedLimitSmallBet: controller.getFixedLimitSmallBet(),
    wagersCapped: menu.wagersCapped,
    pots: controller.computeLivePots(),
    contestablePot: calculateContestablePot(state.players, actor.user_id, menu.toCall),
    rakeConfig: controller.getRakeConfigSnapshot(),
    variantRules: horseVariantRulesFor('flh'),
    players: state.players.map((p) => ({ ...p, knownDeadCards: undefined, cards: [] })),
    communityCards: [],
    communityCards2: [],
    communityCards3: [],
    bombPot: false,
    boardCount: 1,
    pot: state.pot,
    currentBet: state.currentBet,
    minRaise: state.minRaise,
    lastRaise: state.lastRaise,
    stage: state.stage,
    gameVariant: 'flh',
    smallBlind: 1,
    bigBlind: BB,
    dealerSeat: state.dealerSeat,
    actionHistory: state.actionHistory.map((a, i) => ({ ...a, timestamp: i + 1 })),
    gameMode: 'cash',
    format: 'cash',
    ante: 0,
    straddleActive: false,
  } as unknown as HorseGameStateV2;
  HorseMind.reset();
  seedFastRandom(seed);
  return HorseLogic.decide(
    hero,
    gs,
    'balanced',
    { tightness: 1, aggression: 1, bluffFreq: 0, sizingMultiplier: 1 },
    { mind: false, decisionTimeMs: Date.UTC(2026, 10, 20, 18, 0, 0) }
  );
}

afterEach(() => HorseMind.reset());

describe('Fixed-Limit Pattern E4: multi-raised pot position follows postflop seat order', () => {
  it('marks MP in position against UTG even when an earlier cold-caller behind has not yet answered the 4-bet', () => {
    const pos = fixedLimitReraisedPositionOf(
      4,
      3,
      6,
      [{ seat: 5, bet: 4, allIn: false, raisedPreflop: false }],
      8,
      2
    );
    expect(pos).toEqual({
      ipVsRaiser: true,
      inForBehind: 0,
      raisersPendingBehind: 0,
      callersPendingBehind: 1,
      inPosition: true,
    });
  });

  it('marks BB in position vs SB, and CO out of position vs BTN', () => {
    const bbVsSb = fixedLimitReraisedPositionOf(2, 1, 6, [], 6, 2);
    expect(bbVsSb?.ipVsRaiser).toBe(true);
    expect(bbVsSb?.inPosition).toBe(true);

    const coVsBtn = fixedLimitReraisedPositionOf(5, 6, 6, [], 6, 2);
    expect(coVsBtn?.ipVsRaiser).toBe(false);
    expect(coVsBtn?.inPosition).toBe(false);
  });

  it('propagates exact seat-order position through HorseLogic.decide and decidePreflopV7 in Fixed-Limit 3-bet pots', () => {
    let seenCoCallBar = 0;
    let seenMpCallBar = 0;
    const baseCtx = {
      strength: 0.52,
      raiserPosition: 'early' as const,
      raises: 2,
      limpers: 0,
      callers: 0,
      oppsLeft: 2,
      toCall: 6,
      currentBet: 6,
      contestablePot: 13,
      pot: 13,
      bigBlind: 2,
      stack: 200,
      stackBB: 100,
      tightness: 1,
      bluffFreq: 0,
      aggression: 1,
      slowplayFreq: 0,
      sizingMultiplier: 1,
      isOmaha: false,
      isPotLimit: false,
      isFixedLimit: true,
      riskAdd: 0,
      isoWiden: 0,
      mode: 'cash' as const,
      cashAggression: true,
      rand: () => 0.99,
    };
    const coIntent = decidePreflopV7({
      ...baseCtx,
      position: 'late',
      fixedLimitReraisedInPosition: false,
      noteThresholds: (t) => {
        seenCoCallBar = t.call ?? 0;
      },
    });
    const mpIntent = decidePreflopV7({
      ...baseCtx,
      position: 'middle',
      fixedLimitReraisedInPosition: true,
      noteThresholds: (t) => {
        seenMpCallBar = t.call ?? 0;
      },
    });
    expect(seenMpCallBar).toBeLessThan(seenCoCallBar);
    expect(mpIntent.a).toBe('call');
    expect(coIntent.a).toBe('fold');

    // Full live HorseLogic.decide comparison on identical pot (14), identical toCall (4 = 2 BB), identical oppsLeft (2):
    // - mpInPosition: MP (seat 4, classifyGamePosition = 'middle') acts AFTER SB (1) and BB (2) postflop -> IP!
    // - coSandwiched: CO (seat 5, classifyGamePosition = 'late') has BTN (6) raiser behind -> OOP!
    // Without E4, CO ('late') was treated as IP and MP ('middle') as OOP, so CO called more hands than MP!
    const boundaryHands = [
      'Ks 9s',
      'Qs 9s',
      'Js 9s',
      'Ts 9s',
      '9s 8s',
      '8s 7s',
      'As 6s',
      'Ks Td',
      'Qs Td',
      'Js Td',
      '5s 5d',
      '4s 4d',
    ];
    let mpContinues = 0;
    let coContinues = 0;
    for (const h of boundaryHands) {
      const mpHand = buildTableHand(6, 6, {
        1: cards('As Ad'),
        2: cards('Ac Kc'),
        3: cards('7c 2d'),
        4: cards(h), // MP hero
        5: cards('8c 3d'),
        6: cards('9c 4d'),
      });
      mpHand.performAction(3, 'call', undefined, 'player'); // UTG limps 2
      mpHand.performAction(4, 'call', undefined, 'player'); // MP limps 2
      mpHand.performAction(5, 'fold', undefined, 'player');
      mpHand.performAction(6, 'fold', undefined, 'player');
      mpHand.performAction(1, 'raise', 4, 'player'); // SB raises 4
      mpHand.performAction(2, 'raise', 6, 'player'); // BB 3-bets 6
      mpHand.performAction(3, 'fold', undefined, 'player'); // UTG folds -> pot = 14, MP owes 4
      if (decideAtState(mpHand, 7).action !== 'fold') mpContinues++;

      const coHand = buildTableHand(6, 6, {
        1: cards('As Ad'),
        2: cards('7c 2d'),
        3: cards('8c 3d'),
        4: cards('9c 4d'),
        5: cards(h), // CO hero
        6: cards('Ac Kc'),
      });
      coHand.performAction(3, 'fold', undefined, 'player');
      coHand.performAction(4, 'fold', undefined, 'player');
      coHand.performAction(5, 'call', undefined, 'player'); // CO limps 2
      coHand.performAction(6, 'raise', 4, 'player'); // BTN raises 4
      coHand.performAction(1, 'raise', 6, 'player'); // SB 3-bets 6
      coHand.performAction(2, 'fold', undefined, 'player'); // BB folds -> pot = 14, CO owes 4
      if (decideAtState(coHand, 7).action !== 'fold') coContinues++;
    }
    expect(mpContinues).toBeGreaterThan(coContinues);
  });
});
