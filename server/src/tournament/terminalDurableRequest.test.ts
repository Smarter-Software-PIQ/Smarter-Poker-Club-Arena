import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../services/supabase.js', () => ({ maintenanceSupabase: { rpc: mocks.rpc } }));
import { runWithTournamentDataAuthority } from '../services/supabase/dataActorContext.js';
import {
  prepareDurableTerminalRequest,
  executeDurableTerminalRequest,
  closeDurableTerminalRequest,
  readDurableTerminalRequest,
  TerminalIntentUnknownError,
  SatelliteTerminalPrepareBusyError,
} from './terminalDurableRequest.js';
const tournamentId = '00000000-0000-4000-8000-000000000001';
const generation = '00000000-0000-4000-8000-000000000002';
const winner = '00000000-0000-4000-8000-000000000003';
const identity = { kind: 'places' as const, tournamentId, observedWinnerId: winner };
const authority = { tournamentId, leaseGeneration: generation };
function row(id: string) {
  return {
    request_id: id,
    tournament_id: tournamentId,
    original_request: identity,
    original_generation: generation,
    current_generation: generation,
    phase: 'prepared',
  };
}
beforeEach(() => vi.resetAllMocks());
describe('durable pre-send acknowledgement', () => {
  it('reuses the same prepare identity after a lost reply and sends no settlement', async () => {
    mocks.rpc
      .mockRejectedValueOnce(new Error('lost'))
      .mockImplementationOnce(async (_name, args) => ({
        data: { ok: true, request: row(args.p_request_id) },
        error: null,
      }));
    const intent = await runWithTournamentDataAuthority(authority, () =>
      prepareDurableTerminalRequest(identity)
    );
    expect(intent?.identity).toEqual(identity);
    expect(mocks.rpc.mock.calls).toHaveLength(2);
    expect(mocks.rpc.mock.calls[0]).toEqual(mocks.rpc.mock.calls[1]);
    expect(
      mocks.rpc.mock.calls.every(([name]) => name === 'fn_prepare_tournament_terminal_request')
    ).toBe(true);
  });
  it('defers a satellite whose prepare attempts both rolled back before any payment', async () => {
    const satellite = { ...identity, kind: 'satellite' as const };
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '55P03' } });
    await expect(
      runWithTournamentDataAuthority(authority, () => prepareDurableTerminalRequest(satellite))
    ).rejects.toBeInstanceOf(SatelliteTerminalPrepareBusyError);
    expect(mocks.rpc.mock.calls).toHaveLength(2);
    expect(mocks.rpc.mock.calls[0]).toEqual(mocks.rpc.mock.calls[1]);
    expect(mocks.rpc.mock.calls[0][0]).toBe('fn_prepare_tournament_terminal_request');
  });

  it.each(['places', 'legacy_deal', 'proposal_deal'] as const)(
    '%s with two proven lock rollbacks is unsent contention, not unknown',
    async (kind) => {
      const request: any = { ...identity, kind };
      if (kind !== 'places') request.observedWinnerId = null;
      if (kind === 'proposal_deal')
        Object.assign(request, { proposalId: winner, revision: 'a'.repeat(64) });
      mocks.rpc.mockResolvedValue({ data: null, error: { code: '55P03' } });
      await expect(
        runWithTournamentDataAuthority(authority, () => prepareDurableTerminalRequest(request))
      ).rejects.toBeInstanceOf(SatelliteTerminalPrepareBusyError);
      expect(mocks.rpc.mock.calls).toHaveLength(2);
      expect(mocks.rpc.mock.calls[0]).toEqual(mocks.rpc.mock.calls[1]);
      expect(
        mocks.rpc.mock.calls.every(([name]) => name === 'fn_prepare_tournament_terminal_request')
      ).toBe(true);
    }
  );

  it('preserves an unknown prepare if a later satellite attempt meets contention', async () => {
    const satellite = { ...identity, kind: 'satellite' as const };
    mocks.rpc
      .mockRejectedValueOnce(new Error('lost response'))
      .mockResolvedValueOnce({ data: null, error: { code: '55P03' } });
    await expect(
      runWithTournamentDataAuthority(authority, () => prepareDurableTerminalRequest(satellite))
    ).rejects.toBeInstanceOf(TerminalIntentUnknownError);
  });

  it.each(['places', 'satellite'] as const)(
    '%s preserves mixed contention and lost acknowledgement as unknown',
    async (kind) => {
      mocks.rpc
        .mockResolvedValueOnce({ data: null, error: { code: '55P03' } })
        .mockRejectedValueOnce(new Error('lost reply'));
      await expect(
        runWithTournamentDataAuthority(authority, () =>
          prepareDurableTerminalRequest({ ...identity, kind })
        )
      ).rejects.toBeInstanceOf(TerminalIntentUnknownError);
    }
  );

  it('unknown prepare stays unsent and retains its exact identity', async () => {
    mocks.rpc.mockRejectedValue(new Error('lost'));
    const error = await runWithTournamentDataAuthority(authority, () =>
      prepareDurableTerminalRequest(identity)
    ).catch((e) => e);
    expect(error).toBeInstanceOf(TerminalIntentUnknownError);
    expect(error.originalRequest).toEqual(identity);
    expect(mocks.rpc.mock.calls).toHaveLength(2);
    expect(
      mocks.rpc.mock.calls.every(([name]) => name === 'fn_prepare_tournament_terminal_request')
    ).toBe(true);
  });
  it('does not treat a different winner acknowledgement as authority to execute', async () => {
    mocks.rpc.mockImplementation(async (_name, args) => ({
      data: {
        ok: true,
        request: {
          ...row(args.p_request_id),
          original_request: { ...identity, observedWinnerId: generation },
        },
      },
      error: null,
    }));
    await expect(
      runWithTournamentDataAuthority(authority, () => prepareDurableTerminalRequest(identity))
    ).rejects.toBeInstanceOf(TerminalIntentUnknownError);
  });
  it('requires exact committed execution and close acknowledgements', async () => {
    const id = '00000000-0000-4000-8000-000000000004';
    const intent: any = {
      requestId: id,
      identity,
      originalGeneration: generation,
      currentGeneration: generation,
      phase: 'prepared',
    };
    mocks.rpc.mockResolvedValue({
      data: {
        ok: true,
        request: { ...row(id), phase: 'committed', current_generation: winner },
        receipt: { fully_settled: true },
      },
      error: null,
    });
    expect((await executeDurableTerminalRequest(intent)).error).toBeTruthy();
    mocks.rpc.mockResolvedValue({
      data: {
        ok: true,
        request: { ...row(id), phase: 'closed' },
        outcome: {
          ok: true,
          tournament_id: tournamentId,
          definitively_not_committed: true,
          status: 'RUNNING',
          receipt: null,
        },
      },
      error: null,
    });
    expect(await closeDurableTerminalRequest(intent)).toBe(true);
    mocks.rpc.mockResolvedValue({
      data: {
        ok: true,
        request: { ...row(id), phase: 'prepared' },
        outcome: {
          ok: true,
          tournament_id: tournamentId,
          definitively_not_committed: true,
          status: 'RUNNING',
          receipt: null,
        },
      },
      error: null,
    });
    expect(await closeDurableTerminalRequest(intent)).toBe(false);
  });
  it.each(['places', 'satellite', 'satellite_qualifiers'] as const)(
    'retains original custody through the compatible %s executor',
    async (kind) => {
      const id = '00000000-0000-4000-8000-000000000004';
      const original =
        kind === 'satellite_qualifiers'
          ? { kind, tournamentId, observedWinnerId: null, qualifierIds: [winner] }
          : { ...identity, kind };
      const intent: any = {
        requestId: id,
        identity: original,
        originalGeneration: generation,
        currentGeneration: generation,
        phase: 'prepared',
      };
      const receipt = { fully_settled: true };
      mocks.rpc.mockResolvedValue({
        data: {
          ok: true,
          request: { ...row(id), original_request: original, phase: 'committed' },
          receipt,
        },
        error: null,
      });
      expect(await executeDurableTerminalRequest(intent)).toEqual({ data: receipt, error: null });
      expect(mocks.rpc).toHaveBeenCalledWith(
        kind === 'satellite_qualifiers'
          ? 'fn_execute_capped_satellite_terminal_request'
          : 'fn_execute_tournament_terminal_request',
        { p_request_id: id, p_generation: generation }
      );
    }
  );
  it('a malformed absence is unknown rather than permission to start', async () => {
    mocks.rpc.mockResolvedValue({
      data: { ok: true, found: false, tournament_id: winner },
      error: null,
    });
    await expect(readDurableTerminalRequest(tournamentId)).rejects.toThrow('unproven');
  });
});
