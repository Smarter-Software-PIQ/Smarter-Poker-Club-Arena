import { describe, expect, it, vi } from 'vitest';
const io = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('../services/supabase/client.js', () => ({ supabase: io, maintenanceSupabase: {} }));
vi.mock('../services/errorReporter.js', () => ({ reportError: vi.fn() }));
import { TournamentManager } from './TournamentManager.js';
import { GameServer } from '../GameServer.js';
import { tournamentLeaseMonotonicNow } from '../services/tournamentLease.js';

/**
 * An operator closure that meets a playing manager it cannot close hands the
 * event to a closure hold, and the hold closes it from database-certified
 * absence (2026-11-05: nine events stuck RUNNING, original_graph_not_ready).
 */
const tournament = '00000000-0000-4000-8000-000000009911';
const operation = '00000000-0000-4000-8000-000000009912';
const generation = '00000000-0000-4000-8000-000000009913';

function heldManager(host: object) {
  return new TournamentManager(
    tournament,
    host as any,
    generation,
    tournamentLeaseMonotonicNow() + 30_000
  ) as any;
}

describe('a closure hold deals nothing and closes from certified absence', () => {
  it('cancels the unfinished hand and acknowledges every table as absent', async () => {
    const host = { canCertifyTournamentTableAbsent: vi.fn(() => true) };
    const manager = heldManager(host);
    manager.holdForOperatorClosure(operation);
    expect(manager.heldForOperatorClosure()).toBe(operation);
    expect(manager.isRunning()).toBe(false);
    expect(manager.deliberateDealingHold(Date.now())).toBe('operator_closure_hold');
    // The hold keeps its heartbeated lease although it never runs.
    expect(
      manager.renewTournamentLeaseProof(generation, tournamentLeaseMonotonicNow() + 30_000)
    ).toBe(true);
    const request = {
      operation_id: operation,
      tournament_id: tournament,
      current_generation: generation,
      closureMode: 'equal_share' as const,
      tables: [
        {
          table_id: 'wedged-table',
          lifecycle: '7',
          required: true,
          durable_hand_number: 52074228,
          cancellable_permit_id: 'dead-generation-permit',
          cancellable_hand_hash: 'reviewed-hash',
        },
        { table_id: 'closed-table', lifecycle: '6', required: false, durable_hand_number: 9 },
      ],
    };
    io.rpc.mockImplementation(async (name: string) => ({
      data:
        name === 'fn_ca_tournament_abort_stop_state'
          ? { ok: true, state: 'stop_requested', ...request }
          : name === 'fn_ca_cancel_tournament_abort_unsettled_hand'
            ? { ok: true, outcome: 'aborted_unsettled' }
            : { ok: true },
      error: null,
    }));
    expect(await manager.acknowledgeTournamentAbortBoundary(request)).toMatchObject({
      state: 'acknowledged',
    });
    const names = io.rpc.mock.calls.map(([name]) => name);
    expect(names.indexOf('fn_ca_cancel_tournament_abort_unsettled_hand')).toBeLessThan(
      names.indexOf('fn_ca_ack_tournament_abort_boundary')
    );
    expect(io.rpc).toHaveBeenCalledWith(
      'fn_ca_cancel_tournament_abort_unsettled_hand',
      expect.objectContaining({
        p_permit_id: 'dead-generation-permit',
        p_evidence: expect.objectContaining({
          kind: 'tournament_abort_absent_boundary_v2',
          closure_mode: 'equal_share',
          hand_number: 52074228,
        }),
      })
    );
    expect(io.rpc).toHaveBeenCalledWith(
      'fn_ca_ack_tournament_abort_boundary',
      expect.objectContaining({ p_table_id: 'wedged-table', p_lease_generation: generation })
    );
    expect(io.rpc).not.toHaveBeenCalledWith(
      'fn_ca_ack_tournament_abort_boundary',
      expect.objectContaining({ p_table_id: 'closed-table' })
    );
    await manager.stop();
    io.rpc.mockReset();
  });

  it('is refused to a generation that is already playing', () => {
    const manager = heldManager({});
    manager.running = true;
    expect(() => manager.holdForOperatorClosure(operation)).toThrow(
      'operator_closure_hold_refused'
    );
    expect(manager.heldForOperatorClosure()).toBeNull();
  });

  it('names what is not ready instead of a bare refusal', async () => {
    const manager = heldManager({ canCertifyTournamentTableAbsent: () => false });
    manager.holdForOperatorClosure(operation);
    const request = {
      operation_id: operation,
      tournament_id: tournament,
      current_generation: generation,
      closureMode: 'equal_share' as const,
      tables: [{ table_id: 't', lifecycle: '1', required: true, durable_hand_number: 3 }],
    };
    io.rpc.mockResolvedValue({
      data: { ok: true, state: 'stop_requested', ...request },
      error: null,
    });
    expect(await manager.acknowledgeTournamentAbortBoundary(request)).toMatchObject({
      reason: 'original_graph_not_ready',
      blocked_by: ['absence_uncertified'],
    });
    await manager.stop();
    io.rpc.mockReset();
  });
});

