/**
 * ROLLING HANDOFF: SUCCESSOR BOOT ROLE AND CLIENT RELAY (2026-11-19,
 * docs/ENGINE-ROLLING-HANDOFF.md).
 *
 * Owner orders (Dan, Chicago time): 12:54 "WE NEED TO STOP REQUIRING AN ENGINE
 * CUT OVER FOR ANY AND ALL UPGRADES AND IMPROVEMENTS AND FIXES." 14:58 "FULLY
 * BUILD, FIX AND ENHANCE ALL OF THESE AND MAKE SURE THEY ARE FULLY WIRED IN
 * AND TESTED BEFORE CLAIMING SUCCESS."
 *
 * Two GameServer instances run in this process, each behind its own real
 * HTTP listener on its own loopback port, with the real router, the real
 * EngineWebSocketServer, a real TableStateHub each, the real coordinator and
 * the real relay. Engines and the lease database are the same fixtures
 * GameServerRollingHandoff.test.ts uses (fake dealer surface, in-memory lease
 * rows with the migration's rules). Clients are real `ws` sockets and real
 * HTTP requests, always aimed at the OLD engine's port: that is the single
 * port Caddy sends every player to.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import http, { type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';

vi.mock('../services/errorReporter.js', () => ({ reportError: vi.fn() }));
vi.mock('../services/PlayerSessionAccess.js', () => ({
  playerSessionVerdict: vi.fn(async () => 'alive'),
}));
vi.mock('../http/auth.js', () => ({
  authenticateRequest: vi.fn(async (req: IncomingMessage) => {
    const header = req.headers.authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer user:')) return null;
    return { userId: header.slice('Bearer user:'.length) };
  }),
}));
vi.mock('../http/rateLimit.js', () => ({
  checkRateLimit: vi.fn(() => true),
  __resetRateLimiterForTests: vi.fn(),
}));
vi.mock('../services/TableViewerAccess.js', () => ({
  authorizeTableViewer: vi.fn(async () => ({ allowed: true, reason: 'seated', clubId: null })),
}));

import { GameServer } from '../GameServer.js';
import { createRouter } from '../router.js';
import { createEngineHttpServer } from '../http/createEngineHttpServer.js';
import { EngineWebSocketServer, CLOSE_ENGINE_HANDOFF } from '../transport/EngineWebSocketServer.js';
import { TableStateHub } from '../transport/TableStateHub.js';
import { RollingHandoffCoordinator } from './RollingHandoffCoordinator.js';
import { HandoffRelay, RELAYED_HEADER } from './handoffRelay.js';
import {
  bootsAsHandoffSuccessor,
  handoffPeerPort,
  HANDOFF_SUCCESSOR_ROLE,
} from './handoffSuccessorRole.js';
import { prefetchRequestBody, readBody } from '../http/body.js';
import { ChannelHub } from '../hub/ChannelHub.js';
import { evaluateEngineLiveness } from '../engine/EngineLivenessVerdict.js';
import type {
  HandedLease,
  HandOffRequest,
  HandOffResult,
  LeaseHandoffStore,
} from './leaseHandoffStore.js';

const T1 = 'aaaaaaaa-0000-4000-8000-0000000000a1';
const T2 = 'aaaaaaaa-0000-4000-8000-0000000000a2';
const T3 = 'aaaaaaaa-0000-4000-8000-0000000000a3';
const EVENT = 'eeeeeeee-0000-4000-8000-0000000000e1';
const GEN = (n: number) => `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OLD = 'engine-old';
const NEW = 'engine-new';

const seats = [
  { seat: 2, userId: 'kingfish', stack: 1_250 },
  { seat: 5, userId: 'danimal', stack: 830 },
];

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
  delete process.env.ENGINE_ROLLING_HANDOFF;
  delete process.env.ENGINE_ROLE;
  delete process.env.ENGINE_HANDOFF_PEER_PORT;
  delete process.env.PORT;
  vi.restoreAllMocks();
});

// ── Lease database: the migration's rules, as in GameServerRollingHandoff.test.ts ──

type Lease = { instance: string; generation: string };

function leaseDatabase() {
  const leases = new Map<string, Lease>();
  const rows: Array<HandedLease & { toInstance: string; state: string }> = [];
  let n = 0;
  const store: LeaseHandoffStore = {
    async handOff(r: HandOffRequest): Promise<HandOffResult> {
      const key = `${r.scope}:${r.leaseKey}`;
      const lease = leases.get(key);
      if (!lease) return { status: 'refused', reason: 'lease_missing' };
      if (lease.instance !== r.fromInstance || lease.generation !== r.fromGeneration)
        return { status: 'refused', reason: 'lease_not_held' };
      leases.set(key, { instance: r.toInstance, generation: r.toGeneration });
      if (r.parentId) {
        const parent = rows.find((x) => x.handoffId === r.parentId);
        if (parent) parent.state = 'returned';
      }
      n += 1;
      const handoffId = `cccccccc-0000-4000-8000-${String(n).padStart(12, '0')}`;
      rows.push({
        handoffId,
        scope: r.scope,
        leaseKey: r.leaseKey,
        fromInstance: r.fromInstance,
        toGeneration: r.toGeneration,
        toInstance: r.toInstance,
        fingerprint: r.fingerprint,
        kind: r.kind,
        state: 'handed',
      });
      return { status: 'transferred', handoffId };
    },
    async handedTo(instance) {
      return rows.filter((x) => {
        const lease = leases.get(`${x.scope}:${x.leaseKey}`);
        return (
          x.toInstance === instance &&
          x.state === 'handed' &&
          lease?.instance === instance &&
          lease.generation === x.toGeneration
        );
      });
    },
    async settle(id, instance, outcome) {
      const row = rows.find((x) => x.handoffId === id && x.toInstance === instance);
      if (!row) return false;
      row.state = outcome;
      return true;
    },
    async openHandoffs(instance) {
      return rows.filter((x) => {
        const lease = leases.get(`${x.scope}:${x.leaseKey}`);
        return (
          x.state === 'handed' &&
          (x.toInstance === instance || x.fromInstance === instance) &&
          lease?.instance === x.toInstance &&
          lease.generation === x.toGeneration
        );
      }).length;
    },
  };
  return { leases, rows, store };
}

// ── One engine: GameServer + router + EngineWebSocketServer + TableStateHub ──

type FakeEngine = ReturnType<typeof fakeEngine>;

function fakeEngine(opts: {
  owner: string;
  tableId: string;
  generation: string;
  seats: typeof seats;
  db: ReturnType<typeof leaseDatabase>;
  hub: TableStateHub;
}) {
  const leaseKey = `table:${opts.tableId}`;
  let tick = 0;
  const e = {
    owner: opts.owner,
    running: true,
    handInProgress: true,
    maintenancePaused: false,
    durable: true,
    lightning: false,
    actions: [] as Array<{ userId: string; action: string }>,
    seats: opts.seats.map((s) => ({ ...s })),
    isRunning: () => e.running,
    isBetweenHands: () => !e.handInProgress,
    isParkedBetweenHands: () => e.maintenancePaused && !e.handInProgress,
    hasUnresolvedF06Preparation: () => false,
    hasUnretiredStoppedTimeBankCustody: () => false,
    hasAccountingInFlight: () => false,
    isMaintenanceStateDurable: () => e.durable,
    maintenanceDurabilityReason: () => (e.durable ? null : 'bank_park_write_incomplete'),
    getEngineLeaseAuthority: () => ({
      scope: 'cash' as const,
      verified: true as const,
      generation: opts.generation,
      proofDeadlineMonotonicMs: Number.MAX_SAFE_INTEGER,
    }),
    hasCurrentEngineLeaseAuthority: () => {
      const lease = opts.db.leases.get(leaseKey);
      return lease?.instance === opts.owner && lease.generation === opts.generation;
    },
    describeHandoffBoundary: () => ({
      seats: e.seats.map((s) => ({ ...s })),
      lightning: e.lightning,
    }),
    pauseForMaintenance: vi.fn(() => {
      e.maintenancePaused = true;
    }),
    resumeFromMaintenance: vi.fn(() => {
      e.maintenancePaused = false;
    }),
    fenceForEngineLeaseLoss: vi.fn(),
    setMaintenanceLock: vi.fn((_locked: boolean) => ({ success: true })),
    // Read and act surface (handlers/state.ts, handlers/action.ts).
    getTableState: (userId: string) => ({
      table_id: opts.tableId,
      servedBy: e.owner,
      viewer: userId,
    }),
    getPlayerActions: () => ({ canAct: true, servedBy: e.owner }),
    handlePlayerAction: vi.fn((userId: string, action: string) => {
      // A dealer that no longer holds its lease refuses, as the real one does.
      if (!e.hasCurrentEngineLeaseAuthority()) return { success: false, error: 'fenced' };
      e.actions.push({ userId, action });
      return { success: true, servedBy: e.owner };
    }),
    recordActionPerformance: vi.fn(),
    /** One authoritative state publication, as ServerTableEngine does per change. */
    publish: () => {
      tick += 1;
      opts.hub.publish(opts.tableId, {
        table_id: opts.tableId,
        servedBy: e.owner,
        tick,
        seats: e.seats,
      } as never);
    },
  };
  return e;
}

