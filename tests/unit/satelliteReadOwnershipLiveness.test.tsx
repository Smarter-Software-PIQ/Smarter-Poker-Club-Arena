import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ from: vi.fn(), report: vi.fn(), signals: [] as AbortSignal[] }));
vi.mock('../../src/lib/supabase', () => ({ supabase: { from: m.from } }));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: m.report }));
import { useSatellites } from '../../src/components/tournament/details/useSatellites';
import { useSatelliteAwards } from '../../src/components/tournament/details/useSatelliteAwards';
function query(data: unknown, pending = false) {
  const answer = pending ? new Promise<any>(() => {}) : Promise.resolve({ data, error: null });
  const q: any = { then: (yes: any, no: any) => answer.then(yes, no) };
  for (const name of ['select', 'or', 'in', 'eq', 'order', 'limit', 'gt']) q[name] = () => q;
  q.abortSignal = (signal: AbortSignal) => {
    m.signals.push(signal);
    return q;
  };
  return q;
}
const satellite = { id: 'sat-a', name: 'Satellite A', status: 'REGISTERING' };
beforeEach(() => {
  m.from.mockReset();
  m.report.mockReset();
  m.signals.length = 0;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it.each(['target', 'viewer'])(
  'never exposes previous satellite cards or membership on a %s change',
  async (change) => {
    m.from
      .mockReturnValueOnce(query([satellite]))
      .mockReturnValueOnce(query([{ tournament_id: 'sat-a' }]))
      .mockReturnValue(query(null, true));
    const renders: any[] = [];
    const { result, rerender } = renderHook(
      ({ target, viewer }) => {
        const value = useSatellites(target, viewer);
        renders.push(value);
        return value;
      },
      { initialProps: { target: 'target-a', viewer: 'viewer-a' } }
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.registration).toEqual({ 'sat-a': true });
    renders.length = 0;
    rerender({
      target: change === 'target' ? 'target-b' : 'target-a',
      viewer: change === 'viewer' ? 'viewer-b' : 'viewer-a',
    });
    expect(renders.every((value) => value.cards.length === 0 && value.registration === null)).toBe(
      true
    );
    expect(result.current.loading).toBe(true);
  }
);
it('ends a stalled list read at the shared deadline and exposes the existing retry state', async () => {
  vi.useFakeTimers();
  m.from.mockReturnValue(query(null, true));
  const { result } = renderHook(() => useSatellites('target', 'viewer'));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(12001);
  });
  expect(result.current.loading).toBe(false);
  expect(result.current.error).toBe('Satellites Could Not Be Loaded');
  expect(result.current.cards).toEqual([]);
  expect(m.signals[0]?.aborted).toBe(true);
});
it('ends a stalled membership read with unknown registration, never a false Register claim', async () => {
  vi.useFakeTimers();
  m.from.mockImplementation((table) =>
    query(table === 'tournaments' ? [satellite] : null, table !== 'tournaments')
  );
  const { result } = renderHook(() => useSatellites('target', 'viewer'));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(12001);
  });
  expect(result.current.loading).toBe(false);
  expect(result.current.cards).toHaveLength(1);
  expect(result.current.registration).toBeNull();
  expect(m.report).toHaveBeenCalledWith(expect.any(Error), 'useSatellites.registration');
  expect(m.signals.at(-1)?.aborted).toBe(true);
});
it('ends a stalled recorded-award read as unknown without inventing ticket or cash evidence', async () => {
  vi.useFakeTimers();
  m.from.mockReturnValue(query(null, true));
  const { result } = renderHook(() =>
    useSatelliteAwards(
      {
        id: 'sat-a',
        status: 'COMPLETED',
        tournament_type: 'SATELLITE',
        satellite_target_id: 'target',
      },
      [{ prize: 10 }],
      undefined,
      'viewer'
    )
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(12001);
  });
  expect(result.current.ready).toBe(true);
  expect(result.current.failed).toBe(true);
  expect(result.current.kindFor('winner', 10)).toBe('unknown');
  expect(m.signals[0]?.aborted).toBe(true);
});
it('an explicit retry after list timeout reads a new complete result', async () => {
  vi.useFakeTimers();
  m.from.mockReturnValueOnce(query(null, true)).mockReturnValueOnce(query([]));
  const { result } = renderHook(() => useSatellites('target', 'viewer'));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(12001);
  });
  expect(result.current.error).not.toBeNull();
  await act(async () => {
    result.current.retry();
  });
  expect(result.current.loading).toBe(false);
  expect(result.current.error).toBeNull();
  expect(result.current.cards).toEqual([]);
  expect(m.from).toHaveBeenCalledTimes(2);
});
it('retires and aborts the old list request on target change', async () => {
  let resolve!: (value: unknown) => void;
  const old = query(null, true);
  old.then = (yes: any, no: any) =>
    new Promise((done) => {
      resolve = done;
    }).then(yes, no);
  m.from.mockReturnValueOnce(old).mockReturnValueOnce(query([]));
  const { result, rerender } = renderHook(({ id }) => useSatellites(id, 'viewer'), {
    initialProps: { id: 'old' },
  });
  await act(async () => {});
  const signal = m.signals[0];
  rerender({ id: 'new' });
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(signal.aborted).toBe(true);
  await act(async () => resolve({ data: [satellite], error: null }));
  expect(result.current.cards).toEqual([]);
  expect(m.from).toHaveBeenCalledTimes(2);
});
it('aborts an award read on unmount without reporting a stale error', async () => {
  m.from.mockReturnValue(query(null, true));
  const { unmount } = renderHook(() =>
    useSatelliteAwards({ id: 'sat', status: 'COMPLETED', tournament_type: 'SATELLITE' }, [
      { prize: 10 },
    ])
  );
  await act(async () => {});
  unmount();
  await act(async () => {});
  expect(m.signals[0].aborted).toBe(true);
  expect(m.report).not.toHaveBeenCalled();
});
it('retains authoritative cash evidence and unknown recipients after a successful read', async () => {
  m.from.mockReturnValue(
    query([
      {
        id: 'a',
        tournament_id: 'sat',
        user_id: 'winner',
        source: 'satellite_remainder',
        amount: 10,
        metadata: null,
        recorded_by: 'credit_and_log',
      },
    ])
  );
  const { result } = renderHook(() =>
    useSatelliteAwards({ id: 'sat', status: 'COMPLETED', tournament_type: 'SATELLITE' }, [
      { prize: 10 },
    ])
  );
  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(result.current.failed).toBe(false);
  expect(result.current.kindFor('winner', 10)).toBe('cash');
  expect(result.current.kindFor('other', 10)).toBe('unknown');
});
