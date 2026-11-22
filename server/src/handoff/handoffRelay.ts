/**
 * HANDOFF RELAY: the yielding engine stays the front door for tables it moved.
 *
 * Owner order (Dan, 2026-11-19 12:54 Chicago): "WE NEED TO STOP REQUIRING AN
 * ENGINE CUT OVER FOR ANY AND ALL UPGRADES AND IMPROVEMENTS AND FIXES."
 *
 * Players reach one port through Caddy. During a rolling handoff two engines
 * share the host and a table that moved is dealt by the other process. Without
 * this relay the front door would answer 404 (HTTP) or refuse the WebSocket
 * upgrade for that table, exactly the split-fleet state of 2026-08-23
 * (services/leadership.ts).
 *
 * What it does, only while ENGINE_ROLLING_HANDOFF=on and a peer port is set:
 *
 *   - HTTP: a request for a table this engine does not serve and that the
 *     owner decides belongs to the peer (`relaysTable`) is forwarded byte for
 *     byte to 127.0.0.1:<peer>, and the peer's answer is streamed back. Table
 *     ids come from the route (`/state/:id`, `/actions/:id/...`,
 *     `/insurance-preview?tableId=`) or from the JSON body of the table POST
 *     routes; a body read to decide is handed to the local handler unchanged
 *     (http/body.ts) when the request stays here.
 *   - WebSocket: an upgrade for `/ws/table/:id` that belongs to the peer is
 *     spliced at the socket level (the original request line, headers and
 *     every frame after them), so the peer does its own authentication and
 *     the client sees exactly the peer's handshake, SNAPSHOT and DELTAs. A
 *     spectator socket is the same route and follows the same way.
 *   - After retirement (`relaysEverything`), every request and every upgrade
 *     except this engine's own `/internal/rolling-handoff/*` control routes
 *     goes to the peer: the old process is then a pure proxy until the one
 *     Caddy upstream change makes it unnecessary.
 *
 * What it never does: serve a moved table from local state. When the peer
 * cannot be reached the request is answered 503 with Retry-After and the
 * upgrade is refused with 503 (a browser retries both; a 404 or close 4404
 * would put the client on its slow "table gone" ladder). A request that
 * already came through a relay (`x-engine-handoff-relayed`) is never relayed
 * again, so two engines can never bounce one request between them.
 *
 * Nothing here can throw into a request or upgrade listener: an exception in
 * an `upgrade` listener is an uncaughtException, which restarts the engine
 * (transport/upgradeTarget.ts). Every path is caught and answered.
 */
import { EventEmitter } from 'node:events';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import net from 'node:net';
import type { Duplex } from 'node:stream';
import { parseUpgradeTarget } from '../transport/upgradeTarget.js';
import { parseTableIdFromPath } from '../transport/wsHelpers.js';
import { MAX_BODY_SIZE, prefetchRequestBody } from '../http/body.js';

export const RELAYED_HEADER = 'x-engine-handoff-relayed';

/** POST routes whose JSON body names the table they act on. */
export const TABLE_BODY_ROUTES: ReadonlySet<string> = new Set([
  '/action',
  '/timebank',
  '/reject_rebuy',
  '/rabbit-hunt',
  '/heartbeat',
  '/away',
  '/seat_arrival',
  '/preaction',
  '/addchips',
  '/leave-lightning-occupancy',
  '/leave-occupancy',
  '/leave',
  '/sitout',
  '/straddle',
  '/rit',
  '/insurance',
  '/showhand',
  '/discard',
  '/post-bb',
  '/admin/pause',
  '/admin/resume',
  '/admin/kick',
  '/admin/kick-occupancy',
]);

const CONTROL_PREFIX = '/internal/rolling-handoff/';
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-connection',
  'transfer-encoding',
  'upgrade',
  'te',
  'trailer',
]);

