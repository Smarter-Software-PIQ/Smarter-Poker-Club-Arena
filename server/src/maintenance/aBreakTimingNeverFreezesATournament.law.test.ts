/**
 * A BREAK LANDING A FEW MILLISECONDS EARLY OR LATE NEVER FREEZES A TOURNAMENT
 * (2026-11-06, Dan: "make adjustments with the breaks so tournaments never
 * freeze or fail because of the timing of a break being off").
 *
 * Sunday Deep Stack Satellite 30 (a2a2c981): its :55 break ran 00:55:42 to
 * 01:00:42 and ended INSIDE the 01:00-01:05 hourly break; both resumed in the
 * same instant at 01:05:00, table 72417d9c reserved hand 55620681 at
 * 01:05:08 and ~50 ms later a pause rose over it. The pause held the hand and
 * the waiter waited for the hand. Satellite 25 (fbb86b2a) froze the same way
 * at 18:29Z and only came back when its own break happened to overlap the
 * 03:00 hourly break.
 *
 * Two laws, both driven through the real engine:
 *  1. A reserved hand that never started, held at the pause gate by ANY
 *     owner (hourly break, qualifier/closeout boundary, an activation
 *     boundary's pause), is parked - never a live hand a waiter must
 *     outlast - and it is dealt intact when the last pause lifts.
 *  2. The tournament break and the coming hourly break are one break: a
 *     tournament break that would overlap the next scheduled hourly break
 *     ends exactly with it, never partway through it.
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
import { ServerTableEngine } from '../engine/ServerTableEngine.js';
import { HandController } from '../engine/HandController.js';
import { F06HandPermit } from '../services/F06HandPermit.js';
import { MaintenanceBreak } from './MaintenanceBreak.js';
import { TournamentManagerBase } from '../tournament/TournamentManagerBase.js';
import { readFileSync } from 'node:fs';
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

async function heldBy(owner: 'maintenance' | 'closeout' | 'activation') {
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
  // The pause rises between the reservation and the deal: the exact
  // interleaving a break's timing decides.
  if (owner === 'maintenance') f.e.pauseForMaintenance(420_000);
  if (owner === 'closeout') void f.e.parkForTerminalCloseout(0);
  if (owner === 'activation')
    f.e.pauseAfterHand(undefined, { beforeNextHand: true, untilResumed: true });
  acknowledge();
  await vi.waitFor(() => expect(f.e.handForHandResolve).not.toBeNull());
  return { ...f, run, attempt };
}

// A durable table break (an unclaimed tournament move) never holds a reserved
// original at all: runOriginalController plays it, and the move claims the
// table at the boundary the hand produces (#9625,
// anUnclaimableMoveDoesNotOutlastTheLastPause / isNextHandPausedOnlyByUnclaimedTournamentMove).
it.each(['maintenance', 'closeout', 'activation'] as const)(
  'a reserved hand that never started, held by the %s pause, is parked',
  async (owner) => {
    const { e, controller, attempt, emitted } = await heldBy(owner);
    expect(attempt.started).toBe(false);
    expect(emitted).toEqual([]);
    expect(JSON.parse(controller.serializeRecoveryState()).handStarted).toBe(false);
    expect(e.isBetweenHands()).toBe(false);
    expect(e.isPreparedOriginalHeldAtPauseGate()).toBe(true);
    // The owner-specific questions are the same rule plus their own owner.
    expect(e.isPreparedOriginalHeldForMaintenance()).toBe(owner === 'maintenance');
    expect(e.isPreparedOriginalHeldAtTerminalCloseout()).toBe(owner === 'closeout');
  }
);

it.each([
  'started',
  'not-at-gate',
  'wrong-controller',
  'settling',
  'permit-replaced',
  'owner-lost',
  'continuation-batch',
] as const)('a %s hand is never mistaken for a held, unstarted one', async (scenario) => {
  const f = await heldBy('activation');
  const e = f.e;
  if (scenario === 'started') f.controller.start();
  if (scenario === 'not-at-gate') e.handForHandResolve = null;
  if (scenario === 'wrong-controller') e.retainedPreparedOriginalController = null;
  if (scenario === 'settling') e.postHandTasksPromise = Promise.resolve();
  if (scenario === 'permit-replaced') e.handCount = 55574171;
  if (scenario === 'owner-lost') e.lifecycleCanMutate = () => false;
  if (scenario === 'continuation-batch')
    e.handContinuation = { isUnretained: () => false, close: () => {} };
  expect(e.isPreparedOriginalHeldAtPauseGate()).toBe(false);
  e.handContinuation = null;
});

it('the activation boundary does not wait for a held hand that never started', async () => {
  const { e } = await heldBy('activation');
  const between = (TournamentManagerBase.prototype as any).allTablesBetweenHands;
  expect(between.call({ tableEngines: new Map([[config.tableId, e]]) })).toBe(true);
});

it('the activation boundary still waits for a hand that has started', async () => {
  const f = await heldBy('activation');
  f.controller.start();
  const between = (TournamentManagerBase.prototype as any).allTablesBetweenHands;
  expect(between.call({ tableEngines: new Map([[config.tableId, f.e]]) })).toBe(false);
});

it('the held hand is dealt intact when the last pause lifts', async () => {
  const { e, controller, run, emitted } = await heldBy('activation');
  e.resumeDealing();
  await vi.waitFor(() => expect(emitted.some((ev) => ev.type === 'CARDS_DEALT')).toBe(true));
  expect(e.handCount).toBe(55574170);
  const state = controller.getState();
  expect(controller.performAction(state.currentPlayerSeat, 'fold')).toBe(true);
  await run;
  await e.handContinuation.join();
  expect(emitted.filter((ev) => ev.type === 'HAND_START')).toHaveLength(1);
});

function schedule(at: number, opts: { phase?: string; armed?: boolean; announceIn?: number }) {
  const mb: any = Object.create(MaintenanceBreak.prototype);
  mb.now = () => at;
  mb.phase = opts.phase ?? 'idle';
  mb.started = true;
  mb.announceTimer = opts.armed === false ? null : {};
  mb.scheduledAnnouncementAt = at + (opts.announceIn ?? 3 * 60_000);
  mb.announcedAt = 0;
  mb.breakEndsAt = 0;
  return mb as MaintenanceBreak;
}

it('a :55 tournament break ends with the :00 hourly break it would overlap', () => {
  const at55 = Date.parse('2026-11-06T00:55:00Z');
  // Hourly break announced at :58, starts :00, ends :05.
  const mb = schedule(at55, {});
  expect(mb.tournamentBreakEndsAt(7 * 60_000)).toBe(Date.parse('2026-11-06T01:05:00Z'));
});

it('a break the tournament break cannot reach, or none armed, changes nothing', () => {
  const at = Date.parse('2026-11-06T00:30:00Z');
  expect(schedule(at, { announceIn: 28 * 60_000 }).tournamentBreakEndsAt(7 * 60_000)).toBe(0);
  expect(schedule(at, { armed: false }).tournamentBreakEndsAt(7 * 60_000)).toBe(0);
});

it('an active hourly break is still the end it always was', () => {
  const at = Date.parse('2026-11-06T00:56:00Z');
  const mb: any = schedule(at, { phase: 'counting_down' });
  mb.breakEndsAt = Date.parse('2026-11-06T01:05:00Z');
  expect(mb.tournamentBreakEndsAt(7 * 60_000)).toBe(mb.breakEndsAt);
});

it('every synchronized tournament break asks the one-break end, never the idle one', () => {
  const src = readFileSync(new URL('../GameServer.ts', import.meta.url), 'utf8');
  expect(src.match(/this\.maintenanceBreak\.tournamentBreakEndsAt\(/g)).toHaveLength(2);
  expect(src).not.toMatch(/const maintenanceEndsAt = this\.maintenanceBreak\.endsAt\(\)/);
});
