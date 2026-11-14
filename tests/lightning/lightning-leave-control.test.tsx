import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useLightningFinalDeal } from '../../src/lightning/useLightningFinalDeal';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

it.each([null, 41])(
  'keeps matchmaking open through idle and replayed snapshots (%s)',
  async (initial) => {
    const stop = vi.fn(async () => {});
    const props = {
      userId: 'hero',
      anchor: { tableId: 'physical', occupancyId: 'seat-occ' },
      currentHand: 41,
      presentedHand: initial as number | null,
      roomClosed: false,
      onPresented: stop,
      onError: vi.fn(),
    };
    const first = renderHook(useLightningFinalDeal, { initialProps: props });
    act(() => first.result.current.queue());
    first.unmount();
    const view = renderHook(useLightningFinalDeal, { initialProps: props });
    expect(view.result.current.queued).toBe(true);
    view.rerender({ ...props, presentedHand: 41 });
    view.rerender({ ...props, currentHand: 42, presentedHand: null });
    expect(stop).not.toHaveBeenCalled();
    await act(async () => view.rerender({ ...props, currentHand: 42, presentedHand: 42 }));
    expect(stop).toHaveBeenCalledOnce();
    expect(view.result.current.queued).toBe(false);
  }
);

it('cancels before the final deal without stopping matchmaking', () => {
  const props = {
    userId: 'hero',
    anchor: { tableId: 'physical', occupancyId: 'seat-occ' },
    currentHand: 1,
    presentedHand: 1,
    roomClosed: false,
    onPresented: vi.fn(),
    onError: vi.fn(),
  };
  const view = renderHook(useLightningFinalDeal, { initialProps: props });
  act(() => view.result.current.queue());
  act(() => view.result.current.cancel());
  view.rerender({ ...props, currentHand: 2, presentedHand: 2 });
  expect(props.onPresented).not.toHaveBeenCalled();
});

it('follows the same physical seat into a pool and isolates every other occupancy', async () => {
  const stop = vi.fn(async () => {});
  const anchor = { tableId: 'feeder', occupancyId: 'owned-occupancy' };
  const props = {
    userId: 'owner',
    anchor,
    currentHand: 48,
    presentedHand: null as number | null,
    roomClosed: false,
    onPresented: stop,
    onError: vi.fn(),
  };
  const first = renderHook(useLightningFinalDeal, { initialProps: props });
  act(() => first.result.current.queue());
  first.unmount();
  const room = renderHook(useLightningFinalDeal, {
    initialProps: {
      ...props,
      anchor: null as typeof anchor | null,
      currentHand: 49,
      presentedHand: 49,
    },
  });
  for (const unrelated of [
    { userId: 'other', anchor },
    { userId: 'owner', anchor: { ...anchor, tableId: 'other-table' } },
    { userId: 'owner', anchor: { ...anchor, occupancyId: 'replacement-occupancy' } },
  ]) {
    room.rerender({ ...props, ...unrelated, currentHand: 49, presentedHand: 49 });
    expect(room.result.current.queued).toBe(false);
  }
  expect(stop).not.toHaveBeenCalled();
  await act(async () => room.rerender({ ...props, currentHand: 49, presentedHand: 49 }));
  expect(stop).toHaveBeenCalledOnce();
});
