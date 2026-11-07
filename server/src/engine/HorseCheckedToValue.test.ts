import { describe, expect, it } from 'vitest';
import type { Card, GameVariant } from '../types.js';
import { horseDecisionReceiptRefusal } from './horseDecision/responseValidation.js';
import { HorseLogic } from './HorseLogic.js';
import { checkedToNonBottomRiverBoat } from './HorseNonBottomRiverValue.js';
import { omahaBoatPosition, omahaBoatsAbove, seedFastRandom } from './HorseEval.js';
import { jointPolicyFixture } from './multiway/JointRangeFixture.test-support.js';
import { calculatePots } from './PokerEngine.js';
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
  it('does not exempt trip-board middle boats from initiative discipline', () => {
    const { hero, state } = spot('plo4', 'behind');
    hero.cards = cards('Kc Kh 4c 5d');
    state.communityCards = cards('7c 7h 7s 2d 3h');
    expect(omahaBoatPosition(hero.cards, state.communityCards)!.boats).toBeGreaterThan(0);
    seedFastRandom(1);
    expect(HorseLogic.decide(hero, state, 'balanced', {}, options).action).toBe('check');
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
