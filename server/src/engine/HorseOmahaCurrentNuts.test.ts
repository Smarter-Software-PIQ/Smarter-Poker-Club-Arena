/**
 * Boundaries of the Omaha current-nuts raise (HorseOmahaCurrentNuts.ts),
 * built from production hand 55690261: PLO5 1/2, turn As 7h 6h 4s, a pot bet
 * of 50 into 50, the horse holding 8c 5c Kh 3h 2d (the nut straight with a
 * king-high heart redraw) and the small blind still to act.
 */
import { describe, expect, it } from 'vitest';
import type { Card, CardRank, CardSuit, HorseDecision, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import { omahaCurrentNuts, omahaCurrentNutsRaise } from './HorseOmahaCurrentNuts.js';

const SUIT: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (s: string): Card[] =>
  (s.match(/../g) ?? []).map((t) => ({ rank: t[0] as CardRank, suit: SUIT[t[1]] }));

function seat(seat: number, stack: number, extra: Partial<SeatPlayer> = {}): SeatPlayer {
  return {
    seat,
    user_id: `p${seat}`,
    username: `p${seat}`,
    stack,
    bet: 0,
    cards: [],
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
    ...extra,
  } as SeatPlayer;
}

/** Hero seat 3 faces seat 5's turn bet of 50 into 50; seat 4 behind unless heads-up. */
function spot(
  hole: string,
  board: string,
  o: {
    headsUp?: boolean;
    heroStack?: number;
    maxRaiseTo?: number;
    stage?: string;
    variant?: string;
  } = {}
) {
  const heroStack = o.heroStack ?? 405.25;
  const hero = seat(3, heroStack, { cards: cards(hole) });
  const players = [
    seat(1, 744.27, { is_folded: true }),
    hero,
    seat(4, 720.45, { is_folded: o.headsUp === true }),
    seat(5, 140, { bet: 50 }),
  ];
  const gs = {
    stateSchemaVersion: 1,
    players,
    communityCards: cards(board),
    pot: 100,
    currentBet: 50,
    toCall: 50,
    minRaiseTo: 100,
    maxRaiseTo: o.maxRaiseTo ?? 200,
    legalActions: ['fold', 'call', 'raise', 'all_in'],
    stage: o.stage ?? 'turn',
    gameVariant: o.variant ?? 'plo5',
    bettingStructure: 'pot_limit',
    bigBlind: 2,
    smallBlind: 1,
  } as unknown as HorseGameStateV2;
  return { hero, gs };
}

const CALL: HorseDecision = { action: 'call', amount: 50, thinkTime: 0 };

describe('Omaha current nuts facing a flop or turn bet', () => {
  it('the real hand: nut straight with a flush redraw, a player behind, raises the pot', () => {
    const { hero, gs } = spot('2dKh3h8c5c', 'As7h6h4s');
    expect(omahaCurrentNuts(hero.cards, gs.communityCards)).toEqual({
      nuts: true,
      tieable: true,
      redrawOuts: 9,
    });
    expect(omahaCurrentNutsRaise(CALL, hero, gs)).toMatchObject({ action: 'raise', amount: 200 });
  });

  it('the same freeroll heads-up raises the pot too', () => {
    const { hero, gs } = spot('2dKh3h8c5c', 'As7h6h4s', { headsUp: true });
    expect(omahaCurrentNutsRaise(CALL, hero, gs)).toMatchObject({ action: 'raise', amount: 200 });
  });

  it('on the flop the freeroll raises as well', () => {
    const { hero, gs } = spot('2dKh3h8c5c', '7h6h4s', { stage: 'flop' });
    expect(omahaCurrentNutsRaise(CALL, hero, gs)).toMatchObject({ action: 'raise', amount: 200 });
  });

  it('when the pot raise is the whole stack it is an all in', () => {
    const { hero, gs } = spot('2dKh3h8c5c', 'As7h6h4s', { heroStack: 150, maxRaiseTo: 150 });
    expect(omahaCurrentNutsRaise(CALL, hero, gs)).toMatchObject({ action: 'all_in' });
  });

  it('a vulnerable nut hand with no redraw (the unique nut flush) still raises', () => {
    const { hero, gs } = spot('AhJhQdTc4s', '9h6h2hKc');
    const status = omahaCurrentNuts(hero.cards, gs.communityCards);
    expect(status).toEqual({ nuts: true, tieable: false, redrawOuts: 0 });
    expect(omahaCurrentNutsRaise(CALL, hero, gs)).toMatchObject({ action: 'raise', amount: 200 });
  });

  it('a chop-locked nut straight with no redraw keeps the call', () => {
    const { hero, gs } = spot('JcTs4d4c3h', '9c8d7s2h');
    expect(omahaCurrentNuts(hero.cards, gs.communityCards)).toEqual({
      nuts: true,
      tieable: true,
      redrawOuts: 0,
    });
    expect(omahaCurrentNutsRaise(CALL, hero, gs)).toEqual(CALL);
  });

  it('a hand that is not the current nuts keeps the call', () => {
    const { hero, gs } = spot('2dKh3h5c3c', 'As7h6h4s');
    expect(omahaCurrentNuts(hero.cards, gs.communityCards)?.nuts).toBe(false);
    expect(omahaCurrentNutsRaise(CALL, hero, gs)).toEqual(CALL);
  });

  it('the river, hi-lo and a fold or raise are not this rule', () => {
    const river = spot('2dKh3h8c5c', 'As7h6h4s9d', { stage: 'river' });
    expect(omahaCurrentNutsRaise(CALL, river.hero, river.gs)).toEqual(CALL);
    const hilo = spot('2dKh3h8c5c', 'As7h6h4s', { variant: 'plo8' });
    expect(omahaCurrentNutsRaise(CALL, hilo.hero, hilo.gs)).toEqual(CALL);
    const real = spot('2dKh3h8c5c', 'As7h6h4s');
    const raise: HorseDecision = { action: 'raise', amount: 150, thinkTime: 0 };
    expect(omahaCurrentNutsRaise(raise, real.hero, real.gs)).toEqual(raise);
  });
});
