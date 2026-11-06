import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * AN OPERATOR CLOSURE HOLD SURVIVES AN ENGINE RESTART (2026-11-05).
 *
 * PR #9536's closure hold lived in a process-local Map. After the daily 04:00
 * Chicago restart the Map is empty, so the first closure request after boot
 * resumed a PLAYING copy that had to fail again before the hold was re-armed:
 * one extra playing generation and retire cycle per held event, every restart,
 * inside the only window these closures may run in. The handoff is now also
 * recorded on the event's abort target row, and a resume adoption with no
 * in-memory entry reads it back. These run the real GameServer admission into
 * the real TournamentManager; only the database is modelled.
 */

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  retained: vi.fn(),
  claim: vi.fn(),
  release: vi.fn(),
}));
vi.mock('../services/supabase/client.js', () => ({
  supabase: { rpc: mocks.rpc, from: mocks.from },
  maintenanceSupabase: {
    rpc: vi.fn(async (name: string, args: { p_tournament_id: string }) => {
      if (name !== 'fn_read_tournament_terminal_request')
        throw new Error('Unexpected maintenance RPC: ' + name);
      return { data: { ok: true, found: false, tournament_id: args.p_tournament_id }, error: null };
    }),
  },
}));
vi.mock('../services/supabase/handHistory.js', async (original) => ({
  ...(await original<any>()),
  resumeRetainedHandSubmission: mocks.retained,
}));
vi.mock('../services/tournamentLease.js', async (original) => ({
  ...(await original<any>()),
  claimTournamentLease: mocks.claim,
  releaseTournaments: mocks.release,
}));
vi.mock('../services/errorReporter.js', () => ({
  reportError: vi.fn(),
  reportWarning: vi.fn(),
  describeError: (error: unknown) => String(error),
}));

import { TournamentManager } from './TournamentManager.js';
import { GameServer } from '../GameServer.js';
import { TournamentRetirementCustody } from '../services/TournamentRetirementCustody.js';

const EVENT = 'c1000000-0000-4000-8000-000000000001';
const OPERATION = 'c2000000-0000-4000-8000-000000000002';
const OTHER_OPERATION = 'c3000000-0000-4000-8000-000000000003';
const SUCCESSOR = 'c5000000-0000-4000-8000-000000000005';

const managers: any[] = [];

function server(): any {
  const s = Object.create(GameServer.prototype);
  Object.assign(s, {
    running: true,
    lifecycleGeneration: 1,
    tournamentEngines: new Map(),
    tableEngines: new Map(),
    tournamentOwnedTables: new Set(),
    tournamentRetirementCustody: new TournamentRetirementCustody(),
    drainedF06TournamentCustody: new Map(),
    completedF06TournamentCustody: new Map(),
    tournamentManagerRetirementOperations: new WeakMap(),
    tournamentManagerLeaseReleaseOperations: new Map(),
    tournamentManagerPendingLeaseReleases: new Map(),
    tournamentManagerAdmissionLeaseGenerations: new Map(),
    tournamentManagerAdmissionRetryTimers: new Map(),
    discoveryJobs: new Set(),
    directAdmissionIsCurrent: () => true,
    clearTournamentManagerAdmissionRetry: vi.fn(),
    scheduleTournamentManagerAdmissionRetry: vi.fn(),
    finishTournamentManagerAdmission: vi.fn(),
  });
  return s;
}

type Durable = {
  state: 'stop_requested' | 'quiesced' | 'settled';
  operation_id: string;
  closure_hold: { operation_id: string; at: string; reason: string } | null;
} | null;

