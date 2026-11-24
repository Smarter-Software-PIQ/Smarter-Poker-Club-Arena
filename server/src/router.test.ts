import { describe, it, expect, vi } from 'vitest';

/**
 * The router matches on the PATH, not the whole request target (2026-09-03).
 * `/health?cb=...` used to fall through to the 404 at the bottom of the
 * router; spin-sweep, both watchdogs and anyone cache-busting per the
 * estate's own advice read "engine unreachable" from a healthy engine.
 */
import { createRouter } from './router.js';
import type { IncomingMessage, ServerResponse } from 'http';

function fakeRes() {
  const captured: { statusCode?: number; body: string } = { body: '' };
  const res = {
    writeHead: (code: number) => {
      captured.statusCode = code;
      return res;
    },
    setHeader: () => res,
    end: (chunk?: string) => {
      if (chunk) captured.body += chunk;
    },
  } as unknown as ServerResponse;
  return { res, captured };
}

describe('the router answers /health with a query string', () => {
  const gameServer = {
    getStatus: () => ({
      liveness: 'ok',
      status: 'ok',
      dealerPrerequisitesReady: true,
      liveHorseDecision: { phase: 'ready' },
      probe: 'cache-busted',
    }),
    getPrometheusMetrics: () => '',
  };
  const router = createRouter({ gameServer } as never);

  it.each(['/health', '/health?cb=1788402501855', '/?cb=2'])(
    '%s is the health route',
    async (target) => {
      const { res, captured } = fakeRes();
      await router({ method: 'GET', url: target, headers: {} } as unknown as IncomingMessage, res);
      expect(captured.statusCode).toBe(200);
      expect(JSON.parse(captured.body)).toMatchObject({ probe: 'cache-busted' });
    }
  );

  it('an unknown path with a query is still a 404', async () => {
    const { res, captured } = fakeRes();
    await router(
      { method: 'GET', url: '/nope?cb=1', headers: {} } as unknown as IncomingMessage,
      res
    );
    expect(captured.statusCode).toBe(404);
  });

  it('carries explicit table scope through the real router and rejects an unbounded request', async () => {
    const tableId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const getStatus = vi.fn(gameServer.getStatus);
    const scoped = createRouter({ gameServer: { ...gameServer, getStatus } } as never);
    const { res, captured } = fakeRes();
    await scoped(
      {
        method: 'GET',
        url: `/health?cb=1&liveness_table_ids=${tableId}`,
        headers: {},
      } as IncomingMessage,
      res
    );
    expect(captured.statusCode).toBe(200);
    expect(getStatus).toHaveBeenCalledTimes(1);
    expect(getStatus).toHaveBeenCalledWith({ kind: 'tables', tableIds: [tableId] });
    const invalid = fakeRes();
    await scoped(
      { method: 'GET', url: '/health?liveness_all=true', headers: {} } as IncomingMessage,
      invalid.res
    );
    expect(invalid.captured.statusCode).toBe(400);
    expect(getStatus).toHaveBeenCalledTimes(1);
  });
});

/**
 * ONE REQUEST CANNOT RESTART THE ENGINE (launch audit 2026-10-05).
 *
 * The router is handed straight to `http.createServer`, which does not await
 * it. A handler that throws became an unhandledRejection, and index.ts treats
 * that as fatal: drain, restart, every hand in flight voided. The router now
 * answers 500 and resolves.
 */
