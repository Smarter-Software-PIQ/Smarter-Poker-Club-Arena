import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), verify: vi.fn() }));
vi.mock('../services/supabase.js', () => ({
  supabase: { rpc: mocks.rpc },
  maintenanceSupabase: { rpc: mocks.rpc },
}));
vi.mock('./completionSettlementReceipt.js', () => ({
  verifyTournamentCompletionReceipt: mocks.verify,
  parseLegacyFeeCustodyOrigin: vi.fn(),
}));
vi.mock('./satelliteSettlementReceipt.js', () => ({
  verifySatelliteSettlementReceipt: mocks.verify,
}));
import {
  requestTournamentTerminalReceipt,
  resolveOriginalTerminalOutcome,
  TerminalSettlementOutcomeUnknownError,
  TerminalSettlementRefusedError,
  closeTerminalFinishLanes,
  openTerminalFinishLanes,
} from './terminalSettlementRpc.js';
import {
  requestSatelliteSettlementReceipt,
  resolveOriginalSatelliteOutcome,
} from './satelliteSettlementRpc.js';

import { runWithTournamentDataAuthority } from '../services/supabase/dataActorContext.js';
const tournamentId = '00000000-0000-4000-8000-000000000001';
const winner = '00000000-0000-4000-8000-000000000002';
const proposal = '00000000-0000-4000-8000-000000000003';
beforeEach(() => {
  vi.clearAllMocks();
  openTerminalFinishLanes();
  mocks.rpc.mockResolvedValue({ error: { message: 'lost' } });
});

describe('the original terminal request survives an unknown outcome', () => {
  it('retains an immutable copied proposal after the original writer and resolver lose their replies', async () => {
    const dealProposal = { proposalId: proposal, revision: 'a'.repeat(64) };
    const pending = requestTournamentTerminalReceipt(tournamentId, 'final_table_deal', null, {
      attempts: 1,
      dealProposal,
    });
    dealProposal.revision = 'b'.repeat(64);
    const error = await pending.catch((value) => value);
    expect(error).toBeInstanceOf(TerminalSettlementOutcomeUnknownError);
    expect(error.originalRequest).toEqual({
      kind: 'proposal_deal',
      tournamentId,
      observedWinnerId: null,
      proposalId: proposal,
      revision: 'a'.repeat(64),
    });
    expect(Object.isFrozen(error.originalRequest)).toBe(true);
    mocks.rpc.mockClear();
    await expect(resolveOriginalTerminalOutcome(error.originalRequest)).resolves.toMatchObject({
      state: 'unknown',
    });
    expect(mocks.rpc.mock.calls).toEqual([
      [
        'fn_resolve_tournament_terminal_proposal_outcome',
        {
          p_tournament_id: tournamentId,
          p_observed_winner_id: null,
          p_settlement_mode: 'final_table_deal',
          p_proposal_id: proposal,
          p_revision: 'a'.repeat(64),
        },
      ],
    ]);
  });

  it('retains the satellite winner and uses only the satellite resolver', async () => {
    const error = await requestSatelliteSettlementReceipt(tournamentId, winner, {
      attempts: 1,
    }).catch((e) => e);
    expect(error.originalRequest).toEqual({
      kind: 'satellite',
      tournamentId,
      observedWinnerId: winner,
    });
    expect(Object.isFrozen(error.originalRequest)).toBe(true);
    mocks.rpc.mockClear();
    await resolveOriginalSatelliteOutcome(error.originalRequest);
    expect(mocks.rpc.mock.calls).toEqual([
      [
        'fn_resolve_satellite_settlement_outcome',
        {
          p_tournament_id: tournamentId,
          p_observed_winner_id: winner,
        },
      ],
    ]);
  });

  it('does not fabricate request authority for an identity-less read error', () => {
    expect(new TerminalSettlementOutcomeUnknownError('read failed').originalRequest).toBeNull();
  });

  it('requires a serialized exact miss and never turns malformed evidence into permission to pay', async () => {
    const request = { kind: 'places' as const, tournamentId, observedWinnerId: winner };
    const miss = {
      ok: true,
      tournament_id: tournamentId,
      mode: 'places',
      terminal_committed: false,
      definitively_not_committed: true,
      status: 'RUNNING',
      receipt: null,
    };
    mocks.rpc.mockResolvedValue({ data: miss, error: null });
    await expect(resolveOriginalTerminalOutcome(request)).resolves.toEqual({
      state: 'not_committed',
    });
    mocks.rpc.mockResolvedValue({ data: { ...miss, tournament_id: proposal }, error: null });
    await expect(resolveOriginalTerminalOutcome(request)).resolves.toMatchObject({
      state: 'unknown',
    });
    expect(
      mocks.rpc.mock.calls.every(([name]) => name === 'fn_resolve_tournament_terminal_outcome')
    ).toBe(true);
  });
});

describe('durable requests remain fenced until acknowledged closure', () => {
  const generation = '00000000-0000-4000-8000-000000000004';
  const authority = { tournamentId, leaseGeneration: generation };
  function preparedMock(close: boolean) {
    let request: any;
    mocks.rpc.mockImplementation(async (name, args) => {
      if (name === 'fn_prepare_tournament_terminal_request') {
        request = {
          request_id: args.p_request_id,
          tournament_id: tournamentId,
          original_request: args.p_request,
          original_generation: generation,
          current_generation: generation,
          phase: 'prepared',
        };
        return { data: { ok: true, request }, error: null };
      }
      if (name === 'fn_get_tournament_deal_consensus')
        return { data: { ok: true, ready: true }, error: null };
      if (name === 'fn_close_uncommitted_tournament_terminal_request')
        return close
          ? {
              data: {
                ok: true,
                request: { ...request, phase: 'closed' },
                outcome: {
                  ok: true,
                  tournament_id: tournamentId,
                  definitively_not_committed: true,
                  receipt: null,
                  status: 'RUNNING',
                },
              },
              error: null,
            }
          : { error: { message: 'lost' } };
      throw new Error('Unexpected RPC ' + name);
    });
  }
  it.each([true, false])(
    'legacy refusal releases gameplay only after closure acknowledgement=%s',
    async (closed) => {
      preparedMock(closed);
      const error = await runWithTournamentDataAuthority(authority, () =>
        requestTournamentTerminalReceipt(tournamentId, 'final_table_deal', null, {
          legacyDealAuthority: 'proposal_authority_not_active',
        })
      ).catch((e) => e);
      expect(error).toBeInstanceOf(
        closed ? TerminalSettlementRefusedError : TerminalSettlementOutcomeUnknownError
      );
      expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual([
        'fn_prepare_tournament_terminal_request',
        'fn_get_tournament_deal_consensus',
        'fn_close_uncommitted_tournament_terminal_request',
      ]);
      if (!closed) expect(error.originalRequest.kind).toBe('legacy_deal');
    }
  );
  it('shutdown keeps the acknowledged original fenced without sending a payer or queuing a close', async () => {
    preparedMock(true);
    closeTerminalFinishLanes();
    try {
      const error = await runWithTournamentDataAuthority(authority, () =>
        requestTournamentTerminalReceipt(tournamentId, 'places', winner)
      ).catch((e) => e);
      expect(error).toBeInstanceOf(TerminalSettlementOutcomeUnknownError);
      expect(error.originalRequest).toEqual({
        kind: 'places',
        tournamentId,
        observedWinnerId: winner,
      });
      expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual([
        'fn_prepare_tournament_terminal_request',
      ]);
    } finally {
      openTerminalFinishLanes();
    }
  });
});