/** The database: a RUNNING event with no reserved hand, and its abort target row. */
function database(target: Durable) {
  const calls: string[] = [];
  mocks.from.mockImplementation((name: string) => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => {
          calls.push(`read:${name}`);
          return {
            data: {
              id: EVENT,
              format_contract: 'mtt-v1',
              club_id: 'club',
              status: 'RUNNING',
              blind_structure: [{ smallBlind: 25, bigBlind: 50, ante: 0, durationMinutes: 10 }],
              current_level: 3,
              level_started_at: new Date(Date.now() - 60_000).toISOString(),
              prize_pool_finalized: true,
              on_break: false,
            },
            error: null,
          };
        },
        in: () => {
          const query = {
            order: () => query,
            limit: () => query,
            then: (resolve: (value: unknown) => unknown) => {
              calls.push(`read:${name}`);
              return Promise.resolve({ data: [], error: null }).then(resolve);
            },
          };
          return query;
        },
      }),
    }),
  }));
  mocks.rpc.mockImplementation(async (name: string, args: Record<string, any>) => {
    calls.push(name);
    if (name === 'fn_f06_find_mixed_manager_custody')
      return { error: null, data: { ok: true, tournament_id: EVENT, receipt: null } };
    if (name === 'fn_f06_assert_drained_manager_custody')
      return {
        error: null,
        data: {
          ok: true,
          tournament_id: EVENT,
          lease_generation: args.p_lease_generation,
          recovery_required: false,
          pending_tables: [],
          proof: { parks: [], originals: [] },
          terminal_proof: [],
        },
      };
    if (name === 'fn_ca_read_tournament_closure_hold') {
      expect(args).toEqual({ p_tournament_id: EVENT });
      return {
        error: null,
        data: target
          ? {
              ok: true,
              tournament_id: EVENT,
              operation_id: target.operation_id,
              state: target.state,
              closure_hold: target.closure_hold,
            }
          : { ok: true, tournament_id: EVENT, state: null, closure_hold: null },
      };
    }
    throw new Error(`unexpected rpc ${name}`);
  });
  return { calls };
}

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.from.mockReset();
  mocks.retained.mockReset().mockResolvedValue(null);
  mocks.claim.mockReset().mockResolvedValue({
    status: 'granted',
    leaseGeneration: SUCCESSOR,
    proofDeadlineMonotonicMs: performance.now() + 60_000,
  });
  mocks.release.mockReset().mockResolvedValue({ status: 'confirmed', attempts: 1 });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const proto = TournamentManager.prototype as any;
  vi.spyOn(proto, 'readTournamentClub').mockResolvedValue(undefined);
  vi.spyOn(proto, 'loadMultiDayPlan').mockImplementation(async function (this: any) {
    this.multiDayPlan = { kind: 'none' };
  });
});
afterEach(() => {
  for (const m of managers.splice(0)) m.fenceForTournamentLeaseLoss?.();
  vi.restoreAllMocks();
});

const hold = (operationId: string) => ({
  operation_id: operationId,
  at: '2026-11-05T09:58:00Z',
  reason: 'original_graph_not_ready retired_generation=c6000000-0000-4000-8000-000000000006',
});

