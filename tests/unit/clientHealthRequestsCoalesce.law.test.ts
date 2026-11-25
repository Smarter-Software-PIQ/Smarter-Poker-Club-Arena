/**
 * CLIENT /health CALLERS COALESCE CONCURRENT IN-FLIGHT REQUESTS (2026-11-24).
 *
 * Incident b87d2b52 / 7bf7a01f: PR #11808 mounted `usePrivateGameInviteLauncher()`
 * on every tournament card and lobby row (100-250+ simultaneous mounts per lobby),
 * calling `privateGameHoldsSupported()` with no in-flight Promise deduplication.
 * Every cold lobby load fired 100-250+ concurrent `GET /health` requests over
 * HTTP/2, overflowing Node's port 8080 listen backlog during Playwright E2E and
 * starving Docker's HEALTHCHECK on a healthy dealing engine.
 *
 * This law test proves:
 *   1. 200 concurrent `privateGameHoldsSupported()` / `privateSitAndGoHoldsSupported()`
 *      calls share strictly 1 `fetch('/health')`, preserve the 60s TTL cache on
 *      success, retry cleanly after errors, and reset both cache and in-flight
 *      state via `_resetPrivateGameSupportForTests()`.
 *   2. 50 concurrent `readCashRakePolicyVersion()` calls share strictly 1
 *      `fetch('/health')` and retry cleanly after errors.
 *   3. 50 concurrent `getServerStatus()` calls share strictly 1 `fetch('/health')`
 *      and retry cleanly after errors.
 *   4. Every direct `fetch` / `engineFetch` caller of `/health` anywhere in `src/`
 *      is structurally guarded by an in-flight coalescing gate cleared in `.finally()`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { sliceMethod } from '../helpers/sourceWindow';

vi.mock('../../src/lib/supabase', () => ({
  supabase: { rpc: vi.fn() },
}));

vi.mock('../../src/lib/authToken', () => ({
  getFreshAccessToken: async () => null,
}));

import {
  _resetPrivateGameSupportForTests,
  privateGameHoldsSupported,
  privateSitAndGoHoldsSupported,
} from '../../src/lib/privateGameInvite';
import {
  _resetCashRakePolicyVersionForTests,
  readCashRakePolicyVersion,
} from '../../src/services/cashRakePolicyVersion';
import { getServerStatus } from '../../src/services/GameServerAPI';

const ROOT = path.resolve(__dirname, '../..');

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
      collectSourceFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe('privateGameHoldsSupported coalesces concurrent /health probes', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    _resetPrivateGameSupportForTests();
  });

  it('200 concurrent calls issue strictly 1 fetch(/health) and resolve identically', async () => {
    const gate = deferred<{ ok: boolean; json: () => Promise<unknown> }>();
    const fetchMock = vi.fn(() => gate.promise);
    vi.stubGlobal('fetch', fetchMock);

    const calls = Array.from({ length: 200 }, (_, i) =>
      i % 2 === 0 ? privateGameHoldsSupported() : privateSitAndGoHoldsSupported()
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);

    gate.resolve({
      ok: true,
      json: async () => ({ privateGameHolds: 1, privateSitAndGoHolds: 1 }),
    });
    const results = await Promise.all(calls);
    expect(results).toHaveLength(200);
    expect(results.every((value) => value === true)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Subsequent call within 60s TTL reuses the cached answer with 0 extra fetches.
    expect(await privateGameHoldsSupported()).toBe(true);
    expect(await privateSitAndGoHoldsSupported()).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('200 concurrent privateGameHoldsSupported() calls share 1 fetch and refresh after 60s TTL', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-24T04:00:00Z'));

    let generation = 0;
    const fetchMock = vi.fn(async () => {
      generation += 1;
      return {
        ok: true,
        json: async () => ({
          privateGameHolds: generation === 1 ? 1 : 0,
          privateSitAndGoHolds: 0,
        }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const firstWave = await Promise.all(
      Array.from({ length: 200 }, () => privateGameHoldsSupported())
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(firstWave.every((v) => v === true)).toBe(true);

    vi.advanceTimersByTime(59_000);
    expect(await privateGameHoldsSupported()).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2_000);
    expect(await privateGameHoldsSupported()).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('clears in-flight state on rejection so a subsequent call retries cleanly', async () => {
    const first = deferred<{ ok: boolean; json: () => Promise<unknown> }>();
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ privateGameHolds: 1, privateSitAndGoHolds: 1 }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const pending = Promise.all(Array.from({ length: 25 }, () => privateGameHoldsSupported()));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    first.reject(new Error('network down'));

    const failed = await pending;
    expect(failed.every((v) => v === false)).toBe(true);

    // Retry immediately after failure: must not be stuck on a stale in-flight or error cache.
    expect(await privateGameHoldsSupported()).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('_resetPrivateGameSupportForTests clears both cache and in-flight state', async () => {
    const stale = deferred<{ ok: boolean; json: () => Promise<unknown> }>();
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => stale.promise)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ privateGameHolds: 1, privateSitAndGoHolds: 0 }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const staleCall = privateGameHoldsSupported();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    _resetPrivateGameSupportForTests();
    expect(await privateGameHoldsSupported()).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Resolving the superseded probe after reset must not poison the fresh cache.
    stale.resolve({
      ok: true,
      json: async () => ({ privateGameHolds: 0, privateSitAndGoHolds: 0 }),
    });
    expect(await staleCall).toBe(false);
    expect(await privateGameHoldsSupported()).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('readCashRakePolicyVersion coalesces concurrent /health probes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    _resetCashRakePolicyVersionForTests();
  });

  it('50 concurrent calls issue strictly 1 fetch(/health) and resolve identically', async () => {
    const gate = deferred<{ ok: boolean; json: () => Promise<unknown> }>();
    const fetchMock = vi.fn(() => gate.promise);
    vi.stubGlobal('fetch', fetchMock);

    const calls = Array.from({ length: 50 }, () => readCashRakePolicyVersion());
    expect(fetchMock).toHaveBeenCalledTimes(1);

    gate.resolve({
      ok: true,
      json: async () => ({ version: '2026-11-24', cashRakePolicyVersion: 2 }),
    });
    const results = await Promise.all(calls);
    expect(results).toHaveLength(50);
    expect(results.every((v) => v === 2)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('clears in-flight state on error so a subsequent call retries cleanly', async () => {
    const gate = deferred<{ ok: boolean; json: () => Promise<unknown> }>();
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => gate.promise)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ version: '2026-11-24', cashRakePolicyVersion: 1 }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const pending = Promise.all(Array.from({ length: 20 }, () => readCashRakePolicyVersion()));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    gate.reject(new Error('timeout'));

    const failed = await pending;
    expect(failed.every((v) => v === null)).toBe(true);

    expect(await readCashRakePolicyVersion()).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('getServerStatus coalesces concurrent /health probes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('50 concurrent calls issue strictly 1 fetch(/health) and retry cleanly after error', async () => {
    const gate = deferred<{ ok: boolean; json: () => Promise<unknown> }>();
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => gate.promise)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ running: true, uptime: 100, activeTables: 4 }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const wave = Promise.all(Array.from({ length: 50 }, () => getServerStatus()));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    gate.resolve({
      ok: true,
      json: async () => ({ running: true, uptime: 99, activeTables: 3 }),
    });
    const statuses = await wave;
    expect(statuses).toHaveLength(50);
    expect(statuses.every((s) => s?.running === true && s.activeTables === 3)).toBe(true);

    // Error clears in-flight so subsequent call retries cleanly.
    expect(await getServerStatus()).toBeNull();
    const recovered = await getServerStatus();
    expect(recovered?.running).toBe(true);
    expect(recovered?.activeTables).toBe(4);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('LAW — every direct /health fetch in src/ coalesces concurrent in-flight requests', () => {
  it('detects all src/ /health fetchers and proves each has an in-flight coalescing gate', () => {
    const srcRoot = path.join(ROOT, 'src');
    const healthCallers: string[] = [];
    const HEALTH_FETCH_RE = /\b(?:engineFetch|fetch)\(\s*[`'"][^`'"]*\/health\b/;

    for (const abs of collectSourceFiles(srcRoot)) {
      const content = readFileSync(abs, 'utf8');
      if (HEALTH_FETCH_RE.test(content)) {
        healthCallers.push(path.relative(ROOT, abs).split(path.sep).join('/'));
      }
    }

    const expected: Record<string, { method: string; inFlightRe: RegExp }> = {
      'src/lib/privateGameInvite.ts': {
        method: 'async function engineHoldSupport(',
        inFlightRe: /if\s*\(\s*engineSupportInFlight\s*\)\s*return\s+engineSupportInFlight/,
      },
      'src/services/cashRakePolicyVersion.ts': {
        method: 'export async function readCashRakePolicyVersion(',
        inFlightRe:
          /if\s*\(\s*cashRakePolicyVersionInFlight\s*\)\s*return\s+cashRakePolicyVersionInFlight/,
      },
      'src/services/GameServerAPI.ts': {
        method: 'export async function getServerStatus(',
        inFlightRe: /if\s*\(\s*serverStatusInFlight\s*\)\s*return\s+serverStatusInFlight/,
      },
      'src/utils/supabaseConnectionWatchdog.ts': {
        method: 'private checkHealth(',
        inFlightRe: /if\s*\(\s*this\.checkInFlight\s*\)\s*return\s+this\.checkInFlight/,
      },
    };

    expect(healthCallers.sort()).toEqual(Object.keys(expected).sort());

    for (const [rel, spec] of Object.entries(expected)) {
      const source = readFileSync(path.join(ROOT, rel), 'utf8');
      const body = sliceMethod(source, spec.method);
      expect(body, `${rel} must reuse an in-flight /health promise`).toMatch(spec.inFlightRe);
      expect(body, `${rel} must clear its in-flight /health promise in finally`).toMatch(
        /\.finally\(/
      );
      expect(source, `${rel} must bound its shared /health probe with an abort timeout`).toMatch(
        /AbortSignal\.timeout\(|AbortController/
      );
    }
  });
});
