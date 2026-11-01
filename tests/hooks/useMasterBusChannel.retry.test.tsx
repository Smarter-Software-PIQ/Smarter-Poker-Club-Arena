import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const f = vi.hoisted(() => ({
  subscribeRealtime: vi.fn(),
  admissions: [] as Array<{ signal: AbortSignal; status: (value: string) => void }>,
  getOrCreateChannel: vi.fn(),
  registerChannelFactory: vi.fn(),
  removeChannelFactory: vi.fn(),
  removeRegisteredChannel: vi.fn(),
  reportError: vi.fn(),
  statuses: [] as Array<(status: string) => void>,
  payloads: [] as Array<(payload: unknown) => void>,
  emit: vi.fn(),
}));
vi.mock('../../src/lib/subscribeRealtime', () => ({ subscribeRealtime: f.subscribeRealtime }));
vi.mock('../../src/core/MasterBus', () => ({ masterBus: f }));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: f.reportError }));
import { useMasterBusChannel } from '../../src/hooks/useMasterBusChannel';
import { __resetRealtimeTransportLossForTests } from '../../src/lib/realtimeTransportLoss';
import { __resetRealtimeDegradationPolicyForTests } from '../../src/lib/realtimeDegradationPolicy';

beforeEach(() => {
  vi.clearAllMocks();
  __resetRealtimeTransportLossForTests();
  f.admissions = [];
  f.subscribeRealtime.mockImplementation((channel, status, signal) => {
    f.admissions.push({ signal, status });
    channel.subscribe(status);
    return Promise.resolve();
  });
  f.statuses = [];
  f.payloads = [];
  f.getOrCreateChannel.mockImplementation(() => {
    const channel = {
      state: 'closed',
      on: (_kind: string, _filter: unknown, payload: (value: unknown) => void) => {
        f.payloads.push(payload);
        return channel;
      },
      subscribe: (status: (value: string) => void) => f.statuses.push(status),
    };
    return channel;
  });
});

it('explicit retry replaces a failed row subscription and rejects late old callbacks', () => {
  const onPayload = vi.fn(),
    onSubscriptionStatus = vi.fn(),
    onSubscriptionError = vi.fn();
  const { rerender, unmount } = renderHook(
    ({ restartKey }) =>
      useMasterBusChannel({
        channelName: 'club-data-tables:test',
        table: 'tables',
        filter: 'club_id=eq.test',
        event: '*',
        onPayload,
        onSubscriptionStatus,
        onSubscriptionError,
        ...{ restartKey },
      }),
    { initialProps: { restartKey: 0 } }
  );
  act(() => f.statuses[0]('TIMED_OUT'));
  rerender({ restartKey: 1 });
  expect(f.statuses).toHaveLength(2);
  expect(f.removeRegisteredChannel).toHaveBeenCalledWith(
    expect.stringMatching(/^club-data-tables:test:row:/),
    expect.anything()
  );
  onSubscriptionStatus.mockClear();
  onSubscriptionError.mockClear();
  act(() => {
    f.statuses[1]('SUBSCRIBED');
    f.statuses[0]('CLOSED');
    f.payloads[0]({ revision: 'old' });
    f.payloads[1]({ revision: 'new' });
  });
  expect(onSubscriptionStatus.mock.calls).toEqual([['SUBSCRIBED']]);
  expect(onSubscriptionError).not.toHaveBeenCalled();
  expect(onPayload.mock.calls).toEqual([[{ revision: 'new' }]]);
  rerender({ restartKey: 1 });
  expect(f.statuses).toHaveLength(2);
  unmount();
  expect(f.removeRegisteredChannel).toHaveBeenCalledTimes(2);
});

