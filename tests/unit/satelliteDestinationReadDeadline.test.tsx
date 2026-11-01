import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: m.read,
          abortSignal() {
            return this;
          },
        }),
      }),
    }),
  },
}));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
import { useSatelliteDestination } from '../../src/components/lobby/game-cards/useTournamentCardText';
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it('expires a shared unanswered destination and permits the next visit to read', async () => {
  vi.useFakeTimers();
  m.read
    .mockImplementationOnce(() => new Promise(() => {}))
    .mockResolvedValue({ data: { name: 'Sunday Main' }, error: null });
  const first = renderHook(() => useSatelliteDestination('hung-destination'));
  await act(async () => {
    await vi.dynamicImportSettled();
  });
  expect(m.read).toHaveBeenCalledTimes(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(12000);
  });
  expect(first.result.current).toBe('Satellite Destination Unavailable');
  first.unmount();
  const next = renderHook(() => useSatelliteDestination('hung-destination'));
  await act(async () => {
    await vi.dynamicImportSettled();
  });
  expect(m.read).toHaveBeenCalledTimes(2);
  expect(next.result.current).toBe('Wins A Seat Into Sunday Main');
});

it('keeps a fresh destination when the expired lookup eventually answers', async () => {
  vi.useFakeTimers();
  m.read.mockReset();
  let resolve!: (value: unknown) => void;
  m.read
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    )
    .mockResolvedValue({ data: { name: 'New Main' }, error: null });
  const first = renderHook(() => useSatelliteDestination('late-destination'));
  await act(async () => {
    await vi.dynamicImportSettled();
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(12000);
  });
  first.unmount();
  const next = renderHook(() => useSatelliteDestination('late-destination'));
  await act(async () => {
    await vi.dynamicImportSettled();
  });
  expect(next.result.current).toBe('Wins A Seat Into New Main');
  await act(async () => {
    resolve({ data: { name: 'Old Main' }, error: null });
  });
  expect(next.result.current).toBe('Wins A Seat Into New Main');
});
