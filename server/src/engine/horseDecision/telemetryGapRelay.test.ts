/**
 * A Horse decision worker thread's lost telemetry batch is alerted by the main thread (2026-11-14), and the
 * worker's shutdown series stays inside the engine's graceful deadline.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
const mocked = vi.hoisted(() => ({ raise: vi.fn() }));
vi.mock('../../services/horseTelemetryGapAlert.js', () => ({
  raiseHorseTelemetryGapAlert: mocked.raise,
}));
import { LiveHorseDecisionWorkerClient } from './client.js';
import { HORSE_JOURNAL_STOP_TIMEOUT_MS } from '../../services/HorseDecisionJournal.js';
import { BRAIN_TELEMETRY_SHUTDOWN_BUDGET_MS } from '../../services/BrainTelemetryFlush.js';

const source = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

afterEach(() => mocked.raise.mockReset());

describe('worker telemetry gap relay', () => {
  it('raises the alert on the main thread for a gap the worker posts, and does not treat it as a fault', async () => {
    mocked.raise.mockResolvedValue(undefined);
    let onMessage: ((message: unknown) => void) | null = null;
    const posted: unknown[] = [];
    const client = new LiveHorseDecisionWorkerClient({
      workerFactory: () =>
        ({
          postMessage: (message: unknown) => posted.push(message),
          on: (event: string, handler: (message: unknown) => void) => {
            if (event === 'message') onMessage = handler;
          },
          terminate: async () => 0,
        }) as never,
      maxInFlight: 1,
    });
    const gap = {
      kind: 'abandoned',
      batches: 1,
      day: '2026-11-14',
      workerId: 'worker-publisher-id',
      thread: 'worker',
    };
    onMessage!({ type: 'HORSE_TELEMETRY_GAP', gap });
    expect(mocked.raise).toHaveBeenCalledTimes(1);
    expect(mocked.raise).toHaveBeenCalledWith(gap);
    expect(client.status().lastError).toBeNull();
    await client.stop().catch(() => undefined);
  });

  it('gives the worker thread a sink that posts to the main thread before the runtime starts', () => {
    const worker = source('./worker.ts');
    const sink = worker.indexOf(
      "setBrainTelemetryGapSink((gap) => port.postMessage({ type: 'HORSE_TELEMETRY_GAP', gap }));"
    );
    expect(sink).toBeGreaterThan(-1);
    expect(sink).toBeLessThan(worker.indexOf('void runtime.start();'));
  });

  it('never loads the engine alert module in the flush service a worker thread runs', () => {
    const flush = source('../../services/BrainTelemetryFlush.ts');
    // a static value import would open a second owner of the main thread's alert journal in every worker
    expect(flush).not.toMatch(
      /^import \{[^}]*\} from '\.\/(horseTelemetryGapAlert|engineAlerts)\.js';/m
    );
    expect(flush).toMatch(/^import type \{[^}]*\} from '\.\/horseTelemetryGapAlert\.js';/m);
    expect(flush).toContain(
      "else if (isMainThread)\n      void import('./horseTelemetryGapAlert.js')"
    );
  });
});

describe('the worker shutdown series fits the engine deadline', () => {
  it('stops the journal, then the telemetry, in that order', () => {
    const runtime = source('./workerRuntime.ts');
    const stop = runtime.slice(runtime.indexOf('async function stopOwnedServices()'));
    const journal = stop.indexOf('await stopHorseDecisionJournal();');
    const telemetry = stop.indexOf('stopBrainTelemetryFlush()');
    expect(journal).toBeGreaterThan(-1);
    expect(telemetry).toBeGreaterThan(journal);
  });

  it('between-hands drain + journal stop + telemetry stop is inside the graceful deadline', () => {
    const constant = (file: string, name: string) => {
      const match = new RegExp(`const ${name} = ([0-9_]+);`).exec(source(file));
      expect(match, `${name} in ${file}`).not.toBeNull();
      return Number(match![1]!.replaceAll('_', ''));
    };
    const deadline = constant('../../index.ts', 'SHUTDOWN_DEADLINE_MS');
    const drain = constant('../../GameServer.ts', 'DRAIN_BUDGET_MS');
    // the journal's stop gives up at its own timer; the telemetry stop starts no write that could end past its
    // budget (BrainTelemetryFlush.gapsAndStopEvidence.test.ts proves that against a slow writer)
    const series = HORSE_JOURNAL_STOP_TIMEOUT_MS + BRAIN_TELEMETRY_SHUTDOWN_BUDGET_MS;
    expect(series).toBe(25_000);
    expect(drain + series).toBeLessThan(deadline);
    expect(deadline - (drain + series)).toBe(3_000);
  });
});