describe('GameServer hands an unclosable playing manager to a closure hold', () => {
  function fixture(answer: () => Promise<unknown>, state = 'stop_requested') {
    const manager = {
      tournamentAbortActuationAllowed: () => true,
      getTournamentLeaseGeneration: () => generation,
      hasCurrentTournamentLeaseAuthority: () => true,
      heldForOperatorClosure: () => null,
      acknowledgeTournamentAbortBoundary: vi.fn(answer),
    };
    const server = Object.create(GameServer.prototype) as any;
    server.tournamentEngines = new Map([[tournament, manager]]);
    server.stopTournamentManagerIfOwned = vi.fn(async () => {
      server.tournamentEngines.delete(tournament);
      return true;
    });
    io.rpc.mockResolvedValue({
      data: {
        ok: true,
        state,
        operation_id: operation,
        tournament_id: tournament,
        current_generation: generation,
        tables: [],
      },
      error: null,
    });
    return { server, manager };
  }

  it('retires a not-ready playing generation and arms the hold for its successor', async () => {
    const f = fixture(async () => ({ state: 'pending', reason: 'original_graph_not_ready' }));
    expect(
      await f.server.acknowledgeTournamentAbortBoundary(operation, tournament, 'equal_share')
    ).toMatchObject({ state: 'pending', reason: 'original_manager_retired_for_closure_hold' });
    expect(f.server.stopTournamentManagerIfOwned).toHaveBeenCalledWith(
      tournament,
      f.manager,
      expect.any(String)
    );
    expect(f.server.operatorClosureHolds.get(tournament)).toBe(operation);
  });

  it('retires a playing generation whose retired dealer never certifies its stopped hand', async () => {
    const f = fixture(async () => ({ state: 'pending', reason: 'physical_writer_not_drained' }));
    expect(
      await f.server.acknowledgeTournamentAbortBoundary(operation, tournament, 'equal_share')
    ).toMatchObject({ reason: 'original_manager_retired_for_closure_hold' });
    const transient = fixture(async () => ({
      state: 'pending',
      reason: 'manager_tail_not_drained',
    }));
    expect(
      await transient.server.acknowledgeTournamentAbortBoundary(
        operation,
        tournament,
        'equal_share'
      )
    ).toMatchObject({ reason: 'manager_tail_not_drained' });
    expect(transient.server.stopTournamentManagerIfOwned).not.toHaveBeenCalled();
  });

  it('retires a playing generation whose closure threw (the 503) instead of retrying it forever', async () => {
    const f = fixture(async () => {
      throw new Error('tournament_abort_stopped_hand_changed');
    }, 'quiesced');
    expect(
      await f.server.acknowledgeTournamentAbortBoundary(operation, tournament, 'equal_share')
    ).toMatchObject({ reason: 'original_manager_retired_for_closure_hold' });
    expect(f.server.operatorClosureHolds.get(tournament)).toBe(operation);
  });

  it('leaves a ready closure, a withdrawn closure and a non equal-share request alone', async () => {
    const ready = fixture(async () => ({ state: 'acknowledged' }));
    expect(
      await ready.server.acknowledgeTournamentAbortBoundary(operation, tournament, 'equal_share')
    ).toMatchObject({ state: 'acknowledged' });
    expect(ready.server.stopTournamentManagerIfOwned).not.toHaveBeenCalled();

    const withdrawn = fixture(async () => {
      throw new Error('operator_abort_withdrawn_for_original_recovery');
    });
    await expect(
      withdrawn.server.acknowledgeTournamentAbortBoundary(operation, tournament, 'equal_share')
    ).rejects.toThrow('withdrawn');
    expect(withdrawn.server.stopTournamentManagerIfOwned).not.toHaveBeenCalled();

    const plain = fixture(async () => ({ state: 'pending', reason: 'original_graph_not_ready' }));
    await plain.server.acknowledgeTournamentAbortBoundary(operation, tournament);
    expect(plain.server.stopTournamentManagerIfOwned).not.toHaveBeenCalled();
    expect(plain.server.operatorClosureHolds).toBeUndefined();
  });
});
