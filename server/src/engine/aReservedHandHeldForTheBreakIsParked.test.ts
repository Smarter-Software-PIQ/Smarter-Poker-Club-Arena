/**
 * A RESERVED HAND THAT THE BREAK HELD BEFORE ITS DEAL IS PARKED (2026-11-05).
 *
 * Spin 9139b7d2 (tournament 3111798e, "20 Chip Spin NLH", 2 players):
 *   23:20:00.953Z  engine-recovery-window break announced
 *   23:20:01.301Z  "Hand #55574170 - 2 players"   (number allocated, permit
 *                  reserved, sequence-zero original being retained)
 *   23:20:01.365Z  LAST HAND fan-out reaches the table (pauseForMaintenance)
 *   23:20:01.536Z  "Parked between hands - waiting for the pause to lift..."
 *                  (runOriginalController holding the unstarted original)
 * and from 23:22:09Z the restart census counted the table `cards_in_air`
 * for the whole break, so release 42126015699-1 backed out. The hand was
 * never dealt; it played intact after the thaw.
 *
 * These cases drive that exact interleaving through the real engine and the
 * real census: the park request lands between the original's retention and
 * its start.
 */
import { afterEach, expect, it, vi } from 'vitest';
const { presenceUpserts } = vi.hoisted(() => ({ presenceUpserts: [] as unknown[] }));
vi.mock('../services/supabase/client.js', () => ({
  supabase: {
    from: (table: string) => {
      if (table !== 'engine_presence_parked') throw Error('Unexpected SQL ' + table);
      return {
        upsert: async (row: unknown) => {
          presenceUpserts.push(row);
          return { error: null };
        },
      };
    },
    rpc: () => {
      throw Error('Unexpected RPC');
    },
  },
  maintenanceSupabase: {},
}));
vi.mock('../services/errorReporter.js', () => ({ reportError: vi.fn(), reportWarning: vi.fn() }));
import { ServerTableEngine } from './ServerTableEngine.js';
import { HandController } from './HandController.js';
import { F06HandPermit } from '../services/F06HandPermit.js';
import { MaintenanceBreak } from '../maintenance/MaintenanceBreak.js';
import type { HandConfig, HandEvent, SeatPlayer } from '../types.js';

const config: HandConfig = {
  tableId: '9139b7d2-f7d7-4451-9950-a423a1cfdcd1',
  handNumber: 55574170,
  gameVariant: 'nlh',
  smallBlind: 10,
  bigBlind: 20,
  ante: 0,
  isTournament: true,
  rakeConfig: { percent: 0, cap: 0, noFlopNoDrop: true },
};
const players: SeatPlayer[] = [1, 2].map((seat) => ({
  seat,
  user_id: '00000000-0000-4000-8000-00000000010' + seat,
  username: 'P' + seat,
  stack: 1000,
  bet: 0,
  totalInvested: 0,
  cards: [],
  is_folded: false,
  is_all_in: false,
  is_sitting_out: false,
}));
const binding = {
  tournament_id: '3111798e-0000-4000-8000-000000000001',
  table_id: config.tableId,
  hand_number: '55574170',
  permit_id: 'dddddddd-0000-4000-8000-0000000000a1',
  lease_generation: 'bbbbbbbb-0000-4000-8000-0000000000a1',
  lifecycle: '1',
  custody_id: 'eeeeeeee-0000-4000-8000-0000000000a1',
};
const engines: any[] = [];
afterEach(() => {
  presenceUpserts.length = 0;
  for (const e of engines.splice(0)) {
    e.running = false;
    e.activeHandWaitRelease?.release('test_cleanup');
    e.handContinuation?.close();
    e.handForHandResolve?.();
    (ServerTableEngine as any).releaseCurrentEngine(e.tableId, e);
    e.preciseTimer.dispose();
    e.engineTelemetry.dispose();
  }
  vi.restoreAllMocks();
});

async function reservedOriginal() {
  const e: any = new ServerTableEngine(config.tableId);
  engines.push(e);
  expect(e.claimProcessOwnership()).toBe(true);
  e.running = true;
  e.handCount = 55574170;
  e.lifecycleCanMutate = () => true;
  e.engineLeaseAuthorityIsCurrent = () => true;
  const controller = new HandController(config, players, 1);
  e.handController = controller;
  const roster = players.map((p) => ({
    user_id: p.user_id,
    seat_number: p.seat,
    stack: p.stack,
    seat_id: '00000000-0000-4000-8000-00000000000' + p.seat,
    seat_joined_at: '2026-11-05T23:00:00Z',
    occupancy_id: '00000000-0000-4000-8000-00000000020' + p.seat,
    is_horse: false,
  }));
  e.seatedPlayers = roster;
  e.currentHandSeatGenerations = new Map(
    roster.map((p) => [p.user_id, { seat_id: p.seat_id, seat_joined_at: p.seat_joined_at }])
  );
  e.currentHandDealtStacks = new Map(players.map((p) => [p.user_id, p.stack]));
  for (const p of players) {
    e.timeBankEngine.initializePlayer(config.tableId, p.user_id);
    e.timeBankEngine.setAutoActivate(config.tableId, p.user_id, false);
    e.timeBankMeta.set(p.user_id, { initialSeconds: 30, baseSeconds: 30, dbConsumedSeconds: 0 });
  }
  const permit = new F06HandPermit(
    binding,
    async () => ({
      data: {
        ok: true,
        tournament_id: binding.tournament_id,
        generation: binding.lease_generation,
        custody_id: binding.custody_id,
        permit_id: binding.permit_id,
        table_id: binding.table_id,
        lifecycle: binding.lifecycle,
        hand_number: binding.hand_number,
        state: 'reserved',
      },
      error: null,
    }),
    () => true,
    () => !e.isNextHandPaused()
  );
  await permit.reserve();
  e.f06CurrentPermit = permit;
  e.acquireFinancialControllerStart = async () => null;
  e.beginTerminalBoundaryPersistence = () => 1;
  e.flushSnapshot = async () => {};
  e.dispatchFinancialHandComplete = (f: () => Promise<void>) => f();
  e.clearTurnTimer = () => {};
  const emitted: HandEvent[] = [];
  e.handleHandEvent = async (event: HandEvent) => {
    emitted.push(event);
  };
  e.killForRestart = vi.fn();
  return { e, controller, permit, roster, emitted };
}

