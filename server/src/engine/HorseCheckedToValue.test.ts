import { describe, expect, it } from 'vitest';
import type { Card, GameVariant } from '../types.js';
import { horseDecisionReceiptRefusal } from './horseDecision/responseValidation.js';
import { HorseLogic } from './HorseLogic.js';
import {
  checkedToNonBottomBoat,
  checkedToNonBottomRiverBoat,
  checkedToOnePairAboveFlush,
} from './HorseNonBottomRiverValue.js';
import { omahaBoatPosition, omahaBoatsAbove, seedFastRandom } from './HorseEval.js';
import { jointPolicyFixture } from './multiway/JointRangeFixture.test-support.js';
import { calculatePots, Deck } from './PokerEngine.js';
import { HandController } from './HandController.js';
import type { GameState } from '../types.js';

const cards = (s: string): Card[] =>
  s.split(' ').map((c) => ({
    rank: c[0] as Card['rank'],
    suit: ({ c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' } as const)[c[1] as 'c'],
  }));

function spot(variant: GameVariant, aggressor: 'before' | 'behind') {
  const { hero, state } = jointPolicyFixture(variant, 1, 'cash', 'river');
  Object.assign(hero, {
    seat: 2,
    user_id: 'hero',
    cards: cards('Kc Kh Ac 7d 6d 2c').slice(0, Number(variant.at(-1))),
  });
  state.players = [
    { ...state.players[1], seat: 1, user_id: 'before' },
    hero,
    { ...state.players[2], seat: 3, user_id: 'behind' },
  ];
  Object.assign(state, {
    dealtSeatIds: [1, 2, 3],
    dealerSeat: 3,
    heroSeat: 2,
    currentPlayerSeat: 2,
    communityCards: cards('9c 4s Qd 9h Ks'),
    pot: 15,
    contestablePot: 15,
    maxRaiseTo: 15,
    pots: calculatePots(state.players),
  });
  state.actionHistory = [
    {
      userId: aggressor,
      seat: aggressor === 'before' ? 1 : 3,
      action: 'bet',
      amount: 3,
      stage: 'turn',
      timestamp: 1,
    },
    { userId: 'hero', seat: 2, action: 'call', amount: 3, stage: 'turn', timestamp: 2 },
    {
      userId: aggressor === 'before' ? 'behind' : 'before',
      seat: aggressor === 'before' ? 3 : 1,
      action: 'call',
      amount: 3,
      stage: 'turn',
      timestamp: 3,
    },
    { userId: 'before', seat: 1, action: 'check', amount: 0, stage: 'river', timestamp: 4 },
  ];
  if (aggressor === 'behind') {
    const history = state.actionHistory!;
    state.actionHistory = [
      { userId: 'before', seat: 1, action: 'check', amount: 0, stage: 'turn', timestamp: -1 },
      { userId: 'hero', seat: 2, action: 'check', amount: 0, stage: 'turn', timestamp: 0 },
      history[0],
      { ...history[2], timestamp: 2 },
      { ...history[1], timestamp: 3 },
      history[3],
    ];
  }
  return { hero, state };
}

// Isolate the heuristic's initiative rule, not an EV qualification or a
// replacement for canonical policy owners. No opponent private cards enter.
const options = { mind: false, v9Timing: false, phase11Omaha: 'off', phase13Joint: 'off' } as const;
describe('checked-to river value in a multiway pot', () => {
  it.each(['before', 'behind'] as const)(
    'submits value through the controller with aggressor %s',
    (aggressor) => {
      const { hero, state } = spot('plo6', aggressor);
      const controller = new HandController(
        {
          tableId: 'checked-to-value-isolated',
          handNumber: 1,
          gameVariant: 'plo6',
          smallBlind: 1,
          bigBlind: 2,
          rakeConfig: { percent: 0, cap: 0, noFlopNoDrop: true },
        },
        state.players,
        3
      );
      const internal = controller as unknown as {
        state: GameState;
        handFSM: { transition(s: string): void };
      };
      Object.assign(internal.state, {
        players: state.players,
        communityCards: state.communityCards,
        stage: 'river',
        currentBet: 0,
        pot: 15,
        minRaise: 2,
        lastRaise: 2,
        currentPlayerSeat: 2,
      });
      for (const stage of ['posting_blinds', 'dealing', 'preflop', 'flop', 'turn', 'river'])
        internal.handFSM.transition(stage);
      const menu = controller.getAuthoritativeActionState(hero.user_id)!;
      expect(menu.legalActions).toContain('bet');
      Object.assign(state, menu, { bettingStructure: menu.structure });
      seedFastRandom(1);
      const action = HorseLogic.decide(
        hero,
        state,
        'balanced',
        {},
        { mind: false, v9Timing: false }
      );
      expect(action.policyFallback).toBeUndefined();
      expect(action.action).toBe('bet');
      expect(controller.performAction(hero.seat, action.action, action.amount)).toBe(true);
      expect(controller.getState().currentBet).toBe(action.amount);
    }
  );
  it.each(['plo4', 'plo5', 'plo6'] as const)(
    '%s lets value sizing act after the aggressor checks',
    (variant) => {
      for (let seed = 1; seed <= 20; seed++) {
        const { hero, state } = spot(variant, 'before');
        seedFastRandom(seed);
        const action = HorseLogic.decide(hero, state, 'balanced', {}, options);
        expect(action.policyFallback).toBeUndefined();
        expect(action.action, `seed ${seed}`).toBe('bet');
        expect(action.amount).toBeGreaterThanOrEqual(2);
        expect(action.amount).toBeLessThanOrEqual(15);
      }
    }
  );
  it.each(['plo4', 'plo5', 'plo6'] as const)(
    '%s retains the gate for bottom full when a different opponent checked',
    (variant) => {
      for (let seed = 1; seed <= 20; seed++) {
        const { hero, state } = spot(variant, 'behind');
        hero.cards = cards('4c 4h Ac 7d 6d 2c').slice(0, Number(variant.at(-1)));
        seedFastRandom(seed);
        const action = HorseLogic.decide(hero, state, 'balanced', {}, options);
        expect(action.policyFallback).toBeUndefined();
        expect(action.action, `seed ${seed}`).toBe('check');
      }
    }
  );
  it('does not mistake an earlier aggressor check for the last raiser checking', () => {
    const { hero, state } = spot('plo5', 'before');
    hero.cards = cards('4c 4h Ac 7d 6d');
    state.actionHistory = [
      { userId: 'before', seat: 1, action: 'bet', amount: 3, stage: 'turn', timestamp: 1 },
      { userId: 'hero', seat: 2, action: 'call', amount: 3, stage: 'turn', timestamp: 2 },
      { userId: 'behind', seat: 3, action: 'raise', amount: 6, stage: 'turn', timestamp: 3 },
      { userId: 'before', seat: 1, action: 'call', amount: 3, stage: 'turn', timestamp: 4 },
      { userId: 'hero', seat: 2, action: 'call', amount: 3, stage: 'turn', timestamp: 5 },
      { userId: 'before', seat: 1, action: 'check', amount: 0, stage: 'river', timestamp: 6 },
    ];
    seedFastRandom(1);
    expect(HorseLogic.decide(hero, state, 'balanced', {}, options).action).toBe('check');
  });
  it('does not release the gate for a check on a different street', () => {
    const { hero, state } = spot('plo4', 'before');
    state.actionHistory!.at(-1)!.stage = 'flop';
    seedFastRandom(1);
    expect(HorseLogic.decide(hero, state, 'balanced', {}, options).action).toBe('check');
  });
  it.each(['plo4', 'plo5', 'plo6'] as const)(
    '%s releases initiative-only suppression for middle and top full',
    (variant) => {
      for (const pair of ['Kc Kh', 'Qc Qh']) {
        const { hero, state } = spot(variant, 'behind');
        hero.cards = cards(`${pair} Ac 7d 6d 2c`).slice(0, Number(variant.at(-1)));
        expect(omahaBoatPosition(hero.cards, state.communityCards!)!.lowerBoats).toBeGreaterThan(0);
        for (let seed = 1; seed <= 20; seed++) {
          seedFastRandom(seed);
          const action = HorseLogic.decide(hero, state, 'balanced', {}, options);
          expect(action.policyFallback).toBeUndefined();
          expect(action.action, `${pair} seed ${seed}`).toBe('bet');
          expect(action.amount).toBeGreaterThanOrEqual(2);
          expect(action.amount).toBeLessThanOrEqual(15);
        }
      }
    }
  );
  it('preserves the old evaluator API and distinguishes singleton ranks', () => {
    const board = cards('Ac Ah Kc Kh 2d');
    const hole = cards('As Ks 2c 2h 2s');
    const rank = omahaBoatPosition(hole, board)!;
    expect(rank).toEqual({ boats: 0, quads: 0, lowerBoats: 0 });
    expect(omahaBoatsAbove(hole, board)).toEqual({ boats: 0, quads: 0 });
    expect(omahaBoatPosition(cards('3c 4h 5s 6d'), cards('7c 8h 9s Td Ac'))).toBeNull();
  });
  it('bets eights full of nines after a river check on the trip-eight PLO5 board', () => {
    const { hero, state } = spot('plo5', 'behind');
    hero.cards = cards('5c 9c As Jc 9h');
    state.communityCards = cards('4c 8h 5s 8s 8c');
    Object.assign(state, { pot: 5.75, contestablePot: 5.75, maxRaiseTo: 5.75 });
    const position = omahaBoatPosition(hero.cards, state.communityCards)!;
    expect(position.boats).toBeGreaterThan(0);
    expect(position.lowerBoats).toBeGreaterThan(0);
    expect(checkedToNonBottomRiverBoat(hero, state)).toBe(true);
    seedFastRandom(1);
    const decision = HorseLogic.decide(hero, state, 'balanced', {}, options);
    expect(decision.action).toBe('bet');
    expect(decision.amount).toBeGreaterThanOrEqual(state.minRaiseTo!);
    expect(decision.amount).toBeLessThanOrEqual(state.maxRaiseTo!);
  });

  it.each(['plo8', 'flo8', 'nlh'] as const)('does not enable the exception in %s', (variant) => {
    const { hero, state } = spot('plo4', 'behind');
    state.gameVariant = variant;
    // Hold the compiled variant and canonical rules in agreement.
    delete state.variantRules;
    if (variant === 'nlh') hero.cards = cards('Kc Kh');
    seedFastRandom(1);
    expect(checkedToNonBottomRiverBoat(hero, state)).toBe(false);
  });
  it.each(['boardCount', 'secondaryBoard', 'allInOrFold', 'bombPot'])(
    'does not enable the exception for %s',
    (guard) => {
      const { hero, state } = spot('plo4', 'behind');
      if (guard === 'boardCount') state.boardCount = 2;
      if (guard === 'secondaryBoard') state.communityCards2 = cards('2d 3d 5s 6h 8c');
      if (guard === 'allInOrFold') state.allInOrFold = true;
      if (guard === 'bombPot') state.bombPot = true;
      seedFastRandom(1);
      expect(checkedToNonBottomRiverBoat(hero, state)).toBe(false);
    }
  );

  it.each([
    'unknownHole',
    'duplicateCard',
    'noCheck',
    'noBet',
    'turn',
    'splitLow',
    'fixedLimit',
    'paidCall',
  ])('refuses incomplete or unsupported context: %s', (guard) => {
    const { hero, state } = spot('plo4', 'behind');
    if (guard === 'unknownHole') hero.cards = hero.cards.slice(0, 3);
    if (guard === 'duplicateCard') hero.cards[1] = hero.cards[0];
    if (guard === 'noCheck')
      state.actionHistory = state.actionHistory!.filter((a) => a.stage !== 'river');
    if (guard === 'noBet') state.legalActions = ['check'];
    if (guard === 'turn') state.stage = 'turn';
    if (guard === 'splitLow')
      state.variantRules = { ...state.variantRules!, splitLow8OrBetter: true };
    if (guard === 'fixedLimit') state.bettingStructure = 'fixed_limit';
    if (guard === 'paidCall') state.toCall = 5;
    expect(checkedToNonBottomRiverBoat(hero, state)).toBe(false);
  });

  it('leaves facing-bet decisions outside the exemption', () => {
    const { hero, state } = spot('plo4', 'behind');
    state.currentBet = 5;
    state.toCall = 5;
    state.legalActions = ['fold', 'call', 'raise'];
    expect(checkedToNonBottomRiverBoat(hero, state)).toBe(false);
  });
});

// Original PLO6 river coordinates, with anonymized seat identities. The second
// Horse still had a player behind it when it checked. Only public/own cards enter.
it.each([
  ['c56ed960:27', '2d Td Jd 3h Ks 8h', 'Jh Ac Tc Ts 8c', [6, 1, 2, 3, 4], 5, 8.35, 0.25, 45.05],
  ['b9d0394b:26', '9s 7d Kd 7s 6d Jd', 'Js 5h 6c Qh Jc', [1, 2, 3, 4], 6, 62, 2, 627.4],
] as const)(
  'bets the checked-to middle full house at %s',
  (_id, hole, board, checks, button, pot, bb, stack) => {
    const { hero, state } = spot('plo6', 'before');
    Object.assign(hero, { seat: 5, cards: cards(hole), bet: 0, stack });
    const opponent = state.players[0];
    state.players = Array.from({ length: 6 }, (_, i) =>
      i === 4 ? hero : { ...opponent, user_id: `seat-${i + 1}`, seat: i + 1, bet: 0 }
    );
    Object.assign(state, {
      currentPlayerSeat: 5,
      heroSeat: 5,
      dealerSeat: button,
      dealtSeatIds: [1, 2, 3, 4, 5, 6],
      communityCards: cards(board),
      pot,
      contestablePot: pot,
      currentBet: 0,
      toCall: 0,
      bigBlind: bb,
      minRaiseTo: bb,
      maxRaiseTo: pot,
      legalActions: ['fold', 'check', 'bet', 'all_in'],
    });
    state.actionHistory = checks.map((seat, i) => ({
      userId: `seat-${seat}`,
      seat,
      action: 'check',
      amount: 0,
      stage: 'river',
      timestamp: i + 1,
    }));
    seedFastRandom(1);
    const d = HorseLogic.decide(hero, state, 'balanced', {}, { mind: false, v9Timing: false });
    expect(d.policyFallback).toBeUndefined();
    expect(d.policyOwnership).toBeDefined();
    expect(
      horseDecisionReceiptRefusal(d, state.gameVariant, { player: hero, gameState: state })
    ).toBeNull();
    expect(d.action).toBe('bet');
    expect(d.amount).toBeGreaterThanOrEqual(bb);
    expect(d.amount).toBeLessThanOrEqual(pot);
  }
);

// Public wager/seat history and the acting Horse's own cards from original
// PLO6 decision 9ce1e582-62c8-415e-a8a7-1fcce96aad9d:16. No showdown inputs.
function originalBoatFacingPotBet() {
  const { state } = jointPolicyFixture('plo6', 1, 'cash', 'river');
  const seats = [
    [148.26, 0, 0.25],
    [89.54, 0, 17.75],
    [349.07, 0, 0],
    [160.44, 0, 0],
    [99.28, 0, 0],
    [182.76, 35.25, 52.5],
  ];
  state.players = seats.map(([stack, bet, totalInvested], i) => ({
    ...state.players[0],
    user_id: `seat-${i + 1}`,
    seat: i + 1,
    stack,
    bet,
    totalInvested,
    deadInvested: i === 1 ? 0.5 : 0,
    cards: [],
    is_folded: i !== 1 && i !== 5,
    is_all_in: false,
    is_sitting_out: false,
  }));
  const hero = state.players[1];
  hero.cards = cards('5c 8d 9h 9s 7d Js');
  Object.assign(state, {
    heroSeat: 2,
    currentPlayerSeat: 2,
    dealtSeatIds: [1, 2, 3, 4, 5, 6],
    stage: 'river',
    communityCards: cards('9d 3h Qc Th Ts'),
    dealerSeat: 6,
    currentBet: 35.25,
    pot: 70.5,
    contestablePot: 70.5,
    toCall: 35.25,
    minRaiseTo: 70.5,
    maxRaiseTo: 89.54,
    bigBlind: 0.5,
    smallBlind: 0.25,
    ante: 0.5,
    anteType: 'big_blind',
    legalActions: ['fold', 'call', 'raise', 'all_in'],
    pots: calculatePots(state.players),
  });
  const actions = [
    [3, 'fold', 0, 'preflop'],
    [4, 'fold', 0, 'preflop'],
    [5, 'fold', 0, 'preflop'],
    [6, 'raise', 2.25, 'preflop'],
    [1, 'fold', 0, 'preflop'],
    [2, 'call', 1.75, 'preflop'],
    [2, 'check', 0, 'flop'],
    [6, 'check', 0, 'flop'],
    [2, 'bet', 3.28, 'turn'],
    [6, 'raise', 15, 'turn'],
    [2, 'call', 11.72, 'turn'],
    [2, 'check', 0, 'river'],
    [6, 'bet', 35.25, 'river'],
  ] as const;
  state.actionHistory = actions.map(([seat, action, amount, stage], timestamp) => ({
    userId: `seat-${seat}`,
    seat,
    action,
    amount,
    stage,
    timestamp,
  }));
  return { hero, state };
}

it.each(['original', 'stack-capped', 'unbeatable'] as const)(
  'handles the %s pot-bet price at original decision 9ce1e582:16',
  (kind) => {
    const { hero, state } = originalBoatFacingPotBet();
    if (kind === 'stack-capped') {
      hero.stack = 20;
      Object.assign(state, {
        minRaiseTo: null,
        maxRaiseTo: null,
        legalActions: ['fold', 'call', 'all_in'],
      });
    }
    if (kind === 'unbeatable') hero.cards = cards('5c 8d Td Tc 7d Js');
    seedFastRandom(1);
    const d = HorseLogic.decide(hero, state, 'balanced', {}, { mind: false, v9Timing: false });
    expect(d.policyFallback).toBeUndefined();
    expect(d.policyOwnership).toBeDefined();
    expect(
      horseDecisionReceiptRefusal(d, state.gameVariant, { player: hero, gameState: state })
    ).toBeNull();
    if (kind === 'unbeatable') expect(['raise', 'all_in']).toContain(d.action);
    else if (kind === 'stack-capped')
      expect(d).toMatchObject({ action: 'all_in', amount: undefined });
    else expect(d).toMatchObject({ action: 'call', amount: 35.25 });
  }
);

it('flats the 54-into-54 top boat that changed the historical PLO6 neutrality corpus', () => {
  const { hero, state } = jointPolicyFixture('plo6', 1, 'cash', 'river');
  const seats = [
    [356.04, 0, 24],
    [34.49, 54, 78],
    [63.56, 0, 0],
    [387.19, 0, 6],
  ];
  for (const [i, p] of state.players.entries()) {
    const [stack, bet, totalInvested] = seats[i];
    Object.assign(p, { stack, bet, totalInvested, is_folded: i >= 2, is_all_in: false, cards: [] });
  }
  hero.cards = cards('Qd 3h 2s 5h 9d Qh');
  Object.assign(state, {
    communityCards: cards('6h 8d 6c 7h Qc'),
    dealerSeat: 4,
    currentBet: 54,
    toCall: 54,
    pot: 108,
    contestablePot: 108,
    minRaiseTo: 108,
    maxRaiseTo: 216,
    legalActions: ['fold', 'call', 'raise', 'all_in'],
    pots: calculatePots(state.players),
  });
  state.actionHistory = [
    { seat: 1, userId: hero.user_id, stage: 'river', action: 'check', amount: 0, timestamp: 1 },
    {
      seat: 2,
      userId: state.players[1].user_id,
      stage: 'river',
      action: 'bet',
      amount: 54,
      timestamp: 2,
    },
  ];
  seedFastRandom(1);
  const decision = HorseLogic.decide(hero, state, 'balanced', {}, { mind: false, v9Timing: false });
  expect(decision.policyFallback).toBeUndefined();
  expect(decision).toMatchObject({ action: 'call', amount: 54 });
});

it.each(['plo4', 'plo5'] as const)(
  'admits a %s pot-bet boat call at the worker boundary',
  (variant) => {
    const { hero, state } = originalBoatFacingPotBet();
    state.gameVariant = variant;
    hero.cards = hero.cards.slice(0, Number(variant.at(-1)));
    seedFastRandom(1);
    const decision = HorseLogic.decide(
      hero,
      state,
      'balanced',
      {},
      { mind: false, v9Timing: false }
    );
    expect(decision.policyGraph?.transitions.find((t) => t.node === 'wager_rules')).toMatchObject({
      before: { action: 'all_in' },
      after: { action: 'call', amount: 35.25 },
      changed: true,
    });
    expect(
      horseDecisionReceiptRefusal(decision, variant, { player: hero, gameState: state })
    ).toBeNull();
    expect(
      horseDecisionReceiptRefusal(decision, variant, {
        player: hero,
        gameState: { ...state, toCall: 34 },
      })
    ).toBe('policy_graph');
    expect(
      horseDecisionReceiptRefusal(decision, variant, {
        player: { ...hero, cards: [] },
        gameState: state,
      })
    ).toBe('policy_graph');
  }
);

// Original public wager histories, stacks and acting cards. Seat identities are anonymized.
const flushSpots = [
  {
    id: '8c231c8c',
    heroSeat: 1,
    button: 3,
    hole: 'Ad 7c 7s 9d 2h',
    board: 'Js 8s 4d Td 5d',
    pot: 50,
    bb: 2,
    sb: 1,
    rakeCap: 5,
    bbjFeeBB: 0.25,
    legalActions: ['fold', 'check', 'bet', 'all_in'],
    seats: [
      [1, 390.85, 0, 8, 0, 0, 0],
      [2, 378.7, 0, 8, 0, 0, 0],
      [3, 296.85, 0, 8, 0, 0, 0],
      [4, 1876.91, 0, 8, 0, 0, 0],
      [5, 194.45, 0, 10, 2, 0, 0],
      [6, 182, 0, 8, 0, 0, 0],
    ],
    history: [
      [4, 'preflop', 'sb', 1],
      [5, 'preflop', 'bb', 2],
      [5, 'preflop', 'ante', 2],
      [6, 'preflop', 'raise', 8],
      [1, 'preflop', 'call', 8],
      [2, 'preflop', 'call', 8],
      [3, 'preflop', 'call', 8],
      [4, 'preflop', 'call', 7],
      [5, 'preflop', 'call', 6],
      [4, 'flop', 'check', 0],
      [5, 'flop', 'check', 0],
      [6, 'flop', 'check', 0],
      [1, 'flop', 'check', 0],
      [2, 'flop', 'check', 0],
      [3, 'flop', 'check', 0],
      [4, 'turn', 'check', 0],
      [5, 'turn', 'check', 0],
      [6, 'turn', 'check', 0],
      [1, 'turn', 'check', 0],
      [2, 'turn', 'check', 0],
      [3, 'turn', 'check', 0],
      [4, 'river', 'check', 0],
      [5, 'river', 'check', 0],
      [6, 'river', 'check', 0],
    ],
    higher: 0,
  },
  {
    id: '1241ad6a',
    heroSeat: 2,
    button: 5,
    hole: 'Js Ts 2h 2d As',
    board: '3s Tc 2s 8c 5s',
    pot: 151,
    bb: 2,
    sb: 1,
    rakeCap: 5,
    bbjFeeBB: 0.25,
    legalActions: ['fold', 'check', 'bet', 'all_in'],
    seats: [
      [1, 387, 0, 13, 2, 0, 1],
      [2, 918, 0, 46, 0, 0, 0],
      [3, 1079.3, 0, 0, 0, 0, 1],
      [4, 400, 0, 0, 0, 0, 1],
      [5, 1493.22, 0, 46, 0, 0, 0],
      [6, 1249.4, 0, 46, 0, 0, 0],
    ],
    history: [
      [1, 'preflop', 'bb', 2],
      [1, 'preflop', 'ante', 2],
      [6, 'preflop', 'sb', 1],
      [2, 'preflop', 'call', 2],
      [3, 'preflop', 'fold', 0],
      [4, 'preflop', 'fold', 0],
      [5, 'preflop', 'raise', 11],
      [6, 'preflop', 'call', 10],
      [1, 'preflop', 'call', 9],
      [2, 'preflop', 'call', 9],
      [6, 'flop', 'check', 0],
      [1, 'flop', 'check', 0],
      [2, 'flop', 'check', 0],
      [5, 'flop', 'check', 0],
      [6, 'turn', 'bet', 35],
      [1, 'turn', 'fold', 0],
      [2, 'turn', 'call', 35],
      [5, 'turn', 'call', 35],
      [6, 'river', 'check', 0],
    ],
    higher: 1,
  },
  {
    id: 'c9ac0461',
    heroSeat: 5,
    button: 3,
    hole: '2c Tc 5h 6c Ah',
    board: '2d 3c Jh Kh Th',
    pot: 6.85,
    bb: 0.25,
    sb: 0.1,
    rakeCap: 0.62,
    bbjFeeBB: 0.6,
    legalActions: ['fold', 'check', 'bet', 'all_in'],
    seats: [
      [1, 27.78, 0, 1.1, 0, 0, 0],
      [2, 28.97, 0, 1.1, 0, 0, 0],
      [3, 65.05, 0, 1.1, 0, 0, 0],
      [4, 42.12, 0, 1.1, 0, 0, 0],
      [5, 132.16, 0, 1.35, 0.25, 0, 0],
      [6, 103.04, 0, 1.1, 0, 0, 0],
    ],
    history: [
      [4, 'preflop', 'sb', 0.1],
      [5, 'preflop', 'bb', 0.25],
      [5, 'preflop', 'ante', 0.25],
      [6, 'preflop', 'raise', 1.1],
      [1, 'preflop', 'call', 1.1],
      [2, 'preflop', 'call', 1.1],
      [3, 'preflop', 'call', 1.1],
      [4, 'preflop', 'call', 1],
      [5, 'preflop', 'call', 0.85],
      [4, 'flop', 'check', 0],
      [5, 'flop', 'check', 0],
      [6, 'flop', 'check', 0],
      [1, 'flop', 'check', 0],
      [2, 'flop', 'check', 0],
      [3, 'flop', 'check', 0],
      [4, 'turn', 'check', 0],
      [5, 'turn', 'check', 0],
      [6, 'turn', 'check', 0],
      [1, 'turn', 'check', 0],
      [2, 'turn', 'check', 0],
      [3, 'turn', 'check', 0],
      [4, 'river', 'check', 0],
    ],
    higher: 1,
  },
] as const;

function originalRiverFlush(input: (typeof flushSpots)[number]) {
  const { state } = jointPolicyFixture('plo5', 1, 'cash', 'river');
  state.players = input.seats.map(([seat, stack, bet, totalInvested, deadInvested, , flags]) => ({
    ...state.players[0],
    user_id: 's' + seat,
    username: 's' + seat,
    cards: [],
    seat,
    stack,
    bet,
    totalInvested,
    deadInvested,
    is_folded: Boolean(flags & 1),
    is_all_in: Boolean(flags & 2),
    is_sitting_out: Boolean(flags & 4),
  }));
  const hero = state.players.find((p) => p.seat === input.heroSeat)!;
  hero.cards = cards(input.hole);
  const history = input.history.map(([seat, stage, action, amount], timestamp) => ({
    seat,
    stage,
    action,
    amount,
    timestamp,
    userId: 's' + seat,
  }));
  Object.assign(state, {
    heroSeat: hero.seat,
    currentPlayerSeat: hero.seat,
    dealerSeat: input.button,
    blindSeats: {
      smallBlind: history.find((a) => a.action === 'sb')!.seat,
      bigBlind: history.find((a) => a.action === 'bb')!.seat,
    },
    dealtSeatIds: state.players.map((p) => p.seat),
    communityCards: cards(input.board),
    pot: input.pot,
    contestablePot: input.pot,
    pots: calculatePots(state.players),
    minRaise: input.bb,
    minRaiseTo: input.bb,
    maxRaiseTo: input.pot,
    bigBlind: input.bb,
    smallBlind: input.sb,
    ante: input.bb,
    anteType: 'big_blind',
    legalActions: [...input.legalActions],
    actionHistory: history,
    rakeConfig: {
      percent: 10,
      cap: input.rakeCap,
      noFlopNoDrop: true,
      playerCountCaps: [
        { players: 2, cap: input.rakeCap / 2 },
        { players: 3, cap: input.rakeCap },
        { players: 4, cap: input.rakeCap },
      ],
    },
    bbjConfig: { enabled: true, feeBB: input.bbjFeeBB, minPotBB: 10, minPlayersDealt: 3 },
  });
  return { hero, state };
}

it.each(flushSpots)('bets the checked-to PLO5 flush at $id', (input) => {
  const { hero, state } = originalRiverFlush(input);
  seedFastRandom(1);
  const d = HorseLogic.decide(hero, state, 'balanced', {}, { mind: false, v9Timing: false });
  expect(
    horseDecisionReceiptRefusal(d, state.gameVariant, { player: hero, gameState: state })
  ).toBeNull();
  expect(checkedToOnePairAboveFlush(hero, state)).toBe(input.higher === 1);
  if (input.id === 'c9ac0461')
    expect(d.policyGraph?.transitions.find((t) => t.node === 'wager_rules')).toMatchObject({
      before: { action: 'check' },
      after: { action: 'bet', amount: 3.43 },
      changed: true,
    });
  expect(d.action).toBe('bet');
  if (input.higher === 0) expect(d.amount).toBe(input.pot);
});

it('limits the one-higher-pair flush bet to a checked-to, single-board high river', () => {
  const { hero, state } = originalRiverFlush(flushSpots[2]);
  expect(
    checkedToOnePairAboveFlush(hero, {
      ...state,
      actionHistory: state.actionHistory!.filter((a) => a.stage !== 'river'),
    })
  ).toBe(false);
  expect(checkedToOnePairAboveFlush(hero, { ...state, legalActions: ['check'] })).toBe(false);
  expect(checkedToOnePairAboveFlush(hero, { ...state, boardCount: 2 })).toBe(false);
  expect(checkedToOnePairAboveFlush(hero, { ...state, gameVariant: 'plo8' })).toBe(false);
  expect(checkedToOnePairAboveFlush({ ...hero, cards: cards('2c Tc 5h 6c 8h') }, state)).toBe(
    false
  );
});

it.each([
  ['plo4', 'Jh 6s 4h 4s', 'Jd 4d Jc 2h'],
  ['plo5', 'Ks 5h As Kh 7d', 'Kc 3d 3h 8h'],
  ['plo6', 'Ks 5h As Kh 7d 9s', 'Kc 3d 3h 8h'],
] as const)(
  'prices an offered %s turn boat bet without requiring a river card',
  (variant, hole, board) => {
    const { hero, state } = jointPolicyFixture(variant, 1, 'cash', 'turn');
    hero.cards = cards(hole);
    state.communityCards = cards(board);
    state.actionHistory = [
      {
        userId: state.players[1].user_id,
        seat: 2,
        action: 'check',
        amount: 0,
        stage: 'turn',
        timestamp: 1,
      },
    ];
    expect(checkedToNonBottomRiverBoat(hero, state)).toBe(false);
    expect(checkedToNonBottomBoat(hero, state)).toBe(true);
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      seedFastRandom(seed);
      const d = HorseLogic.decide(hero, state, 'balanced', {}, { mind: false, v9Timing: false });
      expect(d.policyFallback).toBeUndefined();
      expect(d.action).toBe('bet');
      expect(d.amount).toBeGreaterThanOrEqual(state.minRaiseTo!);
      expect(d.amount).toBeLessThanOrEqual(state.maxRaiseTo!);
      expect(
        horseDecisionReceiptRefusal(d, variant, { player: hero, gameState: state })
      ).toBeNull();
    }
    expect(checkedToNonBottomBoat(hero, { ...state, actionHistory: [] })).toBe(false);
    expect(checkedToNonBottomBoat(hero, { ...state, bombPot: true })).toBe(false);
  }
);

describe('PLO4 river response after value betting a non-nut full house', () => {
  it.each([
    { stack: 100, opponentStack: 100, raiseTo: 70, expected: 'call', paid: 50 },
    { stack: 40, opponentStack: 40, raiseTo: 40, expected: 'all_in', paid: 20 },
    { stack: 200, opponentStack: 200, raiseTo: 40, expected: null, paid: 20 },
    { stack: 200, opponentStack: 200, raiseTo: 80, expected: 'call', paid: 60 },
    { stack: 200, opponentStack: 30, raiseTo: 30, expected: 'call', paid: 10 },
    { stack: 200, opponentStack: 200, raiseTo: null, expected: 'bet', paid: 0 },
  ])(
    'accepts the next decision at price $paid after opponent response $raiseTo',
    ({ stack, opponentStack, raiseTo, expected, paid }) => {
      const { hero, state } = jointPolicyFixture('plo4', 1, 'cash', 'river');
      Object.assign(hero, {
        user_id: 'hero',
        seat: 2,
        cards: cards('6h Td Tc Qd'),
        stack,
        bet: 0,
        totalInvested: 10,
      });
      const opponent = { ...hero, stack: opponentStack, user_id: 'opponent', seat: 1, cards: [] };
      Object.assign(state, {
        players: [opponent, hero],
        communityCards: cards(raiseTo === null ? 'Kd 2h 2c Th' : 'Kd 2h 2c Th 4d'),
        heroSeat: 2,
        dealtSeatIds: [1, 2],
        dealerSeat: 2,
        blindSeats: { smallBlind: 2, bigBlind: 1 },
      });
      const controller = new HandController(
        {
          tableId: 'river-check-raise',
          handNumber: 1,
          gameVariant: 'plo4',
          smallBlind: 1,
          bigBlind: 2,
          rakeConfig: { percent: 0, cap: 0, noFlopNoDrop: true },
        },
        state.players,
        2
      );
      const internal = controller as unknown as {
        state: GameState;
        handFSM: { transition(s: string): void };
      };
      Object.assign(internal.state, {
        players: state.players,
        communityCards: state.communityCards,
        stage: raiseTo === null ? 'turn' : 'river',
        deck: new Deck(cards('4d')),
        currentBet: 0,
        pot: 20,
        minRaise: 2,
        lastRaise: 2,
        currentPlayerSeat: 1,
        dealerSeat: 2,
        actionHistory: [],
      });
      for (const stage of ['posting_blinds', 'dealing', 'preflop', 'flop', 'turn', 'river'])
        if (stage !== 'river' || raiseTo !== null) internal.handFSM.transition(stage);
      function decideAtCurrentPrice() {
        const current = controller.getState({ includeActionOrigins: true });
        const player = current.players.find((p) => p.seat === hero.seat)!;
        const menu = controller.getAuthoritativeActionState(hero.user_id)!;
        Object.assign(
          state,
          {
            players: current.players,
            stage: current.stage,
            communityCards: current.communityCards,
            actionHistory: current.actionHistory,
            pot: current.pot,
            contestablePot: controller.getContestablePotForCall(hero.user_id),
            currentBet: current.currentBet,
            currentPlayerSeat: current.currentPlayerSeat,
            pots: calculatePots(current.players),
          },
          menu,
          { bettingStructure: menu.structure }
        );
        seedFastRandom(1);
        return HorseLogic.decide(player, state, 'balanced', {});
      }
      expect(controller.performAction(1, 'check')).toBe(true);
      const open = decideAtCurrentPrice();
      expect(open).toMatchObject({ action: 'bet', amount: 20 });
      expect(controller.performAction(2, open.action, open.amount)).toBe(true);
      if (raiseTo === null) {
        expect(controller.performAction(1, 'call')).toBe(true);
        expect(controller.getState().stage).toBe('river');
        expect(controller.getState().communityCards).toEqual(cards('Kd 2h 2c Th 4d'));
        expect(controller.performAction(1, 'check')).toBe(true);
      } else {
        const reply = raiseTo === opponentStack ? 'all_in' : 'raise';
        expect(controller.performAction(1, reply, raiseTo)).toBe(true);
      }
      const response = decideAtCurrentPrice();
      expect(state.toCall).toBe(paid);
      expect(response.policyFallback).toBeUndefined();
      if (expected !== null) expect(response.action).toBe(expected);
      if (opponentStack === 30) expect(state.legalActions).toEqual(['fold', 'call']);
      if (expected === 'call') expect(response.amount).toBe(paid);
      expect(controller.performAction(2, response.action, response.amount)).toBe(true);
    }
  );
});
