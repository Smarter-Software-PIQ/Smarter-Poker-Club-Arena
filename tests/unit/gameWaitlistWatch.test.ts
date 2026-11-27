import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const realtime = vi.hoisted(() => ({
  broadcast: null as null | ((message: { payload?: { game_id?: unknown } }) => void),
  status: null as null | ((status: string) => void),
  removeChannel: vi.fn(),
}));

vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    channel: vi.fn(() => {
      const channel = {
        on: vi.fn(
          (
            _type: string,
            _filter: unknown,
            handler: (message: { payload?: { game_id?: unknown } }) => void
          ) => {
            realtime.broadcast = handler;
            return channel;
          }
        ),
        subscribe: vi.fn((listener: (status: string) => void) => {
          realtime.status = listener;
          return channel;
        }),
      };
      return channel;
    }),
    removeChannel: realtime.removeChannel,
  },
}));

import {
  GAME_WAITLIST_POLL_MS,
  GAME_WAITLIST_SAFETY_POLL_MS,
  watchGameWaitlistCounts,
} from '../../src/lib/gameWaitlistWatch';

beforeEach(() => {
  vi.useFakeTimers();
  realtime.broadcast = null;
  realtime.status = null;
  realtime.removeChannel.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the waitlist counts follow the shared realtime poll rule', () => {
  it('re-reads every 20 s until the broadcast channel joins', () => {
    const load = vi.fn();
    const stop = watchGameWaitlistCounts(['g1'], load);
    vi.advanceTimersByTime(GAME_WAITLIST_POLL_MS * 2);
    expect(load).toHaveBeenCalledTimes(2);
    stop();
  });

  it('reads once on joining, then only every minute while subscribed', () => {
    const load = vi.fn();
    const stop = watchGameWaitlistCounts(['g1'], load);
    realtime.status?.('SUBSCRIBED');
    expect(load).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(GAME_WAITLIST_SAFETY_POLL_MS - 1);
    expect(load).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(load).toHaveBeenCalledTimes(2);
    stop();
  });

  it('goes back to 20 s the moment the channel drops', () => {
    const load = vi.fn();
    const stop = watchGameWaitlistCounts(['g1'], load);
    realtime.status?.('SUBSCRIBED');
    load.mockClear();
    realtime.status?.('CHANNEL_ERROR');
    vi.advanceTimersByTime(GAME_WAITLIST_POLL_MS);
    expect(load).toHaveBeenCalledTimes(1);
    stop();
  });

  it('a broadcast for a watched game re-reads within 750 ms; others are ignored', () => {
    const load = vi.fn();
    const stop = watchGameWaitlistCounts(['g1'], load);
    realtime.broadcast?.({ payload: { game_id: 'other' } });
    vi.advanceTimersByTime(800);
    expect(load).not.toHaveBeenCalled();
    realtime.broadcast?.({ payload: { game_id: 'g1' } });
    vi.advanceTimersByTime(750);
    expect(load).toHaveBeenCalledTimes(1);
    stop();
  });

  it('stopping removes the channel and leaves no timer behind', () => {
    const load = vi.fn();
    const stop = watchGameWaitlistCounts(['g1'], load);
    realtime.broadcast?.({ payload: { game_id: 'g1' } });
    stop();
    expect(realtime.removeChannel).toHaveBeenCalledTimes(1);
    realtime.status?.('SUBSCRIBED');
    vi.advanceTimersByTime(10 * GAME_WAITLIST_SAFETY_POLL_MS);
    expect(load).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
