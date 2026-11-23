/**
 * Shared deal fixture for the F06 rest tests: the real ServerTableEngine
 * dealHand, the real F06HandPermit, and an RPC fake that keeps SQL's
 * one-reserved-permit-per-table rule. The importing test file owns the
 * vi.mock calls for the Supabase client, error reporter and engine alerts.
 * Copied from AnUnstartedHandReleasesItsPermit.test.ts (2026-10-15), with an
 * optional per-call latency, a begin hook and named begin refusals.
 */
import { expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ServerTableEngine } from './ServerTableEngine.js';
import { F06HandPermit } from '../services/F06HandPermit.js';

export const ids = {
  tournament_id: 'aaaaaaaa-0000-4000-8000-0000000000f1',
  lease_generation: 'bbbbbbbb-0000-4000-8000-0000000000f1',
  table_id: 'cccccccc-0000-4000-8000-0000000000f1',
  custody_id: 'eeeeeeee-0000-4000-8000-0000000000f1',
  lifecycle: '7',
};

type Row = {
  permit_id: string;
  hand_number: string;
  state: 'reserved' | 'never_started' | 'accepted';
  evidence_id: string | null;
};

export const engines: any[] = [];
export function disposeEngines(): void {
  for (const engine of engines.splice(0)) {
    engine.cancelHorseDecisionWork();
    engine.running = false;
    (ServerTableEngine as any).releaseCurrentEngine(engine.tableId, engine);
    engine.preciseTimer.dispose();
    engine.engineTelemetry.dispose();
  }
  vi.restoreAllMocks();
  vi.clearAllMocks();
}

