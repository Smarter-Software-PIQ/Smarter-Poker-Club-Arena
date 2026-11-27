import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  REALTIME_SAFETY_POLL_MS,
  isRealtimeLive,
  startRealtimeAwarePoll,
} from '../../src/lib/realtimeAwarePoll';
import { useRealtimeAwarePoll } from '../../src/hooks/useRealtimeAwarePoll';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('startRealtimeAwarePoll', () => {
  it('polls at the fast cadence while the channel is not live', () => {
    const poll = vi.fn();
    const handle = startRealtimeAwarePoll(poll, { fastMs: 2_000 });
    vi.advanceTimersByTime(6_000);
    expect(poll).toHaveBeenCalledTimes(3);
    expect(handle.currentMs()).toBe(2_000);
    handle.stop();
  });

  it('drops to the 30 s safety cadence while SUBSCRIBED', () => {
    const poll = vi.fn();
    const handle = startRealtimeAwarePoll(poll, { fastMs: 2_000 });
    handle.setLive(true);
    vi.advanceTimersByTime(REALTIME_SAFETY_POLL_MS - 1);
    expect(poll).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(poll).toHaveBeenCalledTimes(1);
    expect(handle.currentMs()).toBe(REALTIME_SAFETY_POLL_MS);
    handle.stop();
  });

  it('stops entirely while live when slowMs is null', () => {
    const poll = vi.fn();
    const handle = startRealtimeAwarePoll(poll, { fastMs: 1_000, slowMs: null, live: true });
    vi.advanceTimersByTime(10 * REALTIME_SAFETY_POLL_MS);
    expect(poll).not.toHaveBeenCalled();
    expect(handle.currentMs()).toBeNull();
    handle.stop();
  });

  it('resumes the fast cadence the moment the channel drops', () => {
    const poll = vi.fn();
    const handle = startRealtimeAwarePoll(poll, { fastMs: 2_000, live: true });
    vi.advanceTimersByTime(10_000);
    expect(poll).not.toHaveBeenCalled();
    handle.setLive(false);
    vi.advanceTimersByTime(2_000);
    expect(poll).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(4_000);
    expect(poll).toHaveBeenCalledTimes(3);
    handle.stop();
  });

  it('does not restart the clock when the same state is reported again', () => {
    const poll = vi.fn();
    const handle = startRealtimeAwarePoll(poll, { fastMs: 2_000 });
    vi.advanceTimersByTime(1_500);
    handle.setLive(false);
    vi.advanceTimersByTime(500);
    expect(poll).toHaveBeenCalledTimes(1);
    handle.stop();
  });

  it('never polls after stop, and ignores later state reports', () => {
    const poll = vi.fn();
    const handle = startRealtimeAwarePoll(poll, { fastMs: 2_000 });
    handle.stop();
    handle.setLive(false);
    handle.setLive(true);
    vi.advanceTimersByTime(10 * REALTIME_SAFETY_POLL_MS);
    expect(poll).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('treats only SUBSCRIBED as live', () => {
    expect(isRealtimeLive('SUBSCRIBED')).toBe(true);
    for (const status of ['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED', 'joining', '', null, undefined]) {
      expect(isRealtimeLive(status)).toBe(false);
    }
  });
});

function Poller(props: {
  poll: () => void;
  live: boolean;
  enabled?: boolean;
  fastMs?: number;
  slowMs?: number | null;
}) {
  useRealtimeAwarePoll(props.poll, {
    live: props.live,
    enabled: props.enabled,
    fastMs: props.fastMs ?? 2_000,
    slowMs: props.slowMs,
  });
  return null;
}

describe('useRealtimeAwarePoll', () => {
  it('is fast when disconnected, slow when subscribed, fast again on a drop', () => {
    const poll = vi.fn();
    const view = render(<Poller poll={poll} live={false} />);
    act(() => vi.advanceTimersByTime(4_000));
    expect(poll).toHaveBeenCalledTimes(2);

    view.rerender(<Poller poll={poll} live />);
    act(() => vi.advanceTimersByTime(REALTIME_SAFETY_POLL_MS - 1));
    expect(poll).toHaveBeenCalledTimes(2);
    act(() => vi.advanceTimersByTime(1));
    expect(poll).toHaveBeenCalledTimes(3);

    view.rerender(<Poller poll={poll} live={false} />);
    act(() => vi.advanceTimersByTime(2_000));
    expect(poll).toHaveBeenCalledTimes(4);
    view.unmount();
    act(() => vi.advanceTimersByTime(10 * REALTIME_SAFETY_POLL_MS));
    expect(poll).toHaveBeenCalledTimes(4);
  });

  it('starts slow when the channel is already live at mount', () => {
    const poll = vi.fn();
    const view = render(<Poller poll={poll} live />);
    act(() => vi.advanceTimersByTime(REALTIME_SAFETY_POLL_MS - 1));
    expect(poll).not.toHaveBeenCalled();
    view.unmount();
  });

  it('runs nothing while disabled', () => {
    const poll = vi.fn();
    const view = render(<Poller poll={poll} live={false} enabled={false} />);
    act(() => vi.advanceTimersByTime(60_000));
    expect(poll).not.toHaveBeenCalled();
    view.rerender(<Poller poll={poll} live={false} enabled />);
    act(() => vi.advanceTimersByTime(2_000));
    expect(poll).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('calls the latest callback without restarting the clock', () => {
    const first = vi.fn();
    const second = vi.fn();
    const view = render(<Poller poll={first} live={false} />);
    act(() => vi.advanceTimersByTime(1_500));
    view.rerender(<Poller poll={second} live={false} />);
    act(() => vi.advanceTimersByTime(500));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    view.unmount();
  });
});