describe('a handler that throws is a 500, never a rejected listener', () => {
  it('answers 500 and resolves when the handler throws before writing', async () => {
    const router = createRouter({
      gameServer: {
        getStatus: () => {
          throw new Error('boom');
        },
        getPrometheusMetrics: () => {
          throw new Error('boom');
        },
      },
    } as never);
    const { res, captured } = fakeRes();
    await expect(
      router({ method: 'GET', url: '/metrics', headers: {} } as unknown as IncomingMessage, res)
    ).resolves.toBeUndefined();
    expect(captured.statusCode).toBe(500);
    expect(JSON.parse(captured.body)).toEqual({ error: 'Internal Server Error' });
  });

  it('destroys the response instead of writing twice when headers already went out', async () => {
    const router = createRouter({
      gameServer: {
        getPrometheusMetrics: () => {
          throw new Error('boom');
        },
      },
    } as never);
    const destroy = vi.fn();
    const res = {
      headersSent: true,
      writeHead: vi.fn(),
      setHeader: vi.fn(),
      end: vi.fn(),
      destroy,
    } as unknown as ServerResponse;
    await expect(
      router({ method: 'GET', url: '/metrics', headers: {} } as unknown as IncomingMessage, res)
    ).resolves.toBeUndefined();
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(
      (res as unknown as { writeHead: ReturnType<typeof vi.fn> }).writeHead
    ).not.toHaveBeenCalled();
  });
});

describe('public /health burst coalescing (b87d2b52)', () => {
  it('serves 200 concurrent public proxy GET /health requests with one getStatus() call per 1s window while keeping loopback and parameterized probes fresh', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-11-24T04:00:00.000Z'));
      let seq = 0;
      const getStatus = vi.fn(() => ({
        liveness: 'ok',
        status: 'ok',
        dealerPrerequisitesReady: true,
        liveHorseDecision: { phase: 'ready' },
        seq: ++seq,
      }));
      const router = createRouter({
        gameServer: { getStatus, getPrometheusMetrics: () => '' },
      } as never);

      // 200 public proxy GET /health calls in a burst -> strictly 1 getStatus() call
      const burst = await Promise.all(
        Array.from({ length: 200 }, async () => {
          const { res, captured } = fakeRes();
          await router(
            {
              method: 'GET',
              url: '/health',
              headers: { 'x-forwarded-for': '203.0.113.9' },
            } as unknown as IncomingMessage,
            res
          );
          return captured;
        })
      );
      expect(getStatus).toHaveBeenCalledTimes(1);
      for (const reply of burst) {
        expect(reply.statusCode).toBe(200);
        expect(JSON.parse(reply.body)).toMatchObject({ seq: 1 });
      }

      // Loopback / internal probe (no X-Forwarded-For) always bypasses the cache
      const internal = fakeRes();
      await router(
        { method: 'GET', url: '/health', headers: {} } as unknown as IncomingMessage,
        internal.res
      );
      expect(getStatus).toHaveBeenCalledTimes(2);
      expect(JSON.parse(internal.captured.body)).toMatchObject({ seq: 2 });

      // Parameterized public probe (?nocache=1) always bypasses the cache
      const parameterized = fakeRes();
      await router(
        {
          method: 'GET',
          url: '/health?nocache=1',
          headers: { 'x-forwarded-for': '203.0.113.9' },
        } as unknown as IncomingMessage,
        parameterized.res
      );
      expect(getStatus).toHaveBeenCalledTimes(3);
      expect(JSON.parse(parameterized.captured.body)).toMatchObject({ seq: 3 });

      // Still inside 1,000 ms TTL: unparameterized public probe reuses seq=1
      vi.advanceTimersByTime(999);
      const stillCached = fakeRes();
      await router(
        {
          method: 'GET',
          url: '/health',
          headers: { 'x-forwarded-for': '203.0.113.9' },
        } as unknown as IncomingMessage,
        stillCached.res
      );
      expect(getStatus).toHaveBeenCalledTimes(3);
      expect(JSON.parse(stillCached.captured.body)).toMatchObject({ seq: 1 });

      // After 1,000 ms TTL expires: next public probe refreshes cleanly
      vi.advanceTimersByTime(1);
      const refreshed = fakeRes();
      await router(
        {
          method: 'GET',
          url: '/health',
          headers: { 'x-forwarded-for': '203.0.113.9' },
        } as unknown as IncomingMessage,
        refreshed.res
      );
      expect(getStatus).toHaveBeenCalledTimes(4);
      expect(JSON.parse(refreshed.captured.body)).toMatchObject({ seq: 4 });
    } finally {
      vi.useRealTimers();
    }
  });
});