interface Engine {
  name: string;
  gs: any;
  hub: TableStateHub;
  ews: EngineWebSocketServer;
  server: http.Server;
  port: number;
  /** The leader-owned (singleton) jobs this engine is running right now. */
  leaderJobs: { running: boolean };
}

/** Real listener first, so both ports are known before either relay exists. */
async function listen(): Promise<{
  server: http.Server;
  port: number;
  setListener: (l: http.RequestListener) => void;
}> {
  let listener: http.RequestListener = (_req, res) => {
    res.writeHead(503);
    res.end();
  };
  const server = createEngineHttpServer((req, res) => listener(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      })
  );
  return { server, port, setListener: (l) => (listener = l) };
}

const fleet = {
  /** The one leadership row both engines share (claim_engine_leadership's rule). */
  leader: OLD as string | null,
  /** Every singleton job start, in order, with which engine started it. */
  singletonStarts: [] as string[],
  overlap: false,
};

function buildEngine(
  name: string,
  role: 'serving' | 'successor',
  db: ReturnType<typeof leaseDatabase>,
  listener: Awaited<ReturnType<typeof listen>>,
  peerPort: number
): Engine {
  const hub = new TableStateHub();
  const s = Object.create(GameServer.prototype) as any;
  const leaderJobs = { running: role === 'serving' };
  s.running = true;
  s.lifecycleGeneration = 1;
  s.tableEngines = new Map<string, FakeEngine>();
  s.tournamentEngines = new Map();
  s.tournamentOwnedTables = new Set();
  s.maintenanceBreak = { isActive: () => false };
  s.lightningRooms = {
    activeHosts: () => 0,
    isRoom: () => false,
    actionEngineFor: () => undefined,
  };
  s.directTableAdmissionOperations = new Map();
  s.directTableAdmissionLeaseGenerations = new Map();
  s.tournamentManagerAdmissionLeaseGenerations = new Map();
  s.handoffYieldedTables = new Set();
  s.handoffReportedAt = new Map();
  s.handoffPeerFailures = 0;
  s.handoffSuccessorPhase = role === 'successor';
  s.leaderBootComplete = role === 'serving';
  s.adoptedSeats = seats;
  s.recoverDirectTableEngine = vi.fn(async (tableId: string) => {
    s.tableEngines.delete(tableId);
    hub.dropTable(tableId);
  });
  // Admission exactly as performCashTableEngineAdmission orders it: the one
  // handoff admission question, then the lease claim (a free or own row is
  // granted; a fresh foreign row is owned elsewhere), then the dealer.
  s.ensureCashTableEngine = vi.fn(async (tableId: string) => {
    if (s.tableEngines.has(tableId)) return true;
    if (s.refusesHandoffAdmission({ scope: 'table', key: tableId })) return false;
    const requested =
      s.directTableAdmissionLeaseGenerations.get(tableId) ?? GEN(900 + db.leases.size);
    const key = `table:${tableId}`;
    const lease = db.leases.get(key);
    if (lease && !(lease.instance === name && lease.generation === requested)) return false;
    db.leases.set(key, { instance: name, generation: requested });
    s.directTableAdmissionLeaseGenerations.delete(tableId);
    const engine = fakeEngine({
      owner: name,
      tableId,
      generation: requested,
      seats: s.adoptedSeats,
      db,
      hub,
    });
    engine.handInProgress = false;
    s.tableEngines.set(tableId, engine);
    if (s.rollingHandoff?.holdsArrival({ scope: 'table', key: tableId }))
      engine.setMaintenanceLock(true);
    engine.publish();
    return true;
  });
  // The certified stop: every leader job stops, and only then is the
  // leadership row released (GameServer.performStop, leadership-release step).
  s.stop = vi.fn(async () => {
    s.running = false;
    s.stopHandoffTimers();
    leaderJobs.running = false;
    if (fleet.leader === name) fleet.leader = null;
  });
  s.claimHandoffLeadership = vi.fn(async () => {
    if (fleet.leader !== null) return false;
    fleet.leader = name;
    return true;
  });
  // The takeover runs performStart again in place (handoffTakeoverInProgress):
  // the leader boot's discovery, sweeps and singleton jobs, here recorded.
  s.performStart = vi.fn(async () => {
    expect(s.handoffTakeoverInProgress).toBe(true);
    expect(s.handoffSuccessorPhase).toBe(false);
    // No singleton job may start while another engine runs them.
    for (const other of engines.values())
      if (other !== leaderJobs && other.running) fleet.overlap = true;
    leaderJobs.running = true;
    fleet.singletonStarts.push(name);
    s.leaderBootComplete = true;
  });
  const port = { ...s.createRollingHandoffPort(), instanceId: name };
  s.rollingHandoff = new RollingHandoffCoordinator(port, db.store, {
    pollMs: 1,
    adoptPollMs: 5,
    sleep: async () => {
      await new Promise<void>((resolve) => setImmediate(resolve));
    },
  });
  process.env.ENGINE_ROLLING_HANDOFF = 'on';
  process.env.ENGINE_HANDOFF_PEER_PORT = String(peerPort);
  process.env.PORT = String(listener.port);
  s.handoffRelay = s.createHandoffRelay();
  expect(s.handoffRelay).toBeInstanceOf(HandoffRelay);
  cleanups.push(() => s.handoffRelay.close());
  cleanups.push(() => s.stopHandoffTimers());

  const ews = new EngineWebSocketServer({
    hub,
    tableExists: (tableId: string) => s.hasTableOrLightningRoom(tableId),
    ensureTable: (tableId: string) => s.ensureCashTableEngine(tableId),
    verifyToken: async (token: string) => ({ userId: token.split('.')[1] }),
    authorizeConnection: async () => ({
      allowed: true,
      reason: 'seated',
      clubId: null,
      banned: false,
      ipRestricted: false,
    }),
  } as never);
  (ews as unknown as { logConnectionAudit: unknown }).logConnectionAudit = vi.fn();
  cleanups.push(() => ews.close());
  listener.setListener(
    createRouter({
      gameServer: s,
      tableStateHub: hub,
      engineWs: ews,
      channelHub: new ChannelHub(),
    } as never) as http.RequestListener
  );
  // Exactly the bootstrap wiring in index.ts.
  const relay = s.getHandoffRelay();
  const upgradeHost = relay ? relay.attachUpgrades(listener.server) : listener.server;
  ews.attach(upgradeHost as http.Server);
  s.setHandoffTransport({
    closeTable: (tableId: string) => ews.closeTableForHandoff(tableId),
    closeAll: () => ews.closeAllForHandoff(),
  });
  engines.set(name, leaderJobs);
  return { name, gs: s, hub, ews, server: listener.server, port: listener.port, leaderJobs };
}

