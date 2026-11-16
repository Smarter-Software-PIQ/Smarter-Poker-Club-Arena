/**
 * LAW: A FIXED-LIMIT MENU OFFERS WHAT IT EXECUTES (2026-11-15).
 *
 * HandController.getAvailableActions says all_in is "advertised only where it
 * is a real shove". On fixed limit that was false (A2-CONTRACT-EXECUTED,
 * defects D3 and D4, run on the engine):
 *   - on a capped street, and for a deep stack that may not reopen against an
 *     incomplete all-in, the menu listed `all_in` although pressing it is
 *     executed and recorded as a CALL;
 *   - against an opponent who is all in, with nobody left who could answer,
 *     the menu listed `raise`, whose excess is only returned uncalled.
 *
 * The rule now, fixed limit only:
 *   - `all_in` is not listed where the press executes as a call or check;
 *   - `raise`/`bet` are not listed when every other live player is all in.
 * What each action EXECUTES is unchanged: the owner rule "the ALL IN click
 * counts as a CALL" still holds for a press the menu does not list (see
 * AnAllInPressCountsAsACall.law.test.ts), and a raise sent anyway is still
 * accepted with its excess returned. `all_in` stays listed where it is a wager
 * (a deep stack's one bet or raise) so an absent `all_in` always means a
 * passive press (HandFuzzer INV-ALLIN-IS-CALL). No-limit and pot-limit menus
 * are unchanged.
 */
import { describe, it, expect } from 'vitest';
import { HandController } from './HandController.js';
import type { HandConfig, SeatPlayer } from '../types.js';

function mkPlayers(stacks: number[]): SeatPlayer[] {
  return stacks.map(
    (stack, i) =>
      ({
        seat: i + 1,
        user_id: `u${i + 1}`,
        username: `P${i + 1}`,
        stack,
        bet: 0,
        totalInvested: 0,
        cards: [],
        is_folded: false,
        is_all_in: false,
        is_sitting_out: false,
      }) as SeatPlayer
  );
}

function hand(gameVariant: string, stacks: number[]) {
  const hc = new HandController(
    {
      tableId: 't-menu',
      handNumber: 1,
      gameVariant,
      smallBlind: 1,
      bigBlind: 2,
      rakeConfig: { percent: 0, cap: 0, noFlopNoDrop: true },
    } as HandConfig,
    mkPlayers(stacks),
    1
  );
  hc.start();
  const st = () => (hc as unknown as { state: any }).state;
  const seat = (n: number) => st().players.find((p: SeatPlayer) => p.seat === n);
  const chips = () => st().players.reduce((s: number, p: SeatPlayer) => s + p.stack, 0) + st().pot;
  return {
    hc,
    st,
    seat,
    chips,
    menu: (n: number) => hc.getAuthoritativeActionState(`u${n}`)!.legalActions,
    last: () => st().actionHistory[st().actionHistory.length - 1],
  };
}

