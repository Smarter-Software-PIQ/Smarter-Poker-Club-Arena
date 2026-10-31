import { describe, expect, it } from 'vitest';
import { HorseLogic, type HorseGameStateV2 } from './HorseLogic.js';
import { seedFastRandom, omahaMadeClass } from './HorseEval.js';
import { LEAGUE_MATCHUPS, UNMEASURABLE_MATCHUPS } from '../benchmark/HorseLeague.js';
import type { Card, SeatPlayer } from '../types.js';
const cards = (s: string): Card[] =>
  s.split(' ').map(
    (v) =>
      ({
        rank: v[0],
        suit: ({ c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' } as const)[v[1] as 'c'],
      }) as Card
  );
function spot(variant = 'plo4', street = 'river', dry = false) {
  // Recorded review2373791, projected from its pre-action publicNode.
  const hero = {
    seat: 3,
    user_id: 'hero',
    username: 'hero',
    stack: 43.33,
    bet: 0,
    totalInvested: 18.27,
    cards: cards(dry ? 'Kc Ks Qd Th' : 'Qd Ah Ad Ts'),
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
    is_horse: true,
  } as SeatPlayer;
  if (variant !== 'plo4') hero.cards.push(...cards(variant === 'plo5' ? '6h' : '6h 8d'));
  const opp = {
    ...hero,
    seat: 2,
    user_id: 'opp',
    cards: [],
    stack: 28.58,
    bet: 37.64,
    totalInvested: 55.91,
  };
  const board = cards(dry ? 'Kd Jh 8c 4s 2d' : '4c 3s 7d Jc As');
  const gs = {
    players: [hero, opp],
    communityCards: street === 'river' ? board : board.slice(0, 4),
    pot: 75.28,
    currentBet: 37.64,
    minRaise: 37.64,
    lastRaise: 37.64,
    minRaiseTo: 75.28,
    maxRaiseTo: 43.33,
    stage: street,
    gameVariant: variant,
    bigBlind: 0.25,
    dealerSeat: 2,
    gameMode: 'cash',
    format: 'cash',
    bettingStructure: 'pot_limit',
    chipUnit: 0.01,
    actionHistory: [
      { seat: 3, userId: 'hero', action: 'check', amount: 0, stage: street, timestamp: 1 },
      { seat: 2, userId: 'opp', action: 'bet', amount: 37.64, stage: street, timestamp: 2 },
    ],
  } as HorseGameStateV2;
  return { hero, gs };
}
function decide(
  seed: number,
  on: boolean,
  variant = 'plo4',
  street = 'river',
  dry = false,
  extra: Record<string, unknown> = {}
) {
  const { hero, gs } = spot(variant, street, dry);
  seedFastRandom(seed * 977);
  const d = HorseLogic.decide(
    hero,
    gs,
    'balanced',
    {},
    { mind: false, telemetry: false, v55OmahaRiverTripsFlat: on, ...extra }
  );
  return { action: d.action, amount: d.amount };
}
describe('V55 Omaha river trips flat', () => {
  it.each(['plo4', 'plo5'])(
    'retains a priced call without escalating a river set in %s',
    (variant) => {
      for (let seed = 1; seed <= 40; seed++)
        expect(decide(seed, true, variant)).toEqual({ action: 'call', amount: 37.64 });
    }
  );
  it('retains a priced call without escalating a river set in plo6 when V59 is off', () => {
    for (let seed = 1; seed <= 40; seed++)
      expect(decide(seed, true, 'plo6', 'river', false, { v59Plo6RiverUnpaired: false })).toEqual({
        action: 'call',
        amount: 37.64,
      });
  });
  it('PLO6 owner ruling (V59, 2026-10-25): this set folds to the pot-sized river bet', () => {
    // A random six-card hand beats aces here ~32% of the time (any 5 with a
    // 2 or a 6 is a straight); measured unpaired PLO6 river calls in that
    // class won 17% (docs/changelog/2026-10-25-plo6-river-unpaired-discipline.md).
    for (let seed = 1; seed <= 40; seed++) expect(decide(seed, true, 'plo6').action).toBe('fold');
  });
  it('reproduces the recorded re-shove with the switch off', () => {
    for (let seed = 1; seed <= 40; seed++) expect(decide(seed, false).action).toBe('all_in');
  });
  it('preserves dry-board top sets and every earlier-street decision', () => {
    const { hero, gs } = spot('plo4', 'river', true);
    expect(omahaMadeClass(hero.cards, gs.communityCards).weak).toBe(false);
    for (let seed = 1; seed <= 20; seed++) {
      expect(decide(seed, true, 'plo4', 'river', true)).toEqual(
        decide(seed, false, 'plo4', 'river', true)
      );
      expect(decide(seed, true, 'plo4', 'turn')).toEqual(decide(seed, false, 'plo4', 'turn'));
    }
  });
  it('reports every V55 card as refused, with its arms, instead of dealing an inert one', () => {
    // 2026-10-31: 0 of 6,000 pairs diverged on PLO4 and PLO5 every night from
    // 2026-10-27, and PLO6 never diverged. Retired into UNMEASURABLE_MATCHUPS
    // so each run writes a refused row the audit reads, never deleted.
    for (const variant of ['plo4', 'plo5', 'plo6']) {
      const name = `${variant}_v55_river_trips_flat`;
      expect(LEAGUE_MATCHUPS.some((m) => m.name === name)).toBe(false);
      const refused = UNMEASURABLE_MATCHUPS.find((m) => m.name === name)!;
      expect(refused.a.v55OmahaRiverTripsFlat).toBe(true);
      expect(refused.b).toEqual({});
      expect(refused.stackBB).toBe(400);
      expect(refused.variant).toBe(variant);
    }
  });
});
