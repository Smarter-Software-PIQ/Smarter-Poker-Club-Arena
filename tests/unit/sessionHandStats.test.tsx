import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  listeners: new Map<string, Set<(event: { payload: unknown }) => void>>(),
  reportError: vi.fn(),
  lightning: false,
}));
vi.mock('../../src/lightning/lightningSession', () => ({
  getLightningPoolSession: () => (mocks.lightning ? { poolSessionId: 'lightning' } : null),
}));
vi.mock('../../src/lib/supabase', () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: mocks.reportError }));
vi.mock('../../src/core/MasterBus', () => ({
  masterBus: {
    subscribe: (name: string, callback: (event: { payload: unknown }) => void) => {
      const set = mocks.listeners.get(name) ?? new Set();
      set.add(callback);
      mocks.listeners.set(name, set);
      return () => set.delete(callback);
    },
  },
}));
import { parseSessionHandStats, useSessionHandStats } from '../../src/hooks/useSessionHandStats';
const row = (hands = 56) => ({
  hands_played: hands,
  hands_won: 20,
  vpip_percent: 46.4,
  pfr_percent: 33.9,
  started_at: '2026-11-01T01:25:37Z',
});
const emit = (name: string, payload: unknown) =>
  act(() => mocks.listeners.get(name)?.forEach((cb) => cb({ payload })));
