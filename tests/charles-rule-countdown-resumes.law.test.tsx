/**
 * THE CHARLES RULE COUNTDOWN RESUMES WHERE IT LEFT OFF (owner 2026-11-13).
 *
 *   "IF YOU GO INTO PROFIT, AND YOUR 10 HANDS STARTS... THEN YOU FALL BELOW
 *    PROFIT AT LETS SAY THE 7 HANDS LEFT MARK... BUT THEN GO BACK INTO PROFIT.
 *    IT NEEDS TO PICK BACK UP WHERE YOU LEFT OFF AT THE 7 HANDS, NOT RESTART
 *    THE 10 BACK OVER."  And: "KEEP THE DOUBLING BASELINE FROM BEFORE THE
 *    PAUSE."
 *
 * Pins, so no later change can quietly bring the restart back:
 *
 *   - the newest image of fn_cash_session_evaluate pauses on lost profit and
 *     never clears the hands played, the hands added, the doubles or the
 *     doubling reference there;
 *   - the player is told when the count pauses and when it resumes, and sees
 *     the paused count beside the seat and between Lightning hands;
 *   - Club Data lists paused players apart from the players who owe hands.
 *
 * The state machine itself runs on real PostgreSQL in
 * tests/unit/charlesRuleBigWin.pg.test.ts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, renderHook, screen } from '@testing-library/react';
import { readFileSync, readdirSync } from 'node:fs';

vi.mock('../src/lib/supabase', () => ({ supabase: { rpc: vi.fn() } }));

import HitRunCountPill from '../src/components/table/HitRunCountPill';
import { parseClubHitRunRows } from '../src/pages/club/ClubHitRunPanel';
import { useCountdownPauseResume } from '../src/hooks/useHeroHandCount';
import {
  HIT_RUN_PAUSED_LABEL,
  HIT_RUN_PAUSED_NOTE,
  countdownPausedText,
  countdownResumedText,
  pausedHandsOf,
  type HandCount,
} from '../src/lib/hitAndRun';

afterEach(cleanup);
const read = (p: string) => readFileSync(p, 'utf8');
const NONE: HandCount = { owed: null, required: null };

describe('the database pauses the countdown, it never restarts it', () => {
  const dir = 'supabase/migrations';
  const newest = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .reverse()
    .find((f) =>
      read(`${dir}/${f}`).includes(
        'CREATE OR REPLACE FUNCTION public.fn_cash_session_evaluate(p_table_id uuid, p_entries jsonb)'
      )
    );
  const sql = read(`${dir}/${newest}`);
  const body = sql.slice(
    sql.indexOf('CREATE OR REPLACE FUNCTION public.fn_cash_session_evaluate(')
  );
  const lost = body.slice(
    body.indexOf('ELSIF v_stack <= v_s.baseline THEN'),
    body.indexOf('v_played := v_played + 1;')
  );

  it('the newest image is the resume migration or a later one', () => {
    expect(newest && newest >= '20261114050737').toBe(true);
  });

  it('losing the profit clears only the start stamp', () => {
    expect(lost).toContain('ELSIF v_stack <= v_s.baseline THEN');
    const pause = lost.slice(0, lost.indexOf('ELSIF v_started IS NULL THEN'));
    const code = pause.replace(/--.*$/gm, '');
    expect(code).toContain('v_started := NULL;');
    for (const kept of ['v_req :=', 'v_played :=', 'v_dbl :=', 'v_ref :='])
      expect(code).not.toContain(kept);
  });

  it('coming back resumes without counting the returning hand or moving the doubling reference', () => {
    const back = lost.slice(lost.indexOf('ELSIF v_started IS NULL THEN')).replace(/--.*$/gm, '');
    expect(back).toContain('v_started := v_now;');
    for (const kept of ['v_req :=', 'v_played :=', 'v_dbl :=', 'v_ref :='])
      expect(back).not.toContain(kept);
  });
});

describe('the player is told, and sees the paused count', () => {
  it('reads a paused countdown from the status row, and nothing else as paused', () => {
    const row = { hands_remaining: 0, hands_required: 10, hands_played: 3, completed: false };
    expect(pausedHandsOf(row)).toEqual({ left: 7, total: 10 });
    expect(pausedHandsOf({ ...row, hands_required: 20, hands_played: 2 })).toEqual({
      left: 18,
      total: 20,
    });
    expect(pausedHandsOf({ ...row, hands_remaining: 7 })).toBeNull(); // owed, not paused
    expect(pausedHandsOf({ ...row, completed: true, hands_played: 10 })).toBeNull();
    expect(pausedHandsOf({ ...row, hands_required: 0, hands_played: 0 })).toBeNull();
    expect(pausedHandsOf({ ...row, completed: undefined })).toBeNull(); // unreadable
  });

  it('says both in Title Case with no em dash and no dollar sign', () => {
    expect(countdownPausedText(7)).toBe(
      'You Are Out Of Profit. Your Hand Count Is Paused At 7 Hands. You Can Leave Now'
    );
    expect(countdownResumedText(7)).toBe(
      'You Are Back In Profit. 7 Hands Left Before You Can Leave'
    );
    expect(countdownResumedText(1)).toBe(
      'You Are Back In Profit. 1 Hand Left Before You Can Leave'
    );
    for (const text of [
      countdownPausedText(7),
      countdownResumedText(7),
      HIT_RUN_PAUSED_LABEL,
      HIT_RUN_PAUSED_NOTE,
    ])
      expect(text).not.toMatch(/[–—$]/);
  });

  it('announces a pause and the resume once each, never a pause already standing at open', () => {
    const onPause = vi.fn();
    const onResume = vi.fn();
    const { rerender } = renderHook(
      ({ c, h }: { c: HandCount; h: number }) => useCountdownPauseResume(c, h, onPause, onResume),
      { initialProps: { c: NONE, h: 5 } }
    );
    rerender({ c: { owed: 8, required: 10, reason: 'hit_run' }, h: 6 });
    rerender({ c: { owed: 7, required: 10, reason: 'hit_run' }, h: 7 });
    rerender({ c: NONE, h: 8 }); // the engine owes nothing; the database read is pending
    expect(onPause).not.toHaveBeenCalled();
    rerender({ c: { owed: null, required: null, paused: 7, pausedRequired: 10 }, h: 8 });
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(onPause).toHaveBeenLastCalledWith(7);
    rerender({ c: { owed: null, required: null, paused: 7, pausedRequired: 10 }, h: 9 });
    expect(onPause).toHaveBeenCalledTimes(1);
    rerender({ c: { owed: 7, required: 10, reason: 'hit_run' }, h: 10 });
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(onResume).toHaveBeenLastCalledWith(7);
    rerender({ c: { owed: 6, required: 10, reason: 'hit_run' }, h: 11 });
    expect(onResume).toHaveBeenCalledTimes(1);

    const again = vi.fn();
    renderHook(() =>
      useCountdownPauseResume(
        { owed: null, required: null, paused: 4, pausedRequired: 10 },
        3,
        again,
        vi.fn()
      )
    );
    expect(again).not.toHaveBeenCalled();
  });

  it('shows the paused count in the pill, apart from the owed count', () => {
    render(<HitRunCountPill hands={7} paused />);
    const pill = screen.getByTestId('hit-run-paused-pill');
    expect(pill).toHaveTextContent(HIT_RUN_PAUSED_LABEL);
    expect(pill).toHaveTextContent('7');
    expect(pill).toHaveTextContent(HIT_RUN_PAUSED_NOTE);
    expect(screen.queryByTestId('hit-run-count-pill')).toBeNull();
  });

  it('is wired into the table: toasts, the seat tracker and the Lightning pill', () => {
    const page = read('src/pages/TablePage.tsx').replace(/\s+/g, ' ');
    expect(page).toContain('useCountdownPauseResume( heroHandCount,');
    expect(page).toContain('toast.info(countdownPausedText(hands))');
    expect(page).toContain('toast.info(countdownResumedText(hands))');
    expect(page).toContain('handsPaused={heroHandCount.paused ?? null}');
    expect(page).toContain('<HitRunCountPill hands={heroHandCount.paused ?? null} paused />');
    const tracker = read('src/components/table/HeroVpipTracker.tsx');
    expect(tracker).toContain('data-testid="hero-hand-count-paused"');
    expect(tracker).toContain('const showPaused = !showHands &&');
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

  it('the database returns them under their own key and leaves the owing rows as they were', () => {
    const sql = read('supabase/migrations/20261114072737_club_data_shows_paused_hand_counts.sql');
    expect(sql).toContain("'paused_rows', v_paused");
    expect(sql).toContain('AND ts.stack <= s.baseline');
    expect(sql).toContain('AND public.fn_cash_session_hands_owed(s, ts.stack) = 0');
    expect(sql).toContain("'contract', 'ca_club_hit_run_status.v1'");
    expect(sql).not.toMatch(/is_horse/);
  });
});
