import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  installRealtimeLiveness,
  RESUME_EVENTS,
  RESUME_PROBE_MS,
  REALTIME_HEARTBEAT_MS,
  type RealtimeLivenessClient,
} from '../../src/lib/realtimeLiveness';

// Dan 2026-11-05: knockouts sent while a phone's realtime socket was dead never
// reached the felt. A page that comes back must find a dead socket at once.
function harness(connected: boolean) {
  const listeners = new Map<string, () => void>();
  let visible = true;
  let pendingTimer: (() => void) | null = null;
  const client: RealtimeLivenessClient = {
    isConnected: vi.fn(() => connected),
    connect: vi.fn(),
    sendHeartbeat: vi.fn(() => {
      client.pendingHeartbeatRef = 'ref';
    }),
    pendingHeartbeatRef: null,
  };
  const env = {
    addEventListener: (type: string, fn: () => void) => listeners.set(type, fn),
    removeEventListener: (type: string) => listeners.delete(type),
    isVisible: () => visible,
    setTimeout: (fn: () => void) => {
      pendingTimer = fn;
      return 1;
    },
    clearTimeout: () => {
      pendingTimer = null;
    },
    now: () => 0,
  };
  const report = vi.fn();
  const dispose = installRealtimeLiveness(client, env, report);
  return {
    client,
    report,
    dispose,
    listeners,
    fire: (type = 'visibilitychange') => listeners.get(type)?.(),
    runProbe: () => {
      const fn = pendingTimer;
      pendingTimer = null;
      fn?.();
    },
    hide: () => {
      visible = false;
    },
  };
}

describe('a resumed page finds a dead realtime socket at once', () => {
  it('listens for every way a page comes back', () => {
    const h = harness(true);
    expect([...h.listeners.keys()].sort()).toEqual([...RESUME_EVENTS].sort());
  });
  it('connects at once when the socket is already known closed', () => {
    const h = harness(false);
    h.fire('pageshow');
    expect(h.client.connect).toHaveBeenCalledTimes(1);
    expect(h.client.sendHeartbeat).not.toHaveBeenCalled();
    expect(h.report).toHaveBeenCalledWith('not_connected', {});
  });
  it('leaves a live socket alone once its probe beat is answered', () => {
    const h = harness(true);
    h.fire();
    expect(h.client.sendHeartbeat).toHaveBeenCalledTimes(1);
    h.client.pendingHeartbeatRef = null; // the server answered
    h.runProbe();
    expect(h.client.sendHeartbeat).toHaveBeenCalledTimes(1);
    expect(h.report).not.toHaveBeenCalled();
  });
  it('forces the SDK heartbeat timeout when the probe beat goes unanswered', () => {
    const h = harness(true);
    h.fire('online');
    h.runProbe();
    expect(h.client.sendHeartbeat).toHaveBeenCalledTimes(2);
    expect(h.report).toHaveBeenCalledWith('unanswered_heartbeat', { waitedMs: 0 });
  });
  it('runs one probe at a time', () => {
    const h = harness(true);
    h.fire('focus');
    h.fire('visibilitychange');
    expect(h.client.sendHeartbeat).toHaveBeenCalledTimes(1);
  });
  it('does nothing for a page that is still hidden', () => {
    const h = harness(false);
    h.hide();
    h.fire();
    expect(h.client.connect).not.toHaveBeenCalled();
  });
  it('removes every listener on dispose', () => {
    const h = harness(true);
    h.dispose();
    expect(h.listeners.size).toBe(0);
  });
  it('probes quickly and beats faster than the SDK default', () => {
    expect(RESUME_PROBE_MS).toBeLessThanOrEqual(5_000);
    expect(REALTIME_HEARTBEAT_MS).toBeLessThan(25_000);
  });
});

describe('the shared client is wired for liveness', () => {
  const client = readFileSync(resolve(process.cwd(), 'src/lib/supabase.ts'), 'utf8');
  it('beats from a worker at the shorter interval', () => {
    expect(client).toContain('heartbeatIntervalMs: REALTIME_HEARTBEAT_MS,');
    expect(client).toContain("worker: typeof Worker !== 'undefined',");
  });
  it('installs the resume probe on the one realtime client', () => {
    expect(client).toMatch(
      /installRealtimeLiveness\(supabase\.realtime as unknown as RealtimeLivenessClient\);/
    );
  });
});

describe('the tournament channel rejoin re-reads what a drop hid', () => {
  const page = readFileSync(resolve(process.cwd(), 'src/pages/TablePage.tsx'), 'utf8');
  it('re-reads heads and chests beside the break on every SUBSCRIBED', () => {
    const at = page.indexOf('if (isMounted) void refreshTournamentBreakRef.current();');
    expect(at).toBeGreaterThan(0);
    const end = page.indexOf("if (status === 'CHANNEL_ERROR')", at);
    expect(end).toBeGreaterThan(at);
    const block = page.slice(at, end);
    expect(block).toContain('void bountyMapRefreshRef.current?.();');
    expect(block).toContain('restoreMysteryBountyStateRef.current();');
  });
});
