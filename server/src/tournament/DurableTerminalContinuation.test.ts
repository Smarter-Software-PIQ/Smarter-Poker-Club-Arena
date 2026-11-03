import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TournamentManagerEliminations } from './TournamentManagerEliminations.js';
import * as durable from './terminalDurableRequest.js';
import * as terminal from './terminalSettlementRpc.js';
import * as satellite from './satelliteSettlementRpc.js';
import * as qualifiers from './satelliteQualifierRpc.js';
vi.mock('../services/errorReporter.js', () => ({ reportError: vi.fn() }));
const event = '00000000-0000-4000-8000-000000000001';
const winner = '00000000-0000-4000-8000-000000000002';
const generation = '00000000-0000-4000-8000-000000000003';
const originalGeneration = '00000000-0000-4000-8000-000000000004';
const proposalId = '00000000-0000-4000-8000-000000000005';
const receipt = { settlementMode: 'places' };
beforeEach(() => vi.restoreAllMocks());
const method = (TournamentManagerEliminations.prototype as any).continueOriginalTerminalRequest;
function manager() {
  return {
    tournamentId: event,
    tournamentFinished: false,
    cleanupCommittedTournament: vi.fn().mockResolvedValue(true),
    cleanupCommittedSatellite: vi.fn().mockResolvedValue(true),
    cleanupCommittedSatelliteQualifiers: vi.fn().mockResolvedValue(true),
    settleFinalTableDeal: vi.fn().mockResolvedValue(true),
    fenceUnknownTerminalOutcome: vi.fn(),
  };
}
describe('original terminal startup continuation', () => {
  it.each(['places', 'proposal_deal', 'legacy_deal', 'satellite', 'satellite_qualifiers'] as const)(
    'adopts and resolves %s before any writer or dealer',
    async (kind) => {
      const identity: any = {
        kind,
        tournamentId: event,
        observedWinnerId: kind === 'places' || kind === 'satellite' ? winner : null,
      };
      if (kind === 'proposal_deal')
        Object.assign(identity, { proposalId, revision: 'a'.repeat(64) });
      if (kind === 'satellite_qualifiers') identity.qualifierIds = [winner];
      const original: any = {
        requestId: proposalId,
        originalGeneration,
        currentGeneration: originalGeneration,
        phase: 'prepared',
        identity,
      };
      const adopted = { ...original, currentGeneration: generation };
      vi.spyOn(durable, 'readDurableTerminalRequest').mockResolvedValue(original);
      const adopt = vi.spyOn(durable, 'adoptDurableTerminalRequest').mockResolvedValue(adopted);
      const ordinaryRead = vi
        .spyOn(terminal, 'resolveOriginalTerminalOutcome')
        .mockResolvedValue({ state: 'committed', receipt } as any);
      const satelliteRead = vi
        .spyOn(satellite, 'resolveOriginalSatelliteOutcome')
        .mockResolvedValue({ state: 'committed', receipt } as any);
      const qualifierRead = vi
        .spyOn(qualifiers, 'resolveOriginalSatelliteQualifierOutcome')
        .mockResolvedValue({ kind: 'committed', receipt } as any);
      const writes = [
        vi.spyOn(terminal, 'requestTournamentTerminalReceipt'),
        vi.spyOn(satellite, 'requestSatelliteSettlementReceipt'),
        vi.spyOn(qualifiers, 'requestSatelliteQualifierReceipt'),
      ];
      const m = manager();
      expect(await method.call(m)).toBe(true);
      expect(adopt).toHaveBeenCalledWith(original);
      const read =
        kind === 'satellite'
          ? satelliteRead
          : kind === 'satellite_qualifiers'
            ? qualifierRead
            : ordinaryRead;
      expect(read).toHaveBeenCalledWith(identity, adopted);
      expect(adopt.mock.invocationCallOrder[0]).toBeLessThan(read.mock.invocationCallOrder[0]);
      for (const write of writes) expect(write).not.toHaveBeenCalled();
      expect(m.tournamentFinished).toBe(true);
      expect(m.fenceUnknownTerminalOutcome).not.toHaveBeenCalled();
    }
  );
  it('does not replay or clear ownership when serialized resolution is unknown', async () => {
    const identity: any = { kind: 'places', tournamentId: event, observedWinnerId: winner };
    const row: any = {
      identity,
      currentGeneration: generation,
      originalGeneration,
      requestId: proposalId,
      phase: 'prepared',
    };
    vi.spyOn(durable, 'readDurableTerminalRequest').mockResolvedValue(row);
    vi.spyOn(durable, 'adoptDurableTerminalRequest').mockResolvedValue(row);
    vi.spyOn(terminal, 'resolveOriginalTerminalOutcome').mockResolvedValue({
      state: 'unknown',
      reason: 'transport lost',
    });
    const write = vi.spyOn(terminal, 'requestTournamentTerminalReceipt');
    const m = manager();
    expect(await method.call(m)).toBe(true);
    expect(write).not.toHaveBeenCalled();
    expect(m.cleanupCommittedTournament).not.toHaveBeenCalled();
    expect(m.fenceUnknownTerminalOutcome).toHaveBeenCalled();
  });
  it('replays only the immutable original after a serialized miss', async () => {
    const identity: any = {
      kind: 'proposal_deal',
      tournamentId: event,
      observedWinnerId: null,
      proposalId,
      revision: 'a'.repeat(64),
    };
    const row: any = {
      identity,
      currentGeneration: generation,
      originalGeneration,
      requestId: proposalId,
      phase: 'prepared',
    };
    vi.spyOn(durable, 'readDurableTerminalRequest').mockResolvedValue(row);
    vi.spyOn(durable, 'adoptDurableTerminalRequest').mockResolvedValue(row);
    const read = vi
      .spyOn(terminal, 'resolveOriginalTerminalOutcome')
      .mockResolvedValue({ state: 'not_committed' });
    const write = vi
      .spyOn(terminal, 'requestTournamentTerminalReceipt')
      .mockResolvedValue({ ...receipt, settlementMode: 'final_table_deal' } as any);
    const m = manager();
    expect(await method.call(m)).toBe(true);
    expect(write).toHaveBeenCalledWith(event, 'final_table_deal', null, {
      dealProposal: { proposalId, revision: 'a'.repeat(64) },
    });
    expect(read.mock.invocationCallOrder[0]).toBeLessThan(write.mock.invocationCallOrder[0]);
    expect(m.settleFinalTableDeal).toHaveBeenCalled();
  });
  it('unreadable original state refuses startup rather than inventing an empty event', async () => {
    vi.spyOn(durable, 'readDurableTerminalRequest').mockRejectedValue(new Error('unreadable'));
    await expect(method.call(manager())).rejects.toThrow('unreadable');
  });
});
