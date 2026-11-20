/**
 * Bounded, non-blocking database persistence for engine lifecycle events
 * (boot, shutdown, leadership loss, and FATAL / crash errors).
 *
 * Incident 075013fd (Lane 1): when a candidate or serving engine crashes on
 * boot or during play, operators must be able to read the crash reason and
 * stack directly from `public.engine_lifecycle_logs` without SSHing to the
 * Hetzner host.
 *
 * Three invariants:
 *   1. NEVER THROW, NEVER BLOCK the caller. Every write resolves to a boolean.
 *   2. BOUNDED IN MEMORY AND PAYLOAD. At most MAX_IN_FLIGHT concurrent writes
 *      are tracked; messages, stacks, and detail JSON are strictly truncated.
 *   3. BOUNDED FLUSH AT EXIT. `flushEngineLifecycleLogs(timeoutMs)` waits at
 *      most `timeoutMs` with an unref'd timer so a dead database can never
 *      delay or hang process exit.
 */

import { supabase } from './supabase/client.js';
import { INSTANCE_ID } from './tableLease.js';
import { ENGINE_RELEASE_IDENTITY } from '../releaseIdentity.js';
import { describeError } from './errorReporter.js';

export type EngineLifecycleLogLevel = 'info' | 'warn' | 'error' | 'fatal';

export interface EngineLifecycleLogInput {
  level: EngineLifecycleLogLevel;
  event: string;
  message: string;
  error?: unknown;
  detail?: Record<string, unknown>;
}

export interface EngineLifecycleLogRow {
  instance_id: string;
  release_sha: string | null;
  level: EngineLifecycleLogLevel;
  event: string;
  message: string;
  detail: Record<string, unknown>;
}

export type EngineLifecycleLogSink = (row: EngineLifecycleLogRow) => Promise<void>;

export const MAX_LIFECYCLE_MESSAGE_CHARS = 2_000;
export const MAX_LIFECYCLE_EVENT_CHARS = 120;
export const MAX_LIFECYCLE_STACK_CHARS = 4_000;
export const MAX_LIFECYCLE_DETAIL_BYTES = 8_192;
export const MAX_LIFECYCLE_IN_FLIGHT = 32;
export const DEFAULT_LIFECYCLE_FLUSH_TIMEOUT_MS = 2_000;

const inFlight = new Set<Promise<boolean>>();
let customSink: EngineLifecycleLogSink | null = null;

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 15))}...[truncated]`;
}

function serializeErrorDetail(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const out: Record<string, unknown> = {
      errorName: truncate(error.name || 'Error', 120),
      errorMessage: truncate(error.message || '', MAX_LIFECYCLE_MESSAGE_CHARS),
    };
    if (typeof error.stack === 'string' && error.stack.length > 0) {
      out.stack = truncate(error.stack, MAX_LIFECYCLE_STACK_CHARS);
    }
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' || typeof code === 'number') {
      out.code = String(code).slice(0, 64);
    }
    return out;
  }
  return {
    errorMessage: truncate(describeError(error), MAX_LIFECYCLE_MESSAGE_CHARS),
  };
}

function buildBoundedDetail(input: EngineLifecycleLogInput): Record<string, unknown> {
  const mem = process.memoryUsage();
  const base: Record<string, unknown> = {
    pid: process.pid,
    uptimeSec: Math.round(process.uptime()),
    rssBytes: mem.rss,
    heapUsedBytes: mem.heapUsed,
    ...(input.detail ?? {}),
    ...(input.error !== undefined ? serializeErrorDetail(input.error) : {}),
  };
  try {
    const encoded = JSON.stringify(base);
    if (Buffer.byteLength(encoded, 'utf8') <= MAX_LIFECYCLE_DETAIL_BYTES) {
      return JSON.parse(encoded) as Record<string, unknown>;
    }
  } catch {
    // Fall through to minimal safe object on circular or unserializable input.
  }
  return {
    pid: process.pid,
    uptimeSec: Math.round(process.uptime()),
    rssBytes: mem.rss,
    heapUsedBytes: mem.heapUsed,
    truncated: true,
    ...(input.error !== undefined
      ? { errorMessage: truncate(describeError(input.error), 512) }
      : {}),
  };
}

export function buildEngineLifecycleLogRow(input: EngineLifecycleLogInput): EngineLifecycleLogRow {
  const releaseSha =
    ENGINE_RELEASE_IDENTITY.releaseSha || process.env.GIT_COMMIT_SHA?.trim() || null;
  return {
    instance_id: truncate(String(INSTANCE_ID || `pid-${process.pid}`), 128),
    release_sha: releaseSha ? releaseSha.slice(0, 64) : null,
    level: input.level,
    event: truncate(
      String(input.event || 'unknown').trim() || 'unknown',
      MAX_LIFECYCLE_EVENT_CHARS
    ),
    message: truncate(String(input.message ?? ''), MAX_LIFECYCLE_MESSAGE_CHARS),
    detail: buildBoundedDetail(input),
  };
}

async function defaultSink(row: EngineLifecycleLogRow): Promise<void> {
  const { error } = await supabase.from('engine_lifecycle_logs').insert(row);
  if (error) {
    throw new Error(error.message || 'engine_lifecycle_logs insert failed');
  }
}

export function recordEngineLifecycleLog(input: EngineLifecycleLogInput): Promise<boolean> {
  // Under Vitest / unit tests without an injected sink, stay silent so no
  // test makes unexpected network calls.
  if (!customSink && (process.env.VITEST || process.env.NODE_ENV === 'test')) {
    return Promise.resolve(false);
  }
  if (inFlight.size >= MAX_LIFECYCLE_IN_FLIGHT) {
    return Promise.resolve(false);
  }

  let row: EngineLifecycleLogRow;
  try {
    row = buildEngineLifecycleLogRow(input);
  } catch {
    return Promise.resolve(false);
  }

  const sink = customSink ?? defaultSink;
  const writePromise: Promise<boolean> = Promise.resolve()
    .then(() => sink(row))
    .then(
      () => true,
      () => false
    );

  inFlight.add(writePromise);
  void writePromise.finally(() => {
    inFlight.delete(writePromise);
  });
  return writePromise;
}

export async function flushEngineLifecycleLogs(
  timeoutMs: number = DEFAULT_LIFECYCLE_FLUSH_TIMEOUT_MS
): Promise<void> {
  if (inFlight.size === 0) return;
  const pending = Array.from(inFlight);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.allSettled(pending),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, Math.max(0, timeoutMs));
        timer.unref();
      }),
    ]);
  } catch {
    // Flushing lifecycle logs must never throw during shutdown.
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Test seams */
export function _setEngineLifecycleLogSinkForTests(sink: EngineLifecycleLogSink | null): void {
  customSink = sink;
}

export function _resetEngineLifecycleLogForTests(): void {
  customSink = null;
  inFlight.clear();
}