it('a registered recovery factory cannot let a retired channel overwrite its replacement', () => {
  const onPayload = vi.fn(),
    onSubscriptionStatus = vi.fn(),
    onSubscriptionError = vi.fn();
  renderHook(() =>
    useMasterBusChannel({
      channelName: 'club-data-tables:test',
      table: 'tables',
      filter: 'club_id=eq.test',
      event: '*',
      onPayload,
      onSubscriptionStatus,
      onSubscriptionError,
    })
  );
  act(() => f.statuses[0]('TIMED_OUT'));
  act(() => f.registerChannelFactory.mock.calls[0][1]());
  expect(f.statuses).toHaveLength(2);
  onSubscriptionStatus.mockClear();
  onSubscriptionError.mockClear();
  act(() => {
    f.statuses[1]('SUBSCRIBED');
    f.statuses[0]('CLOSED');
    f.payloads[0]({ revision: 'old' });
    f.payloads[1]({ revision: 'new' });
  });
  expect(onSubscriptionStatus.mock.calls).toEqual([['SUBSCRIBED']]);
  expect(onSubscriptionError).not.toHaveBeenCalled();
  expect(onPayload.mock.calls).toEqual([[{ revision: 'new' }]]);
});

it('aborts pending admission on unmount and ignores a retired completion', () => {
  f.subscribeRealtime.mockImplementation((_channel, status, signal) => {
    f.admissions.push({ signal, status });
    return Promise.resolve();
  });
  const onSubscriptionStatus = vi.fn(),
    onSubscriptionError = vi.fn();
  const { unmount } = renderHook(() =>
    useMasterBusChannel({
      channelName: 'pending',
      table: 'club_members',
      filter: 'club_id=eq.test',
      event: '*',
      onPayload: vi.fn(),
      onSubscriptionStatus,
      onSubscriptionError,
    })
  );
  expect(f.admissions[0].signal.aborted).toBe(false);
  unmount();
  expect(f.admissions[0].signal.aborted).toBe(true);
  act(() => f.admissions[0].status('CHANNEL_ERROR'));
  expect(onSubscriptionStatus).not.toHaveBeenCalled();
  expect(onSubscriptionError).not.toHaveBeenCalled();
  expect(f.removeRegisteredChannel).toHaveBeenCalledTimes(1);
});

it('a pending recovery admission is cancelled before its replacement owns callbacks', () => {
  f.subscribeRealtime.mockImplementation((_channel, status, signal) => {
    f.admissions.push({ signal, status });
    return Promise.resolve();
  });
  const onSubscriptionStatus = vi.fn();
  const { unmount } = renderHook(() =>
    useMasterBusChannel({
      channelName: 'pending-retry',
      table: 'club_members',
      filter: 'club_id=eq.test',
      event: '*',
      onPayload: vi.fn(),
      onSubscriptionStatus,
    })
  );
  act(() => f.registerChannelFactory.mock.calls[0][1]());
  expect(f.admissions).toHaveLength(2);
  expect(f.admissions[0].signal.aborted).toBe(true);
  expect(f.admissions[1].signal.aborted).toBe(false);
  act(() => {
    f.admissions[1].status('SUBSCRIBED');
    f.admissions[0].status('CLOSED');
  });
  expect(onSubscriptionStatus.mock.calls).toEqual([['SUBSCRIBED']]);
  unmount();
  expect(f.admissions[1].signal.aborted).toBe(true);
});

it('reports a reasonless socket drop once for every row channel it fans out to (2026-10-24)', () => {
  const errors = [vi.fn(), vi.fn()];
  ['club-members-kings-club', 'club-agents-kings-club'].forEach((channelName, i) =>
    renderHook(() =>
      useMasterBusChannel({
        channelName,
        table: i ? 'agents' : 'club_members',
        filter: 'club_id=eq.test',
        event: '*',
        onPayload: vi.fn(),
        onSubscriptionError: errors[i],
      })
    )
  );
  act(() => f.statuses.forEach((status) => status('CHANNEL_ERROR')));
  expect(f.reportError.mock.calls.map(([, source]) => source)).toEqual(['Realtime.transport_lost']);
  for (const error of errors)
    expect(error).toHaveBeenCalledExactlyOnceWith('CHANNEL_ERROR', undefined);

  // The socket comes back; the next drop is a new outage and is counted.
  act(() => f.statuses.forEach((status) => status('SUBSCRIBED')));
  act(() => f.statuses[0]('CHANNEL_ERROR'));
  expect(f.reportError).toHaveBeenCalledTimes(2);
});

it('still files a row channel the server refused with a reason', () => {
  renderHook(() =>
    useMasterBusChannel({
      channelName: 'club-data:test',
      table: 'tables',
      filter: 'club_id=eq.test',
      event: '*',
      onPayload: vi.fn(),
    })
  );
  const mismatch = new Error('mismatch between server and client bindings for postgres changes');
  act(() => f.statuses[0]('CHANNEL_ERROR', mismatch as never));
  expect(f.reportError).toHaveBeenCalledExactlyOnceWith(
    mismatch,
    'useMasterBusChannel.CHANNEL_ERROR.tables'
  );
});

