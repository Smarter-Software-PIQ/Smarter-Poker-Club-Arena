import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const io = vi.hoisted(() => ({ rpc: vi.fn(), gate: 'available' }));
vi.mock('../../src/lib/supabase', () => ({ supabase: { rpc: io.rpc } }));
vi.mock('../../src/hooks/usePlatformCapability', () => ({ usePlatformCapability: () => io.gate }));
import { readTournamentStageView } from '../../src/services/TournamentStageService';
import {
  useTournamentStageView,
  useTournamentStageViews,
} from '../../src/hooks/useTournamentStageView';
function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return {
    resolve,
    query: Object.assign(promise, { abortSignal: vi.fn((_signal: AbortSignal) => promise) }),
  };
}
const answer = (id: string) => ({
  data: {
    ok: true,
    tournament_id: id,
    status: 'BAGGED',
    plan: { rule_version: 'multi-day-v1', time_zone: 'UTC', stage_count: 2 },
    stages: [],
  },
  error: null,
});
beforeEach(() => {
  io.rpc.mockReset();
  io.gate = 'available';
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
describe('stage reads keep a finite scoped answer', () => {
  it('bounds a never-answering read and ignores its late answer', async () => {
    vi.useFakeTimers();
    const d = deferred();
    io.rpc.mockReturnValue(d.query);
    let result: unknown;
    const run = readTournamentStageView('A').then((value) => {
      result = value;
    });
    await vi.advanceTimersByTimeAsync(12000);
    expect(result).toMatchObject({ status: 'unknown' });
    expect(d.query.abortSignal).toHaveBeenCalledOnce();
    expect(d.query.abortSignal.mock.calls[0][0].aborted).toBe(true);
    d.resolve(answer('A'));
    await run;
    expect(result).toMatchObject({ status: 'unknown' });
  });
  it('classifies a rejected transport as unknown', async () => {
    io.rpc.mockImplementation(() =>
      Object.assign(Promise.reject(new Error('offline')), {
        abortSignal: function () {
          return this;
        },
      })
    );
    await expect(readTournamentStageView('A')).resolves.toMatchObject({ status: 'unknown' });
  });
  it('ends mounted loading on timeout and does not let a superseded read replace the next event', async () => {
    vi.useFakeTimers();
    const a = deferred(),
      b = deferred();
    io.rpc.mockReturnValueOnce(a.query).mockReturnValueOnce(b.query);
    const h = renderHook(({ id }) => useTournamentStageView(id), { initialProps: { id: 'A' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    h.rerender({ id: 'B' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(a.query.abortSignal.mock.calls[0][0].aborted).toBe(true);
    await act(async () => {
      a.resolve(answer('A'));
    });
    expect(h.result.current.view).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12000);
    });
    expect(h.result.current.loading).toBe(false);
    expect(h.result.current.view).toBeNull();
    expect(io.rpc).toHaveBeenCalledTimes(2);
    await act(async () => {
      b.resolve(answer('B'));
    });
    expect(h.result.current.view).toBeNull();
  });
  it('hides the previous event and status while the next scope is unresolved', async () => {
    const a = deferred(),
      b = deferred(),
      refresh = deferred();
    io.rpc
      .mockReturnValueOnce(a.query)
      .mockReturnValueOnce(b.query)
      .mockReturnValueOnce(refresh.query);
    const h = renderHook(({ id, status }) => useTournamentStageView(id, status), {
      initialProps: { id: 'A', status: 'BAGGED' },
    });
    await act(async () => {
      a.resolve(answer('A'));
    });
    expect(h.result.current.view?.tournamentId).toBe('A');
    h.rerender({ id: 'B', status: 'BAGGED' });
    expect(h.result.current.view).toBeNull();
    expect(h.result.current.loading).toBe(true);
    await act(async () => {
      b.resolve(answer('B'));
    });
    h.rerender({ id: 'B', status: 'RUNNING' });
    expect(h.result.current.view).toBeNull();
    expect(h.result.current.loading).toBe(true);
  });
  it('hides an old lobby collection immediately when its requested IDs change', async () => {
    const a = deferred(),
      b = deferred();
    io.rpc.mockReturnValueOnce(a.query).mockReturnValueOnce(b.query);
    const h = renderHook(({ ids }) => useTournamentStageViews(ids), {
      initialProps: { ids: ['A'] },
    });
    await act(async () => {
      a.resolve(answer('A'));
    });
    expect(h.result.current.A).toBeDefined();
    h.rerender({ ids: ['B'] });
    expect(h.result.current).toEqual({});
    await act(async () => {
      b.resolve(answer('B'));
    });
    expect(Object.keys(h.result.current)).toEqual(['B']);
  });
  it('never returns a capability-disabled snapshot even in the first disabled render', async () => {
    const a = deferred();
    io.rpc.mockReturnValue(a.query);
    const seen: unknown[] = [];
    const h = renderHook(() => {
      const value = useTournamentStageView('A');
      seen.push({ gate: io.gate, view: value.view });
      return value;
    });
    await act(async () => {
      a.resolve(answer('A'));
    });
    io.gate = 'unavailable';
    h.rerender();
    expect(
      seen.filter((x: any) => x.gate === 'unavailable').every((x: any) => x.view === null)
    ).toBe(true);
  });
});
