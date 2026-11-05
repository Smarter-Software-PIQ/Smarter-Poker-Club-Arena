import { describe, expect, it } from 'vitest';
import { HandController } from '../engine/HandController.js';
import { recheckHorseQualifiedBeforeAcceptance } from '../engine/HorseQualifiedAcceptance.js';
import { shapeLightningHorseAction } from './LightningHorse.js';
import type { Card, GameState, HorseDecision, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from '../engine/HorseLogic.js';

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

describe('Lightning preserves river nut value after acceptance-time withdrawal', () => {
  it.each(['omahaVariantPolicy', 'jointPolicy'] as const)(
    'restores legal nut value after %s reselects a passive baseline',
    (field) => {
      const { hc, hero } = incident();
      const issued: HorseDecision = { action: 'bet', amount: 17.26, thinkTime: 0 };
      (issued as any)[field] = {
        variant: 'plo5',
        boardCount: 1,
        applied: true,
        baselineAction: 'check',
        baselineAmount: null,
        finalAction: 'bet',
        finalAmount: 17.26,
        selection: 'selected',
        authority: { epoch: 'missing-worker', generation: 1, authorityKey: 'missing' },
      };
      const withdrawn = recheckHorseQualifiedBeforeAcceptance(issued, {
        player: hero,
        gameState: {
          ...hc.getState(),
          ...hc.getBlindSnapshot(),
          gameMode: 'cash',
          gameVariant: 'plo5',
        } as HorseGameStateV2,
      });
      expect(withdrawn.action).toBe('check');
      expect((withdrawn as any)[field].applied).toBe(false);
      const shaped = shapeLightningHorseAction(hc, hero.user_id, withdrawn, false);
      expect(shaped).toEqual({ action: 'bet', amount: 17.26 });
      expect(hc.performAction(hero.seat, shaped.action, shaped.amount)).toBe(true);
      expect(hc.getState().currentBet).toBe(17.26);
      expect((withdrawn as any)[field].selection).toBe('withdrawn_before_acceptance');
    }
  );

  it('leaves a near-nut check to the range-aware strategy', () => {
    const { hc, hero } = incident('4c Qh 8s 3h 9s');
    expect(shapeLightningHorseAction(hc, hero.user_id, { action: 'check' }, false)).toEqual({
      action: 'check',
      amount: undefined,
    });
  });

  it('does not bet into opponents who cannot respond', () => {
    const { hc, hero } = incident();
    for (const p of (hc as unknown as { state: GameState }).state.players)
      if (p.seat !== hero.seat) {
        p.is_all_in = true;
        p.stack = 0;
      }
    expect(shapeLightningHorseAction(hc, hero.user_id, { action: 'check' }, false).action).toBe(
      'check'
    );
  });
});
