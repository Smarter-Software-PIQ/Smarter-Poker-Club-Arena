import v8 from 'node:v8';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
vi.mock('./http/auth.js', () => ({ authenticateRequest: vi.fn() }));
vi.mock('./http/body.js', () => ({ readBody: vi.fn() }));
vi.mock('./http/rateLimit.js', () => ({ checkRateLimit: vi.fn(() => true) }));
import { GameServer } from './GameServer.js';
import { ServerTableEngine } from './engine/ServerTableEngine.js';

/**
 * A RETIRED TABLE ENGINE IS GARBAGE (2026-11-02).
 *
 * engine-01 served eed06fe5 with 15 V8 "Ineffective mark-compacts near heap
 * limit" deaths in 72 hours. With the Diamond Arena closed, its tournament
 * tables are refused at start and retired about 7,300 times every 30 minutes
 * (14,694 "Diamond Tournaments Are Not Open" lines in one 30-minute window,
 * 91 distinct tables), and the main heap climbed about 4 GB an hour after each
 * restart. A live sampling heap profile attributed the retained growth to
 * engines built by admitMissingManagedTableEngine -> createManagedTableEngine:
 * every retired generation stayed reachable. eed06fe5's GameServer held each
 * adopted generation in a strong Map (weeklyPayoutTableListeners) until process
 * shutdown; #8692 made it a WeakMap and released it on every registry exit.
 *
 * The structural suite (WeeklyPayoutCustodyReleasesRetiredEngines) pins that
 * one registry. This law pins the property the process actually needs, for any
 * registry present or future: after a generation is stopped and has left the
 * GameServer, nothing in the process can still reach it. Measured with the
 * real classes and a forced full GC: eed06fe5 retains 60 of 60 generations in
 * each case below; main retains 0.
 */
v8.setFlagsFromString('--expose-gc');
const gc = vm.runInNewContext('gc') as () => void;

const GENERATIONS = 24;

async function collect(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    gc();
  }
}

function tableId(prefix: string, index: number): string {
  return `${prefix}-${prefix.slice(0, 4)}-4${prefix.slice(0, 3)}-8${prefix.slice(0, 3)}-${String(index % 5).padStart(12, '0')}`;
}

async function stopQuietly(engine: any): Promise<void> {
  try {
    await engine.stop();
  } catch {
    /* a teardown diagnostic does not change reachability */
  }
}

describe('a retired table engine is collectable', () => {
  it('drops a tournament generation that was admitted, stopped and unregistered', async () => {
    const gameServer = new GameServer() as any;
    gameServer.running = true;
    const refs: WeakRef<object>[] = [];
    try {
      for (let i = 0; i < GENERATIONS; i++) {
        const id = tableId('aaaaaaaa', i);
        let engine: any = new ServerTableEngine(id);
        refs.push(new WeakRef(engine));
        expect(gameServer.registerTableEngine(id, engine)).toBe(true);
        await stopQuietly(engine);
        expect(gameServer.unregisterTournamentTableEngine(id, engine)).toBe(true);
        engine = null;
      }
    } finally {
      gameServer.running = false;
    }
    await collect();
    expect(refs.filter((ref) => ref.deref()).length).toBe(0);
  });

  it('drops a generation fenced by a failed start (the closed-Diamond refusal shape)', async () => {
    const gameServer = new GameServer() as any;
    gameServer.running = true;
    const refs: WeakRef<object>[] = [];
    try {
      for (let i = 0; i < GENERATIONS; i++) {
        const id = tableId('bbbbbbbb', i);
        let engine: any = new ServerTableEngine(id);
        refs.push(new WeakRef(engine));
        expect(gameServer.registerTableEngine(id, engine)).toBe(true);
        engine.claimProcessOwnership();
        engine.killForRestart('start_failed:start_load_table', false);
        await stopQuietly(engine);
        expect(gameServer.unregisterTournamentTableEngine(id, engine)).toBe(true);
        engine = null;
      }
    } finally {
      gameServer.running = false;
    }
    await collect();
    expect(refs.filter((ref) => ref.deref()).length).toBe(0);
  });

  it('drops every replaced generation and keeps only the live successor', async () => {
    const gameServer = new GameServer() as any;
    gameServer.running = true;
    const id = tableId('cccccccc', 0);
    const refs: WeakRef<object>[] = [];
    let current: any = new ServerTableEngine(id);
    try {
      expect(gameServer.registerTableEngine(id, current)).toBe(true);
      for (let i = 0; i < GENERATIONS; i++) {
        refs.push(new WeakRef(current));
        const fresh: any = new ServerTableEngine(id);
        await stopQuietly(current);
        await expect(gameServer.replaceTableEngine(id, current, fresh)).resolves.toBe(true);
        current = fresh;
      }
      await collect();
      expect(refs.filter((ref) => ref.deref()).length).toBe(0);
      expect(gameServer.tableEngines.get(id)).toBe(current);
    } finally {
      await stopQuietly(current);
      gameServer.unregisterTournamentTableEngine(id, current);
      gameServer.running = false;
    }
  });

  it('drops a cash generation that left through unregisterTableEngine', async () => {
    const gameServer = new GameServer() as any;
    const refs: WeakRef<object>[] = [];
    for (let i = 0; i < GENERATIONS; i++) {
      const id = tableId('dddddddd', i);
      let engine: any = new ServerTableEngine(id);
      refs.push(new WeakRef(engine));
      gameServer.tableEngines.set(id, engine);
      gameServer.adoptWeeklyPayout(engine);
      await stopQuietly(engine);
      expect(gameServer.unregisterTableEngine(id, engine)).toBe(true);
      engine = null;
    }
    await collect();
    expect(refs.filter((ref) => ref.deref()).length).toBe(0);
  });
});
