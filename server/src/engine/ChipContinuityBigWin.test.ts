import { describe, expect, it, vi } from 'vitest';
import {
  ChipContinuityTracker,
  bigWinHandsRemaining,
  countdownHandsRemaining,
  handsOwedReason,
  hitRunHandsRemaining,
} from './ChipContinuity.js';
import type { CashSessionRow } from '../services/supabase/cashSessions.js';

/**
 * THE CHARLES RULE AFTER A LARGE WIN (owner 2026-11-11), as the engine reads
 * it: one predicate (the larger of the two obligations) behind the leave
 * door, the sit-out hold, the blind off and the seat's count, and an empty
 * mirror after an engine replacement is never read as "nothing owed".
 */
const row = (over: Partial<CashSessionRow> = {}): CashSessionRow => ({
  user_id: 'p',
  baseline: 100,
  stack: 0,
  stay_remaining_ms: 0,
  stay_running: false,
  stay_last_tick_at: '',
  stay_clock_ms: 600000,
  leave_locked: false,
  hands_required: 0,
  hands_played: 0,
  hands_remaining: 0,
  hit_run_doubles: 0,
  hit_run_completed: false,
  blind_off: false,
  ...over,
});

describe('one predicate for every hand owed', () => {
  it('owes the larger obligation and never lets one clear the other', () => {
    const both = row({
      hands_required: 10,
      hands_played: 7,
      big_win_required: 10,
      big_win_played: 0,
    });
    expect(countdownHandsRemaining(both, 300)).toBe(3);
    expect(bigWinHandsRemaining(both, 300)).toBe(10);
    expect(hitRunHandsRemaining(both, 300)).toBe(10);
    expect(handsOwedReason(both, 300)).toBe('both');
    // Profit gone: the countdown lapses, the big-win ten still stands while chips remain.
    expect(hitRunHandsRemaining(both, 90)).toBe(10);
    expect(handsOwedReason(both, 90)).toBe('big_win');
    // A completed countdown does not complete the big-win count, nor the reverse.
    const done = row({
      hands_required: 10,
      hands_played: 10,
      hit_run_completed: true,
      big_win_required: 10,
      big_win_played: 4,
    });
    expect(hitRunHandsRemaining(done, 300)).toBe(6);
    const doubles = row({
      hands_required: 20,
      hands_played: 12,
      big_win_required: 10,
      big_win_played: 10,
    });
    expect(hitRunHandsRemaining(doubles, 300)).toBe(8);
    expect(handsOwedReason(doubles, 300)).toBe('hit_run');
  });

  it('owes nothing at a stack of zero, and nothing to a database without the rule', () => {
    expect(hitRunHandsRemaining(row({ big_win_required: 10, big_win_played: 0 }), 0)).toBe(0);
    expect(hitRunHandsRemaining(row(), 500)).toBe(0);
  });
});

describe('the tracker', () => {
  const make = (evaluate: any) =>
    new ChipContinuityTracker({
      tableId: 't1',
      isCash: () => true,
      isFrozen: () => false,
      evaluate,
      report: vi.fn(),
    });

  it('locks the leave and shows the count, its total and why, after a +250 BB win', async () => {
    const t = make(
      vi.fn(async () => [
        row({
          user_id: 'p',
          big_win_required: 10,
          big_win_played: 2,
          hands_reason: 'big_win',
          big_win_bb_won: 312.5,
        }),
      ])
    );
    await t.evaluate([{ user_id: 'p', stack: 400, active: true, hand_id: 'h' }]);
    expect(t.leaveLock('p', 400)).toMatchObject({ locked: true, handsRemaining: 8 });
    expect(t.seatFields('p', 400)).toMatchObject({
      leave_locked: true,
      hit_run_hands_remaining: 8,
      hit_run_hands_required: 10,
      hit_run_reason: 'big_win',
      hit_run_big_win_bb: 312.5,
    });
  });

  it('after an engine replacement, one evaluation of a seat fills the mirror the exit reads', async (..._args: unknown[]) => {
    const evaluate = vi.fn(async (..._args: unknown[]) => [
      row({ user_id: 'p', big_win_required: 10, big_win_played: 0 }),
    ]);
    const t = make(evaluate);
    expect(t.row('p')).toBeUndefined(); // empty mirror: not an answer
    await t.evaluate([{ user_id: 'p', active: false }]);
    expect(evaluate.mock.calls[0][1]).toEqual([{ user_id: 'p', active: false }]); // no hand counted
    expect(t.leaveLock('p', 400)).toMatchObject({ locked: true, handsRemaining: 10 });
  });
});
