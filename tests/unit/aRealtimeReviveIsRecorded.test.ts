import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FORCED_LOSS_WINDOW_MS,
  REJOIN_DEADLINE_MS,
  __resetRealtimeRevivalForTests,
  markForcedReconnect,
  noteRevivalRejoined,
  setRevivalSink,
  wasForcedByLiveness,
  type RevivalRecord,
} from '../../src/lib/realtimeRevival';
import {
  REVIVE_REPORT_WINDOW_MS,
  __resetRevivalWriteForTests,
  mayWriteRevival,
  writeRevival,
  type RevivalRowWriter,
} from '../../src/lib/realtimeLiveness';
import {
  __resetRealtimeTransportLossForTests,
  noteRealtimeTransportLoss,
  noteRealtimeTransportRecovered,
} from '../../src/lib/realtimeTransportLoss';

const reportError = vi.hoisted(() => vi.fn());
vi.mock('../../src/utils/errorReporter', () => ({
  reportError,
  reportWarning: vi.fn(),
}));

// 2026-11-06: the resume revive was console-only, so production could not see
// that #9645 ever fired. Every forced reconnect is now measured and recorded.
function timers() {
  let fire: (() => void) | null = null;
  return {
    t: {
      setTimeout: (fn: () => void) => {
        fire = fn;
        return 7;
      },
      clearTimeout: vi.fn(() => {
        fire = null;
      }),
    },
    expire: () => {
      const f = fire;
      fire = null;
      f?.();
    },
  };
}

function writer(userId: string | null, error: { message: string } | null = null) {
  const rows: Record<string, unknown>[] = [];
  const w: RevivalRowWriter = {
    userId: async () => userId,
    insert: async (row) => {
      rows.push(row);
      return { error };
    },
  };
  return { rows, make: async () => w };
}

afterEach(() => {
  __resetRealtimeRevivalForTests();
  __resetRevivalWriteForTests();
  __resetRealtimeTransportLossForTests();
  reportError.mockReset();
});

describe('a forced reconnect is measured from resume to rejoin', () => {
  it('records the gap when a channel joins again', () => {
    const got: RevivalRecord[] = [];
    setRevivalSink((r) => got.push(r));
    const { t } = timers();
    markForcedReconnect('unanswered_heartbeat', 3000, 1_000, 4_000, t);
    noteRevivalRejoined(5_250);
    expect(got).toEqual([
      { reason: 'unanswered_heartbeat', rejoined: true, gapMs: 4_250, waitedMs: 3000 },
    ]);
    expect(t.clearTimeout).toHaveBeenCalledWith(7);
  });
  it('records rejoined false when nothing joins before the deadline', () => {
    const got: RevivalRecord[] = [];
    setRevivalSink((r) => got.push(r));
    const { t, expire } = timers();
    markForcedReconnect('not_connected', null, 0, 0, t);
    expire();
    noteRevivalRejoined(REJOIN_DEADLINE_MS + 1);
    expect(got).toEqual([
      { reason: 'not_connected', rejoined: false, gapMs: null, waitedMs: null },
    ]);
  });
  it('keeps one open measurement and ignores joins with none open', () => {
    const got: RevivalRecord[] = [];
    setRevivalSink((r) => got.push(r));
    noteRevivalRejoined(10);
    const { t } = timers();
    markForcedReconnect('not_connected', null, 0, 0, t);
    markForcedReconnect('unanswered_heartbeat', 3000, 50, 50, t);
    noteRevivalRejoined(100);
    expect(got).toHaveLength(1);
    expect(got[0].reason).toBe('not_connected');
  });
  it('a sink that throws never breaks the page', () => {
    setRevivalSink(() => {
      throw new Error('boom');
    });
    const { t } = timers();
    markForcedReconnect('not_connected', null, 0, 0, t);
    expect(() => noteRevivalRejoined(5)).not.toThrow();
  });
  it('a transport recovery closes the open measurement', () => {
    const got: RevivalRecord[] = [];
    setRevivalSink((r) => got.push(r));
    const { t } = timers();
    markForcedReconnect('not_connected', null, Date.now(), Date.now(), t);
    noteRealtimeTransportRecovered();
    expect(got).toHaveLength(1);
    expect(got[0].rejoined).toBe(true);
  });
});

