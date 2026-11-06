/**
 * THE SWEEP GATE READS PENDING BOUNTY WORK, NOT EVERY MARKER (2026-11-06)
 *
 * The per-sweep bounty gate asked fn_tournament_has_unsettled_bounties, which
 * re-proves every settled obligation's marker: 2.4 s on a 402-obligation PKO,
 * 272,041 engine calls at a 262 ms mean in pg_stat_statements. The gate now
 * asks fn_tournament_has_pending_bounty_work (migration 20261106034328) and
 * falls back to the old verdict only while that function is not installed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ rpc: vi.fn(), reportError: vi.fn() }));
vi.mock('../services/supabase/client.js', () => ({
  supabase: { from: vi.fn(), rpc: fixture.rpc },
  maintenanceSupabase: { from: vi.fn(), rpc: fixture.rpc },
}));
vi.mock('../services/errorReporter.js', () => ({
  reportError: fixture.reportError,
  reportWarning: vi.fn(),
}));

const { TournamentManagerEliminations, pendingWorkGateIsNotInstalled } =
  await import('./TournamentManagerEliminations.js');

function manager() {
  const m = Object.create(TournamentManagerEliminations.prototype) as any;
  Object.assign(m, {
    tournamentId: '00000000-0000-4000-8000-000000000001',
    requestUrgentEliminationSweepAfter: vi.fn(),
  });
  return m;
}
const pko = { is_pko: true };

describe('the sweep gate reads pending bounty work, not every marker', () => {
  beforeEach(() => vi.clearAllMocks());

  it('asks the pending-work gate and never the full re-proof', async () => {
    fixture.rpc.mockResolvedValue({ data: false, error: null });
    expect(await manager().recoverPendingBountyObligations(pko)).toBe(true);
    expect(fixture.rpc.mock.calls.map(([fn]) => fn)).toEqual([
      'fn_tournament_has_pending_bounty_work',
    ]);
  });

  it('holds the bust while bounty work is open', async () => {
    fixture.rpc.mockResolvedValue({ data: true, error: null });
    expect(await manager().recoverPendingBountyObligations(pko)).toBe(false);
  });

  it.each([
    {
      code: 'PGRST202',
      message: 'Could not find the function public.fn_tournament_has_pending_bounty_work',
    },
    {
      code: '42883',
      message: 'function fn_tournament_has_pending_bounty_work(uuid) does not exist',
    },
  ])('falls back to the old verdict only while the gate is not installed (%o)', async (missing) => {
    fixture.rpc
      .mockResolvedValueOnce({ data: null, error: missing })
      .mockResolvedValueOnce({ data: true, error: null });
    expect(await manager().recoverPendingBountyObligations(pko)).toBe(false);
    expect(fixture.rpc.mock.calls.map(([fn]) => fn)).toEqual([
      'fn_tournament_has_pending_bounty_work',
      'fn_tournament_has_unsettled_bounties',
    ]);
    expect(fixture.reportError).not.toHaveBeenCalled();
  });

  it('reports a real refusal and retries, without falling back', async () => {
    fixture.rpc.mockResolvedValue({
      data: null,
      error: { code: '57014', message: 'canceling statement' },
    });
    const m = manager();
    expect(await m.recoverPendingBountyObligations(pko)).toBe(false);
    expect(fixture.rpc).toHaveBeenCalledTimes(1);
    expect(fixture.reportError).toHaveBeenCalledWith(
      expect.anything(),
      'Tournament.bounty_outbox_verdict_failed'
    );
    expect(m.requestUrgentEliminationSweepAfter).toHaveBeenCalled();
  });

  it('a non-bounty event asks nothing', async () => {
    expect(await manager().recoverPendingBountyObligations({ is_pko: false })).toBe(true);
    expect(fixture.rpc).not.toHaveBeenCalled();
  });

  it('recognises only the not-installed answers', () => {
    expect(pendingWorkGateIsNotInstalled({ code: 'PGRST202' })).toBe(true);
    expect(pendingWorkGateIsNotInstalled({ code: '42883' })).toBe(true);
    expect(pendingWorkGateIsNotInstalled({ code: '57014', message: 'timeout' })).toBe(false);
    expect(pendingWorkGateIsNotInstalled(null)).toBe(false);
  });
});