/* 2026-10-31: one Member Management tab raised 15,302 "Live ... Connection
   Could Not Be Established" toasts in six hours. A channel that keeps failing
   is ONE degradation episode: one consumer notification, one toast, one
   report, until SUBSCRIBED. Recovery attempts back off (immediate, then
   1 s .. 30 s with jitter). */
it('notifies and toasts once per degradation episode and backs off its recovery', () => {
  vi.useFakeTimers();
  try {
    __resetRealtimeDegradationPolicyForTests();
    const toasts = () => f.emit.mock.calls.filter(([event]) => event === 'SHOW_TOAST');
    const onSubscriptionError = vi.fn();
    const { unmount } = renderHook(() =>
      useMasterBusChannel({
        channelName: 'member-record-wallet-storm',
        table: 'club_members',
        filter: 'club_id=eq.test',
        event: '*',
        onPayload: vi.fn(),
        onSubscriptionError,
        degradedToast: 'The Live Wallet Connection Could Not Be Established.',
      })
    );
    const factory = f.registerChannelFactory.mock.calls[0][1] as () => void;

    // Failure 1, then many health-monitor ticks, each attempt failing.
    act(() => {
      f.statuses[0]('CHANNEL_ERROR');
      f.statuses[0]('CLOSED');
    });
    act(() => factory()); // first retry is immediate
    expect(f.statuses).toHaveLength(2);
    act(() => f.statuses[1]('TIMED_OUT'));
    act(() => factory()); // second retry waits 0.5 s .. 1 s
    expect(f.statuses).toHaveLength(2);
    act(() => factory()); // a pending retry absorbs further requests
    act(() => vi.advanceTimersByTime(1_000));
    expect(f.statuses).toHaveLength(3);
    for (let i = 3; i < 20; i++) {
      act(() => f.statuses[i - 1]('CHANNEL_ERROR'));
      act(() => factory());
      act(() => vi.advanceTimersByTime(30_000));
      expect(f.statuses).toHaveLength(i + 1);
    }
    expect(onSubscriptionError).toHaveBeenCalledTimes(1);
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0][1]).toMatchObject({
      severity: 'critical',
      message: 'The Live Wallet Connection Could Not Be Established.',
    });
    expect(f.reportError).toHaveBeenCalledTimes(1);

    // Backoff is capped: the 20th consecutive failure still retries within 30 s.
    act(() => f.statuses[19]('CHANNEL_ERROR'));
    act(() => factory());
    act(() => vi.advanceTimersByTime(14_999));
    const before = f.statuses.length;
    act(() => vi.advanceTimersByTime(15_001));
    expect(f.statuses.length).toBe(before + 1);

    // Recovery closes the episode; the next outage notifies and toasts again.
    act(() => f.statuses.at(-1)!('SUBSCRIBED'));
    act(() => factory()); // after SUBSCRIBED the next retry is immediate
    expect(f.statuses.length).toBe(before + 2);
    act(() => f.statuses.at(-1)!('CHANNEL_ERROR'));
    expect(onSubscriptionError).toHaveBeenCalledTimes(2);
    expect(toasts()).toHaveLength(2);
    unmount();
  } finally {
    vi.useRealTimers();
  }
});

it('a remount inside the same outage does not toast the same channel again', () => {
  __resetRealtimeDegradationPolicyForTests();
  const toasts = () => f.emit.mock.calls.filter(([event]) => event === 'SHOW_TOAST');
  const options = {
    channelName: 'member-record-remount',
    table: 'club_members',
    filter: 'club_id=eq.test',
    event: '*' as const,
    onPayload: vi.fn(),
    degradedToast: 'The Live Member Connection Could Not Be Established.',
  };
  const first = renderHook(() => useMasterBusChannel(options));
  act(() => f.statuses[0]('CHANNEL_ERROR'));
  first.unmount();
  renderHook(() => useMasterBusChannel(options));
  act(() => f.statuses[1]('CHANNEL_ERROR'));
  expect(toasts()).toHaveLength(1);
});
