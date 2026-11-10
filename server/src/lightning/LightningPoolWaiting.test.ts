/**
 * REAL ARRIVALS WHILE WAITING (Dan 2026-11-10): "the transition to the next
 * game feels fake, you are just sitting there, and then all at once all the
 * players appear". The matcher forms a table in one step, so who will sit at
 * the next table is unknown until it forms. How many legal players each
 * forming pass left waiting IS known (the database's own legal_count less the
 * players it placed). The worker reports it, and every waiting room of the
 * Cluster is told it privately when it changes: a count, never a name.
 */
import { describe, expect, it, vi } from 'vitest';
vi.mock('../services/supabase/client.js', () => ({
  supabase: {
    from: vi.fn(() => {
      throw Error('Unexpected database access in the pool-waiting fixture');
    }),
    rpc: vi.fn(() => {
      throw Error('Unexpected database RPC in the pool-waiting fixture');
    }),
  },
  maintenanceSupabase: {},
}));
vi.mock('../services/errorReporter.js', () => ({ reportError: vi.fn() }));
const { MetricsRegistry } = await import('../observability/Metrics.js');
const { LightningClusterWorker, lightningPoolWaitingAfterPass } =
  await import('./LightningClusterWorker.js');
const { LightningPresence } = await import('./LightningPresence.js');
const { LightningMetrics } = await import('./LightningMetrics.js');
const { LightningRegistry } = await import('./LightningRegistry.js');
const kit = await import('../testing/lightningHostTestKit.js');
import { LIGHTNING_AUTO_REBUY_DEFAULTS, type LightningConfig } from './LightningConfig.js';

const { uid, formedHand } = kit;
const CLUSTER = uid(1);
const OTHER = uid(2);
const form: LightningConfig = {
  matcherVersion: null,
  workerMode: 'form',
  passIntervalMs: 1_000,
  keepaliveIntervalMs: 5_000,
  maxHandsPerPass: 7,
  dealWindowMs: 600_000,
  autoRebuy: LIGHTNING_AUTO_REBUY_DEFAULTS,
};
const quiet = { log: () => {}, warn: () => {}, error: () => {} };

function handRow(n: number, base: number) {
  const f = formedHand(n, base);
  return {
    hand_id: f.handId,
    instance_id: f.instanceId,
    bb: f.bb,
    sb: f.sb,
    btn: f.btn,
    players: f.players,
  };
}

describe('the waiting count a forming pass leaves', () => {
  it('is the legal count less every player placed in a hand, never below zero', () => {
    expect(lightningPoolWaitingAfterPass(9, [handRow(6, 100)])).toBe(3);
    expect(lightningPoolWaitingAfterPass(4, [])).toBe(4);
    expect(lightningPoolWaitingAfterPass(12, [handRow(6, 100), handRow(6, 200)])).toBe(0);
    expect(lightningPoolWaitingAfterPass(3, [handRow(6, 100)])).toBe(0);
  });

  it('is unknown, not zero, when the answer carries no count', () => {
    expect(lightningPoolWaitingAfterPass(undefined, [])).toBeNull();
    expect(lightningPoolWaitingAfterPass('7', [])).toBeNull();
    expect(lightningPoolWaitingAfterPass(Number.NaN, [])).toBeNull();
  });

  it('is reported by a forming pass that answered, and never by one that failed', async () => {
    const told: number[] = [];
    let reply: unknown = {
      data: {
        ok: true,
        formed: 1,
        hands: [handRow(6, 100)],
        legal_count: 8,
        frozen: false,
        stopped_reason: 'plan_exhausted',
      },
      error: null,
    };
    const w = new LightningClusterWorker(CLUSTER, form, {
      rpc: vi.fn(async () => reply) as any,
      presence: new LightningPresence(() => []),
      metrics: new LightningMetrics(new MetricsRegistry()),
      logger: quiet,
      startHand: () => {},
      onPoolWaiting: (n) => told.push(n),
    });
    await w.pass();
    expect(told).toEqual([2]);
    reply = { data: null, error: { message: 'socket hang up' } };
    await w.pass();
    expect(told).toEqual([2]);
  });

  it('a listener that throws never takes the pass down', async () => {
    const w = new LightningClusterWorker(CLUSTER, form, {
      rpc: vi.fn(async () => ({
        data: {
          ok: true,
          formed: 0,
          hands: [],
          legal_count: 3,
          frozen: false,
          stopped_reason: 'plan_exhausted',
        },
        error: null,
      })) as any,
      presence: new LightningPresence(() => []),
      metrics: new LightningMetrics(new MetricsRegistry()),
      logger: quiet,
      startHand: () => {},
      onPoolWaiting: () => {
        throw new Error('boom');
      },
    });
    await expect(w.pass()).resolves.toMatchObject({ outcome: 'formed' });
  });
});

