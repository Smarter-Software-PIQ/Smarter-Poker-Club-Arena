/**
 * LAW: A jackpot hand banks its own drop before it asks where the drop went.
 * Incident efde14dc (2026-11-19): since 20261118071736 the BBJ drop is banked
 * after the hand by fn_ca_bank_pending_hand_obligations, and the payout read
 * the bbj_contributions receipt before it existed, refused with "no confirmed
 * payout destination" and paged CRITICAL. See bankThisHandsPendingDrop.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
const rpc = vi.fn();
const from = vi.fn();
const raiseFinancialAlert = vi.fn();
vi.mock('./client.js', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: (...args: unknown[]) => from(...args),
  },
}));
vi.mock('../errorReporter.js', () => ({ reportError: vi.fn() }));
vi.mock('../financialAlerts.js', () => ({
  raiseFinancialAlert: (...a: unknown[]) => raiseFinancialAlert(...a),
}));
import { BBJ_DROP_BANKING_PENDING, processBBJPayout, setBBJPayoutQueue } from './bbj.js';

const params = {
  kind: 'mini' as const,
  tierId: 'micro',
  tableId: 'table-1',
  clubId: 'club-1',
  handNumber: 60218398,
  loserUserId: 'loser',
  winnerUserId: 'winner',
  loserHandName: 'Full House',
  winnerHandName: 'Four of a Kind',
  dealtInPlayerIds: ['loser', 'winner'],
  seatedUserIds: ['loser', 'winner'],
  payoutTotalPercent: 0,
};
type Row = Record<string, unknown>;
let rows: Record<string, Row[]>;
let bankingHolds: number;
let settle: ReturnType<typeof vi.fn>;
let claim: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 1000 });
  bankingHolds = 0;
  rows = {
    bbj_payouts: [],
    bbj_contributions: [],
    bbj_pools: [{ id: 'union-pool', status: 'active' }],
    hand_bank_obligation_pending: [
      {
        hand_id: 'hand-uuid',
        table_id: 'table-1',
        hand_number: 60218398,
        kind: 'bbj_contribution',
      },
    ],
  };
  settle = vi.fn();
  claim = vi.fn().mockResolvedValue(true);
  setBBJPayoutQueue({ claim, settle });
  from.mockImplementation((name: string) => {
    const filters: Array<[string, unknown]> = [];
    const query = {
      insert: async () => ({ data: null, error: null }),
      is: () => query,
      order: () => query,
      limit: () => query,
      select: () => query,
      eq: (key: string, value: unknown) => {
        filters.push([key, value]);
        return query;
      },
      maybeSingle: async () => {
        const m = (rows[name] ?? []).filter((r) => filters.every(([k, v]) => r[k] === v));
        return { data: m[0] ?? null, error: m.length > 1 ? { message: 'multiple rows' } : null };
      },
    };
    return query;
  });
  rpc.mockImplementation(async (name: string, args: Row) => {
    if (name === 'fn_ca_bank_pending_hand_obligations') {
      expect(args).toEqual({ p_hand_id: 'hand-uuid' });
      if (bankingHolds > 0) {
        bankingHolds--;
        return { data: { items: [{ status: 'busy' }] }, error: null };
      }
      rows.hand_bank_obligation_pending = [];
      rows.bbj_contributions = [
        { table_id: 'table-1', hand_number: 60218398, pool_id: 'union-pool' },
      ];
      return { data: { items: [{ status: 'banked' }] }, error: null };
    }
    return {
      data: [
        {
          applied: true,
          already_paid: false,
          recovered: false,
          payout_id: 'payout-1',
          total_payout: 425,
          loser_share: 212.49,
          winner_share: 106.25,
          table_share: 106.26,
          per_player_share: 53.13,
          balance_after: 1000,
        },
      ],
      error: null,
    };
  });
});

describe('a jackpot hand banks its own drop before it asks where the drop went', () => {
  it('banks the stored drop, then pays from the receipt pool, with no alert', async () => {
    const outcome = await processBBJPayout(params);
    expect(rpc.mock.calls.map((c) => c[0])).toEqual([
      'fn_ca_bank_pending_hand_obligations',
      'fn_bbj_mini_payout',
    ]);
    expect(rpc).toHaveBeenCalledWith(
      'fn_bbj_mini_payout',
      expect.objectContaining({ p_pool_id: 'union-pool' })
    );
    expect(outcome.status).not.toBe('queued');
    expect(raiseFinancialAlert).not.toHaveBeenCalled();
  });

  it('retries while another banker holds the pool, then pays', async () => {
    bankingHolds = 2;
    const outcome = await processBBJPayout(params);
    expect(outcome.status).not.toBe('queued');
    expect(rpc).toHaveBeenCalledWith(
      'fn_bbj_mini_payout',
      expect.objectContaining({ p_pool_id: 'union-pool' })
    );
    expect(raiseFinancialAlert).not.toHaveBeenCalled();
  });

  it('a drop still banking after every attempt is a deferral on disk, not a CRITICAL', async () => {
    bankingHolds = 99;
    const outcome = await processBBJPayout(params);
    expect(outcome.status).toBe('queued');
    expect(outcome.status === 'queued' && outcome.lastError).toContain(BBJ_DROP_BANKING_PENDING);
    expect(
      rpc.mock.calls.filter((c) => c[0] === 'fn_ca_bank_pending_hand_obligations')
    ).toHaveLength(4);
    expect(rpc).not.toHaveBeenCalledWith('fn_bbj_mini_payout', expect.anything());
    expect(claim).toHaveBeenCalled();
    expect(settle).not.toHaveBeenCalled();
    expect(raiseFinancialAlert).not.toHaveBeenCalled();
  });

  it('without a durable claim the deferral still pages, with the real attempt count', async () => {
    bankingHolds = 99;
    claim.mockResolvedValue(false);
    await processBBJPayout(params);
    expect(raiseFinancialAlert).toHaveBeenCalledTimes(1);
    expect(raiseFinancialAlert.mock.calls[0][3]).toMatchObject({ attempts: 4, queued: false });
  });

  it('never substitutes a pool: no receipt and no stored drop still refuses', async () => {
    rows.hand_bank_obligation_pending = [];
    const outcome = await processBBJPayout(params);
    expect(outcome.status).toBe('queued');
    expect(rpc).not.toHaveBeenCalled();
    // A non-retryable refusal makes one attempt, and says so.
    expect(raiseFinancialAlert.mock.calls[0][3]).toMatchObject({ attempts: 1 });
  });

  it.each(['main', 'mini'] as const)(
    'closes the concurrent-banker race when the drop banks between the receipt and pending reads (%s)',
    async (kind) => {
      // Reproduce incident 7a0c2e25 (hand #60701395): Read #1 on bbj_contributions
      // misses while the projection banker is mid-flight; before Read #2 on
      // hand_bank_obligation_pending runs, the banker atomically inserts
      // bbj_contributions and deletes hand_bank_obligation_pending.
      const baseFrom = from.getMockImplementation()!;
      let contributionReads = 0;
      from.mockImplementation((name: string) => {
        if (name === 'hand_bank_obligation_pending' && contributionReads === 1) {
          rows.hand_bank_obligation_pending = [];
          rows.bbj_contributions = [
            { table_id: 'table-1', hand_number: 60218398, pool_id: 'union-pool' },
          ];
        }
        const q = baseFrom(name);
        if (name === 'bbj_contributions') {
          const origMaybeSingle = q.maybeSingle;
          q.maybeSingle = async () => {
            contributionReads++;
            return origMaybeSingle();
          };
        }
        return q;
      });

      const callParams =
        kind === 'main'
          ? { ...params, kind: undefined, tierId: undefined, payoutTotalPercent: 25 }
          : params;
      const outcome = await processBBJPayout(callParams);

      expect(outcome.status).toBe('paid');
      expect(rpc).toHaveBeenCalledTimes(1);
      expect(rpc).toHaveBeenCalledWith(
        kind === 'mini' ? 'fn_bbj_mini_payout' : 'bbj_atomic_payout_v2',
        expect.objectContaining({ p_pool_id: 'union-pool' })
      );
      expect(settle).toHaveBeenCalledTimes(1);
      expect(raiseFinancialAlert).not.toHaveBeenCalled();
    }
  );

  it('pays when a concurrent banker finishes before our banking RPC runs (status absent)', async () => {
    const baseRpc = rpc.getMockImplementation()!;
    rpc.mockImplementation(async (name: string, args: Row) => {
      if (name === 'fn_ca_bank_pending_hand_obligations') {
        rows.hand_bank_obligation_pending = [];
        rows.bbj_contributions = [
          { table_id: 'table-1', hand_number: 60218398, pool_id: 'union-pool' },
        ];
        return { data: { status: 'absent', items: [] }, error: null };
      }
      return baseRpc(name, args);
    });

    const outcome = await processBBJPayout(params);
    expect(outcome.status).toBe('paid');
    expect(rpc).toHaveBeenCalledWith(
      'fn_bbj_mini_payout',
      expect.objectContaining({ p_pool_id: 'union-pool' })
    );
    expect(raiseFinancialAlert).not.toHaveBeenCalled();
  });

  it('refuses ambiguous bbj_contributions on the post-pending re-read without substituting a pool', async () => {
    const baseFrom = from.getMockImplementation()!;
    let contributionReads = 0;
    from.mockImplementation((name: string) => {
      if (name === 'hand_bank_obligation_pending' && contributionReads === 1) {
        rows.hand_bank_obligation_pending = [];
        rows.bbj_contributions = [
          { table_id: 'table-1', hand_number: 60218398, pool_id: 'union-pool' },
          { table_id: 'table-1', hand_number: 60218398, pool_id: 'other-pool' },
        ];
      }
      const q = baseFrom(name);
      if (name === 'bbj_contributions') {
        const origMaybeSingle = q.maybeSingle;
        q.maybeSingle = async () => {
          contributionReads++;
          return origMaybeSingle();
        };
      }
      return q;
    });

    const outcome = await processBBJPayout(params);
    expect(outcome.status).toBe('queued');
    expect(outcome.status === 'queued' && outcome.lastError).toContain(
      'bbj_contributions destination read failed: multiple rows'
    );
    expect(rpc).not.toHaveBeenCalled();
    expect(settle).not.toHaveBeenCalled();
  });
});
