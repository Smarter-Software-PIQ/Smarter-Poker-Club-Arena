import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * BIG TOURNAMENTS OPEN IN WAVES, THROUGH THE REAL START PATH (fix 4,
 * Dan 2026-11-05). tableOpenWaves.test.ts proves the arithmetic; this drives
 * TournamentManagerBase.startManagedTableEngine itself - the one start path
 * for launch, resume and late-registration capacity tables - with two
 * managers sharing one opening budget, and proves:
 *   - no dealer reaches its first database read before its slot;
 *   - two 60-table events starting together never exceed one wave per gap;
 *   - every admission proof still runs, after the wait, for every table;
 *   - a late-registration capacity table is still admitted and started;
 *   - a table becoming ready frees its slot for the next.
 */
const transport = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), report: vi.fn() }));
vi.mock('../services/supabase/client.js', () => ({
  supabase: { from: transport.from, rpc: transport.rpc },
  maintenanceSupabase: { from: transport.from, rpc: transport.rpc },
}));
vi.mock('../services/errorReporter.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/errorReporter.js')>()),
  reportError: transport.report,
  reportThrottled: vi.fn(),
}));

import { GameServer } from '../GameServer.js';
import { TournamentManager } from './TournamentManager.js';
import { TableOpenGate } from './tableOpenWaves.js';