describe('the waiting rooms of a Cluster', () => {
  async function registryWith(rooms: Array<{ room: string; user: string; cluster: string }>) {
    const owners = new Map(rooms.map((r) => [r.room, { playerId: r.user, clusterId: r.cluster }]));
    const reg = new LightningRegistry({
      viewAccess: async () => true,
      roomOwner: async (room: string) => owners.get(room) ?? null,
      now: () => 1_000,
    });
    const sent: Array<{ room: string; user: string; payload: Record<string, unknown> }> = [];
    reg.setUserEventSink((room, user, payload) => sent.push({ room, user, payload }));
    for (const r of rooms) {
      await reg.authorize(r.room, r.user);
      reg.connect(r.room, r.user);
    }
    return { reg, sent };
  }

  it('hears the count privately, as a number with no player in it', async () => {
    const { reg, sent } = await registryWith([{ room: uid(10), user: uid(11), cluster: CLUSTER }]);
    reg.setPoolWaiting(CLUSTER, 4);
    expect(sent).toEqual([
      {
        room: uid(10),
        user: uid(11),
        payload: {
          type: 'lightning_pool_waiting',
          pool_session_id: uid(10),
          cluster_id: CLUSTER,
          waiting: 4,
          at: 1_000,
        },
      },
    ]);
  });

  it('is told only when the count changes, and only the rooms of that Cluster', async () => {
    const { reg, sent } = await registryWith([
      { room: uid(10), user: uid(11), cluster: CLUSTER },
      { room: uid(20), user: uid(21), cluster: OTHER },
    ]);
    reg.setPoolWaiting(CLUSTER, 4);
    reg.setPoolWaiting(CLUSTER, 4);
    reg.setPoolWaiting(CLUSTER, 5);
    expect(sent.map((s) => [s.room, s.payload.waiting])).toEqual([
      [uid(10), 4],
      [uid(10), 5],
    ]);
  });

  it('a room in a hand hears nothing; once released it is told afresh', async () => {
    const room = uid(10);
    const user = uid(11);
    const { reg, sent } = await registryWith([{ room, user, cluster: CLUSTER }]);
    reg.setPoolWaiting(CLUSTER, 3);
    const host = {
      instanceId: uid(90),
      clusterId: CLUSTER,
      participantIds: () => [user],
      roomOf: () => room,
      notePresence: () => {},
    } as any;
    reg.register(host);
    reg.setPoolWaiting(CLUSTER, 4);
    expect(sent.map((s) => s.payload.waiting)).toEqual([3]);
    reg.releaseRoom(host, user);
    reg.setPoolWaiting(CLUSTER, 3);
    expect(sent.map((s) => s.payload.waiting)).toEqual([3, 3]);
  });

  it('a room with no socket is not told; RESYNC repeats the last count', async () => {
    const room = uid(10);
    const user = uid(11);
    const { reg, sent } = await registryWith([{ room, user, cluster: CLUSTER }]);
    reg.disconnect(room, user);
    reg.setPoolWaiting(CLUSTER, 2);
    expect(sent).toEqual([]);
    // A reconnect is admitted again (the room was pruned with its last socket).
    await reg.authorize(room, user);
    reg.connect(room, user);
    reg.rePushHoleCards(room, user);
    expect(
      sent.filter((s) => s.payload.type === 'lightning_pool_waiting').map((s) => s.payload.waiting)
    ).toEqual([2]);
  });
});
