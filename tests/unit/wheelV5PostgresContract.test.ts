import { beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from '../fixtures/diamond-spins/wheel-v5-postgres-receipts.json';
import { wheelV5MainWeights } from '../../src/utils/wheelV5Model';
import { verifyWheelReceiptFairness } from '../../src/utils/wheelFairness';
import { assertWheelAward } from '../../src/utils/wheelAward';
import {
  assertWheelReceipt,
  saveWheelPending,
  readWheelPending,
} from '../../src/utils/wheelPendingSpin';
const rpc = vi.hoisted(() => vi.fn());
vi.mock('../../src/lib/supabase', () => ({ supabase: { rpc } }));
import service, {
  type WheelSpinResult,
  type WheelPreviousOutcome,
} from '../../src/services/DiamondWheelService';
beforeEach(() => {
  rpc.mockReset();
  localStorage.clear();
});
const spins = Object.entries(fixture.receipts).filter(([key]) => key !== 'quote');
describe('actual PostgreSQL quarter-game receipts and negotiated endpoint', () => {
  it('matches all17 server predecessor rows byte for byte', () => {
    expect(fixture.weights).toHaveLength(17);
    for (const row of fixture.weights) {
      const previous: WheelPreviousOutcome | null =
        row.previous === 0
          ? null
          : {
              spin_id: 'fixture',
              ord: row.previous,
              tier: row.super_game ? 'super' : 'main',
              game: row.super_game as WheelPreviousOutcome['game'],
            };
      expect(wheelV5MainWeights(previous)).toEqual(row.weights);
    }
  });
  it('accepts the version5 quote only after the server advertises it', async () => {
    rpc.mockResolvedValueOnce({ data: fixture.receipts.quote, error: null });
    expect(
      (await service.getStateV2('d1000000-0000-4000-8000-000000000003', 100)).contract_version
    ).toBe(5);
  });
  it.each(spins)(
    'verifies actual $0, preserving its pending identity through reload',
    async (_key, raw) => {
      const receipt = raw as unknown as WheelSpinResult;
      const attempt = {
        userId: 'test',
        clubId: receipt.club_id,
        mode: 'paid' as const,
        commitId: receipt.fairness.commit_id,
        commitHash: receipt.fairness.server_seed_hash,
        clientSeed: receipt.fairness.client_seed,
        ticketId: null,
        contractVersion: 5 as const,
        entryDiamonds: 100,
      };
      saveWheelPending(attempt);
      expect(readWheelPending('test', receipt.club_id)).toEqual(attempt);
      rpc.mockResolvedValueOnce({ data: raw, error: null });
      const parsed = await service.spinV2(attempt);
      expect(rpc.mock.calls[0][0]).toBe('fn_wheel_spin_v5');
      assertWheelAward(parsed);
      assertWheelReceipt(parsed, attempt);
      expect((await verifyWheelReceiptFairness(parsed)).fair).toBe(true);
      const tampered = structuredClone(parsed);
      tampered.fairness.weights![0]++;
      expect((await verifyWheelReceiptFairness(tampered)).fair).toBe(false);
    }
  );
  it('does not downgrade an advertised5 request to another money endpoint on failure', async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST202', message: 'function unavailable' },
    });
    const attempt = {
      clubId: 'd1000000-0000-4000-8000-000000000003',
      commitId: '11111111-1111-4111-8111-111111111111',
      clientSeed: 'same',
      entryDiamonds: 100,
      mode: 'paid' as const,
      ticketId: null,
      contractVersion: 5 as const,
    };
    try {
      await service.spinV2(attempt);
    } catch {
      /* Unknown requests retain caller identity. */
    }
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][0]).toBe('fn_wheel_spin_v5');
  });
});