const uuid = (n: number) => `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Hand-driven clock for the shared gate. */
function clock() {
  let t = 5_000_000;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => t,
    setTimer: (fn: () => void, ms: number) => {
      const id = ++seq;
      timers.set(id, { at: t + ms, fn });
      return id;
    },
    clearTimer: (id: unknown) => void timers.delete(id as number),
    async advance(ms: number) {
      const until = t + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, v]) => v.at <= until)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        t = due[1].at;
        due[1].fn();
        await flush();
      }
      t = until;
      await flush();
    },
  };
}
async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

interface FakeEngine {
  tableId: string;
  ready: Promise<boolean>;
  settle: (ok: boolean) => void;
  start: ReturnType<typeof vi.fn>;
  holdDealingUntil: ReturnType<typeof vi.fn>;
  installF06Allocator: ReturnType<typeof vi.fn>;
  installF06HandAdmission: ReturnType<typeof vi.fn>;
  installF06OwnReservedPermitReconciler: ReturnType<typeof vi.fn>;
  getStartupTournamentPolicyRefusal: () => null;
  setHub: ReturnType<typeof vi.fn>;
  pauseAfterHand: ReturnType<typeof vi.fn>;
  isRunning: () => boolean;
}
function fakeEngine(tableId: string): FakeEngine {
  let settle!: (ok: boolean) => void;
  const ready = new Promise<boolean>((r) => (settle = r));
  // A real start() settles `ready` once its start-up reads are done and then
  // keeps running the dealing loop; it never returns before ready.
  return {
    tableId,
    ready,
    settle,
    start: vi.fn(async () => {
      await ready;
    }),
    holdDealingUntil: vi.fn(),
    installF06Allocator: vi.fn(),
    installF06HandAdmission: vi.fn(),
    installF06OwnReservedPermitReconciler: vi.fn(),
    getStartupTournamentPolicyRefusal: () => null,
    setHub: vi.fn(),
    pauseAfterHand: vi.fn(),
    isRunning: () => false,
  };
}

/** Which tables have reached their first admission read (the F06 hand state). */
const firstReads: string[] = [];

function server() {
  const game: any = Object.create(GameServer.prototype);
  Object.assign(game, {
    running: true,
    tableEngines: new Map(),
    tournamentOwnedTables: new Set(),
    tournamentRetirementCustody: { admissionAllowed: () => true },
    maintenanceBreak: { adopt: vi.fn() },
  });
  game.ownsTournamentTableEngine = (id: string, e: unknown) => game.tableEngines.get(id) === e;
  game.registerTableEngine = (id: string, e: unknown) => {
    game.tableEngines.set(id, e);
    return true;
  };
  return game;
}

function manager(game: any, event: string, lease: string, gate: TableOpenGate) {
  const m: any = new TournamentManager(event, game, lease, performance.now() + 600_000);
  m.lifecycleEpoch.begin();
  m.running = true;
  m.tableOpenGate = () => gate;
  return m;
}

function addTables(game: any, m: any, prefix: number, n: number): FakeEngine[] {
  const engines: FakeEngine[] = [];
  for (let i = 0; i < n; i++) {
    const e = fakeEngine(uuid(prefix + i));
    m.tableEngines.set(e.tableId, e);
    game.tableEngines.set(e.tableId, e);
    engines.push(e);
  }
  return engines;
}

beforeEach(() => {
  firstReads.length = 0;
  transport.rpc.mockReset();
  transport.report.mockReset();
  transport.rpc.mockImplementation(async (name: string, p: any) => {
    if (name === 'fn_ca_resume_hand_submission') return { data: { found: false }, error: null };
    if (name === 'fn_f06_hand_number_state') {
      firstReads.push(p.p_table_id);
      return {
        data: {
          ok: true,
          table_id: p.p_table_id,
          lifecycle: '1',
          can_reserve: true,
          blocked_reason: null,
          used_hand_number_max: '0',
          next_hand_number_candidate: '1',
          unresolved_permit: null,
        },
        error: null,
      };
    }
    throw new Error('unexpected rpc ' + name);
  });
});
afterEach(() => vi.restoreAllMocks());

describe('big tournaments open their tables in waves', () => {
  it('two 60-table events launching together share one budget and every table still starts', async () => {
    const c = clock();
    const gate = new TableOpenGate({
      now: c.now,
      setTimer: c.setTimer,
      clearTimer: c.clearTimer,
      log: () => {},
      inFlightMax: 1000,
    });
    const game = server();
    const a = manager(game, uuid(1), uuid(2), gate);
    const b = manager(game, uuid(3), uuid(4), gate);
    const ea = addTables(game, a, 1000, 60);
    const eb = addTables(game, b, 2000, 60);
    // A healthy table finishes its start-up reads promptly.
    for (const e of [...ea, ...eb]) e.start.mockImplementation(async () => e.settle(true));
    // The launch loops of both managers, as start() runs them.
    for (let i = 0; i < 60; i++) {
      a.startManagedTableEngine(ea[i], 'Tournament.a.table_engine_error');
      b.startManagedTableEngine(eb[i], 'Tournament.b.table_engine_error');
    }
    await flush();
    // Nothing past the first wave has touched the database.
    expect(firstReads).toHaveLength(25);
    const waveSizes = [firstReads.length];
    while (firstReads.length < 120) {
      const before = firstReads.length;
      await c.advance(1500);
      waveSizes.push(firstReads.length - before);
    }
    expect(waveSizes).toEqual([25, 25, 25, 25, 20]);
    // Both events were opening from the first wave on.
    const first = new Set(firstReads.slice(0, 25));
    expect(ea.some((e) => first.has(e.tableId))).toBe(true);
    expect(eb.some((e) => first.has(e.tableId))).toBe(true);
    // Every table ran the full admission and started exactly once.
    for (const e of [...ea, ...eb]) {
      expect(e.installF06Allocator).toHaveBeenCalledOnce();
      expect(e.installF06HandAdmission).toHaveBeenCalledOnce();
      expect(e.start).toHaveBeenCalledOnce();
    }
    expect(transport.report).not.toHaveBeenCalled();
  });

  it('a slow database holds the next wave until earlier tables are ready', async () => {
    const c = clock();
    const gate = new TableOpenGate({
      now: c.now,
      setTimer: c.setTimer,
      clearTimer: c.clearTimer,
      log: () => {},
      inFlightMax: 50,
    });
    const game = server();
    const a = manager(game, uuid(5), uuid(6), gate);
    const ea = addTables(game, a, 3000, 70);
    for (const e of ea) a.startManagedTableEngine(e, 'Tournament.a.table_engine_error');
    await c.advance(1500);
    await c.advance(1500);
    await c.advance(1500);
    // None ready yet: the in-flight cap holds at 50.
    expect(firstReads).toHaveLength(50);
    // Ten tables finish their start-up reads; ten more may begin.
    for (const e of ea.slice(0, 10)) e.settle(true);
    await c.advance(0);
    await c.advance(1500);
    expect(firstReads).toHaveLength(60);
    for (const e of ea) e.settle(true);
    await c.advance(1500);
    expect(firstReads).toHaveLength(70);
    expect(gate.stats().inFlight).toBe(0);
  });

  it('a late-registration capacity table is still admitted and started through the gate', async () => {
    const c = clock();
    const gate = new TableOpenGate({
      now: c.now,
      setTimer: c.setTimer,
      clearTimer: c.clearTimer,
      log: () => {},
    });
    const game = server();
    const a = manager(game, uuid(7), uuid(8), gate);
    // The launch already holds the wave's room.
    const launch = addTables(game, a, 4000, 25);
    for (const e of launch) a.startManagedTableEngine(e, 'Tournament.a.table_engine_error');
    await flush();
    expect(firstReads).toHaveLength(25);
    const capacityId = uuid(4999);
    const capacity = fakeEngine(capacityId);
    vi.spyOn(a, 'createManagedTableEngine').mockReturnValue(capacity);
    vi.spyOn(a, 'wireEliminationWake').mockImplementation(() => {});
    expect(a.startCapacityTableEngine(capacityId)).toBe(true);
    await flush();
    // Queued behind the full wave, not refused and not dropped.
    expect(firstReads).not.toContain(capacityId);
    expect(game.tableEngines.get(capacityId)).toBe(capacity);
    await c.advance(1500);
    expect(firstReads).toContain(capacityId);
    expect(capacity.start).toHaveBeenCalledOnce();
  });

  it('a table whose manager stood down while it waited is refused by the existing fence', async () => {
    const c = clock();
    const gate = new TableOpenGate({
      now: c.now,
      setTimer: c.setTimer,
      clearTimer: c.clearTimer,
      log: () => {},
      waveSize: 1,
    });
    const game = server();
    const a = manager(game, uuid(9), uuid(10), gate);
    const [first, second] = addTables(game, a, 5000, 2);
    vi.spyOn(a, 'recoverManagedTableEngine').mockResolvedValue(undefined);
    a.startManagedTableEngine(first, 'Tournament.a.table_engine_error');
    a.startManagedTableEngine(second, 'Tournament.a.table_engine_error');
    await flush();
    expect(firstReads).toEqual([first.tableId]);
    // The second dealer's generation is replaced while it waits.
    game.tableEngines.set(second.tableId, fakeEngine(second.tableId));
    await c.advance(1500);
    expect(firstReads).toEqual([first.tableId]);
    expect(second.start).not.toHaveBeenCalled();
    expect(String(transport.report.mock.calls[0]?.[0]?.message)).toContain(
      'f06_engine_admission_fenced'
    );
  });
});

describe('the first deal of a held launch goes in waves', () => {
  it('a dealer prepared inside the pre-seat minute is held to its own wave, wave 0 at the start', () => {
    const game = server();
    const gate = new TableOpenGate({ log: () => {} });
    const startMs = Date.now() + 60_000;
    const a = manager(game, uuid(11), uuid(12), gate);
    a.tournamentCache = { started_at: new Date(startMs).toISOString() };
    const engines = addTables(game, a, 6000, 60);
    for (const e of engines) a.prepareManagedTableEngineForPlay(e);
    const holds = engines.map((e) => Math.max(...e.holdDealingUntil.mock.calls.map((c) => c[0])));
    // Every table is held at least to the advertised start; nobody deals early.
    for (const e of engines) expect(e.holdDealingUntil).toHaveBeenCalledWith(startMs);
    expect(Math.min(...holds)).toBe(startMs);
    expect(holds.filter((h) => h === startMs)).toHaveLength(25);
    expect(Math.max(...holds) - startMs).toBe(3000);
    // Preparing the same dealer again (a restart in the minute) keeps its wave.
    const again = engines[59];
    again.holdDealingUntil.mockClear();
    a.prepareManagedTableEngineForPlay(again);
    expect(Math.max(...again.holdDealingUntil.mock.calls.map((c) => c[0]))).toBe(holds[59]);
  });

  it('start() assigns the waves right after the advertised-start hold, and the level clock keeps the advertised start', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/tournament/TournamentManagerBase.ts', 'utf8');
    const hold = src.indexOf('engine.holdDealingUntil(launchStartMs);');
    const waves = src.indexOf('firstDealWaves.assign(launchStartMs, this.tableEngines.keys())');
    const blind = src.indexOf(
      'const blindStartAtMs = spinFirstDealHoldUntil > 0 ? spinFirstDealHoldUntil : launchStartMs;'
    );
    expect(hold).toBeGreaterThan(-1);
    expect(waves).toBeGreaterThan(hold);
    expect(blind).toBeGreaterThan(waves);
    // The gate sits after the admission fence and before the first database read.
    const fence = src.indexOf('await this.awaitTableOpeningWave(engine, tableId, current);');
    const firstRead = src.indexOf('await resumeRetainedHandSubmission(tableId, INSTANCE_ID');
    expect(fence).toBeGreaterThan(-1);
    expect(firstRead).toBeGreaterThan(fence);
  });
});
