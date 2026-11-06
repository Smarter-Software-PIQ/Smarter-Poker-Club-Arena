/**
 * A RETAINED ORIGINAL NEVER STARTS OUTSIDE THE HAND-FOR-HAND ROUND (2026-11-06).
 *
 * runOriginalController lets a retained, never-started original play when the
 * ONLY thing holding it is an unclaimed tournament move (#9625: the move can
 * claim only at the boundary that hand produces). The predicate it asks,
 * isNextHandPausedOnlyByUnclaimedTournamentMove, ignores a plain hand-for-hand
 * pause (pauseAfterHand() without beforeNextHand), so a table carrying an
 * unclaimed move dealt its original while every other table waited for the
 * hand-for-hand round. The gate now waits for the round's release whenever
 * hand-for-hand holds the table; resumeDealing() lifts it (an unclaimed move
 * on a retained original never blocks that release), and the original plays
 * inside the round.
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
    // Production permits carry no start predicate of their own; the engine's
    // gate decides. This one only refuses what that gate would refuse.
    () => !e.isNextHandPaused() || e.isNextHandPausedOnlyByUnclaimedTournamentMove()
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

async function retainedUnder(owners: { handForHand: boolean; unclaimedMove: boolean }) {
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
  if (owners.handForHand) f.e.pauseAfterHand();
  if (owners.unclaimedMove) f.e.tournamentMovePauseOwners.add('balancer-probe');
  acknowledge();
  return { ...f, run, attempt };
}

it('an unclaimed move alone still lets the retained original play (#9625 unchanged)', async () => {
  const { attempt } = await retainedUnder({ handForHand: false, unclaimedMove: true });
  await vi.waitFor(() => expect(attempt.started).toBe(true));
});

it('under hand-for-hand, an unclaimed move does not let the original start outside the round', async () => {
  const { e, controller, attempt, emitted } = await retainedUnder({
    handForHand: true,
    unclaimedMove: true,
  });
  await vi.waitFor(() => expect(e.handForHandResolve).not.toBeNull());
  expect(attempt.started).toBe(false);
  expect(emitted).toEqual([]);
  expect(JSON.parse(controller.serializeRecoveryState()).handStarted).toBe(false);
  expect(e.isWaitingForHandForHand()).toBe(true);
  // The round's release is not blocked by the unclaimed move, and the
  // original then plays inside the round.
  expect(e.isHandForHandReleaseBlocked()).toBe(false);
  e.resumeDealing();
  await vi.waitFor(() => expect(attempt.started).toBe(true));
});

it('hand-for-hand alone holds the original until the round is released', async () => {
  const { e, attempt } = await retainedUnder({ handForHand: true, unclaimedMove: false });
  await vi.waitFor(() => expect(e.handForHandResolve).not.toBeNull());
  expect(attempt.started).toBe(false);
  e.resumeDealing();
  await vi.waitFor(() => expect(attempt.started).toBe(true));
});
