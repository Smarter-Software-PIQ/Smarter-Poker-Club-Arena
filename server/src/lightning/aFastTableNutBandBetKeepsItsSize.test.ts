import { describe, expect, it } from 'vitest';
import { HandController } from '../engine/HandController.js';
import { shapeLightningHorseAction } from './LightningHorse.js';
import type { Card, GameState, SeatPlayer } from '../types.js';

const cards = (text: string): Card[] =>
  text.split(' ').map((c) => ({
    rank: c[0] as Card['rank'],
    suit: ({ c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' } as const)[c[1] as 'c'],
  }));

// Public action node from hand 54876348, review 3304144. Opponent cards
// are deliberately absent. A three-way river had a legal 17.26 pot bet.
function incident(hole = '4c Ah 8s 3h 9s') {
  const players = [1, 4, 6].map(
    (seat): SeatPlayer => ({
      seat,
      user_id: 'player-' + seat,
      username: 'Fixture',
      stack: seat === 1 ? 117.15 : 95.08,
      bet: 0,
      totalInvested: 5.42,
      cards: seat === 1 ? cards(hole) : [],
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
    })
  );
  const hc = new HandController(
    {
      tableId: 'lightning-river-value-isolated',
      handNumber: 54876348,
      gameVariant: 'plo5',
      smallBlind: 0.25,
      bigBlind: 0.5,
      rakeConfig: { percent: 0, cap: 0, noFlopNoDrop: true },
    },
    players,
    6
  );
  const internal = hc as unknown as { state: GameState; handFSM: { transition(s: string): void } };
  Object.assign(internal.state, {
    players,
    communityCards: cards('Th Kh 4s 6h Js'),
    stage: 'river',
    currentBet: 0,
    pot: 17.26,
    minRaise: 0.5,
    lastRaise: 0.5,
    currentPlayerSeat: 1,
  });
  for (const s of ['posting_blinds', 'dealing', 'preflop', 'flop', 'turn', 'river'])
    internal.handFSM.transition(s);
  const hero = hc.getState().players.find((p) => p.seat === 1)!;
  return { hc, hero };
}

/**
 * omahaValueSizeIsUnreadable on fast (Lightning) cash tables: the acceptance door re-runs the
 * exact-nuts rule (riverNutsRaise) on every river decision. A nut wager the option sized in the
 * owner's 80-95% pot band keeps its size there while it is still the stamped, legal, in-band wager;
 * without the stamp (option off) the door behaves exactly as before. Fixture: the public node of
 * hand 54876348 used by aLightningRiverNutHandKeepsItsValueBet.law.test.ts (no opponent cards).
 */
describe('a fast-table river nut bet sized in the band keeps its size at the door', () => {
  const band = (amount: number, stamped = amount) => ({
    action: 'bet',
    amount,
    valueSize: { kind: 'unreadable_band' as const, action: 'bet' as const, amount: stamped },
  });

  it('on: the stamped band bet stays in 80-95% of the pot and is accepted as sized', () => {
    const { hc, hero } = incident();
    const shaped = shapeLightningHorseAction(hc, hero.user_id, band(15.1), false);
    expect(shaped).toEqual({ action: 'bet', amount: 15.1 });
    expect(shaped.amount! / 17.26).toBeGreaterThanOrEqual(0.8);
    expect(shaped.amount! / 17.26).toBeLessThanOrEqual(0.95);
    expect(hc.performAction(hero.seat, shaped.action, shaped.amount)).toBe(true);
    expect(hc.getState().currentBet).toBe(15.1);
  });

  it('off (no stamp): the same bet is put back to the full pot, exactly as before', () => {
    const { hc, hero } = incident();
    expect(
      shapeLightningHorseAction(hc, hero.user_id, { action: 'bet', amount: 15.1 }, false)
    ).toEqual({
      action: 'bet',
      amount: 17.26,
    });
  });

  it('a stale stamp (the amount was replaced after sizing) or an amount outside the band is not kept', () => {
    const { hc, hero } = incident();
    expect(shapeLightningHorseAction(hc, hero.user_id, band(15.1, 15.0), false)).toEqual({
      action: 'bet',
      amount: 17.26,
    });
    const low = incident();
    expect(shapeLightningHorseAction(low.hc, low.hero.user_id, band(10), false)).toEqual({
      action: 'bet',
      amount: 17.26,
    });
  });
});