const engines = new Map<string, { running: boolean }>();

async function pair() {
  fleet.leader = OLD;
  fleet.singletonStarts = [];
  fleet.overlap = false;
  engines.clear();
  const db = leaseDatabase();
  const a = await listen();
  const b = await listen();
  const old = buildEngine(OLD, 'serving', db, a, b.port);
  const next = buildEngine(NEW, 'successor', db, b, a.port);
  return { db, old, next };
}

function seatTable(
  e: Engine,
  db: ReturnType<typeof leaseDatabase>,
  tableId: string,
  generation: string
) {
  db.leases.set(`table:${tableId}`, { instance: e.name, generation });
  const engine = fakeEngine({ owner: e.name, tableId, generation, seats, db, hub: e.hub });
  e.gs.tableEngines.set(tableId, engine);
  engine.publish();
  return engine;
}

// ── Real clients ─────────────────────────────────────────────────────────────

const token = (user: string) => `h.${user}.s`;

/**
 * A table client with the reconnect rule the browser applies
 * (src/services/EngineStateClient.ts): any close that is not an auth or
 * access verdict reconnects to the same URL, and a handshake refused before
 * it opens is retried.
 */
function tableClient(port: number, tableId: string, user: string) {
  const frames: Array<{
    type: string;
    state?: { servedBy?: string; tick?: number };
    patch?: unknown;
  }> = [];
  const closes: number[] = [];
  let ws: WebSocket | null = null;
  let stopped = false;
  let opens = 0;
  const connect = (): void => {
    if (stopped) return;
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws/table/${tableId}`, [
      'bearer',
      token(user),
    ]);
    ws = socket;
    socket.on('open', () => {
      opens += 1;
    });
    socket.on('message', (raw) => {
      try {
        frames.push(JSON.parse(String(raw)));
      } catch {
        /* not a frame */
      }
    });
    socket.on('error', () => undefined);
    socket.on('close', (code) => {
      closes.push(code);
      if (!stopped && code !== 4401 && code !== 4403) setTimeout(connect, 20);
    });
  };
  connect();
  cleanups.push(() => {
    stopped = true;
    ws?.terminate();
  });
  return {
    frames,
    closes,
    get opens() {
      return opens;
    },
    /** The `servedBy` of the latest full state this client holds. */
    latestSnapshotOwner: () =>
      [...frames].reverse().find((f) => f.type === 'SNAPSHOT')?.state?.servedBy,
    stop: () => {
      stopped = true;
      ws?.close();
    },
  };
}

async function waitFor(check: () => boolean, label: string, ms = 3_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function request(
  port: number,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  user = 'kingfish'
): Promise<{ status: number; body: any; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        agent: false,
        headers: {
          authorization: `Bearer user:${user}`,
          ...(payload
            ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }
            : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString();
          let parsed: unknown = text;
          try {
            parsed = JSON.parse(text);
          } catch {
            /* plain */
          }
          resolve({ status: res.statusCode ?? 0, body: parsed, headers: res.headers });
        });
      }
    );
    req.on('error', reject);
    req.end(payload);
  });
}

/** Move one cash table from `from` to `to` through the real coordinators. */
async function moveTable(from: Engine, to: Engine, engine: FakeEngine): Promise<void> {
  const yielding = from.gs.rollingHandoff.yieldTo(to.name);
  await waitFor(() => engine.pauseForMaintenance.mock.calls.length > 0, 'park requested');
  engine.handInProgress = false; // the hand in the air finishes
  await yielding;
  await to.gs.rollingHandoff.adoptPass();
}

// ═════════════════════════════════════════════════════════════════════════════

describe('handoff successor role and relay configuration', () => {
  it('is off unless the flag is exactly on, whatever ENGINE_ROLE and the peer port say', () => {
    const env = {
      ENGINE_ROLE: HANDOFF_SUCCESSOR_ROLE,
      ENGINE_HANDOFF_PEER_PORT: '8081',
      PORT: '8080',
    };
    expect(bootsAsHandoffSuccessor(env)).toBe(false);
    expect(handoffPeerPort(env)).toBeNull();
    expect(bootsAsHandoffSuccessor({ ...env, ENGINE_ROLLING_HANDOFF: 'true' })).toBe(false);
    const on = { ...env, ENGINE_ROLLING_HANDOFF: 'on' };
    expect(bootsAsHandoffSuccessor(on)).toBe(true);
    expect(handoffPeerPort(on)).toBe(8081);
    expect(bootsAsHandoffSuccessor({ ...on, ENGINE_ROLE: 'standby' })).toBe(false);
    expect(handoffPeerPort({ ...on, ENGINE_HANDOFF_PEER_PORT: '8080' })).toBeNull(); // our own port
    expect(handoffPeerPort({ ...on, ENGINE_HANDOFF_PEER_PORT: '70000' })).toBeNull();
    expect(handoffPeerPort({ ...on, ENGINE_HANDOFF_PEER_PORT: '80a' })).toBeNull();
  });

  it('with the flag off GameServer has no relay, no successor phase and no extra health field', () => {
    process.env.ENGINE_ROLE = HANDOFF_SUCCESSOR_ROLE;
    process.env.ENGINE_HANDOFF_PEER_PORT = '8081';
    const off = new GameServer() as any;
    expect(off.getRollingHandoff()).toBeNull();
    expect(off.getHandoffRelay()).toBeNull();
    expect(off.handoffSuccessorPhase).toBe(false);
    expect(off.refusesHandoffAdmission({ scope: 'table', key: T1 })).toBe(false);
    process.env.ENGINE_ROLLING_HANDOFF = 'on';
    const on = new GameServer() as any;
    expect(on.handoffSuccessorPhase).toBe(true);
    expect(on.getHandoffRelay()).toBeInstanceOf(HandoffRelay);
    on.getHandoffRelay().close();
  });

  it('with the flag off a request and its body take exactly the path they took before', async () => {
    // No relay: the router never reads a body itself, the handler reads the stream.
    const req = new EventEmitter() as any;
    const reading = readBody(req);
    req.emit('data', Buffer.from('{"tableId":"x"}'));
    req.emit('end');
    await expect(reading).resolves.toBe('{"tableId":"x"}');
    // The relay's parked body is handed over once, then the stream is read again.
    const parked = new EventEmitter() as any;
    prefetchRequestBody(parked, '{"a":1}');
    await expect(readBody(parked)).resolves.toBe('{"a":1}');
    const again = readBody(parked);
    parked.emit('data', Buffer.from('z'));
    parked.emit('end');
    await expect(again).resolves.toBe('z');
    // A router whose game server has no relay answers as before.
    const a = await listen();
    a.setListener(
      createRouter({
        gameServer: { getHandoffRelay: () => null, getRollingHandoff: () => null },
        tableStateHub: {},
        engineWs: {},
        channelHub: new ChannelHub(),
      } as never) as http.RequestListener
    );
    const b = await listen();
    b.setListener(
      createRouter({
        gameServer: { getRollingHandoff: () => null },
        tableStateHub: {},
        engineWs: {},
        channelHub: new ChannelHub(),
      } as never) as http.RequestListener
    );
    const withNull = await request(a.port, 'GET', '/internal/rolling-handoff/status');
    const without = await request(b.port, 'GET', '/internal/rolling-handoff/status');
    expect(withNull.status).toBe(404);
    expect(withNull.body).toEqual(without.body);
  });

  it('a successor is alive once it can deal, though it runs no discovery; nobody else changes', () => {
    const barren = {
      isLeader: false,
      processUptimeMs: 3_600_000,
      discoveryLoopStalledMs: 3_600_000,
      discoveryStaleMs: 3_600_000,
      dbConfirmedDead: false,
      tables: [],
    };
    expect(evaluateEngineLiveness({ ...barren, handoffSuccessorDealerReady: true }).status).toBe(
      'ok'
    );
    expect(evaluateEngineLiveness({ ...barren, handoffSuccessorDealerReady: false }).status).toBe(
      'standby'
    );
    expect(evaluateEngineLiveness(barren).status).toBe('standby');
    expect(evaluateEngineLiveness({ ...barren, isLeader: true }).status).toBe('dead');
  });

  it('ChannelHub mirrors tournament broadcasts only while a mirror is set', () => {
    const hub = new ChannelHub();
    const mirrored: string[] = [];
    hub.broadcastToTournament(EVENT, {
      type: 'TOURNAMENT_EVENT',
      tournamentId: EVENT,
      event: {},
    } as never);
    hub.setTournamentMirror((id) => mirrored.push(id));
    hub.broadcastToTournament(EVENT, {
      type: 'TOURNAMENT_EVENT',
      tournamentId: EVENT,
      event: {},
    } as never);
    hub.setTournamentMirror(() => {
      throw new Error('a mirror can never cost the local fan-out');
    });
    expect(() =>
      hub.broadcastToTournament(EVENT, {
        type: 'TOURNAMENT_EVENT',
        tournamentId: EVENT,
        event: {},
      } as never)
    ).not.toThrow();
    hub.setTournamentMirror(null);
    hub.broadcastToTournament(EVENT, {
      type: 'TOURNAMENT_EVENT',
      tournamentId: EVENT,
      event: {},
    } as never);
    expect(mirrored).toEqual([EVENT]);
  });

  it("the successor's tournament mirror lands on the front door's internal route", async () => {
    const seen: Array<{ url?: string; auth?: string; relayed?: string; body: string }> = [];
    const a = await listen();
    a.setListener((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        seen.push({
          url: req.url,
          auth: req.headers.authorization,
          relayed: req.headers[RELAYED_HEADER] as string,
          body: Buffer.concat(chunks).toString(),
        });
        res.end('{}');
      });
    });
    const relay = new HandoffRelay({
      peerPort: a.port,
      relaysTable: () => false,
      relaysEverything: () => false,
      active: () => false,
      report: () => undefined,
    });
    cleanups.push(() => relay.close());
    relay.mirrorTournamentEvent(
      EVENT,
      { type: 'standings_changed', payload: { handNumber: 7 } },
      'key-1'
    );
    relay.mirrorTournamentEvent('not-a-tournament', {}, 'key-1'); // refused, never sent
    await waitFor(() => seen.length === 1, 'mirror posted');
    expect(seen[0]).toEqual({
      url: `/channels/tournament/${EVENT}/event`,
      auth: 'Bearer key-1',
      relayed: '1',
      body: JSON.stringify({ type: 'standings_changed', payload: { handNumber: 7 } }),
    });
  });
});

describe('two engines on two ports: a table moves and its players never notice', () => {
  it('relays players, spectators and new connections, deals only handed tables, and passes leadership only after retirement', async () => {
    const { db, old, next } = await pair();
    const t1 = seatTable(old, db, T1, GEN(1));
    const t2 = seatTable(old, db, T2, GEN(2));
    t2.lightning = true; // stays on the old engine in the first pass

    const player = tableClient(old.port, T1, 'kingfish');
    const spectator = tableClient(old.port, T1, 'railbird');
    const t2Player = tableClient(old.port, T2, 'danimal');
    await waitFor(
      () => player.latestSnapshotOwner() === OLD && spectator.latestSnapshotOwner() === OLD,
      'clients on the old engine'
    );
    await waitFor(() => t2Player.latestSnapshotOwner() === OLD, 't2 client on the old engine');

    // The successor deals nothing that was not handed to it.
    expect(await next.gs.ensureCashTableEngine(T3)).toBe(false);
    expect(db.leases.has(`table:${T3}`)).toBe(false);
    expect(next.gs.refusesHandoffAdmission({ scope: 'tournament', key: EVENT })).toBe(true);
    const direct = await request(next.port, 'GET', `/state/${T3}`);
    expect(direct.status).toBe(404);

    // Move T1.
    await moveTable(old, next, t1);
    expect(db.leases.get(`table:${T1}`)!.instance).toBe(NEW);
    expect(old.gs.tableEngines.has(T1)).toBe(false);
    const adopted: FakeEngine = next.gs.tableEngines.get(T1);
    expect(adopted.owner).toBe(NEW);
    expect(adopted.describeHandoffBoundary().seats).toEqual(seats); // seat positions unchanged

    // The old engine closed its own T1 sockets 1012; both clients came back
    // through the same port and now hold the new engine's state.
    await waitFor(
      () => player.latestSnapshotOwner() === NEW && spectator.latestSnapshotOwner() === NEW,
      'player and spectator follow the move'
    );
    expect(player.closes).toContain(CLOSE_ENGINE_HANDOFF);
    expect(spectator.closes).toContain(CLOSE_ENGINE_HANDOFF);
    // Live updates keep flowing from the new owner.
    const before = player.frames.length;
    adopted.publish();
    await waitFor(
      () => player.frames.length > before && spectator.frames.some((f) => f.type === 'DELTA'),
      'live DELTA through the relay'
    );
    // T2 never moved and its client was never touched.
    expect(t2Player.closes).toEqual([]);
    t2.publish();
    await waitFor(
      () => t2Player.frames.some((f) => f.type === 'DELTA'),
      't2 keeps dealing on the old engine'
    );

    // The player acts through the front door; the new engine applies it.
    const act = await request(old.port, 'POST', '/action', { tableId: T1, action: 'fold' });
    expect(act.status).toBe(200);
    expect(act.body.servedBy).toBe(NEW);
    expect(adopted.actions).toEqual([{ userId: 'kingfish', action: 'fold' }]);
    expect(t1.handlePlayerAction).not.toHaveBeenCalled();
    // A table that stayed is still served locally, body intact.
    const actT2 = await request(
      old.port,
      'POST',
      '/action',
      { tableId: T2, action: 'check' },
      'danimal'
    );
    expect(actT2.body.servedBy).toBe(OLD);
    expect(t2.actions).toEqual([{ userId: 'danimal', action: 'check' }]);

    // A brand-new connection and a fresh read land on the right engine.
    const late = tableClient(old.port, T1, 'latecomer');
    await waitFor(() => late.latestSnapshotOwner() === NEW, 'new connection routed to the owner');
    expect((await request(old.port, 'GET', `/state/${T1}`)).body.servedBy).toBe(NEW);
    expect((await request(old.port, 'GET', `/state/${T2}`)).body.servedBy).toBe(OLD);
    expect((await request(old.port, 'GET', `/actions/${T1}/x`)).body.servedBy).toBe(NEW);

    // Leadership: the old engine still leads and still runs every singleton job.
    (GameServer as any).HANDOFF_LEADERSHIP_POLL_MS = 10;
    next.gs.watchForHandoffLeadership(1);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(next.gs.claimHandoffLeadership).toHaveBeenCalled();
    expect(next.gs.performStart).not.toHaveBeenCalled();
    expect(fleet.leader).toBe(OLD);

    // Second pass: T2 moves, the old engine owns nothing and retires.
    t2.lightning = false;
    await moveTable(old, next, t2);
    await old.gs.rollingHandoff.adoptPass();
    expect(old.gs.rollingHandoff.getMode()).toBe('retired');
    await waitFor(
      () => old.gs.stop.mock.calls.length === 1,
      'retired engine runs its certified stop'
    );
    await waitFor(() => next.gs.performStart.mock.calls.length === 1, 'successor takes leadership');
    expect(fleet.leader).toBe(NEW);
    expect(fleet.overlap).toBe(false);
    expect(fleet.singletonStarts).toEqual([NEW]);
    expect(old.leaderJobs.running).toBe(false);
    expect(next.gs.handoffSuccessorPhase).toBe(false);
    expect(next.gs.performStart).toHaveBeenCalledTimes(1);
    expect(next.gs.handoffTakeoverInProgress).toBe(false);

    // After retirement the old process is a pure proxy: everything goes to the owner.
    await waitFor(() => t2Player.latestSnapshotOwner() === NEW, 't2 client follows its move');
    expect((await request(old.port, 'GET', `/state/${T2}`)).body.servedBy).toBe(NEW);
    expect(old.gs.handoffRelay.stats().relayedHttp).toBeGreaterThan(0);
    // The new engine, now the leader, admits ordinary tables again.
    expect(await next.gs.ensureCashTableEngine(T3)).toBe(true);
  }, 20_000);
});

describe('failure paths: the old engine keeps serving and nothing crashes', () => {
  it('the successor dies mid-handoff: requests are refused 503, never served stale, and the old engine takes its tables back', async () => {
    const { db, old, next } = await pair();
    const t1 = seatTable(old, db, T1, GEN(1));
    const t2 = seatTable(old, db, T2, GEN(2));
    const t3 = seatTable(old, db, T3, GEN(3));
    t2.lightning = true;
    t3.lightning = true;
    const t2Player = tableClient(old.port, T2, 'danimal');
    await waitFor(() => t2Player.latestSnapshotOwner() === OLD, 't2 client');

    await moveTable(old, next, t1); // adopted by the successor
    t3.lightning = false;
    // The successor dies before it adopts T3 (it was handed, never claimed).
    await new Promise<void>((resolve) => {
      next.server.closeAllConnections();
      next.server.close(() => resolve());
    });
    const yielding = old.gs.rollingHandoff.yieldTo(NEW);
    await waitFor(() => t3.pauseForMaintenance.mock.calls.length > 0, 't3 parked');
    t3.handInProgress = false;
    await yielding;
    expect(db.leases.get(`table:${T3}`)!.instance).toBe(NEW);

    // Moved tables are never served from the old engine's memory: 503, retry.
    const read = await request(old.port, 'GET', `/state/${T1}`);
    expect(read.status).toBe(503);
    expect(read.headers['retry-after']).toBe('1');
    const act = await request(old.port, 'POST', '/action', { tableId: T3, action: 'fold' });
    expect(act.status).toBe(503);
    const refused = tableClient(old.port, T1, 'kingfish');
    await waitFor(() => refused.closes.length >= 2, 'upgrade refused and retried');
    expect(refused.opens).toBe(0);
    // T2 is untouched and still dealing.
    expect((await request(old.port, 'GET', `/state/${T2}`)).body.servedBy).toBe(OLD);
    t2.publish();
    await waitFor(() => t2Player.frames.some((f) => f.type === 'DELTA'), 't2 still live');

    // The watchdog notices and aborts the yield after three failed probes.
    expect(old.gs.rollingHandoff.getMode()).toBe('yielding');
    for (let i = 0; i < 3; i++) await old.gs.handoffWatchdogTick();
    expect(old.gs.rollingHandoff.getMode()).toBe('serving');
    expect(old.gs.refusesHandoffAdmission({ scope: 'table', key: T1 })).toBe(false);

    // The dead successor's leases go stale; the old engine re-admits both
    // tables from the database with every seat and stack as they were.
    db.leases.delete(`table:${T1}`);
    db.leases.delete(`table:${T3}`);
    expect(await old.gs.ensureCashTableEngine(T1)).toBe(true);
    expect(await old.gs.ensureCashTableEngine(T3)).toBe(true);
    expect(old.gs.tableEngines.get(T1).describeHandoffBoundary().seats).toEqual(seats);
    expect((await request(old.port, 'GET', `/state/${T1}`)).body.servedBy).toBe(OLD);
    expect(
      (await request(old.port, 'POST', '/action', { tableId: T3, action: 'fold' })).body.servedBy
    ).toBe(OLD);
    await waitFor(
      () => refused.latestSnapshotOwner() === OLD,
      'the retrying client lands on the old engine'
    );
    expect(old.gs.stop).not.toHaveBeenCalled();
  }, 20_000);

  it('the relay target is unreachable: the old engine answers 503 for moved tables and serves its own', async () => {
    const db = leaseDatabase();
    fleet.leader = OLD;
    engines.clear();
    const a = await listen();
    const dead = await listen();
    const deadPort = dead.port;
    await new Promise<void>((resolve) => dead.server.close(() => resolve())); // nothing listens there
    const old = buildEngine(OLD, 'serving', db, a, deadPort);
    const t1 = seatTable(old, db, T1, GEN(1));
    const t2 = seatTable(old, db, T2, GEN(2));
    t2.lightning = true;
    expect(await old.gs.handoffRelay.probePeer(NEW, '')).toEqual(
      expect.objectContaining({ alive: false })
    );

    const yielding = old.gs.rollingHandoff.yieldTo(NEW);
    await waitFor(() => t1.pauseForMaintenance.mock.calls.length > 0, 'parked');
    t1.handInProgress = false;
    await yielding;

    const read = await request(old.port, 'GET', `/state/${T1}`);
    expect(read.status).toBe(503);
    expect(read.body).toEqual({ error: 'engine_handoff_relay_unavailable' });
    const client = tableClient(old.port, T1, 'kingfish');
    await waitFor(() => client.closes.length >= 1, 'upgrade refused');
    expect(client.opens).toBe(0);
    // Its own table: read and act locally, the parked body handed to the handler intact.
    expect((await request(old.port, 'GET', `/state/${T2}`)).body.servedBy).toBe(OLD);
    const act = await request(old.port, 'POST', '/action', { tableId: T2, action: 'call' });
    expect(act.status).toBe(200);
    expect(t2.actions).toEqual([{ userId: 'kingfish', action: 'call' }]);
    // A request that already came through a relay is never relayed again.
    const loop = await new Promise<number>((resolve) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: old.port,
          path: `/state/${T1}`,
          headers: { [RELAYED_HEADER]: '1', authorization: 'Bearer user:kingfish' },
          agent: false,
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        }
      );
      req.end();
    });
    expect(loop).toBe(404); // answered here, from local state: this engine has no T1

    for (let i = 0; i < 3; i++) await old.gs.handoffWatchdogTick();
    expect(old.gs.rollingHandoff.getMode()).toBe('serving');
    db.leases.delete(`table:${T1}`);
    expect(await old.gs.ensureCashTableEngine(T1)).toBe(true);
    await waitFor(
      () => client.latestSnapshotOwner() === OLD,
      'the client lands back on the old engine'
    );
    expect(old.gs.stop).not.toHaveBeenCalled();
  }, 20_000);
});

describe('both dealer admissions ask the one handoff admission question', () => {
  it('performCashTableEngineAdmission and performTournamentManagerAdmission call refusesHandoffAdmission', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/GameServer.ts', 'utf8');
    const body = (name: string) => {
      const start = source.indexOf(`private async ${name}(`);
      expect(start).toBeGreaterThan(0);
      return source.slice(start, source.indexOf('\n  }\n', start));
    };
    expect(body('performTournamentManagerAdmission')).toContain(
      "this.refusesHandoffAdmission({ scope: 'tournament', key: tournamentId })"
    );
    const cash = source.indexOf("this.refusesHandoffAdmission({ scope: 'table', key: tableId })");
    const claim = source.indexOf('await claimTableLease(tableId, requestedLeaseGeneration)');
    expect(cash).toBeGreaterThan(0);
    expect(cash).toBeLessThan(claim); // asked before any lease is claimed
  });
});