const deferred = () => {
  let resolve!: (v: unknown) => void;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.lightning = false;
  mocks.reportError.mockReset();
  mocks.listeners.clear();
});
describe('full persisted session hand statistics', () => {
  it('validates truthful zero, incomplete facts and malformed results', () => {
    expect(parseSessionHandStats(row(0))?.handsPlayed).toBe(0);
    expect(
      parseSessionHandStats({ ...row(), hands_won: null, vpip_percent: null, pfr_percent: null })
        ?.vpipPercent
    ).toBeNull();
    for (const value of [
      null,
      {},
      { ...row(), hands_played: -1 },
      { ...row(), hands_played: '17' },
      { ...row(), vpip_percent: 101 },
      { ...row(), started_at: 'invalid' },
    ])
      expect(parseSessionHandStats(value)).toBeNull();
  });
  it('hydrates 56 hands without a browser baseline and reads final settlement without a successor', async () => {
    mocks.rpc.mockResolvedValue({ data: row(), error: null });
    const hook = renderHook(() => useSessionHandStats('table-a', 'player', true));
    await waitFor(() => expect(hook.result.current.stats?.handsPlayed).toBe(56));
    expect(mocks.rpc).toHaveBeenCalledWith('fn_my_game_session_hand_stats', {
      p_table_id: 'table-a',
    });
    mocks.rpc.mockResolvedValue({ data: row(57), error: null });
    emit('TABLE_UNLOCKED', { table_id: 'another-table' });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    emit('TABLE_UNLOCKED', { table_id: 'table-a' });
    await waitFor(() => expect(hook.result.current.stats?.handsPlayed).toBe(57));
    emit('WS_CONNECTED', { url: 'engine' });
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(3));
    hook.unmount();
    emit('TABLE_UNLOCKED', { table_id: 'table-a' });
    expect(mocks.rpc).toHaveBeenCalledTimes(3);
  });
  it('rejects late replies across table/account changes and repeated reads', async () => {
    const old = deferred(),
      fresh = deferred();
    mocks.rpc.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const hook = renderHook(({ table, user }) => useSessionHandStats(table, user, true), {
      initialProps: { table: 'old', user: 'one' },
    });
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1));
    hook.rerender({ table: 'new', user: 'two' });
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(2));
    await act(async () => fresh.resolve({ data: row(80), error: null }));
    expect(hook.result.current.stats?.handsPlayed).toBe(80);
    await act(async () => old.resolve({ data: row(17), error: null }));
    expect(hook.result.current.stats?.handsPlayed).toBe(80);
    const late = deferred();
    mocks.rpc
      .mockReturnValueOnce(late.promise)
      .mockResolvedValueOnce({ data: row(82), error: null });
    emit('TABLE_UNLOCKED', { table_id: 'new' });
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(3));
    emit('TABLE_UNLOCKED', { table_id: 'new' });
    await waitFor(() => expect(hook.result.current.stats?.handsPlayed).toBe(82));
    await act(async () => late.resolve({ data: row(81), error: null }));
    expect(hook.result.current.stats?.handsPlayed).toBe(82);
  });
  it('shows unknown during initial load, disabled sessions and failed reads, with a reported error', async () => {
    mocks.rpc.mockResolvedValue({ data: row(), error: null });
    const hook = renderHook(({ enabled }) => useSessionHandStats('table', 'player', enabled), {
      initialProps: { enabled: false },
    });
    expect(hook.result.current.stats).toBeNull();
    expect(mocks.rpc).not.toHaveBeenCalled();
    hook.rerender({ enabled: true });
    await waitFor(() => expect(hook.result.current.stats?.handsPlayed).toBe(56));
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'unavailable' } });
    emit('HAND_COMPLETED', { tableId: 'table' });
    await waitFor(() => expect(hook.result.current.stats).toBeNull());
    expect(mocks.reportError).toHaveBeenCalled();
  });
  it('uses the existing persisted pool-session reader for Lightning rooms', async () => {
    mocks.lightning = true;
    mocks.rpc.mockResolvedValue({
      data: {
        hands: 104,
        vpip: 27.9,
        pfr: 15.4,
        started_at: '2026-11-01T01:00:00Z',
        ended_at: null,
      },
      error: null,
    });
    const hook = renderHook(() => useSessionHandStats('lightning', 'player', true));
    await waitFor(() => expect(hook.result.current.stats?.handsPlayed).toBe(104));
    expect(mocks.rpc).toHaveBeenCalledWith('fn_lightning_session_stats', {
      p_pool_session_id: 'lightning',
    });
  });
  it('binds finished summaries and refreshes an open panel on engine reconnect', async () => {
    mocks.rpc.mockResolvedValue({ data: row(), error: null });
    const asOf = Date.parse('2026-11-01T02:00:00Z');
    const hook = renderHook(
      ({ revision }) => useSessionHandStats('table', 'player', true, asOf, revision),
      { initialProps: { revision: 'reconnecting' } }
    );
    await waitFor(() => expect(hook.result.current.stats?.handsPlayed).toBe(56));
    expect(mocks.rpc).toHaveBeenCalledWith('fn_my_game_session_hand_stats', {
      p_table_id: 'table',
      p_as_of: '2026-11-01T02:00:00.000Z',
    });
    mocks.rpc.mockResolvedValue({ data: row(58), error: null });
    hook.rerender({ revision: 'connected' });
    await waitFor(() => expect(hook.result.current.stats?.handsPlayed).toBe(58));
  });
  it('wires Player Hub and both analytics readers to persisted totals, never a local fallback', () => {
    const table = readFileSync('src/pages/TablePage.tsx', 'utf8');
    expect(table).toContain('handsPlayed: persistedHeroHands?.handsPlayed ?? null');
    expect(table).toContain('vpipPercent: persistedHeroHands?.vpipPercent ?? null');
    expect(table).toContain('pfrPercent: persistedHeroHands?.pfrPercent ?? null');
    for (const file of ['RealTimeResultPanel', 'SessionAnalytics']) {
      const src = readFileSync(`src/components/table/${file}.tsx`, 'utf8');
      expect(src).toContain('useSessionHandStats');
      expect(src).toContain('persistedHands.handsPlayed');
    }
    const app = readFileSync('src/App.tsx', 'utf8');
    expect(app).toContain("import('./components/session/SessionSummaryHost')");
    expect(app).toContain("import('./components/tournament/TournamentRankingHost')");
    expect(app).not.toContain("from './components/session/SessionSummaryHost'");
    expect(app).not.toContain("from './components/tournament/TournamentRankingHost'");
    const workflow = readFileSync('scripts/ci/test-data-console-postgres-contracts.sh', 'utf8');
    expect(workflow).toContain('python3 -B "$repo/scripts/ci/test-full-session-hands-postgres.py"');
  });
});