export interface HandoffRelayOptions {
  peerPort: number;
  /** Loopback only; tests may not change it to anything else. */
  peerHost?: '127.0.0.1' | '::1' | 'localhost';
  /** True when traffic for this table must go to the peer. */
  relaysTable(tableId: string): boolean;
  /** True after retirement: everything but the control routes goes to the peer. */
  relaysEverything(): boolean;
  /** Cheap pre-check: false means no table can be relayed, so no body is read. */
  active(): boolean;
  report(error: unknown, context: string, extra?: Record<string, unknown>): void;
  connectTimeoutMs?: number;
  responseTimeoutMs?: number;
}

type RelayedPipe = { client: Duplex; upstream: net.Socket };

export type PeerProbe =
  | { alive: true; instanceId: string | null }
  | { alive: false; reason: string };

function tableIdFromUrl(rawUrl: string): string | null {
  const [path, query = ''] = rawUrl.split('?');
  const state = /^\/state\/([^/]+)$/.exec(path ?? '');
  if (state) return decodeSafe(state[1]!);
  const actions = /^\/actions\/([^/]+)\/[^/]+$/.exec(path ?? '');
  if (actions) return decodeSafe(actions[1]!);
  if (path?.startsWith('/insurance-preview')) {
    const id = new URLSearchParams(query).get('tableId');
    return id && id.length <= 80 ? id : null;
  }
  return null;
}

function decodeSafe(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value);
    return decoded.length <= 80 ? decoded : null;
  } catch {
    return null;
  }
}

function tableIdFromBody(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    const id = record.tableId ?? record.table_id;
    return typeof id === 'string' && id.length > 0 && id.length <= 80 ? id : null;
  } catch {
    return null;
  }
}

function readBounded(req: IncomingMessage): Promise<Buffer | 'too_large' | 'failed'> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const settle = (value: Buffer | 'too_large' | 'failed'): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        settle('too_large');
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => settle(Buffer.concat(chunks)));
    req.on('error', () => settle('failed'));
    req.on('aborted', () => settle('failed'));
  });
}

export class HandoffRelay {
  private readonly host: string;
  private readonly connectTimeoutMs: number;
  private readonly responseTimeoutMs: number;
  private readonly agent: http.Agent;
  private readonly pipes = new Map<string, Set<RelayedPipe>>();
  private relayedHttp = 0;
  private relayedUpgrades = 0;
  private refused = 0;
  private mirrorFailures = 0;

  constructor(private readonly options: HandoffRelayOptions) {
    this.host = options.peerHost ?? '127.0.0.1';
    this.connectTimeoutMs = options.connectTimeoutMs ?? 2_000;
    this.responseTimeoutMs = options.responseTimeoutMs ?? 30_000;
    this.agent = new http.Agent({ keepAlive: true, maxSockets: 256 });
  }

  get peerPort(): number {
    return this.options.peerPort;
  }

  stats(): {
    peerPort: number;
    relayedHttp: number;
    relayedUpgrades: number;
    openRelayedSockets: number;
    refused: number;
    mirrorFailures: number;
  } {
    let open = 0;
    for (const set of this.pipes.values()) open += set.size;
    return {
      peerPort: this.options.peerPort,
      relayedHttp: this.relayedHttp,
      relayedUpgrades: this.relayedUpgrades,
      openRelayedSockets: open,
      refused: this.refused,
      mirrorFailures: this.mirrorFailures,
    };
  }

  // ── HTTP ─────────────────────────────────────────────────────────────────

