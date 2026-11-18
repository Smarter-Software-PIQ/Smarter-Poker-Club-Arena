/**
 * The payout-aware push/fold card (nashPushFoldIcm, 2026-11-15, hand
 * 59441335; default OFF, owner preflop range hold) deals a context the
 * option can act in. The league's other
 * tournament contexts carry no stack list, so heroBubbleFactor returns null
 * there and both arms of any card play chip EV: a card dealt in one of them
 * would measure two identical arms.
 */
import { describe, expect, it } from 'vitest';
import { LEAGUE_MATCHUPS, finalTableMttWithStacksContext } from './HorseLeague.js';
import { payJumpBubbleFactor, type HorseGameStateV2 } from '../engine/HorseLogic.js';

const gsFor = (tournament: HorseGameStateV2['tournament'], heroStack: number) =>
  ({
    players: [],
    communityCards: [],
    pot: 0,
    currentBet: 0,
    minRaise: 0,
    stage: 'preflop',
    gameVariant: 'nlh',
    bigBlind: 2,
    gameMode: 'tournament',
    format: 'mtt',
    tournament,
    _heroStack: heroStack,
  }) as unknown as HorseGameStateV2;

describe('the league deals the payout-aware push/fold where it can act', () => {
  const card = LEAGUE_MATCHUPS.find((m) => m.name === 'mtt6_ft_pay_jump_push_fold_12bb');

  it('is on the card: the option on against the default (chip EV)', () => {
    expect(card).toBeDefined();
    expect(card!.a).toEqual({ nashPushFoldIcm: true });
    expect(card!.b).toEqual({});
    expect(card!.seats).toBe(6);
    expect(card!.stackBB).toBe(12);
  });

  it('its context carries a stack list and every league seat identity', () => {
    const t = card!.context!.tournament!;
    expect(t.inMoney).toBe(true);
    expect(t.playersLeft).toBe(6);
    expect(t.stacks).toEqual([24, 24, 24, 24, 24, 24]);
    expect(Object.keys(t.stackByUser ?? {}).sort()).toEqual([
      'league-1',
      'league-2',
      'league-3',
      'league-4',
      'league-5',
      'league-6',
    ]);
    expect(card!.context).toEqual(finalTableMttWithStacksContext(6, 12));
  });

  it('the option reads a bubble factor above 1 there, and none without the stack list', () => {
    const t = card!.context!.tournament!;
    // A 12bb seat after posting a 1bb ante: 11bb behind.
    const bf = payJumpBubbleFactor(gsFor(t, 22), 11, 'league-3');
    expect(bf).not.toBeNull();
    expect(bf!).toBeGreaterThan(1);
    const { stacks: _s, stackByUser: _u, ...bare } = t;
    expect(payJumpBubbleFactor(gsFor(bare, 22), 11, 'league-3')).toBeNull();
  });
});