export function fixture(
  opts: {
    loseBeginReply?: number;
    loseCancelReply?: number;
    stoppedCustody?: boolean;
    failCancelBeforeCommit?: boolean;
    onBegin?: (call: number) => void;
    refuseBegin?: Record<number, string>;
    /** Simulated round-trip time for every F06 RPC and the seq-0 retention. */
    rpcLatencyMs?: number;
    /** Retained-cancel replies to lose (1-based call numbers). */
    loseRetainedCancelReply?: number;
    /** Refuse every retained cancel before it commits (e.g. a frozen platform). */
    refuseRetainedCancel?: boolean;
  } = {}
) {
  const engine = new ServerTableEngine(
    ids.table_id,
    opts.stoppedCustody
      ? {
          scope: 'tournament',
          verified: true,
          tournamentId: ids.tournament_id,
          generation: ids.lease_generation,
          proofDeadlineMonotonicMs: performance.now() + 30_000,
        }
      : undefined
  ) as any;
  engines.push(engine);
  expect(engine.claimProcessOwnership()).toBe(true);
  engine.tableInfo = {
    id: ids.table_id,
    game_variant: 'nlh',
    game_type: 'tournament',
    tournament_id: ids.tournament_id,
    max_players: 3,
    small_blind: 10,
    big_blind: 20,
    ante: 0,
    ante_enabled: false,
  };
  const seats = [1, 2, 3].map((seat) => ({
    seat_number: seat,
    user_id: 'u' + seat,
    username: 'Player ' + seat,
    occupancy_id: 'occupancy-' + seat,
    stack: 1000,
    seat_id: '00000000-0000-4000-8000-00000000000' + seat,
    seat_joined_at: '2026-10-15T00:00:00.123456Z',
  }));
  engine.seatedPlayers = seats;
  engine.takePreparedHandNumber = () => 100 + engine.handsDealtThisSession;
  engine.bombPotSchedPersistedJson = 'null';
  engine.eventShadowEnabled = false;
  engine.hub = { emitEvent: vi.fn() };
  engine.refreshRakeConfig = async () => {};
  // The private writer is qualified separately by OriginalControllerRuntime
  // and native PostgreSQL; this fixture isolates permit cancellation.
  const retainedAt: number[] = [];
  // SQL's private capsules: one per permit, written by the seq-0 save.
  const capsules = new Map<string, number>();
  engine.retainOriginalBatch = vi.fn(async (original: any, _seats: unknown, batch: any) => {
    retainedAt.push(Date.now());
    if (opts.rpcLatencyMs) await new Promise((r) => setTimeout(r, opts.rpcLatencyMs));
    const row = db.get(String(original.permit_id));
    if (!row || row.state !== 'reserved') throw new Error('HAND_CONTINUATION_ORIGINAL_UNPROVEN');
    capsules.set(row.permit_id, Number(batch.sequence));
  });
  engine.saveSnapshot = vi.fn(async () => {});
  engine.persistPresenceForRestart = vi.fn(async () => {});
  const startedAt: number[] = [];
  const started = vi.fn(() => startedAt.push(Date.now()));
  const originalHandleHandEvent = engine.handleHandEvent.bind(engine);
  engine.handleHandEvent = vi.fn(async (event: any, ...rest: unknown[]) => {
    if (event?.type === 'HAND_START') {
      started();
      return;
    }
    return originalHandleHandEvent(event, ...rest);
  });
  engine.refreshBlinds = vi.fn(async () => {});
  // Reached after the reservation and the controller build: emit HAND_START
  // through the real HandContinuationLane so seq-1 retention and the rest gate
  // are exercised end-to-end without running action timers or horse turns.
  engine.fetchTimeBankExtras = async () => {
    const controller = engine.handController;
    controller.start = () => {
      (controller as any).handStarted = true;
      (controller as any).emit({
        type: 'HAND_START',
        handNumber: engine.handCount,
        players: controller.getState().players,
      });
    };
    return new Map();
  };
  const recorded = vi.spyOn(engine, 'recordRecoveryEvent');

  // SQL's view: one row per permit, and at most one `reserved` per table.
  const db = new Map<string, Row>();
  const reply = (row: Row) => ({
    ...row,
    tournament_id: ids.tournament_id,
    generation: ids.lease_generation,
    table_id: ids.table_id,
    lifecycle: ids.lifecycle,
    custody_id: ids.custody_id,
  });
  let beginCalls = 0;
  const beginAt: number[] = [];
  let cancelCalls = 0;
  let retainedCancelCalls = 0;
  const latency = () =>
    opts.rpcLatencyMs ? new Promise((r) => setTimeout(r, opts.rpcLatencyMs)) : Promise.resolve();
  const rpc = vi.fn(async (name: string, input: Record<string, unknown>) => {
    await latency();
    const permitId = String(input.p_permit_id);
    if (name === 'fn_f06_begin_hand') {
      beginCalls += 1;
      beginAt.push(Date.now());
      opts.onBegin?.(beginCalls);
      const refusal = opts.refuseBegin?.[beginCalls];
      if (refusal) return { data: { ok: false, reason: refusal }, error: null };
      const existing = db.get(permitId);
      if (existing) {
        return { data: { ...reply(existing), ok: existing.state === 'reserved' }, error: null };
      }
      if ([...db.values()].some((row) => row.state === 'reserved')) {
        return { data: { ok: false, reason: 'hand_permit_unresolved' }, error: null };
      }
      const row: Row = {
        permit_id: permitId,
        hand_number: String(input.p_hand_number),
        state: 'reserved',
        evidence_id: null,
      };
      db.set(permitId, row);
      // The begin committed, but its reply is lost on the way back.
      if (beginCalls === opts.loseBeginReply) return { data: null, error: new Error('lost reply') };
      return { data: { ...reply(row), ok: true }, error: null };
    }
    if (name === 'fn_f06_cancel_retained_prepared_hand') {
      retainedCancelCalls += 1;
      if (opts.refuseRetainedCancel)
        return {
          data: null,
          error: new Error('PLATFORM_FROZEN: retained preparation keeps its capsule'),
        };
      const row = db.get(permitId);
      if (!row) return { data: null, error: new Error('F06_PREPARED_ORIGINAL_REQUIRED') };
      if (
        row.state === 'never_started' &&
        row.evidence_id === permitId &&
        !capsules.has(permitId)
      ) {
        // The exact replay: the same receipt.
      } else if (row.state !== 'reserved') {
        return { data: null, error: new Error('F06_PREPARED_NOT_RESERVED') };
      } else {
        if ((capsules.get(permitId) ?? 0) !== 0)
          return { data: null, error: new Error('F06_RETAINED_ORIGINAL_NOT_PREPARED') };
        capsules.delete(permitId);
        row.state = 'never_started';
        row.evidence_id = permitId;
      }
      if (retainedCancelCalls === opts.loseRetainedCancelReply)
        return { data: null, error: new Error('lost reply') };
      return { data: { ...reply(row), ok: true }, error: null };
    }
    if (name === 'fn_f06_cancel_prepared_hand') {
      cancelCalls += 1;
      if (opts.failCancelBeforeCommit)
        return { data: null, error: new Error('transport before commit') };
      const row = db.get(permitId);
      if (!row || (row.state !== 'reserved' && row.evidence_id !== permitId))
        return { data: null, error: new Error('F06_PREPARED_NOT_RESERVED') };
      // A saved original's never_started meets its 'retained' disposition.
      if (capsules.has(permitId))
        return { data: null, error: new Error('HAND_CONTINUATION_UNSETTLED') };
      row.state = 'never_started';
      row.evidence_id = permitId;
      if (cancelCalls === opts.loseCancelReply)
        return { data: null, error: new Error('lost reply') };
      return { data: { ...reply(row), ok: true }, error: null };
    }
    throw new Error('unexpected rpc ' + name);
  });
  const allowStart = { value: true };
  engine.running = false;
  if (opts.stoppedCustody)
    engine.installF06Allocator(
      ids.custody_id,
      async () => 100,
      () => true,
      ids.lifecycle
    );
  engine.installF06HandAdmission(
    (handNumber: string) =>
      new F06HandPermit(
        {
          tournament_id: ids.tournament_id,
          lease_generation: ids.lease_generation,
          table_id: ids.table_id,
          lifecycle: ids.lifecycle,
          permit_id: randomUUID(),
          hand_number: handNumber,
          custody_id: ids.custody_id,
        },
        rpc,
        () => true,
        () => allowStart.value
      )
  );
  engine.running = true;
  const reserved = () => [...db.values()].filter((row) => row.state === 'reserved');
  /** Deal, see the hand start, then let the fixture's hand wait go. */
  async function dealsTheNextHand() {
    const deal = engine.dealHand(seats);
    await vi.waitFor(() => expect(started).toHaveBeenCalledOnce(), { timeout: 5000 });
    engine.activeHandWaitRelease?.release('fixture_done');
    await deal;
  }
  const cancels = () =>
    rpc.mock.calls.filter(([name]) => name === 'fn_f06_cancel_prepared_hand').length;
  const retainedCancels = () =>
    rpc.mock.calls.filter(([name]) => name === 'fn_f06_cancel_retained_prepared_hand').length;
  const killed = vi.spyOn(engine, 'killForRestart').mockImplementation(() => {
    engine.running = false;
  });
  /** Arm a rest the way the dealing loop does, and stop short of it as the loop does. */
  async function armRestAndLead(restMs: number) {
    engine.nextHandNotBeforeMs = Date.now() + restMs;
    const restEndsAt = engine.nextHandNotBeforeMs;
    await engine.awaitNextHandRestLead();
    return restEndsAt as number;
  }
  return {
    engine,
    seats,
    db,
    rpc,
    started,
    startedAt,
    beginAt,
    recorded,
    allowStart,
    reserved,
    dealsTheNextHand,
    cancels,
    retainedCancels,
    capsules,
    killed,
    armRestAndLead,
    retainedAt,
  };
}
