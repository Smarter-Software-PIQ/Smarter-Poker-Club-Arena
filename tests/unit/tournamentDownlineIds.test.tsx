/**
 * Tournament Ranking "Mine Only" reads ONE club, in ONE call.
 *
 * Dan 2026-11-06: "THE 'MINE ONLY' TAKES TOO LONG TO APPEAR ... KINGFISH SHOULD
 * ONLY BE SHOWN THE DOWNLINES INSIDE OF THE CLUB HES CURRENTLY INSIDE OF, (SAME
 * WITH AGENTS AND EVERYTHING ELSE) IT SHOULD ONLY SHOW THE CURRENT CLUBS
 * DOWNLINES THAT ARE STILL INSIDE THE CLUB."
 *
 * The slow version walked the whole union and pulled every staffed club's full
 * roster page by page (~16.6 s for KingFish). These pins keep it to the single
 * scoped reader, keyed on the club the viewer is inside.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), result: vi.fn(), report: vi.fn() }));
vi.mock('../../src/lib/supabase', () => ({ supabase: api }));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: api.report }));
import { useDownlineIds } from '../../src/components/tournament/details/useDownlineIds';

beforeEach(() => {
  vi.resetAllMocks();
  api.rpc.mockImplementation(() => ({ abortSignal: () => api.result() }));
  api.result.mockResolvedValue({ data: [], error: null });
});
afterEach(cleanup);

describe('tournament Mine Only reads the current club downline', () => {
  it('asks the scoped reader once, for the tournament and the club the viewer is inside', async () => {
    api.result.mockResolvedValue({
      data: ['direct', 'nested-player', 'nested-agent'],
      error: null,
    });
    const { result } = renderHook(() => useDownlineIds('viewer', 'event', 'kings'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect([...result.current.downlineIds]).toEqual(['direct', 'nested-player', 'nested-agent']);
    expect(result.current.carriesDownline).toBe(true);
    expect(api.rpc.mock.calls).toEqual([
      ['ca_tournament_my_downline_ids', { p_tournament_id: 'event', p_club_id: 'kings' }],
    ]);
    expect(api.from).not.toHaveBeenCalled();
  });

  it('never walks the union or pulls a full roster', async () => {
    const { result } = renderHook(() => useDownlineIds('viewer', 'event', 'kings'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const names = api.rpc.mock.calls.map(([name]) => name);
    expect(names).not.toContain('fn_club_scope_ids');
    expect(names).not.toContain('ca_club_members_overview');
    expect(names).not.toContain('ca_club_member_downline');
  });

  it('asks nothing when the viewer is not inside a club', async () => {
    const { result } = renderHook(() => useDownlineIds('viewer', 'event', null));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(api.rpc).not.toHaveBeenCalled();
    expect(result.current.carriesDownline).toBe(false);
  });

  it('never counts the viewer as their own downline', async () => {
    api.result.mockResolvedValue({ data: ['viewer', 'mine'], error: null });
    const { result } = renderHook(() => useDownlineIds('viewer', 'event', 'kings'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect([...result.current.downlineIds]).toEqual(['mine']);
  });

  it('a plain player (empty answer) carries no downline and shows no Mine Only', async () => {
    const { result } = renderHook(() => useDownlineIds('viewer', 'event', 'kings'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.carriesDownline).toBe(false);
    expect(result.current.downlineIds.size).toBe(0);
  });

  it('refuses a failed or malformed answer instead of claiming one', async () => {
    api.result.mockResolvedValueOnce({ data: null, error: new Error('refused') });
    const { result, rerender } = renderHook(({ club }) => useDownlineIds('viewer', 'event', club), {
      initialProps: { club: 'a' },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.carriesDownline).toBe(false);
    expect(api.report).toHaveBeenCalledTimes(1);
    api.result.mockResolvedValueOnce({ data: ['ok', 42], error: null });
    rerender({ club: 'b' });
    await waitFor(() => expect(api.report).toHaveBeenCalledTimes(2));
    expect(result.current.downlineIds.size).toBe(0);
  });

  it('clears the previous club and ignores its late answer after switching clubs', async () => {
    let resolveOld!: (value: unknown) => void;
    api.result
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolveOld = r;
          })
      )
      .mockResolvedValue({ data: ['felt-player'], error: null });
    const { result, rerender } = renderHook(({ club }) => useDownlineIds('viewer', 'event', club), {
      initialProps: { club: 'kings' },
    });
    await waitFor(() => expect(api.result).toHaveBeenCalledTimes(1));
    rerender({ club: 'felt' });
    await waitFor(() => expect(result.current.downlineIds.has('felt-player')).toBe(true));
    await act(async () => resolveOld({ data: ['kings-player'], error: null }));
    expect([...result.current.downlineIds]).toEqual(['felt-player']);
  });
});

describe('the Ranking tab passes the club the viewer is inside', () => {
  const tab = readFileSync(
    resolve(__dirname, '../../src/components/tournament/details/RankingTab.tsx'),
    'utf8'
  );
  it('keys Mine Only on the route club, else the entered club - never the union', () => {
    expect(tab).toMatch(/useParams<\{ clubId\?: string \}>\(\)\.clubId/);
    expect(tab).toMatch(/useUserStore\(\(s\) => s\.currentClubId\)/);
    expect(tab).toMatch(
      /useDownlineIds\(\s*currentUserId,\s*tournament\?\.id,\s*routeClubId \|\| enteredClubId\s*\)/
    );
    expect(tab).not.toMatch(/useDownlineIds\([^)]*union_id/);
  });
});

describe('the server reader stays scoped to one club and members still in it', () => {
  const sql = readFileSync(
    resolve(
      __dirname,
      '../../supabase/migrations/20261107032055_tournament_ranking_mine_only_reads_the_current_club_downline.sql'
    ),
    'utf8'
  );
  it('requires the club to be in the tournament scope and the viewer to be in the club', () => {
    expect(sql).toMatch(
      /p_club_id = ANY \(public\.fn_club_scope_ids\(coalesce\(t\.union_id, t\.club_id\)\)\)/
    );
    expect(sql).toMatch(
      /cm\.user_id = auth\.uid\(\)\s+AND cm\.membership_lifecycle_status = 'active'/
    );
  });
  it('returns only active members of that one club, never deleted profiles or the viewer', () => {
    expect(sql).toMatch(
      /ON cm\.club_id = p_club_id\s+AND cm\.user_id = c\.uid\s+AND cm\.membership_lifecycle_status = 'active'/
    );
    expect(sql).toMatch(/pr\.status IS DISTINCT FROM 'deleted'/);
    expect(sql).toMatch(/c\.uid <> auth\.uid\(\)/);
  });
  it('staff see the club; agent tiers see their subtree; players see nothing', () => {
    expect(sql).toMatch(/v\.rk >= 80 AND cm\.club_id = p_club_id/);
    expect(sql).toMatch(/v\.rk BETWEEN 20 AND 79/);
  });
});
