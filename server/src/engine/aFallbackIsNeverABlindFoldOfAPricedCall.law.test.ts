/**
 * LIVEGRADE CR-1 (2026-11-19, hand 60117459, id only): a Horse action with
 * origin horse_fallback was a fold facing a person's bet at price 0.20 with a
 * strong hand. Law: when no policy answer arrives, a PLO4/PLO5 cash seat
 * facing a person's wager is priced by the pure facing-bet equity verdict and
 * the call that pays is the fallback; everywhere else the liveness action
 * stands; PLO6 is untouched. Constructed cards only.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { HorseGameStateV2 } from './HorseLogic.js';
import { failureFallbackAction } from './BettingStructure.js';
import { omahaFallbackPricedCall } from './HorseOmahaFacingBetEquity.js';
import type { Card, SeatPlayer } from '../types.js';

const c = (t: string): Card =>
  ({
    rank: t[0],
    suit: { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' }[t[1]]!,
  }) as Card;
const cards = (s: string): Card[] => s.match(/../g)!.map(c);
const TURN = cards('Kh9s8d3c');

function state(
  variant: string,
  hole: Card[],
  over: { bettorIsHorse?: boolean; bet?: number; mode?: string } = {}
) {
  const bet = over.bet ?? 30;
  const hero = {
    seat: 1,
    user_id: 'horse',
    is_horse: true,
    stack: 400,
    bet: 0,
    cards: hole,
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
  } as unknown as SeatPlayer;
  const bettor = {
    seat: 2,
    user_id: 'bettor',
    is_horse: over.bettorIsHorse === true,
    stack: 340,
    bet,
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
  } as unknown as SeatPlayer;
  const gs = {
    gameVariant: variant,
    gameMode: over.mode ?? 'cash',
    stage: 'turn',
    communityCards: TURN,
    pot: 90 + bet,
    currentBet: bet,
    toCall: bet,
    bigBlind: 2,
    players: [hero, bettor],
    legalActions: bet > 0 ? ['fold', 'call', 'raise'] : ['check', 'bet'],
    publicMemoryDomain: { speed: 'lightning' },
    actionHistory: bet > 0 ? [{ stage: 'turn', seat: 2, action: 'bet', amount: bet }] : [],
  } as unknown as HorseGameStateV2;
  return { hero, gs };
}

describe('the liveness fallback is never a blind fold of a priced call', () => {
  it('the engine liveness action alone still folds every pot-limit seat that owes chips', () => {
    expect(failureFallbackAction({ structure: 'pot_limit', toCall: 30, pot: 120 })).toBe('fold');
  });

  it('PLO5 and PLO4 cash, top set facing a person at a quarter of the pot: the call, for the exact chips', () => {
    const five = state('plo5', cards('KsKd7c6h2c'));
    expect(omahaFallbackPricedCall(five.hero, five.gs)).toBe(30);
    const four = state('plo4', cards('KsKd7c6h'));
    expect(omahaFallbackPricedCall(four.hero, four.gs)).toBe(30);
  });

  it('a hand the price does not pay keeps the liveness fold', () => {
    const { hero, gs } = state('plo5', cards('2s4d5c6hJc'), { bet: 90 });
    expect(omahaFallbackPricedCall(hero, gs)).toBeNull();
  });

  it('outside the measured spot nothing changes: a Horse bettor, nothing owed, a tournament, PLO6', () => {
    const top = cards('KsKd7c6h2c');
    const vsHorse = state('plo5', top, { bettorIsHorse: true });
    expect(omahaFallbackPricedCall(vsHorse.hero, vsHorse.gs)).toBeNull();
    const free = state('plo5', top, { bet: 0 });
    expect(omahaFallbackPricedCall(free.hero, free.gs)).toBeNull();
    const tourney = state('plo5', top, { mode: 'tournament' });
    expect(omahaFallbackPricedCall(tourney.hero, tourney.gs)).toBeNull();
    const six = state('plo6', cards('KsKd7c6h2c2d'));
    expect(omahaFallbackPricedCall(six.hero, six.gs)).toBeNull();
  });

  it('both engine doors ask it before the liveness fold (table worker fallback, Lightning catch)', () => {
    const table = readFileSync(new URL('./ServerTableEngineTurns.ts', import.meta.url), 'utf8');
    expect(table).toMatch(
      /livenessAction === 'fold'\s*\?\s*omahaFallbackPricedCall\(decisionSnapshot\.player, decisionSnapshot\.gameState\)/
    );
    const pool = readFileSync(new URL('../lightning/LightningHorse.ts', import.meta.url), 'utf8');
    expect(pool).toMatch(/omahaFallbackPricedCall\(asked\.player, asked\.gameState\)/);
    expect(pool).toMatch(/action: pricedCall !== null \? 'call' : toCall > 0 \? 'fold' : 'check'/);
  });
});