describe('a loss caused by the forced reconnect says so', () => {
  it('tags a loss inside the window and not one after it', () => {
    const { t } = timers();
    markForcedReconnect('unanswered_heartbeat', 3000, 0, 1_000, t);
    expect(wasForcedByLiveness(1_000 + FORCED_LOSS_WINDOW_MS)).toBe(true);
    expect(wasForcedByLiveness(1_000 + FORCED_LOSS_WINDOW_MS + 1)).toBe(false);
    expect(wasForcedByLiveness(999)).toBe(false);
  });
  it('files the transport loss with forcedByLiveness right after a forced reconnect', () => {
    const { t } = timers();
    markForcedReconnect('unanswered_heartbeat', 3000, Date.now(), Date.now(), t);
    noteRealtimeTransportLoss('ch', 'test', undefined, Date.now());
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError.mock.calls[0][2]).toMatchObject({ forcedByLiveness: true });
  });
  it('files an organic loss without the tag', () => {
    noteRealtimeTransportLoss('ch', 'test', undefined, Date.now());
    expect(reportError.mock.calls[0][2]).not.toHaveProperty('forcedByLiveness');
  });
});

describe('a finished measurement is written durably, throttled and signed in only', () => {
  const record: RevivalRecord = {
    reason: 'unanswered_heartbeat',
    rejoined: true,
    gapMs: 4250,
    waitedMs: 3000.4,
  };
  it('writes the player row with every field', async () => {
    const w = writer('user-1');
    expect(await writeRevival(record, 0, w.make)).toBe(true);
    expect(w.rows).toHaveLength(1);
    expect(w.rows[0]).toMatchObject({
      user_id: 'user-1',
      reason: 'unanswered_heartbeat',
      rejoined: true,
      gap_ms: 4250,
      waited_ms: 3000,
    });
  });
  it('writes at most one row per window', async () => {
    const w = writer('user-1');
    await writeRevival(record, 0, w.make);
    expect(await writeRevival(record, REVIVE_REPORT_WINDOW_MS - 1, w.make)).toBe(false);
    expect(await writeRevival(record, REVIVE_REPORT_WINDOW_MS, w.make)).toBe(true);
    expect(w.rows).toHaveLength(2);
    expect(mayWriteRevival(5, null)).toBe(true);
  });
  it('writes nothing for a signed-out page', async () => {
    const w = writer(null);
    expect(await writeRevival(record, 0, w.make)).toBe(false);
    expect(w.rows).toHaveLength(0);
  });
  it('a refused insert or a failing writer never throws', async () => {
    const refused = writer('user-1', { message: 'rls' });
    expect(await writeRevival(record, 0, refused.make)).toBe(false);
    __resetRevivalWriteForTests();
    const broken = async (): Promise<RevivalRowWriter> => {
      throw new Error('offline');
    };
    await expect(writeRevival(record, 0, broken)).resolves.toBe(false);
  });
});

describe('the revive writer stays out of the entry chunk', () => {
  const revival = readFileSync(resolve(process.cwd(), 'src/lib/realtimeRevival.ts'), 'utf8');
  const liveness = readFileSync(resolve(process.cwd(), 'src/lib/realtimeLiveness.ts'), 'utf8');
  it('the entry-side module imports nothing', () => {
    expect(revival).not.toMatch(/^import /m);
  });
  it('the liveness module owns the table write and registers the sink', () => {
    expect(liveness).toContain(".from('client_realtime_revivals')");
    expect(liveness).toContain('setRevivalSink((record) => void writeRevival(record));');
  });
});
