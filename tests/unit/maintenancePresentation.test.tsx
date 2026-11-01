import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  health: vi.fn(),
  rpc: vi.fn(),
  lobby: null as null | ((value: unknown) => void),
  status: null as null | ((value: string) => void),
}));
vi.mock('../../src/lib/supabase', () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock('../../src/services/GameServerAPI', () => ({ getServerStatus: mocks.health }));
vi.mock('../../src/services/EngineStateClient', () => ({
  engineChannelClient: {
    onStatusChange: (callback: (value: string) => void) => {
      mocks.status = callback;
      return () => {};
    },
  },
}));
vi.mock('../../src/services/RealtimeChannelService', () => ({
  realtimeChannelService: {
    subscribeToLobby: ({ onMaintenance }: { onMaintenance: (value: unknown) => void }) => {
      mocks.lobby = onMaintenance;
      return () => {};
    },
  },
}));
vi.mock('../../src/utils/serverClock', () => ({ serverNow: () => Date.now() }));
import { useMaintenanceBreak } from '../../src/hooks/useMaintenanceBreak';
const epoch = Date.parse('2026-09-17T10:00:00Z');
const event = (extra = {}) => ({
  active: true,
  phase: 'counting_down',
  break_id: epoch - 420000,
  break_ends_at: epoch + 1000,
  timestamp: Date.now(),
  ...extra,
});
const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(epoch);
  mocks.health.mockReset().mockResolvedValue(null);
  mocks.rpc.mockReset().mockResolvedValue({ data: null });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
describe('the countdown follows certified release', () => {
  it('keeps the break finalizing when the deadline expires during an outage', async () => {
    const h = renderHook(() => useMaintenanceBreak());
    await flush();
    act(() => h.result.current.ingestMaintenanceEvent('MAINTENANCE_BREAK', event()));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1001);
    });
    expect(h.result.current.maintenanceBreak).toMatchObject({ active: true, phase: 'finalizing' });
    expect(mocks.health).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(mocks.health).toHaveBeenCalledTimes(2);
  });
  it('does not let a delayed read restore a break after the end event', async () => {
    let resolve!: (value: unknown) => void;
    mocks.health.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        })
    );
    const h = renderHook(() => useMaintenanceBreak());
    act(() => h.result.current.ingestMaintenanceEvent('MAINTENANCE_BREAK_ENDED', event()));
    resolve({
      maintenance: {
        presentation: event(),
        schedule: {
          timeZone: 'America/Chicago',
          startHour: null,
          startMinute: 0,
          durationMs: 300000,
          nextAnnouncementAt: epoch + 1000,
          hourlyCashFreeze: true,
          frequency: 'phase1-hourly',
          policyId: 'phase1-hourly-01a1944f',
        },
      },
    });
    await flush();
    expect(h.result.current.maintenanceBreak.active).toBe(false);
    expect(h.result.current.routineSchedule).toBe('unknown');
    act(() => h.result.current.ingestMaintenanceEvent('MAINTENANCE_BREAK', event()));
    expect(h.result.current.maintenanceBreak.active).toBe(false);
  });
  it('accepts a fresh health release on reconnect and ignores an older break end', async () => {
    const h = renderHook(() => useMaintenanceBreak());
    await flush();
    act(() =>
      h.result.current.ingestMaintenanceEvent('MAINTENANCE_BREAK', event({ break_id: epoch }))
    );
    act(() =>
      h.result.current.ingestMaintenanceEvent(
        'MAINTENANCE_BREAK_ENDED',
        event({ break_id: epoch - 1 })
      )
    );
    expect(h.result.current.maintenanceBreak.active).toBe(true);
    mocks.health.mockResolvedValue({
      maintenance: { presentation: event({ active: false, phase: 'idle', break_id: epoch }) },
    });
    act(() => mocks.status?.('connected'));
    await flush();
    expect(h.result.current.maintenanceBreak.active).toBe(false);
  });
  it('uses certified time and lobby transitions without reopening an already resumed table', async () => {
    const h = renderHook(() => useMaintenanceBreak('table'));
    await flush();
    act(() =>
      h.result.current.ingestMaintenanceEvent(
        'MAINTENANCE_BREAK',
        event({ break_ends_at: epoch + 5000 })
      )
    );
    expect(h.result.current.maintenanceBreak.breakEndsAtMs).toBe(epoch + 5000);
    act(() => h.result.current.ingestMaintenanceEvent('MAINTENANCE_BREAK_ENDED', event()));
    act(() => mocks.lobby?.(event({ phase: 'resuming' })));
    expect(h.result.current.maintenanceBreak.active).toBe(false);
    act(() => mocks.lobby?.(event({ phase: 'last_hand', break_id: epoch + 1 })));
    expect(h.result.current.maintenanceBreak.phase).toBe('last_hand');
  });
  it('keeps a newly loaded persisted expired break visible as finalizing', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ phase: 'counting_down', break_ends_at: new Date(epoch - 1000).toISOString() }],
    });
    const h = renderHook(() => useMaintenanceBreak());
    await flush();
    expect(h.result.current.maintenanceBreak).toMatchObject({ active: true, phase: 'finalizing' });
  });
});

