import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import {
  createInternalLivenessServer,
  DEFAULT_INTERNAL_LIVENESS_PORT,
  HTTP_LISTEN_BACKLOG,
  INTERNAL_LIVENESS_HOST,
  resolveInternalLivenessPort,
  type InternalLivenessVerdict,
} from './createInternalLivenessServer.js';

describe('internal loopback /livez server and HTTP listen backlog (b87d2b52)', () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (!server) return;
    const closing = server;
    server = null;
    await new Promise<void>((resolveClose) => closing.close(() => resolveClose()));
  });

  async function start(getLiveness: () => InternalLivenessVerdict): Promise<string> {
    server = createInternalLivenessServer(getLiveness);
    await new Promise<void>((resolveListen) =>
      server!.listen(0, INTERNAL_LIVENESS_HOST, HTTP_LISTEN_BACKLOG, () => resolveListen())
    );
    const addr = server.address() as AddressInfo;
    expect(addr.address).toBe('127.0.0.1');
    return `http://${addr.address}:${addr.port}`;
  }

  it('serves O(1) { running, liveness } on loopback /livez for ok, standby, and dead states', async () => {
    let verdict: InternalLivenessVerdict = { running: true, liveness: 'ok' };
    const base = await start(() => verdict);

    const okRes = await fetch(`${base}/livez`);
    expect(okRes.status).toBe(200);
    expect(okRes.headers.get('cache-control')).toBe('no-store');
    const okText = await okRes.text();
    expect(okText.length).toBeLessThan(64);
    expect(JSON.parse(okText)).toEqual({ running: true, liveness: 'ok' });

    verdict = { running: true, liveness: 'standby' };
    const standbyRes = await fetch(`${base}/livez`);
    expect(standbyRes.status).toBe(200);
    expect(await standbyRes.json()).toEqual({ running: true, liveness: 'standby' });

    verdict = { running: true, liveness: 'dead' };
    const deadRes = await fetch(`${base}/livez`);
    expect(deadRes.status).toBe(503);
    expect(await deadRes.json()).toEqual({ running: true, liveness: 'dead' });

    verdict = { running: false, liveness: 'ok' };
    const stoppedRes = await fetch(`${base}/livez`);
    expect(stoppedRes.status).toBe(503);
    expect(await stoppedRes.json()).toEqual({ running: false, liveness: 'ok' });
  });

  it('rejects non-/livez routes, non-GET methods, and survives handler throws without crashing', async () => {
    let shouldThrow = false;
    const base = await start(() => {
      if (shouldThrow) throw new Error('liveness exploded');
      return { running: true, liveness: 'ok' };
    });

    expect((await fetch(`${base}/health`)).status).toBe(404);
    expect((await fetch(`${base}/livez`, { method: 'POST' })).status).toBe(405);

    shouldThrow = true;
    expect((await fetch(`${base}/livez`)).status).toBe(500);

    shouldThrow = false;
    expect((await fetch(`${base}/livez`)).status).toBe(200);
  });

  it('parses INTERNAL_LIVENESS_PORT safely with default 8081 and explicit disable support', () => {
    expect(resolveInternalLivenessPort({})).toBe(DEFAULT_INTERNAL_LIVENESS_PORT);
    expect(resolveInternalLivenessPort({ INTERNAL_LIVENESS_PORT: '' })).toBe(8081);
    expect(resolveInternalLivenessPort({ INTERNAL_LIVENESS_PORT: '0' })).toBe(0);
    expect(resolveInternalLivenessPort({ INTERNAL_LIVENESS_PORT: 'off' })).toBe(0);
    expect(resolveInternalLivenessPort({ INTERNAL_LIVENESS_PORT: '8099' })).toBe(8099);
    expect(resolveInternalLivenessPort({ INTERNAL_LIVENESS_PORT: 'invalid' })).toBe(8081);
  });

  it('pins explicit backlog >= 4096 in index.ts and loopback /livez in Dockerfile + engine-up.sh', () => {
    expect(HTTP_LISTEN_BACKLOG).toBeGreaterThanOrEqual(4096);

    const indexSource = readFileSync(resolve(process.cwd(), 'src/index.ts'), 'utf8');
    expect(indexSource).toContain('httpServer.listen(PORT, undefined, HTTP_LISTEN_BACKLOG,');
    expect(indexSource).toContain('INTERNAL_LIVENESS_HOST');
    expect(indexSource).toContain('closeInternalLivenessServer');

    const dockerfile = readFileSync(resolve(process.cwd(), 'Dockerfile'), 'utf8');
    const engineUp = readFileSync(resolve(process.cwd(), 'scripts/engine-up.sh'), 'utf8');
    expect(dockerfile).toContain("fetch('http://127.0.0.1:8081/livez')");
    expect(engineUp).toContain("fetch('http://127.0.0.1:8081/livez')");
    expect(dockerfile).not.toContain('0.0.0.0:8080/health');
    expect(engineUp).not.toContain('0.0.0.0:8080/health');
  });
});
