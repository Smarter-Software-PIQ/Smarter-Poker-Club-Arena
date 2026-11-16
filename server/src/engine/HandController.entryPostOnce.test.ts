/**
 * ONE ENTRY CHARGE PER SEAT (hand #59634000, NLH 0.50/1 Classic, 2026-11-15).
 *
 * A new player was listed under both deadBlinds and bbOnlyPosts. He was billed
 * a dead small blind, a live big blind, and then a second big blind that was
 * not counted toward his bet: 2.50 out of his stack with 1.00 live. Facing a
 * raise to 4 he called 3 more and was in for 5.50.
 */
import { describe, it, expect } from 'vitest';
import { HandController } from './HandController.js';
import type { HandConfig, SeatPlayer } from '../types.js';

function players(n: number, stack: number): SeatPlayer[] {
  return Array.from(
    { length: n },
    (_, i) =>
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

function start(over: Partial<HandConfig>) {
  const cfg = {
    tableId: 't-entry',
    handNumber: 1,
    gameVariant: 'nlh',
    smallBlind: 0.5,
    bigBlind: 1,
    rakeConfig: { percent: 10, cap: 2.5, noFlopNoDrop: true },
    ...over,
  } as HandConfig;
  // Button seat 5: small blind 6, big blind 7, seat 4 is the cutoff.
  const hc = new HandController(cfg, players(9, 200), 5);
  hc.start();
  const state = (hc as unknown as { state: { players: SeatPlayer[]; pot: number } }).state;
  const seat4 = state.players.find((p) => p.seat === 4)!;
  return { state, seat4 };
}

describe('a seat is billed one entry charge, never two', () => {
  it('post-to-enter alone costs exactly one live big blind', () => {
    const { seat4, state } = start({ bbOnlyPosts: [{ seat: 4 }] });
    expect(seat4.stack).toBe(199);
    expect(seat4.bet).toBe(1);
    expect(seat4.totalInvested).toBe(1);
    expect(state.pot).toBe(2.5);
  });

  it('a seat listed as both dead-blind and post-to-enter is not billed a second big blind', () => {
    const { seat4, state } = start({ deadBlinds: [{ seat: 4 }], bbOnlyPosts: [{ seat: 4 }] });
    expect(seat4.stack).toBe(198.5);
    expect(seat4.bet).toBe(1);
    expect(seat4.totalInvested).toBe(1.5);
    // Every chip that left the stack is either the live bet or declared dead.
    expect(seat4.totalInvested - (seat4.deadInvested ?? 0)).toBe(seat4.bet);
    expect(state.pot).toBe(3);
  });
});