describe('a fresh process adopting a held event', () => {
  it('arms the hold from the durable record and never builds a dealer', async () => {
    const db = database({
      state: 'stop_requested',
      operation_id: OPERATION,
      closure_hold: hold(OPERATION),
    });
    const resume = vi.spyOn(TournamentManager.prototype as any, 'resume');
    const dealer = vi.spyOn(TournamentManager.prototype as any, 'startManagedTableEngine');
    const s = server();
    expect(s.operatorClosureHolds).toBeUndefined();

    await s.performTournamentManagerAdmission(EVENT, 'resume', 'Resuming tournament', 1);
    const m = s.tournamentEngines.get(EVENT);
    managers.push(m);

    expect(m.heldForOperatorClosure()).toBe(OPERATION);
    expect(m.isRunning()).toBe(false);
    expect(s.operatorClosureHolds.get(EVENT)).toBe(OPERATION);
    expect(resume).not.toHaveBeenCalled();
    expect(dealer).not.toHaveBeenCalled();
    // The record was read after the lease was granted and before any resume.
    expect(db.calls).toContain('fn_ca_read_tournament_closure_hold');
    expect(db.calls.indexOf('fn_f06_assert_drained_manager_custody')).toBeLessThan(
      db.calls.indexOf('fn_ca_read_tournament_closure_hold')
    );
    expect(db.calls.filter((n) => n === 'read:tournaments')).toHaveLength(0);
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it('resumes as before when there is no durable record', async () => {
    database(null);
    const resume = vi
      .spyOn(TournamentManager.prototype as any, 'resume')
      .mockImplementation(async () => undefined);
    const s = server();
    await s.performTournamentManagerAdmission(EVENT, 'resume', 'Resuming tournament', 1);
    const m = s.tournamentEngines.get(EVENT);
    managers.push(m);
    expect(resume).toHaveBeenCalledOnce();
    expect(m.heldForOperatorClosure()).toBeNull();
    expect(s.operatorClosureHolds?.has(EVENT) ?? false).toBe(false);
    expect(s.finishTournamentManagerAdmission).toHaveBeenCalledOnce();
  });

  it('ignores a durable record whose operation is not the live target operation', async () => {
    database({
      state: 'stop_requested',
      operation_id: OPERATION,
      closure_hold: hold(OTHER_OPERATION),
    });
    const resume = vi
      .spyOn(TournamentManager.prototype as any, 'resume')
      .mockImplementation(async () => undefined);
    const s = server();
    await s.performTournamentManagerAdmission(EVENT, 'resume', 'Resuming tournament', 1);
    const m = s.tournamentEngines.get(EVENT);
    managers.push(m);
    expect(resume).toHaveBeenCalledOnce();
    expect(m.heldForOperatorClosure()).toBeNull();
    expect(s.operatorClosureHolds?.has(EVENT) ?? false).toBe(false);
  });

  it('ignores a durable record on a settled target', async () => {
    database({ state: 'settled', operation_id: OPERATION, closure_hold: hold(OPERATION) });
    const resume = vi
      .spyOn(TournamentManager.prototype as any, 'resume')
      .mockImplementation(async () => undefined);
    const s = server();
    await s.performTournamentManagerAdmission(EVENT, 'resume', 'Resuming tournament', 1);
    managers.push(s.tournamentEngines.get(EVENT));
    expect(resume).toHaveBeenCalledOnce();
    expect(s.operatorClosureHolds?.has(EVENT) ?? false).toBe(false);
  });

  it('never consults the record for a start or stage resume', async () => {
    const db = database({
      state: 'stop_requested',
      operation_id: OPERATION,
      closure_hold: hold(OPERATION),
    });
    vi.spyOn(TournamentManager.prototype as any, 'start').mockImplementation(async () => undefined);
    const s = server();
    await s.performTournamentManagerAdmission(EVENT, 'start', 'Starting tournament', 1);
    managers.push(s.tournamentEngines.get(EVENT));
    expect(db.calls).not.toContain('fn_ca_read_tournament_closure_hold');
    expect(s.operatorClosureHolds?.has(EVENT) ?? false).toBe(false);
  });
});

describe('the handoff records and clears the durable hold', () => {
  const generation = 'c7000000-0000-4000-8000-000000000007';
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-05T17:20:00Z'));
    mocks.from.mockReturnValue({
      select: () => ({ eq: async () => ({ count: 9, error: null }) }),
    });
  });
  afterEach(() => vi.useRealTimers());

  function fixture(stopState: Record<string, unknown>, answer: () => Promise<unknown>) {
    const manager = {
      tournamentAbortActuationAllowed: () => true,
      getTournamentLeaseGeneration: () => generation,
      hasCurrentTournamentLeaseAuthority: () => true,
      heldForOperatorClosure: () => null,
      isF06RecoveryOwner: () => false,
      acknowledgeTournamentAbortBoundary: vi.fn(answer),
      releaseTournamentAbortBoundary: vi.fn(),
    };
    const s = server();
    s.tournamentEngines = new Map([[EVENT, manager]]);
    s.maintenanceBreak = { isActive: () => false, isResuming: () => false };
    s.stopTournamentManagerIfOwned = vi.fn(async () => {
      s.tournamentEngines.delete(EVENT);
      return true;
    });
    s.awaitTournamentManagerLeaseRelease = vi.fn(async () => undefined);
    const records: Record<string, unknown>[] = [];
    const clears: Record<string, unknown>[] = [];
    mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === 'fn_ca_tournament_abort_stop_state')
        return {
          data: {
            ok: true,
            operation_id: OPERATION,
            tournament_id: EVENT,
            current_generation: generation,
            tables: [],
            ...stopState,
          },
          error: null,
        };
      if (name === 'fn_ca_record_tournament_closure_hold') {
        records.push(args);
        return { data: { ok: true }, error: null };
      }
      if (name === 'fn_ca_clear_tournament_closure_hold') {
        clears.push(args);
        return { data: { ok: true, cleared: true }, error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    });
    return { s, manager, records, clears };
  }

  it('records the hold when a not-ready playing generation is retired', async () => {
    const f = fixture({ state: 'stop_requested' }, async () => ({
      state: 'pending',
      reason: 'original_graph_not_ready',
    }));
    expect(
      await f.s.acknowledgeTournamentAbortBoundary(OPERATION, EVENT, 'equal_share')
    ).toMatchObject({ reason: 'original_manager_retired_for_closure_hold' });
    expect(f.s.operatorClosureHolds.get(EVENT)).toBe(OPERATION);
    expect(f.records).toEqual([
      {
        p_operation_id: OPERATION,
        p_tournament_id: EVENT,
        p_reason: 'original_graph_not_ready',
        p_generation: generation,
      },
    ]);
  });

  it('keeps the in-memory hold when the durable record is refused', async () => {
    const f = fixture({ state: 'quiesced' }, async () => ({
      state: 'pending',
      reason: 'physical_writer_not_drained',
    }));
    const base = mocks.rpc.getMockImplementation()!;
    mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) =>
      name === 'fn_ca_record_tournament_closure_hold'
        ? { data: { ok: false, reason: 'closure_hold_target_not_open' }, error: null }
        : base(name, args)
    );
    expect(
      await f.s.acknowledgeTournamentAbortBoundary(OPERATION, EVENT, 'equal_share')
    ).toMatchObject({ reason: 'original_manager_retired_for_closure_hold' });
    expect(f.s.operatorClosureHolds.get(EVENT)).toBe(OPERATION);
    expect(f.s.stopTournamentManagerIfOwned).toHaveBeenCalledOnce();
  });

  it('clears the record when the closure is withdrawn', async () => {
    const f = fixture({ state: 'recovery' }, async () => ({ state: 'acknowledged' }));
    f.s.operatorClosureHolds = new Map([[EVENT, OPERATION]]);
    await expect(
      f.s.acknowledgeTournamentAbortBoundary(OPERATION, EVENT, 'equal_share')
    ).rejects.toThrow('operator_abort_withdrawn_for_original_recovery');
    expect(f.s.operatorClosureHolds.has(EVENT)).toBe(false);
    expect(f.clears).toEqual([{ p_operation_id: OPERATION, p_tournament_id: EVENT }]);
  });

  it('clears the record when the closure is settled', async () => {
    const f = fixture(
      {
        state: 'settled',
        tournament_status: 'CANCELLED',
        receipt: {
          fully_settled: true,
          operation_id: OPERATION,
          tournament_id: EVENT,
          quiescence: { generation },
        },
      },
      async () => ({ state: 'acknowledged' })
    );
    f.s.operatorClosureHolds = new Map([[EVENT, OPERATION]]);
    expect(
      await f.s.acknowledgeTournamentAbortBoundary(OPERATION, EVENT, 'equal_share')
    ).toMatchObject({ runtime_retired: true });
    expect(f.s.operatorClosureHolds.has(EVENT)).toBe(false);
    expect(f.clears).toEqual([{ p_operation_id: OPERATION, p_tournament_id: EVENT }]);
  });
});
