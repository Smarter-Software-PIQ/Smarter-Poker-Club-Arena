import { describe, expect, it, vi } from 'vitest';
vi.mock('./supabase/client.js', () => ({ supabase: {} }));
vi.mock('./errorReporter.js', () => ({ reportError: vi.fn() }));
import { accumulatePlayStats, type HandRow } from './HorsePlayStats.js';
import { deriveFlowFlags, type HandAction } from './supabase/handFacts.js';

const action = (userId: string, action: string, amount = 0, extra = {}): HandAction => ({
  userId,
  action,
  amount,
  stage: 'preflop',
  seat: 1,
  ...extra,
});
function measure(actions: HandAction[], userId = 'hero') {
  const row: HandRow = {
    actions,
    players: [{ userId: 'hero' }, { userId: 'villain' }, { userId: 'third' }],
    winners: [],
    big_blind: 2,
    button_seat: null,
  };
  return {
    daily: accumulatePlayStats([row], new Set([userId]), new Map()).get(userId)!,
    fact: deriveFlowFlags(userId, actions, {
      boardLength: 0,
      returned: 0,
      nonFoldedCount: 1,
      bigBlind: 2,
      contextAvailable: true,
    }),
  };
}

describe('preflop statistics count decisions rather than accounting events', () => {
  it('distinguishes a short all-in raise from an all-in call', () => {
    const { daily, fact } = measure([
      action('villain', 'raise', 6),
      action('hero', 'all_in', 8, { isFullRaise: false }),
    ]);
    expect(daily.pfr).toBe(1);
    expect(daily.threeBets).toBe(1);
    expect(fact.pfr).toBe(true);
    expect(fact.three_bet).toBe(true);
  });
  it('does not count a call-only all-in as a legal 3-bet opportunity', () => {
    const { daily, fact } = measure([
      action('villain', 'raise', 20),
      action('hero', 'all_in', 10, {
        publicNode: {
          status: 'captured',
          actorSeat: 1,
          currentBet: 20,
          legalActions: ['fold', 'all_in'],
          seats: [[1, 10, 0]],
        },
      }),
    ]);
    expect(daily.vpip).toBe(1);
    expect(daily.threeBetOpps).toBe(0);
    expect(fact.vpip).toBe(true);
    expect(fact.three_bet_opportunity).toBe(false);
  });
  it('counts an all-in-only legal raise opportunity', () => {
    const { daily, fact } = measure([
      action('villain', 'raise', 6),
      action('hero', 'all_in', 20, {
        isFullRaise: true,
        publicNode: {
          status: 'captured',
          actorSeat: 1,
          currentBet: 6,
          legalActions: ['fold', 'all_in'],
          seats: [[1, 20, 0]],
        },
      }),
    ]);
    expect(daily.threeBets).toBe(1);
    expect(daily.threeBetOpps).toBe(1);
    expect(fact.three_bet).toBe(true);
    expect(fact.three_bet_opportunity).toBe(true);
  });
  it('does not give an opener a 3-bet opportunity for an uncalled refund', () => {
    const { daily, fact } = measure([
      action('hero', 'raise', 6),
      action('villain', 'fold'),
      action('third', 'fold'),
      action('hero', 'return', 4),
    ]);
    expect(daily.threeBetOpps).toBe(0);
    expect(fact.three_bet_opportunity).toBe(false);
  });
  it('does not give a player who already folded an opportunity to face a later open', () => {
    const { daily, fact } = measure([
      action('hero', 'fold'),
      action('villain', 'raise', 6),
      action('third', 'fold'),
    ]);
    expect(daily.threeBetOpps).toBe(0);
    expect(fact.three_bet_opportunity).toBe(false);
  });
  it('counts a voluntary all-in call as VPIP without calling it a raise', () => {
    const { daily, fact } = measure([
      action('villain', 'raise', 20),
      action('hero', 'all_in', 10, { isFullRaise: false }),
    ]);
    expect(daily.vpip).toBe(1);
    expect(daily.pfr).toBe(0);
    expect(fact.vpip).toBe(true);
    expect(fact.pfr).toBe(false);
  });
  it('excludes forced all-in contributions from voluntary statistics', () => {
    const { daily, fact } = measure([
      action('hero', 'all_in', 1, { origin: 'forced', dead: true, isFullRaise: true }),
      action('villain', 'raise', 6),
      action('third', 'fold'),
    ]);
    expect(daily.vpip).toBe(0);
    expect(daily.pfr).toBe(0);
    expect(daily.threeBetOpps).toBe(0);
    expect(fact.vpip).toBe(false);
    expect(fact.pfr).toBe(false);
  });
  it('counts a cold 3-bet in both its numerator and denominator, once', () => {
    const { daily, fact } = measure([
      action('villain', 'raise', 6),
      action('hero', 'raise', 20),
      action('third', 'fold'),
      action('villain', 'fold'),
      action('hero', 'return', 14),
    ]);
    expect(daily.threeBets).toBe(1);
    expect(daily.threeBetOpps).toBe(1);
    expect(fact.three_bet).toBe(true);
    expect(fact.three_bet_opportunity).toBe(true);
    expect(fact.four_bet_opportunity).toBe(false);
  });
  it('counts a limper facing an open, but not a cold player first facing a 3-bet', () => {
    const actions = [
      action('hero', 'call', 2),
      action('villain', 'raise', 6),
      action('hero', 'raise', 20),
      action('third', 'fold'),
    ];
    expect(measure(actions).daily.threeBetOpps).toBe(1);
    expect(measure(actions, 'third').daily.threeBetOpps).toBe(0);
    expect(measure(actions, 'third').fact.three_bet_opportunity).toBe(false);
  });
});
