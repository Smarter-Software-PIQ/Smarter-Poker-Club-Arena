import { beforeEach, describe, expect, it, vi } from 'vitest';
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => {
      const response = rpc(...args);
      return Object.assign(Promise.resolve(response), { abortSignal: () => response });
    },
  },
}));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
import {
  MysteryBountyService,
  playerTotalsFromAwards,
} from '../../src/services/MysteryBountyService';
const award = (i: number) => ({
  award_id: `award-${i}`,
  amount_cents: i === 1001 ? 900000 : 100,
  recipients: [{ user_id: 'winner', username: 'Winner', amount_cents: i === 1001 ? 900000 : 100 }],
});
beforeEach(() => {
  rpc.mockReset();
});
describe('all mystery awards means a complete stable read', () => {
  it('retains the oldest large prize beyond 1000 awards', async () => {
    const rows = Array.from({ length: 1002 }, (_, i) => award(i));
    rpc.mockImplementation(async (_name: string, p: any) => ({
      data: { total: rows.length, rows: rows.slice(p.p_offset, p.p_offset + p.p_limit) },
      error: null,
    }));
    const result = await MysteryBountyService.getAllAwards('event', { strict: true });
    expect(result.rows).toHaveLength(1002);
    expect(playerTotalsFromAwards(result.rows).get('winner')?.largestCents).toBe(900000);
  });
  it.each(['empty', 'short', 'duplicate', 'changed-total', 'error'])(
    'refuses a partial %s later page',
    async (mode) => {
      const rows = Array.from({ length: 202 }, (_, i) => award(i));
      rpc.mockImplementation(async (_name: string, p: any) => {
        if (p.p_offset === 0)
          return { data: { total: 202, rows: rows.slice(0, 200) }, error: null };
        if (mode === 'error') return { data: null, error: new Error('unreadable') };
        return {
          data: {
            total: mode === 'changed-total' ? 203 : 202,
            rows:
              mode === 'empty'
                ? []
                : mode === 'short'
                  ? [rows[200]]
                  : mode === 'duplicate'
                    ? [rows[0], rows[201]]
                    : [rows[200], rows[201]],
          },
          error: null,
        };
      });
      const failed = await MysteryBountyService.getAllAwards('event', { strict: true }).then(
        () => false,
        () => true
      );
      expect(failed).toBe(true);
    }
  );
  it.each([
    null,
    {},
    { total: false, rows: [] },
    { total: 0.5, rows: [] },
    { total: 0, rows: null },
  ])('refuses an unproven initial inventory %j', async (data) => {
    rpc.mockResolvedValue({ data, error: null });
    const failed = await MysteryBountyService.getAllAwards('event', { strict: true }).then(
      () => false,
      () => true
    );
    expect(failed).toBe(true);
  });
  it('accepts proven empty inventory', async () => {
    rpc.mockResolvedValue({ data: { total: 0, rows: [] }, error: null });
    await expect(MysteryBountyService.getAllAwards('event', { strict: true })).resolves.toEqual({
      total: 0,
      rows: [],
    });
  });
  it.each([1, 200, 400])('reads exactly %i awards without an extra page', async (count) => {
    const rows = Array.from({ length: count }, (_, i) => award(i));
    rpc.mockImplementation(async (_name, p) => ({
      data: { total: count, rows: rows.slice(p.p_offset, p.p_offset + p.p_limit) },
      error: null,
    }));
    const result = await MysteryBountyService.getAllAwards('event');
    expect(result.rows).toHaveLength(count);
    expect(rpc).toHaveBeenCalledTimes(Math.ceil(count / 200));
  });
  it.each([
    { total: 1, rows: [] },
    { total: 0, rows: [award(0)] },
    { total: 1, rows: [{ ...award(0), award_id: null }] },
    { total: 2, rows: [award(0), award(0)] },
  ])('never presents an incomplete first page as complete without strict options', async (data) => {
    rpc.mockResolvedValue({ data, error: null });
    await expect(MysteryBountyService.getAllAwards('event')).rejects.toThrow();
  });
});
