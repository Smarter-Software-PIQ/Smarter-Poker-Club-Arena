/**
 * A Horse decision worker thread's telemetry gap event reaches the sink the main process injects (2026-11-14),
 * nothing on the decision path imports the engine alert module, and the worker's shutdown series stays inside
 * the engine's graceful deadline.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiveHorseDecisionWorkerClient } from './client.js';
import { HORSE_JOURNAL_STOP_TIMEOUT_MS } from '../../services/HorseDecisionJournal.js';
import {
  BRAIN_TELEMETRY_SHUTDOWN_BUDGET_MS,
  setBrainTelemetryGapSink,
} from '../../services/BrainTelemetryFlush.js';

const source = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

afterEach(() => setBrainTelemetryGapSink(null));

function clientWithFakeWorker() {
  let onMessage: ((message: unknown) => void) | null = null;
  const client = new LiveHorseDecisionWorkerClient({
    workerFactory: () =>
      ({
        postMessage: () => undefined,
        on: (event: string, handler: (message: unknown) => void) => {
          if (event === 'message') onMessage = handler;
        },
        terminate: async () => 0,
      }) as never,
    maxInFlight: 1,
  });
  return { client, send: (message: unknown) => onMessage!(message) };
}

describe('worker telemetry gap relay', () => {
  it('hands a gap the worker posts to the sink the main process injected, and does not treat it as a fault', async () => {
    const sink = vi.fn();
    setBrainTelemetryGapSink(sink);
    const { client, send } = clientWithFakeWorker();
    const gap = {
      kind: 'abandoned',
      batches: 1,
      day: '2026-11-14',
      workerId: 'worker-publisher-id',
      thread: 'worker',
    };
    const written = { kind: 'written', day: '2026-11-15', workerId: 'w', thread: 'worker' };
    send({ type: 'HORSE_TELEMETRY_GAP', gap });
    send({ type: 'HORSE_TELEMETRY_GAP', gap: written });
    expect(sink.mock.calls).toEqual([[gap], [written]]);
    expect(client.status().lastError).toBeNull();
    await client.stop().catch(() => undefined);
  });

  it('is harmless when the main process injected no sink, and when the sink throws', async () => {
    const { client, send } = clientWithFakeWorker();
    send({ type: 'HORSE_TELEMETRY_GAP', gap: { kind: 'rejected' } });
    setBrainTelemetryGapSink(() => {
      throw new Error('alert path down');
    });
    send({ type: 'HORSE_TELEMETRY_GAP', gap: { kind: 'rejected' } });
    expect(client.status().lastError).toBeNull();
    await client.stop().catch(() => undefined);
  });

  it('the main process injects the engine alert handler before the telemetry flush starts', () => {
    const index = source('../../index.ts');
    const wire = index.indexOf(
      'setBrainTelemetryGapSink((event) => void handleHorseTelemetryGapEvent(event));'
    );
    expect(wire).toBeGreaterThan(-1);
    expect(index.indexOf('  startBrainTelemetryFlush();', wire)).toBeGreaterThan(wire);
    expect(index.lastIndexOf('  startBrainTelemetryFlush();')).toBe(
      index.indexOf('  startBrainTelemetryFlush();', wire)
    );
  });

  it('no file on the worker relay path loads the engine alert module', () => {
    for (const file of [
      '../../services/BrainTelemetryFlush.ts',
      '../../services/HorseBrainTelemetryPublisher.ts',
      './client.ts',
      './worker.ts',
      './workerRuntime.ts',
      './protocol.ts',
    ]) {
      const text = source(file);
      // a value import, a side-effect import or a dynamic import: each is a closure edge and a second journal owner
      expect(text, file).not.toMatch(
        /^import (?!type )[^;]*from '[^']*(horseTelemetryGapAlert|engineAlert[A-Za-z]*)\.js';/m
      );
      expect(text, file).not.toMatch(
        /import\(\s*'[^']*(horseTelemetryGapAlert|engineAlert[A-Za-z]*)\.js'\s*\)\s*\.then/
      );
      expect(text, file).not.toMatch(
        /await import\(\s*'[^']*(horseTelemetryGapAlert|engineAlert[A-Za-z]*)\.js'/
      );
    }
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
