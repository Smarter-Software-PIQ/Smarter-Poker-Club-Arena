import { beforeEach, describe, expect, it, vi } from 'vitest';
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../../src/lib/supabase', () => ({ supabase: { rpc } }));
import { ClubRakeSnapshotService } from '../../src/services/ClubRakeSnapshotService';

const question = {
  scope: 'club' as const,
  clubId: 'club-1',
  start: '2026-11-09',
  end: '2026-11-15',
};
beforeEach(() => rpc.mockReset());

describe('Data rake snapshots have an explicit Pacific contract', () => {
  it('uses the Pacific reader and checks its answered basis', async () => {
    rpc.mockResolvedValue({
      data: { day_basis: 'America/Los_Angeles 00:00', breakdown: [], series: [] },
      error: null,
    });
    await ClubRakeSnapshotService.get({ ...question, reportBasis: 'pacific' });
    expect(rpc).toHaveBeenCalledWith(
      'ca_rake_snapshot_pacific_v2',
      expect.objectContaining({ p_start: '2026-11-09', p_end: '2026-11-15' })
    );
  });
  it('refuses old-basis data rather than placing it under a Pacific label', async () => {
    rpc.mockResolvedValue({ data: { day_basis: 'America/Chicago', breakdown: [] }, error: null });
    await expect(
      ClubRakeSnapshotService.get({ ...question, reportBasis: 'pacific' })
    ).rejects.toThrow('Different Day Basis');
  });
  it('retains the invoice question and provisional coverage under the Pacific calendar', async () => {
    rpc.mockResolvedValue({
      data: {
        day_basis: 'America/Los_Angeles 00:00',
        accounting_basis: 'union_invoice_accounting',
        accounting_coverage: { complete: true, provisional: true },
        breakdown: [],
        series: [],
      },
      error: null,
    });
    const answer = await ClubRakeSnapshotService.get({ ...question, reportBasis: 'pacific' });
    expect(answer.accounting_basis).toBe('union_invoice_accounting');
    expect(answer.accounting_coverage).toEqual({ complete: true, provisional: true });
  });
  it('preserves the existing financial caller without a Pacific opt-in', async () => {
    rpc.mockResolvedValue({
      data: { accounting_basis: 'chicago_net_money_flow', breakdown: [] },
      error: null,
    });
    await ClubRakeSnapshotService.get(question);
    expect(rpc).toHaveBeenCalledWith('ca_rake_snapshot_v2', expect.any(Object));
  });
});
