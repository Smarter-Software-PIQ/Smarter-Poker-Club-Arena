/**
 * HIT AND RUN, THE CLUB'S CHOICE AND THE FIRST WORD (owner 2026-11-06).
 *
 *   - A club's owner, co-owner or admin can switch the hand count off for the
 *     cash games the club hosts, or choose 5, 10, 15 or 20 hands; the
 *     database decides who may (fn_set_club_hit_run) and this page only asks.
 *   - The hand a countdown starts, the player is told at once, so the count
 *     beside the seat is never a surprise; a count already running when the
 *     table opens is not announced again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { readdirSync, readFileSync } from 'node:fs';

const rpc = vi.fn();
const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
vi.mock('../src/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock('../src/components/common/Toast', () => ({ useToast: () => toast }));

import ClubHandCountPanel from '../src/components/club/ClubHandCountPanel';
import { useCountdownStarted } from '../src/hooks/useHeroHandCount';
import {
  clubHandCountRefusalText,
  bigWinStartedText,
  countdownStartedText,
  parseClubHandCountSetting,
  type HandCount,
} from '../src/lib/hitAndRun';

afterEach(cleanup);
beforeEach(() => {
  rpc.mockReset();
  Object.values(toast).forEach((f) => f.mockReset());
});
const read = (p: string) => readFileSync(p, 'utf8');

describe('the club chooses its hand count', () => {
  it('parses only an offered setting', () => {
    expect(parseClubHandCountSetting(null)).toBeNull();
    expect(parseClubHandCountSetting({ enabled: true, hands: 7 })).toBeNull();
    expect(parseClubHandCountSetting({ enabled: false, hands: 15, can_edit: true })).toEqual({
      enabled: false,
      hands: 15,
      canEdit: true,
    });
    expect(clubHandCountRefusalText('not_a_club_admin')).toBe(
      'Only A Club Owner, Co-Owner Or Admin Can Change This.'
    );
  });

  it('staff switch it off and choose a number through the database door', async () => {
    rpc.mockImplementation(async (fn: string) =>
      fn === 'fn_club_hit_run_setting'
        ? { data: { enabled: true, hands: 10, can_edit: true }, error: null }
        : { data: { ok: true }, error: null }
    );
    render(<ClubHandCountPanel clubId="club-1" />);
    await waitFor(() => expect(screen.getByTestId('club-hand-count-panel')).toBeTruthy());
    expect(screen.getByTestId('club-hand-count-panel').textContent).toContain(
      'Plays 10 Hands Before Leaving, Plus 10 More For Every Double Up'
    );
    fireEvent.change(screen.getByTestId('club-hand-count-hands'), { target: { value: '15' } });
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('fn_set_club_hit_run', {
        p_club_id: 'club-1',
        p_enabled: true,
        p_hands: 15,
      })
    );
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Hand Count Is On: 15 Hands Before Leaving')
    );
    fireEvent.click(screen.getByTestId('club-hand-count-switch'));
    await waitFor(() =>
      expect(rpc).toHaveBeenLastCalledWith('fn_set_club_hit_run', {
        p_club_id: 'club-1',
        p_enabled: false,
        p_hands: 15,
      })
    );
    await waitFor(() => expect(toast.success).toHaveBeenLastCalledWith('Hand Count Is Off'));
    expect(screen.getByTestId('club-hand-count-switch').getAttribute('aria-checked')).toBe('false');
  });

  it('a member sees the setting and cannot change it; a refusal changes nothing', async () => {
    rpc.mockResolvedValueOnce({ data: { enabled: true, hands: 5, can_edit: false }, error: null });
    render(<ClubHandCountPanel clubId="club-1" />);
    await waitFor(() => expect(screen.getByTestId('club-hand-count-panel')).toBeTruthy());
    expect((screen.getByTestId('club-hand-count-switch') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('club-hand-count-hands') as HTMLSelectElement).disabled).toBe(true);
    expect(screen.getByTestId('club-hand-count-panel').textContent).toContain(
      'Only A Club Owner, Co-Owner Or Admin Can Change This.'
    );
  });

  it('shows nothing to a reader the database refuses', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null });
    const { container } = render(<ClubHandCountPanel clubId="club-1" />);
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(container.innerHTML).toBe('');
  });

  it('is on the Club Settings page, and the database stores only what is offered', () => {
    expect(read('src/pages/ClubSettingsPage.tsx')).toContain(
      '<ClubHandCountPanel clubId={clubUUID} />'
    );
    const [file] = readdirSync('supabase/migrations').filter((f) =>
      f.endsWith('_clubs_choose_their_hand_count_before_leaving.sql')
    );
    const sql = read(`supabase/migrations/${file}`);
    expect(file > '20261106203853').toBe(true);
    expect(sql.split('\n')[0]).toBe('-- @install-window: daily-maintenance');
    expect(sql).toContain('CHECK (hit_run_hands IN (5, 10, 15, 20))');
    expect(sql).toContain('public.fn_ca_is_club_staff(p_club_id, auth.uid())');
    expect(sql).toContain("IF md5(s) IS DISTINCT FROM '554822ec475ed772a0b4065b2aabb096'");
  });
});

describe('the player is told when the countdown starts', () => {
  it('says the hands once, only for a countdown that starts while the table is open', () => {
    expect(countdownStartedText(10)).toBe('You Are In Profit. Play 10 Hands Before You Can Leave');
    expect(countdownStartedText(10)).not.toMatch(/[–—$]/);
    const onStart = vi.fn();
    const { rerender } = renderHook(
      ({ c, h }: { c: HandCount; h: number }) => useCountdownStarted(c, h, onStart),
      { initialProps: { c: { owed: 7, required: 10 } as HandCount, h: 40 } }
    );
    // A count already running when the page opened is not announced.
    rerender({ c: { owed: 6, required: 10 }, h: 41 });
    rerender({ c: { owed: null, required: null }, h: 42 });
    expect(onStart).not.toHaveBeenCalled();
    // A new countdown, started on a later hand, is.
    rerender({ c: { owed: 10, required: 10 }, h: 43 });
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledWith(10, undefined, undefined);
    rerender({ c: { owed: 9, required: 10 }, h: 44 });
    expect(onStart).toHaveBeenCalledTimes(1);
    // THE CHARLES RULE AFTER A LARGE WIN (owner 2026-11-11): the start says why.
    rerender({ c: { owed: null, required: null }, h: 45 });
    rerender({ c: { owed: 10, required: 10, reason: 'big_win', bigWinBb: 312.5 }, h: 46 });
    expect(onStart).toHaveBeenLastCalledWith(10, 'big_win', 312.5);
    expect(bigWinStartedText(10, 312.5)).toBe(
      'You Won 312.5 Big Blinds In One Hand. Play 10 Hands Before You Can Leave'
    );
    expect(bigWinStartedText(10, null)).not.toMatch(/[–—$]/);
  });

  it('TablePage toasts it', () => {
    const page = read('src/pages/TablePage.tsx').replace(/\s+/g, ' ');
    expect(page).toContain('useCountdownStarted(heroHandCount, tableState.handNumber ?? 0');
    expect(page).toContain(': countdownStartedText(hands)');
    expect(page).toContain('? bigWinStartedText(hands, bigWinBb)');
    expect(page).toContain('useBigWinRestarted(heroHandCount');
  });
});
