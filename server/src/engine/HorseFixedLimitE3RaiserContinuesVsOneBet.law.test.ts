/**
 * LAW (Fixed-Limit Pattern E3): A Fixed-Limit preflop raiser facing a single
 * 1-small-bet re-raise (opener facing a 3-bet from 2 BB to 3 BB, or 3-bettor
 * facing a 4-bet cap from 3 BB to 4 BB) owes at most 1 small bet into 5 to 8.5
 * small bets and never raise-folds a hand whose realized equity against the
 * re-raiser's range covers the raw 1-bet price plus survival risk.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { HandController } from './HandController.js';
import { Deck, calculateContestablePot } from './PokerEngine.js';
import { HorseLogic, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import { horseVariantRulesFor } from './VariantRules.js';
import { fixedLimitRaiserContinuesVsOneBet } from './HorseFixedLimitStructure.js';
import { cards, BB } from './HuVariantSpot.test-support.js';
import type { Card, SeatPlayer } from '../types.js';

const uid = (seat: number) => `30000000-0000-4000-8000-00000000000${seat}`;

function dealRakedFixedLimit(opts: {
  variant: 'flh' | 'flo8';
  stacks: number[];
  dealerSeat: number;
  holeBySeat: Record<number, Card[]>;
  isTournament?: boolean;
}) {
  const holeCount = opts.variant === 'flo8' ? 4 : 2;
  const originalShuffle = Deck.prototype.shuffle;
  Deck.prototype.shuffle = function () {
    const deck = (this as unknown as { cards: Card[] }).cards;
    const used = Object.values(opts.holeBySeat).flat();
    const rest = deck.filter((c) => !used.some((u) => u.rank === c.rank && u.suit === c.suit));
    // HandController deals one card at a time starting after dealerSeat.
    const seats = opts.stacks.map((_, idx) => idx + 1);
    const dIdx = seats.indexOf(opts.dealerSeat);
    const dealOrder = [...seats.slice(dIdx + 1), ...seats.slice(0, dIdx + 1)];
    const prefix: Card[] = [];
    for (let round = 0; round < holeCount; round++) {
      for (const s of dealOrder) {
        const c = opts.holeBySeat[s]?.[round];
        if (c) prefix.push(c);
      }
    }
    const finalRest = rest.filter(
      (c) => !prefix.some((p) => p.rank === c.rank && p.suit === c.suit)
    );
    deck.splice(0, deck.length, ...prefix, ...finalRest);
  };
  const players = opts.stacks.map((stack, i) => ({
    seat: i + 1,
    user_id: uid(i + 1),
    username: `Seat${i + 1}`,
    stack,
    bet: 0,
    totalInvested: 0,
    cards: [],
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
  })) as SeatPlayer[];
  const controller = new HandController(
    {
      tableId: '31000000-0000-4000-8000-000000000001',
      handNumber: 3001,
      gameVariant: opts.variant,
      smallBlind: 1,
      bigBlind: BB,
      ante: 0,
      isTournament: opts.isTournament === true,
      rakeConfig:
        opts.isTournament === true
          ? { percent: 0, cap: 0, noFlopNoDrop: true }
          : { percent: 10, cap: 3 * BB, jackpotDrop: 1, noFlopNoDrop: true },
    } as never,
    players,
    opts.dealerSeat
  );
  try {
    controller.start();
  } finally {
    Deck.prototype.shuffle = originalShuffle;
  }
  return controller;
}

function decideCurrent(
  controller: HandController,
  variant: 'flh' | 'flo8',
  isTournament = false,
  seed = 42
) {
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
    dealtSeatIds: state.players.filter((p) => p.cards.length > 0).map((p) => p.seat),
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
    variantRules: horseVariantRulesFor(variant),
    players: state.players.map((p) => ({ ...p, knownDeadCards: undefined, cards: [] })),
    communityCards: [...state.communityCards],
    communityCards2: [],
    communityCards3: [],
    bombPot: false,
    boardCount: 1,
    pot: state.pot,
    currentBet: state.currentBet,
    minRaise: state.minRaise,
    lastRaise: state.lastRaise,
    stage: state.stage,
    gameVariant: variant,
    smallBlind: 1,
    bigBlind: BB,
    dealerSeat: state.dealerSeat,
    actionHistory: state.actionHistory.map((a, i) => ({ ...a, timestamp: i + 1 })),
    gameMode: isTournament ? 'tournament' : 'cash',
    format: isTournament ? 'mtt' : 'cash',
    ante: 0,
    straddleActive: false,
  } as unknown as HorseGameStateV2;
  HorseMind.reset();
  seedFastRandom(seed);
  return HorseLogic.decide(
    hero,
    gs,
    'grinder',
    { tightness: 1.1, aggression: 1.0, bluffFreq: 1.0, sizingMultiplier: 1.0 },
    { mind: false, decisionTimeMs: Date.UTC(2026, 10, 20, 18, 0, 0) }
  );
}

afterEach(() => HorseMind.reset());

describe('Fixed-Limit Pattern E3: preflop raiser does not fold to a single 1-bet re-raise when priced in', () => {
  it('heads-up raked FLH cash: opener who raised to 2 BB calls a 3-bet to 3 BB (1 BB into 5 BB) with KJo and QTs', () => {
    for (const hand of ['Kh Jd', 'Qs Ts']) {
      const c = dealRakedFixedLimit({
        variant: 'flh',
        stacks: [200, 200],
        dealerSeat: 1,
        holeBySeat: {
          1: cards(hand),
          2: cards('As Ad'),
        },
      });
      // Seat 1 (BTN/SB) opens to 4 (2 BB); Seat 2 (BB) 3-bets to 6 (3 BB).
      c.performAction(1, 'raise', 4, 'player');
      c.performAction(2, 'raise', 6, 'player');
      expect(c.getCurrentPlayer()?.seat).toBe(1);
      for (const seed of [1, 7, 19, 42]) {
        const d = decideCurrent(c, 'flh', false, seed);
        expect(d.action).not.toBe('fold');
      }
    }
  });

  it('6-max FLH & FLO8: 3-bettor facing a 4-bet cap (1 BB into 7.5 BB) continues with strong 3-bet hands rather than folding to NLH 5-bet bars', () => {
    // 6-max: dealer = 6, SB = 1, BB = 2, UTG = 3, MP = 4, CO = 5, BTN = 6
    const flh = dealRakedFixedLimit({
      variant: 'flh',
      stacks: [200, 200, 200, 200, 200, 200],
      dealerSeat: 6,
      holeBySeat: {
        1: cards('7c 2d'),
        2: cards('8c 3d'),
        3: cards('Ac Kc'),
        4: cards('Jd Js'), // MP 3-bets JJ, faces UTG 4-bet cap
        5: cards('9c 4d'),
        6: cards('Tc 5d'),
      },
      isTournament: true,
    });
    flh.performAction(3, 'raise', 4, 'player'); // UTG opens 2 BB
    flh.performAction(4, 'raise', 6, 'player'); // MP 3-bets 3 BB
    flh.performAction(5, 'fold', undefined, 'player');
    flh.performAction(6, 'fold', undefined, 'player');
    flh.performAction(1, 'fold', undefined, 'player');
    flh.performAction(2, 'fold', undefined, 'player');
    flh.performAction(3, 'raise', 8, 'player'); // UTG caps 4 BB
    expect(flh.getCurrentPlayer()?.seat).toBe(4);
    const flhDecision = decideCurrent(flh, 'flh', true, 11);
    expect(flhDecision.action).toBe('call');

    const flo8 = dealRakedFixedLimit({
      variant: 'flo8',
      stacks: [200, 200],
      dealerSeat: 1,
      holeBySeat: {
        1: cards('As 2s Kh Jd'),
        2: cards('Ac 3c Qd Td'),
      },
    });
    flo8.performAction(1, 'raise', 4, 'player'); // SB opens 2 BB
    flo8.performAction(2, 'raise', 6, 'player'); // BB 3-bets 3 BB
    const flo8Decision = decideCurrent(flo8, 'flo8', false, 11);
    expect(flo8Decision.action).not.toBe('fold');
  });

  it('refuses cold-callers (heroRaisedPreflop = false) and multi-bet cold jumps (toCall > 1 BB)', () => {
    expect(
      fixedLimitRaiserContinuesVsOneBet({
        isFixedLimit: true,
        variant: 'flh',
        dealt: 6,
        raises: 2,
        heroRaisedPreflop: false,
        strength: 0.6,
        toCall: 2,
        stack: 200,
        bigBlind: 2,
        pricePot: 12,
        riskAdd: 0,
        inPosition: true,
      })
    ).toBeNull();
    expect(
      fixedLimitRaiserContinuesVsOneBet({
        isFixedLimit: true,
        variant: 'flh',
        dealt: 6,
        raises: 3,
        heroRaisedPreflop: true,
        strength: 0.6,
        toCall: 4, // 2 small bets to call (e.g. cold-capped behind)
        stack: 200,
        bigBlind: 2,
        pricePot: 14,
        riskAdd: 0,
        inPosition: true,
      })
    ).toBeNull();
  });
});
