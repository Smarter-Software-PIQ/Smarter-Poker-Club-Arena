/**
 * The handoff peer host (ENGINE_HANDOFF_PEER_HOST). Production engines are
 * separate bridged containers, so a container's own loopback is never its
 * peer; the relay, the successor watchdog probe and the channel mirror all
 * reach the peer at the configured host. Default 127.0.0.1: unchanged.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HandoffRelay } from './handoffRelay.js';
import {
  DEFAULT_HANDOFF_PEER_HOST,
  HANDOFF_PEER_HOST_ENV,
  handoffPeerHost,
  handoffPeerPort,
} from './handoffSuccessorRole.js';

const ON = { ENGINE_ROLLING_HANDOFF: 'on' };

function relay(peerPort: number, peerHost?: string): HandoffRelay {
  return new HandoffRelay({
    peerPort,
    ...(peerHost === undefined ? {} : { peerHost }),
    relaysTable: () => false,
    relaysEverything: () => false,
    active: () => false,
    report: () => {},
    connectTimeoutMs: 1_000,
  });
}

afterEach(() => vi.restoreAllMocks());

describe('ENGINE_HANDOFF_PEER_HOST', () => {
  it('defaults to 127.0.0.1 and falls back to it on a malformed value', () => {
    expect(HANDOFF_PEER_HOST_ENV).toBe('ENGINE_HANDOFF_PEER_HOST');
    expect(DEFAULT_HANDOFF_PEER_HOST).toBe('127.0.0.1');
    expect(handoffPeerHost({})).toBe('127.0.0.1');
    expect(handoffPeerHost({ ENGINE_HANDOFF_PEER_HOST: '' })).toBe('127.0.0.1');
    for (const bad of ['http://x', 'a b', '-bad', 'x/y', 'x:8080', 'a'.repeat(254)]) {
      expect(handoffPeerHost({ ENGINE_HANDOFF_PEER_HOST: bad })).toBe('127.0.0.1');
    }
  });

  it('accepts the run-spec hosts', () => {
    for (const host of [
      'host.docker.internal',
      'club-arena-engine-standby-next',
      '172.17.0.1',
      '::1',
    ]) {
      expect(handoffPeerHost({ ENGINE_HANDOFF_PEER_HOST: host })).toBe(host);
    }
  });

  it('refuses its own port only on loopback, where it would be this process', () => {
    expect(handoffPeerPort({ ...ON, PORT: '8080', ENGINE_HANDOFF_PEER_PORT: '8080' })).toBeNull();
    expect(
      handoffPeerPort({
        ...ON,
        PORT: '8080',
        ENGINE_HANDOFF_PEER_PORT: '8080',
        ENGINE_HANDOFF_PEER_HOST: 'localhost',
      })
    ).toBeNull();
    // A bridged successor listens on 8080 inside its container and its peer is
    // published on host port 8080: a different process.
    expect(
      handoffPeerPort({
        ...ON,
        PORT: '8080',
        ENGINE_HANDOFF_PEER_PORT: '8080',
        ENGINE_HANDOFF_PEER_HOST: 'host.docker.internal',
      })
    ).toBe(8080);
    expect(
      handoffPeerPort({
        ENGINE_HANDOFF_PEER_PORT: '8081',
        ENGINE_HANDOFF_PEER_HOST: 'host.docker.internal',
      })
    ).toBeNull();
  });

  it('the relay probe (the watchdog) asks the configured host', async () => {
    const seen: unknown[] = [];
    const original = http.request;
    vi.spyOn(http, 'request').mockImplementation(((options: { host?: unknown }, cb?: unknown) => {
      seen.push(options.host);
      return (original as (...a: unknown[]) => http.ClientRequest)(options, cb);
    }) as typeof http.request);
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ instanceId: 'peer-1' }));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as AddressInfo).port;
    try {
      await expect(relay(port).probePeer('peer-1', 'k')).resolves.toEqual({
        alive: true,
        instanceId: 'peer-1',
      });
      expect(seen.at(-1)).toBe('127.0.0.1');
      // The same port on a host this listener is not bound to is not alive.
      const elsewhere = await relay(port, '::1').probePeer('peer-1', 'k');
      expect(seen.at(-1)).toBe('::1');
      expect(elsewhere.alive).toBe(false);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('GameServer builds the relay (and so the watchdog and mirror) with the configured host', () => {
    const src = readFileSync(resolve(__dirname, '..', 'GameServer.ts'), 'utf8');
    const build = src.slice(
      src.indexOf('private createHandoffRelay()'),
      src.indexOf('report: (error, context, extra) => this.reportHandoff')
    );
    expect(build).toContain('peerHost: handoffPeerHost(),');
    const relaySrc = readFileSync(resolve(__dirname, 'handoffRelay.ts'), 'utf8');
    expect(relaySrc.match(/host: this\.host/g)?.length).toBeGreaterThanOrEqual(4);
    expect(relaySrc).not.toMatch(/host: '127\.0\.0\.1'/);
  });
});
