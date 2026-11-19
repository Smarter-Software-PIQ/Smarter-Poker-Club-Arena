import { afterEach, describe, expect, it } from 'vitest';
import {
  MAX_LIFECYCLE_DETAIL_BYTES,
  MAX_LIFECYCLE_IN_FLIGHT,
  MAX_LIFECYCLE_MESSAGE_CHARS,
  MAX_LIFECYCLE_STACK_CHARS,
  _resetEngineLifecycleLogForTests,
  _setEngineLifecycleLogSinkForTests,
  buildEngineLifecycleLogRow,
  flushEngineLifecycleLogs,
  recordEngineLifecycleLog,
  type EngineLifecycleLogRow,
} from './engineLifecycleLog.js';

afterEach(() => {
  _resetEngineLifecycleLogForTests();
});

describe('engineLifecycleLog', () => {
  it('persists structured boot/fatal rows via the sink without throwing', async () => {
    const rows: EngineLifecycleLogRow[] = [];
    _setEngineLifecycleLogSinkForTests(async (row) => {
      rows.push(row);
    });

    const err = new Error('boom during boot');
    const ok = await recordEngineLifecycleLog({
      level: 'fatal',
      event: 'fatal_error',
      message: 'boom during boot',
      error: err,
      detail: { kind: 'GameServer.Uncaught_exception' },
    });

    expect(ok).toBe(true);
    expect(rows).toHaveLength(1);
    expect(rows[0].level).toBe('fatal');
    expect(rows[0].event).toBe('fatal_error');
    expect(rows[0].instance_id.length).toBeGreaterThan(0);
    expect(rows[0].detail.kind).toBe('GameServer.Uncaught_exception');
    expect(rows[0].detail.errorName).toBe('Error');
    expect(typeof rows[0].detail.stack).toBe('string');
  });

  it('never throws when the database sink rejects', async () => {
    _setEngineLifecycleLogSinkForTests(async () => {
      throw new Error('database unavailable');
    });

    const ok = await recordEngineLifecycleLog({
      level: 'error',
      event: 'shutdown_failed',
      message: 'shutdown failed',
    });

    expect(ok).toBe(false);
  });

  it('bounds message, stack, and oversized or circular detail payloads', () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    const hugeError = new Error('x'.repeat(5_000));
    hugeError.stack = 's'.repeat(10_000);

    const row = buildEngineLifecycleLogRow({
      level: 'fatal',
      event: 'e'.repeat(300),
      message: 'm'.repeat(5_000),
      error: hugeError,
      detail: { blob: 'z'.repeat(20_000) },
    });
    expect(row.message.length).toBeLessThanOrEqual(MAX_LIFECYCLE_MESSAGE_CHARS);
    expect(row.event.length).toBeLessThanOrEqual(120);
    expect(Buffer.byteLength(JSON.stringify(row.detail), 'utf8')).toBeLessThanOrEqual(
      MAX_LIFECYCLE_DETAIL_BYTES
    );
    expect(row.detail.truncated).toBe(true);

    const circularRow = buildEngineLifecycleLogRow({
      level: 'fatal',
      event: 'fatal_error',
      message: 'circular',
      detail: circular,
    });
    expect(circularRow.detail.truncated).toBe(true);

    const normalStackRow = buildEngineLifecycleLogRow({
      level: 'fatal',
      event: 'fatal_error',
      message: 'long stack',
      error: hugeError,
    });
    expect(String(normalStackRow.detail.stack).length).toBeLessThanOrEqual(
      MAX_LIFECYCLE_STACK_CHARS
    );
  });

  it('drops excess writes beyond MAX_LIFECYCLE_IN_FLIGHT so memory stays bounded', async () => {
    const releases: Array<() => void> = [];
    _setEngineLifecycleLogSinkForTests(
      () =>
        new Promise<void>((resolve) => {
          releases.push(resolve);
        })
    );

    const pending: Array<Promise<boolean>> = [];
    for (let i = 0; i < MAX_LIFECYCLE_IN_FLIGHT; i++) {
      pending.push(recordEngineLifecycleLog({ level: 'info', event: 'boot', message: `msg-${i}` }));
    }
    const overflow = await recordEngineLifecycleLog({
      level: 'info',
      event: 'boot',
      message: 'overflow',
    });
    expect(overflow).toBe(false);

    for (const release of releases) release();
    const results = await Promise.all(pending);
    expect(results.every((r) => r === true)).toBe(true);
  });

  it('flushEngineLifecycleLogs returns within its timeout even if the DB hangs', async () => {
    let release!: () => void;
    _setEngineLifecycleLogSinkForTests(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );

    void recordEngineLifecycleLog({ level: 'fatal', event: 'fatal_error', message: 'hung db' });
    const started = Date.now();
    await flushEngineLifecycleLogs(50);
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(500);
    release();
  });
});