  /**
   * Relay this request when it belongs to the peer. Resolves true when the
   * request was answered here (relayed, or refused 503/413), false when the
   * local router must serve it (any body read is handed on intact).
   */
  async relayHttp(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    try {
      if (req.headers[RELAYED_HEADER] !== undefined) return false;
      const rawUrl = req.url || '/';
      const path = rawUrl.split('?')[0] || '/';
      if (path.startsWith(CONTROL_PREFIX)) return false;
      if (this.options.relaysEverything()) {
        this.forwardHttp(req, res, null);
        return true;
      }
      if (!this.options.active()) return false;
      const method = req.method || 'GET';
      if (method === 'GET') {
        const tableId = tableIdFromUrl(rawUrl);
        if (!tableId || !this.options.relaysTable(tableId)) return false;
        this.forwardHttp(req, res, null);
        return true;
      }
      if (method !== 'POST' || !TABLE_BODY_ROUTES.has(path)) return false;
      const body = await readBounded(req);
      if (body === 'too_large') {
        prefetchRequestBody(req, new Error('Request body too large'));
        return false;
      }
      if (body === 'failed') {
        prefetchRequestBody(req, new Error('Request body unreadable'));
        return false;
      }
      const tableId = tableIdFromBody(body.toString());
      if (tableId && this.options.relaysTable(tableId)) {
        this.forwardHttp(req, res, body);
        return true;
      }
      prefetchRequestBody(req, body.toString());
      return false;
    } catch (error) {
      this.options.report(error, 'HandoffRelay.http_decision_failed');
      // A request whose body may already be consumed cannot be served locally.
      if (!res.headersSent) this.refuse(res);
      return true;
    }
  }

  private refuse(res: ServerResponse): void {
    this.refused++;
    try {
      if (!res.headersSent) {
        res.writeHead(503, {
          'Content-Type': 'application/json',
          'Retry-After': '1',
          'Cache-Control': 'no-store',
        });
      }
      res.end(JSON.stringify({ error: 'engine_handoff_relay_unavailable' }));
    } catch {
      res.destroy();
    }
  }

  private forwardHttp(req: IncomingMessage, res: ServerResponse, body: Buffer | null): void {
    const headers: http.OutgoingHttpHeaders = {};
    for (const [name, value] of Object.entries(req.headers)) {
      if (value === undefined || HOP_BY_HOP.has(name)) continue;
      headers[name] = value;
    }
    headers[RELAYED_HEADER] = '1';
    if (body) headers['content-length'] = String(body.length);
    let answered = false;
    const upstream = http.request({
      host: this.host,
      port: this.options.peerPort,
      method: req.method,
      path: req.url || '/',
      headers,
      agent: this.agent,
      timeout: this.connectTimeoutMs,
    });
    const fail = (error: unknown): void => {
      if (answered) return;
      answered = true;
      this.options.report(error, 'HandoffRelay.http_peer_unreachable', {
        peerPort: this.options.peerPort,
      });
      if (res.headersSent) res.destroy();
      else this.refuse(res);
      upstream.destroy();
    };
    upstream.on('socket', (socket) => {
      socket.setTimeout(this.responseTimeoutMs);
    });
    upstream.on('timeout', () => fail(new Error('handoff relay peer timed out')));
    upstream.on('error', fail);
    upstream.on('response', (upstreamRes) => {
      if (answered) {
        upstreamRes.resume();
        return;
      }
      answered = true;
      this.relayedHttp++;
      const out: http.OutgoingHttpHeaders = {};
      for (const [name, value] of Object.entries(upstreamRes.headers)) {
        if (value === undefined || HOP_BY_HOP.has(name)) continue;
        out[name] = value;
      }
      try {
        res.writeHead(upstreamRes.statusCode ?? 502, out);
      } catch (error) {
        this.options.report(error, 'HandoffRelay.http_write_head_failed');
        upstreamRes.resume();
        res.destroy();
        return;
      }
      upstreamRes.on('error', () => res.destroy());
      upstreamRes.pipe(res);
    });
    res.on('close', () => {
      if (!res.writableFinished) upstream.destroy();
    });
    if (body) {
      upstream.end(body);
    } else {
      req.on('error', () => upstream.destroy());
      req.pipe(upstream);
    }
  }

  // ── WebSocket upgrades ───────────────────────────────────────────────────