/** The 23:20:01 interleaving: the break's park lands mid-retention. */
async function parkLandsBetweenReservationAndDeal() {
  const f = await reservedOriginal();
  let acknowledge!: () => void;
  let retaining = false;
  f.e.retainOriginalBatch = async (_o: unknown, _s: unknown, batch: any) => {
    if (batch.sequence !== 0) return;
    retaining = true;
    await new Promise<void>((resolve) => {
      acknowledge = resolve;
    });
  };
  const attempt = { started: false, cause: null as string | null };
  const run = f.e.runOriginalController(f.roster, f.controller, 55574170, Date.now(), attempt);
  await vi.waitFor(() => expect(retaining).toBe(true));
  f.e.pauseForMaintenance(420_000);
  acknowledge();
  await vi.waitFor(() => expect(f.e.handForHandResolve).not.toBeNull());
  return { ...f, run, attempt };
}

function census(engine: unknown): MaintenanceBreak {
  const mb = new MaintenanceBreak({
    engines: () => new Map([[config.tableId, engine]]) as never,
    isRunning: () => true,
  } as never);
  Object.assign(mb as never, { phase: 'counting_down', durableConfirmed: true });
  return mb;
}

it('the restart census counts a reserved, never-dealt original held by the break as parked', async () => {
  const { e, controller, permit, attempt, emitted } = await parkLandsBetweenReservationAndDeal();
  // The held hand: nothing dealt, nothing committed, custody intact.
  expect(attempt.started).toBe(false);
  expect(emitted).toEqual([]);
  expect(JSON.parse(controller.serializeRecoveryState()).handStarted).toBe(false);
  expect(permit.recoveryState()).toBe('attempted');
  expect(e.killForRestart).not.toHaveBeenCalled();
  expect(e.isBetweenHands()).toBe(false);
  // The production census, asked exactly as the 23:22:09Z countdown asked it.
  const mb = census(e);
  expect(mb.snapshot().unparkedReasons ?? {}).not.toHaveProperty('cards_in_air');
  expect(e.isPreparedOriginalHeldForMaintenance()).toBe(true);
  // The parked write ran at THIS gate, so its banks are durable for the break.
  await vi.waitFor(() => expect(e.maintenanceDurabilityReason()).toBeNull());
  expect(mb.snapshot().unparkedTables).toBe(0);
});

it('the held original is dealt intact after the break, never dropped or re-numbered', async () => {
  const { e, controller, run, emitted } = await parkLandsBetweenReservationAndDeal();
  const deck = controller.getRemainingDeck();
  e.resumeFromMaintenance();
  await vi.waitFor(() => expect(emitted.some((ev) => ev.type === 'CARDS_DEALT')).toBe(true));
  expect(e.handCount).toBe(55574170);
  expect(e.isPreparedOriginalHeldForMaintenance()).toBe(false);
  expect(deck.length).toBeGreaterThan(0);
  const state = controller.getState();
  expect(controller.performAction(state.currentPlayerSeat, 'fold')).toBe(true);
  await run;
  await e.handContinuation.join();
  expect(emitted.filter((ev) => ev.type === 'HAND_START')).toHaveLength(1);
  expect(emitted.filter((ev) => ev.type === 'HAND_COMPLETE')).toHaveLength(1);
});

it.each([
  'started',
  'not-at-gate',
  'no-maintenance-hold',
  'wrong-controller',
  'settling',
  'retention-unconfirmed',
  'permit-replaced',
  'owner-lost',
  'continuation-batch',
] as const)('a %s original is still counted as cards_in_air', async (scenario) => {
  const f = await parkLandsBetweenReservationAndDeal();
  const e = f.e;
  if (scenario === 'started') f.controller.start();
  if (scenario === 'not-at-gate') e.handForHandResolve = null;
  if (scenario === 'no-maintenance-hold') e.maintenancePaused = false;
  if (scenario === 'wrong-controller') e.retainedPreparedOriginalController = null;
  if (scenario === 'settling') e.postHandTasksPromise = Promise.resolve();
  if (scenario === 'retention-unconfirmed') e.preparedOriginalRetentionUnconfirmed = true;
  if (scenario === 'permit-replaced') e.handCount = 55574171;
  if (scenario === 'owner-lost') e.lifecycleCanMutate = () => false;
  if (scenario === 'continuation-batch') e.handContinuation = { isUnretained: () => false, close: () => {} };
  expect(e.isPreparedOriginalHeldForMaintenance()).toBe(false);
  expect(census(e).snapshot().unparkedReasons).toMatchObject({ cards_in_air: 1 });
  e.handContinuation = null;
});
