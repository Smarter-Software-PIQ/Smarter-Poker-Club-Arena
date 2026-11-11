/**
 * HIT AND RUN, THE POLISH (owner 2026-11-06, "FULLY BUILD, FIX AND ENHANCE
 * ALL OF THESE"). Pins the follow-up pieces around the ten-hand count:
 *
 *   - the Charles Rule is announced when a double adds hands;
 *   - every leave door asks ONE question when hands are owed;
 *   - the tab X asks on its own table, not behind the lobby;
 *   - the count shows between Lightning hands;
 *   - the confirmation renders over everything (a portal on <body>);
 *   - Club Data shows owners and agents who owes hands;
 *   - the bomb settings page is fixed at one bomb pot every 30 minutes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';

const rpc = vi.fn();
vi.mock('../src/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import HitRunLeaveConfirm from '../src/components/table/HitRunLeaveConfirm';
import HitRunCountPill from '../src/components/table/HitRunCountPill';
import ClubHitRunPanel, { parseClubHitRunRows } from '../src/pages/club/ClubHitRunPanel';
import { useHandsAddedByDouble } from '../src/hooks/useHeroHandCount';
import {
  charlesRuleText,
  handsOwedAt,
  noteHandsOwedAt,
  HIT_RUN_COUNT_LABEL,
  type HandCount,
} from '../src/lib/hitAndRun';
import { mapEngineSnapshot } from '../src/utils/mapEngineSnapshot';

afterEach(cleanup);
const read = (p: string) => readFileSync(p, 'utf8');
const flat = (p: string) => read(p).replace(/\s+/g, ' ');

describe('the Charles Rule is announced', () => {
  it('says how many hands the double added', () => {
    expect(charlesRuleText(10)).toBe('You Doubled Up. 10 Hands Added Before You Can Leave');
    expect(charlesRuleText(1)).toBe('You Doubled Up. 1 Hand Added Before You Can Leave');
    expect(charlesRuleText(10)).not.toMatch(/[–—$]/);
  });

  it('fires once per increase of the countdown total, never on the first read or a count down', () => {
    const onAdded = vi.fn();
    const { rerender } = renderHook(
      ({ c }: { c: HandCount }) => useHandsAddedByDouble(c, onAdded),
      {
        initialProps: { c: { owed: null, required: null } as HandCount },
      }
    );
    rerender({ c: { owed: 10, required: 10 } });
    rerender({ c: { owed: 9, required: 10 } });
    expect(onAdded).not.toHaveBeenCalled();
    rerender({ c: { owed: 19, required: 20 } });
    expect(onAdded).toHaveBeenCalledTimes(1);
    expect(onAdded).toHaveBeenLastCalledWith(10);
    rerender({ c: { owed: 18, required: 20 } });
    expect(onAdded).toHaveBeenCalledTimes(1);
    rerender({ c: { owed: null, required: null } });
    rerender({ c: { owed: 10, required: 10 } });
    expect(onAdded).toHaveBeenCalledTimes(1);
  });

  it('TablePage toasts it', () => {
    const page = flat('src/pages/TablePage.tsx');
    expect(page).toContain('useHandsAddedByDouble(heroHandCount');
    expect(page).toContain('toast.info(charlesRuleText(added))');
  });

  it('the engine seat payload carries the countdown total', () => {
    const mapped = mapEngineSnapshot(
      {
        table_id: 't',
        hand_number: 3,
        pot: 0,
        community_cards: [],
        stage: 'preflop',
        dealer_seat: 1,
        current_player: null,
        players: [
          {
            seat: 1,
            user_id: 'hero',
            stack: 600,
            hit_run_hands_remaining: 14,
            hit_run_hands_required: 20,
          },
        ],
      } as never,
      'hero',
      9
    );
    expect(mapped.heroHandsOwed).toBe(14);
    expect(mapped.heroHandsRequired).toBe(20);
  });
});

describe('one question per leave', () => {
  it('every Leave Table door goes through openLeaveConfirm', () => {
    const page = read('src/pages/TablePage.tsx');
    expect(page).toContain('const openLeaveConfirm = () => {');
    expect((page.match(/openLeaveConfirm\(\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
    // The generic dialog is opened only from inside openLeaveConfirm.
    expect((page.match(/setShowLeaveConfirm\(true\)/g) ?? []).length).toBe(1);
    const body = page.slice(page.indexOf('const openLeaveConfirm = () => {'));
    const fn = body.slice(0, body.indexOf('\n  };') + 4);
    expect(fn).toContain('setHitRunConfirmHands(owed)');
    expect(fn.indexOf('return;')).toBeLessThan(fn.indexOf('setShowLeaveConfirm(true)'));
  });
});

describe('the tab X asks on its own table', () => {
  beforeEach(() => noteHandsOwedAt('t-x', null));
  it('remembers hands owed per table', () => {
    expect(handsOwedAt('t-x')).toBeNull();
    noteHandsOwedAt('t-x', 4);
    expect(handsOwedAt('t-x')).toBe(4);
    noteHandsOwedAt('t-x', 0);
    expect(handsOwedAt('t-x')).toBeNull();
  });
  it('MultiTablePage brings the table forward instead of the lobby when hands are owed', () => {
    const mt = read('src/pages/MultiTablePage.tsx');
    const i = mt.indexOf('if (handsOwedAt(tabId) !== null) {');
    expect(i).toBeGreaterThan(0);
    // The owed branch runs before the last-table lobby branch, and ends at it.
    const end = mt.indexOf('if (remaining.length === 0) {', i);
    expect(end).toBeGreaterThan(i);
    const block = mt.slice(i, end);
    expect(block).toContain('setActiveIndex(idx)');
    expect(block).toContain("action: 'FORCE_LEAVE_TABLE'");
    expect(block).toContain('break;');
    expect(read('src/pages/TablePage.tsx')).toContain('noteHandsOwedAt(');
  });
});

describe('the count between Lightning hands', () => {
  it('shows the count, and nothing when none is owed', () => {
    const { rerender } = render(<HitRunCountPill hands={6} />);
    const pill = screen.getByTestId('hit-run-count-pill');
    expect(pill.textContent).toBe(`${HIT_RUN_COUNT_LABEL}6`);
    expect(pill.getAttribute('role')).toBe('status');
    rerender(<HitRunCountPill hands={0} />);
    expect(screen.queryByTestId('hit-run-count-pill')).toBeNull();
    rerender(<HitRunCountPill hands={null} />);
    expect(screen.queryByTestId('hit-run-count-pill')).toBeNull();
  });
  it('TablePage renders it only for a seatless Lightning hero at a cash table', () => {
    const page = flat('src/pages/TablePage.tsx');
    expect(page).toMatch(
      /<HitRunCountPill hands=\{heroHandsOwed\} reason=\{heroHandCount\.reason \?\? null\} \/>/
    );
    const css = read('src/components/table/HitRunCountPill.css')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .toLowerCase();
    expect(css).not.toMatch(/yellow|#ff0\b|#ffff00|#ffd700|#f5c518/);
  });
});

describe('the confirmation renders over everything', () => {
  it('is portalled to <body>', () => {
    const { container } = render(
      <div id="felt">
        <HitRunLeaveConfirm handsRemaining={3} onStay={() => {}} onLeave={() => {}} />
      </div>
    );
    const dialog = screen.getByTestId('hit-run-confirm');
    expect(container.contains(dialog)).toBe(false);
    expect(dialog.closest('#felt')).toBeNull();
    expect(document.body.contains(dialog)).toBe(true);
  });
});

describe('Club Data shows who owes hands', () => {
  beforeEach(() => rpc.mockReset());

  it('parses the contract and drops malformed rows', () => {
    expect(parseClubHitRunRows(null)).toBeNull();
    expect(parseClubHitRunRows({})).toBeNull();
    const rows = parseClubHitRunRows({
      rows: [
        {
          user_id: 'u1',
          username: 'Charles',
          table_id: 't1',
          table_name: 'Main',
          stakes: '1/2',
          hands_remaining: 14,
          hands_required: 20,
          blind_off: false,
        },
        { user_id: 'u2', hands_remaining: 0 },
        { hands_remaining: 3 },
        { user_id: 'u3', hands_remaining: 2, hands_required: 1, blind_off: true },
      ],
    });
    expect(rows).toHaveLength(2);
    expect(rows![0]).toMatchObject({
      username: 'Charles',
      hands_remaining: 14,
      hands_required: 20,
    });
    expect(rows![1]).toMatchObject({ username: 'Player', hands_required: 2, blind_off: true });
  });

  it('renders the rows the database returns for this club', async () => {
    rpc.mockResolvedValue({
      data: {
        contract: 'ca_club_hit_run_status.v1',
        rows: [
          {
            user_id: 'u1',
            username: 'Charles',
            table_id: 't1',
            table_name: 'Main',
            stakes: '1/2',
            hands_remaining: 14,
            hands_required: 20,
            blind_off: false,
          },
          {
            user_id: 'u2',
            username: 'Ann',
            table_id: 't2',
            table_name: 'Side',
            stakes: '2/5',
            hands_remaining: 3,
            hands_required: 10,
            blind_off: true,
          },
        ],
      },
      error: null,
    });
    render(<ClubHitRunPanel clubId="club-1" />);
    await waitFor(() => expect(screen.getByTestId('club-hit-run-panel')).toBeTruthy());
    expect(rpc).toHaveBeenCalledWith('ca_club_hit_run_status', { p_club_id: 'club-1' });
    const panel = screen.getByTestId('club-hit-run-panel');
    expect(panel.textContent).toContain('Charles');
    expect(panel.textContent).toContain('14 Of 20');
    expect(panel.textContent).toContain('Blinded Off');
    expect(panel.textContent).toContain('2 Owing');
    expect(panel.textContent).not.toMatch(/[–—$]/);
  });

  it('shows nothing when refused, and Clear when nobody owes', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'not authorized' } });
    const { container, unmount } = render(<ClubHitRunPanel clubId="club-1" />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.innerHTML).toBe('');
    unmount();
    rpc.mockResolvedValue({ data: { rows: [] }, error: null });
    render(<ClubHitRunPanel clubId="club-1" />);
    await waitFor(() => expect(screen.getByTestId('club-hit-run-panel')).toBeTruthy());
    expect(screen.getByTestId('club-hit-run-panel').textContent).toContain(
      'No Player Owes Hands Right Now.'
    );
  });

  it('is on the Club Data page and its database read is scoped and installed after the count', () => {
    expect(read('src/pages/club/ClubDataPage.tsx')).toContain('<ClubHitRunPanel clubId={clubUuid}');
    const sql = read(
      'supabase/migrations/20261107020241_club_data_shows_hit_and_run_countdowns.sql'
    );
    expect(sql.split('\n')[0]).toBe('-- @install-window: daily-maintenance');
    expect(sql).toContain('public.fn_ca_club_data_scope(p_club_id)');
    expect(sql).toContain("ERRCODE = '42501'");
    expect(sql).toContain('public.fn_ca_club_data_downline(p_club_id, auth.uid())');
    expect(sql).toContain("coalesce(pr.status, '') <> 'deleted'");
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.ca_club_hit_run_status\(uuid\) FROM PUBLIC, anon;/
    );
    expect('20261107020241' > '20261106203853').toBe(true);
  });
});

describe('the bomb settings page runs every 30 minutes', () => {
  it('shows the interval as fixed and saves 30 minutes', () => {
    const page = read('src/pages/club/TableBombSettingsPage.tsx');
    expect(page).toContain('const BOMB_POT_INTERVAL_MINUTES = 30;');
    expect(page).toContain('bomb_pot_interval_seconds: BOMB_POT_INTERVAL_MINUTES * 60');
    expect(page).toContain('data-testid="bomb-interval-fixed"');
  });
  it('the database stores 1800 seconds for a timed bomb pot whatever is sent', () => {
    const sql = read(
      'supabase/migrations/20261107015928_table_bomb_settings_run_every_thirty_minutes.sql'
    );
    expect(sql).toContain('3c567927ae19f379e9903458154b15ba');
    expect(sql).toContain('1800');
    expect(sql.split('\n')[0]).not.toContain('@install-window');
  });
});
