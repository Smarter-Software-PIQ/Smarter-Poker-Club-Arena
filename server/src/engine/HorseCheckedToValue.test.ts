import { describe, expect, it } from 'vitest';
import type { Card, GameVariant } from '../types.js';
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