describe('routine notices use the existing serving health read', () => {
  it('transitions old daily to hourly to daily only on observed reconnect health', async () => {
    const daily = {
      timeZone: 'America/Chicago',
      startHour: 4,
      startMinute: 0,
      durationMs: 300000,
      nextAnnouncementAt: epoch + 1000,
      hourlyCashFreeze: false,
    };
    const presentation = event({ active: false, phase: 'idle' });
    mocks.health.mockResolvedValue({ maintenance: { presentation, schedule: daily } });
    const h = renderHook(() => useMaintenanceBreak());
    expect(h.result.current.routineSchedule).toBe('unknown');
    await flush();
    expect(h.result.current.routineSchedule).toBe('daily');
    mocks.health.mockResolvedValue({
      maintenance: {
        presentation,
        schedule: {
          ...daily,
          startHour: null,
          frequency: 'phase1-hourly',
          policyId: 'phase1-hourly-01a1944f',
          hourlyCashFreeze: true,
        },
      },
    });
    act(() => mocks.status?.('connected'));
    await flush();
    expect(h.result.current.routineSchedule).toBe('phase1-hourly');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(mocks.health).toHaveBeenCalledTimes(2);
    expect(h.result.current.routineSchedule).toBe('phase1-hourly');
    mocks.health.mockResolvedValue({
      maintenance: {
        presentation,
        schedule: { ...daily, frequency: 'daily', policyId: 'phase1-hourly-01a1944f' },
      },
    });
    act(() => window.dispatchEvent(new Event('online')));
    await flush();
    expect(h.result.current.routineSchedule).toBe('daily');
    mocks.health.mockResolvedValue(null);
    act(() =>
      h.result.current.ingestMaintenanceEvent(
        'MAINTENANCE_BREAK',
        event({ reason: 'Held Break', break_id: epoch + 1 })
      )
    );
    mocks.rpc.mockResolvedValue({
      data: [{ phase: 'counting_down', break_ends_at: new Date(epoch + 120000).toISOString() }],
    });
    act(() => mocks.status?.('connected'));
    await flush();
    expect(h.result.current.routineSchedule).toBe('unknown');
    expect(h.result.current.maintenanceBreak.reason).toBe('Held Break');
    expect(mocks.health).toHaveBeenCalledTimes(4);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
});

it('does not replace an accepted hourly schedule with later-requested but older health', async () => {
  const schedule = {
    timeZone: 'America/Chicago',
    startHour: null,
    startMinute: 0,
    durationMs: 300000,
    nextAnnouncementAt: epoch + 1000,
    hourlyCashFreeze: true,
    frequency: 'phase1-hourly',
    policyId: 'phase1-hourly-01a1944f',
  };
  mocks.health.mockResolvedValue({
    maintenance: { presentation: event({ timestamp: epoch }), schedule },
  });
  const h = renderHook(() => useMaintenanceBreak());
  await flush();
  expect(h.result.current.routineSchedule).toBe('phase1-hourly');
  act(() =>
    h.result.current.ingestMaintenanceEvent(
      'MAINTENANCE_BREAK',
      event({ timestamp: epoch + 2000, reason: 'Newer Event' })
    )
  );
  mocks.health.mockResolvedValue({
    maintenance: {
      presentation: event({ timestamp: epoch + 1000, reason: 'Older Health' }),
      schedule: { ...schedule, frequency: 'daily', startHour: 4, hourlyCashFreeze: false },
    },
  });
  // This request starts after the event: the request revision guard alone cannot reject it.
  act(() => mocks.status?.('connected'));
  await flush();
  expect(h.result.current.maintenanceBreak.reason).toBe('Newer Event');
  expect(h.result.current.routineSchedule).toBe('phase1-hourly');
});
