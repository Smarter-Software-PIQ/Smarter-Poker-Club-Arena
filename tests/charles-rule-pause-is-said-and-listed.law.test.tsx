/**
 * A PAUSED CHARLES RULE COUNTDOWN IS SAID AND LISTED (owner 2026-11-13/14).
 *
 * The countdown pauses out of profit and resumes where it stopped (pinned by
 * tests/the-charles-rule-countdown-resumes.law.test.ts; the table's paused
 * display and resume toast by tests/charles-rule-paused-display.test.tsx).
 * This pins the two pieces around them:
 *
 *   - the hand the profit is lost, the player is told the count is paused
 *     and that they may leave (never for a pause already standing at open);
 *   - Club Data lists paused players apart from the players who owe hands.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import { readFileSync } from 'node:fs';

vi.mock('../src/lib/supabase', () => ({ supabase: { rpc: vi.fn() } }));

import { parseClubHitRunRows } from '../src/pages/club/ClubHitRunPanel';
import { useCountdownPaused } from '../src/hooks/useHeroHandCount';
import { countdownPausedToastText, type HandCount } from '../src/lib/hitAndRun';

afterEach(cleanup);
const read = (p: string) => readFileSync(p, 'utf8');
const NONE: HandCount = { owed: null, required: null };

describe('the pause is said once', () => {
  it('names the hands left and that leaving is allowed, in Title Case', () => {
    expect(countdownPausedToastText(7)).toBe(
      'You Are Out Of Profit. Your Hand Count Is Paused At 7 Hands. You Can Leave Now'
    );
    expect(countdownPausedToastText(1)).toContain('Paused At 1 Hand.');
    expect(countdownPausedToastText(7)).not.toMatch(/[–—$]/);
  });

  it('fires when the count pauses during play, not again while it stays paused, not at open', () => {
    const onPause = vi.fn();
    const { rerender } = renderHook(
      ({ c, h }: { c: HandCount; h: number }) => useCountdownPaused(c, h, onPause),
      { initialProps: { c: NONE, h: 5 } }
    );
    rerender({ c: { owed: 7, required: 10, reason: 'hit_run' }, h: 6 });
    rerender({ c: NONE, h: 7 });
    expect(onPause).not.toHaveBeenCalled();
    rerender({ c: { ...NONE, paused: 7 }, h: 7 });
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(onPause).toHaveBeenLastCalledWith(7);
    rerender({ c: { ...NONE, paused: 7 }, h: 8 });
    expect(onPause).toHaveBeenCalledTimes(1);

    const atOpen = vi.fn();
    renderHook(() => useCountdownPaused({ ...NONE, paused: 4 }, 3, atOpen));
    expect(atOpen).not.toHaveBeenCalled();
  });

  it('is wired into the table', () => {
    const page = read('src/pages/TablePage.tsx').replace(/\s+/g, ' ');
    expect(page).toContain(
      'useCountdownPaused(heroHandCount, tableState.handNumber ?? 0, (hands) => toast.info(countdownPausedToastText(hands)) );'
    );
  });
});

describe('Club Data lists paused players apart from players who owe hands', () => {
  it('parses paused rows after the owing rows, and an older answer without them', () => {
    const owing = { user_id: 'a', username: 'A', hands_remaining: 4, hands_required: 10 };
    const paused = { user_id: 'b', username: 'B', hands_remaining: 7, hands_required: 10 };
    expect(parseClubHitRunRows({ rows: [owing], paused_rows: [paused] })).toMatchObject([
      { user_id: 'a', paused: false, hands_remaining: 4 },
      { user_id: 'b', paused: true, hands_remaining: 7, hands_required: 10, blind_off: false },
    ]);
    expect(parseClubHitRunRows({ rows: [owing] })).toMatchObject([{ user_id: 'a', paused: false }]);
  });

  it('the panel labels them Paused and counts them apart', () => {
    const panel = read('src/pages/club/ClubHitRunPanel.tsx');
    expect(panel).toContain("r.paused ? 'Paused'");
    expect(panel).toContain('`${pausedCount} Paused`');
  });

  it('the database returns them under their own key and leaves the owing rows as they were', () => {
    const sql = read('supabase/migrations/20261114072737_club_data_shows_paused_hand_counts.sql');
    expect(sql).toContain("'paused_rows', v_paused");
    expect(sql).toContain('AND ts.stack <= s.baseline');
    expect(sql).toContain('AND public.fn_cash_session_hands_owed(s, ts.stack) = 0');
    expect(sql).toContain("'contract', 'ca_club_hit_run_status.v1'");
    expect(sql).not.toMatch(/is_horse/);
  });
});