  /**
   * Take the server's `upgrade` events. Returns the emitter the local
   * WebSocket servers attach to instead: every upgrade that stays here is
   * re-emitted on it unchanged, in order, synchronously.
   */
  attachUpgrades(server: EventEmitter): EventEmitter {
    const local = new EventEmitter();
    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      let target: string | null | undefined;
      try {
        target = this.upgradeTarget(req);
      } catch (error) {
        this.options.report(error, 'HandoffRelay.upgrade_decision_failed');
        target = undefined;
      }
      if (target === undefined) {
        local.emit('upgrade', req, socket, head);
        return;
      }
      try {
        this.pipeUpgrade(req, socket, head, target);
      } catch (error) {
        this.options.report(error, 'HandoffRelay.upgrade_pipe_failed');
        try {
          socket.destroy();
        } catch {
          /* already gone */
        }
      }
    });
    return local;
  }

  /** undefined: serve here. string: relay this table. null: relay (retired, not a table route). */
  private upgradeTarget(req: IncomingMessage): string | null | undefined {
    if (req.headers[RELAYED_HEADER] !== undefined) return undefined;
    const url = parseUpgradeTarget(req.url);
    if (!url) return undefined; // the local listener refuses it with 400
    const tableId = url.pathname.startsWith('/ws/table/')
      ? parseTableIdFromPath(url.pathname)
      : null;
    if (this.options.relaysEverything()) return tableId;
    if (!tableId || !this.options.active()) return undefined;
    return this.options.relaysTable(tableId) ? tableId : undefined;
  }

  private pipeUpgrade(
    req: IncomingMessage,
    client: Duplex,
    head: Buffer,
    tableId: string | null
  ): void {
    const key = tableId ?? '*';
    let connected = false;
    let finished = false;
    const upstream = net.connect({ host: this.host, port: this.options.peerPort });
    const pipe: RelayedPipe = { client, upstream };
    const finish = (): void => {
      if (finished) return;
      finished = true;
      clearTimeout(connectTimer);
      const set = this.pipes.get(key);
      set?.delete(pipe);
      if (set && set.size === 0) this.pipes.delete(key);
      upstream.destroy();
      client.destroy();
    };
    const connectTimer = setTimeout(() => {
      if (!connected) refuse(new Error('handoff relay peer connect timed out'));
    }, this.connectTimeoutMs);
    connectTimer.unref?.();
    const refuse = (error: unknown): void => {
      if (finished) return;
      this.refused++;
      this.options.report(error, 'HandoffRelay.upgrade_peer_unreachable', {
        peerPort: this.options.peerPort,
      });
      try {
        if (!connected && client.writable)
          client.write(
            'HTTP/1.1 503 Service Unavailable\r\nRetry-After: 1\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'
          );
      } catch {
        /* peer of the client already gone */
      }
      finish();
    };
    client.on('error', () => finish());
    client.on('close', () => finish());
    upstream.on('error', (error) => (connected ? finish() : refuse(error)));
    upstream.on('close', () => {
      if (!connected) refuse(new Error('handoff relay peer closed before connecting'));
      else finish();
    });
    upstream.on('connect', () => {
      if (finished) return;
      connected = true;
      clearTimeout(connectTimer);
      this.relayedUpgrades++;
      let preamble = `${req.method || 'GET'} ${req.url || '/'} HTTP/${req.httpVersion || '1.1'}\r\n`;
      const raw = req.rawHeaders;
      for (let i = 0; i + 1 < raw.length; i += 2) {
        if (raw[i]!.toLowerCase() === RELAYED_HEADER) continue;
        preamble += `${raw[i]}: ${raw[i + 1]}\r\n`;
      }
      preamble += `${RELAYED_HEADER}: 1\r\n\r\n`;
      upstream.write(preamble);
      if (head && head.length > 0) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    let set = this.pipes.get(key);
    if (!set) {
      set = new Set();
      this.pipes.set(key, set);
    }
    set.add(pipe);
  }

  /**
   * Close relayed sockets (a table that came back is served here again, so its
   * clients must reconnect to this engine). A closed socket makes the client
   * reconnect through its ordinary ladder. Returns how many were closed.
   */
  closeRelayedSockets(tableId?: string): number {
    let closed = 0;
    for (const [key, set] of [...this.pipes.entries()]) {
      if (tableId !== undefined && key !== tableId) continue;
      for (const pipe of [...set]) {
        closed++;
        pipe.upstream.destroy();
        pipe.client.destroy();
      }
    }
    return closed;
  }

  /**
   * Is the peer up, and is it the engine we expect? Asks the peer's own
   * host-local status route (same internal key). Any HTTP answer from a peer
   * whose identity cannot be read counts as alive; a refused or silent port,
   * or a different instance on it (the successor was restarted and adopted
   * nothing), is not.
   */
  probePeer(expectedInstanceId: string | null, internalKey: string): Promise<PeerProbe> {
    return new Promise((resolve) => {
      let settled = false;
      const settle = (value: PeerProbe): void => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      try {
        const request = http.request(
          {
            host: this.host,
            port: this.options.peerPort,
            method: 'GET',
            path: '/internal/rolling-handoff/status',
            headers: internalKey ? { authorization: `Bearer ${internalKey}` } : {},
            timeout: this.connectTimeoutMs,
            agent: false,
          },
          (res) => {
            const chunks: Buffer[] = [];
            let size = 0;
            res.on('data', (chunk: Buffer) => {
              size += chunk.length;
              if (size <= 64 * 1024) chunks.push(chunk);
            });
            res.on('error', () => settle({ alive: false, reason: 'probe_response_failed' }));
            res.on('end', () => {
              if (res.statusCode !== 200) {
                settle({ alive: true, instanceId: null });
                return;
              }
              let instanceId: string | null = null;
              try {
                const parsed = JSON.parse(Buffer.concat(chunks).toString()) as {
                  instanceId?: unknown;
                };
                instanceId = typeof parsed.instanceId === 'string' ? parsed.instanceId : null;
              } catch {
                instanceId = null;
              }
              if (expectedInstanceId && instanceId && instanceId !== expectedInstanceId) {
                settle({ alive: false, reason: `peer_is_${instanceId}` });
                return;
              }
              settle({ alive: true, instanceId });
            });
          }
        );
        request.on('timeout', () => {
          request.destroy();
          settle({ alive: false, reason: 'probe_timeout' });
        });
        request.on('error', (error) =>
          settle({ alive: false, reason: `probe_error:${(error as Error).message}` })
        );
        request.end();
      } catch (error) {
        settle({ alive: false, reason: `probe_threw:${(error as Error).message}` });
      }
    });
  }

  /**
   * Successor only: replay one tournament channel event on the front-door
   * engine through its existing internal route
   * (`POST /channels/tournament/:id/event`, which wraps the body as the same
   * TOURNAMENT_EVENT message). Fire and forget: a lost mirror is a missed
   * presentation frame that the next rejoin read recovers, never an error in
   * the hand that produced it.
   */
  mirrorTournamentEvent(tournamentId: string, event: unknown, internalKey: string): void {
    if (!internalKey || !/^[0-9a-f-]{36}$/i.test(tournamentId)) return;
    let payload: string;
    try {
      payload = JSON.stringify(event);
    } catch {
      return;
    }
    if (typeof payload !== 'string' || payload.length > 60 * 1024) return;
    try {
      const request = http.request({
        host: this.host,
        port: this.options.peerPort,
        method: 'POST',
        path: `/channels/tournament/${tournamentId}/event`,
        headers: {
          authorization: `Bearer ${internalKey}`,
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(payload)),
          [RELAYED_HEADER]: '1',
        },
        agent: this.agent,
        timeout: this.connectTimeoutMs,
      });
      request.on('response', (res) => res.resume());
      request.on('timeout', () => request.destroy());
      request.on('error', () => {
        this.mirrorFailures++;
      });
      request.end(payload);
    } catch {
      this.mirrorFailures++;
    }
  }

  /** Release pooled connections (shutdown and tests). */
  close(): void {
    this.closeRelayedSockets();
    this.agent.destroy();
  }
}