describe('a fixed-limit menu offers what it executes', () => {
  it.each(['flh', 'flo8'])(
    '%s: a capped street lists fold and call only; an ALL IN press is still a call',
    (variant) => {
      // Three-handed: 1 = button, 2 = SB, 3 = BB.
      const h = hand(variant, [200, 200, 200]);
      expect(h.hc.performAction(1, 'raise', 4)).toBe(true);
      expect(h.hc.performAction(2, 'raise', 6)).toBe(true);
      expect(h.hc.performAction(3, 'raise', 8)).toBe(true);
      expect(h.hc.getAuthoritativeActionState('u1')!.wagersCapped).toBe(true);
      expect(h.menu(1)).toEqual(['fold', 'call']);

      const before = h.seat(1).stack;
      expect(h.hc.performAction(1, 'all_in')).toBe(true);
      expect(h.last()).toMatchObject({ seat: 1, action: 'call', amount: 4 });
      expect(h.seat(1).stack).toBe(before - 4);
    }
  );

  it('a deep stack that may not reopen against an incomplete all-in is offered fold and call', () => {
    // 1 = button, 2 = SB (4.5 chips), 3 = BB, 4 = UTG.
    const h = hand('flh', [200, 4.5, 200, 200]);
    expect(h.hc.performAction(4, 'raise', 4)).toBe(true);
    expect(h.hc.performAction(1, 'call')).toBe(true);
    // All in to 4.5: half a chip over 4, under half a bet, so it reopens nobody.
    expect(h.hc.performAction(2, 'all_in')).toBe(true);
    expect(h.hc.performAction(3, 'call')).toBe(true);
    expect(h.st().currentPlayerSeat).toBe(4);
    expect(h.menu(4)).toEqual(['fold', 'call']);

    const before = h.seat(4).stack;
    expect(h.hc.performAction(4, 'all_in')).toBe(true);
    expect(h.last()).toMatchObject({ seat: 4, action: 'call', amount: 0.5 });
    expect(h.seat(4).stack).toBeCloseTo(before - 0.5, 2);
  });

  it('all_in stays listed where it is a wager or a real shove', () => {
    // Deep and open: the press is one raise to the street's ceiling.
    const deep = hand('flh', [200, 200, 200]);
    expect(deep.menu(1)).toEqual(['fold', 'call', 'raise', 'all_in']);
    // Short: the whole stack (3) goes in, between the call and a full raise.
    const short = hand('flh', [3, 200, 200]);
    expect(short.menu(1)).toContain('all_in');
    expect(short.hc.performAction(1, 'all_in')).toBe(true);
    expect(short.last()).toMatchObject({ seat: 1, action: 'all_in' });
    expect(short.seat(1).stack).toBe(0);
  });

  it('heads-up against an all-in nobody can answer: no raise, and a raise sent anyway is unchanged', () => {
    // Heads-up: seat 1 is the button and posts the SB.
    const h = hand('flh', [1000, 5]);
    const before = h.chips();
    expect(h.hc.performAction(1, 'raise', 4)).toBe(true);
    // All in to 5: one over 4, exactly half a bet, so it counts and reopens.
    expect(h.hc.performAction(2, 'all_in')).toBe(true);
    expect(h.st().currentPlayerSeat).toBe(1);
    expect(h.menu(1)).not.toContain('raise');
    expect(h.menu(1)).toContain('call');
    expect(h.hc.getAuthoritativeActionState('u1')!.minRaiseTo).toBeNull();
    expect(h.hc.getAuthoritativeActionState('u1')!.maxRaiseTo).toBeNull();

    // Executed result unchanged: the raise to 7 is accepted and its excess
    // comes straight back, leaving one pot of 10.
    expect(h.hc.performAction(1, 'raise', 7)).toBe(true);
    expect(h.seat(1).totalInvested).toBe(5);
    expect(h.chips()).toBeCloseTo(before, 2);
  });

  it('three-handed: once both opponents are all in, the deep stack is not offered a raise', () => {
    // 1 = button (deep), 2 = SB (3 chips), 3 = BB (5 chips).
    const h = hand('flh', [1000, 3, 5]);
    expect(h.hc.performAction(1, 'raise', 4)).toBe(true);
    expect(h.hc.performAction(2, 'all_in')).toBe(true);
    expect(h.hc.performAction(3, 'all_in')).toBe(true);
    expect(h.st().currentPlayerSeat).toBe(1);
    expect(h.menu(1)).not.toContain('raise');
    expect(h.menu(1)).toContain('call');
  });

  it('no-limit is unchanged: a raise is offered against a full all-in nobody can answer', () => {
    const h = hand('nlh', [1000, 10]);
    expect(h.hc.performAction(1, 'raise', 4)).toBe(true);
    expect(h.hc.performAction(2, 'all_in')).toBe(true);
    expect(h.menu(1)).toEqual(['fold', 'call', 'raise', 'all_in']);
  });

  it('pot-limit is unchanged: a raise is offered against a full all-in nobody can answer', () => {
    const h = hand('plo4', [1000, 10]);
    expect(h.hc.performAction(1, 'raise', 4)).toBe(true);
    expect(h.hc.performAction(2, 'all_in')).toBe(true);
    expect(h.menu(1)).toContain('raise');
  });
});
