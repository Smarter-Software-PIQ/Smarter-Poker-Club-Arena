import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { supabase } from '../../src/lib/supabase';
import { useTournamentScheduleList } from '../../src/hooks/useTournamentScheduleList';
import type { TournamentScheduleRow } from '../../src/services/TournamentScheduleService';

function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (value: unknown) => void;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const builder: any = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    abortSignal: vi.fn(),
    then: promise.then.bind(promise),
  };
  for (const key of ['select', 'eq', 'order', 'abortSignal']) builder[key].mockReturnValue(builder);
  return { builder, resolve, reject };
}
function mockReads(...reads: ReturnType<typeof deferred>[]) {
  const from = vi.spyOn(supabase, 'from').mockClear();
  for (const read of reads) from.mockReturnValueOnce(read.builder);
  return from;
}
const row = (id: string) => ({ id, active: true }) as TournamentScheduleRow;
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe('the union schedule reader', () => {
  it('finishes loading with an error after an unanswered read without retry', async () => {
    vi.useFakeTimers();
    const first = deferred();
    const from = mockReads(first);
    const { result } = renderHook(() => useTournamentScheduleList('union', true));
    expect(result.current.loading).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000);
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe('Could Not Load Recurring Schedules.');
    expect(result.current.schedules).toEqual([]);
    expect(first.builder.abortSignal.mock.calls[0][0].aborted).toBe(true);
    expect(from).toHaveBeenCalledTimes(1);
    await act(async () => {
      first.resolve({ data: [row('late')], error: null });
    });
    expect(result.current.error).not.toBeNull();
    expect(result.current.schedules).toEqual([]);
  });
  it('catches rejected reads and distinguishes them from a confirmed empty list', async () => {
    const first = deferred();
    const second = deferred();
    mockReads(first, second);
    const { result, rerender } = renderHook(({ id }) => useTournamentScheduleList(id, true), {
      initialProps: { id: 'a' },
    });
    await act(async () => {
      first.reject(new Error('Offline'));
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).not.toBeNull();
    rerender({ id: 'b' });
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(true);
    await act(async () => {
      second.resolve({ data: [], error: null });
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });
  it('never projects the previous union or a late toggle onto the new scope', async () => {
    const first = deferred();
    const second = deferred();
    mockReads(first, second);
    const { result, rerender } = renderHook(({ id }) => useTournamentScheduleList(id, true), {
      initialProps: { id: 'a' },
    });
    await act(async () => {
      first.resolve({ data: [row('same')], error: null });
    });
    const oldUpdate = result.current.updateActive;
    expect(result.current.schedules).toHaveLength(1);
    rerender({ id: 'b' });
    expect(result.current.schedules).toEqual([]);
    expect(result.current.loading).toBe(true);
    await act(async () => {
      second.resolve({ data: [row('same')], error: null });
    });
    act(() => oldUpdate('same', false));
    expect(result.current.schedules[0].active).toBe(true);
    act(() => result.current.updateActive('same', false));
    expect(result.current.schedules[0].active).toBe(false);
  });
  it('aborts a departing scope and ignores its late reply', async () => {
    const first = deferred();
    const second = deferred();
    mockReads(first, second);
    const { result, rerender } = renderHook(
      ({ enabled }) => useTournamentScheduleList('a', enabled),
      { initialProps: { enabled: true } }
    );
    await act(async () => {});
    rerender({ enabled: false });
    expect(first.builder.abortSignal.mock.calls[0][0].aborted).toBe(true);
    expect(result.current.loading).toBe(false);
    await act(async () => {
      first.resolve({ data: [row('late')], error: null });
    });
    expect(result.current.schedules).toEqual([]);
    rerender({ enabled: true });
    await act(async () => {
      second.resolve({ data: [row('current')], error: null });
    });
    expect(result.current.schedules[0].id).toBe('current');
  });
});
