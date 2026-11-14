import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * SHORT WHEN ENTRIES STOP (owner law 2026-11-14: no overlay chips until
 * registration, rebuys and the add-on have all ended). When an event stops
 * taking entries while its guarantee is still short, the overlay guard raises
 * one durable alert and keeps the rebuy and add-on boost running; it never
 * seats an entry the door refused.
 */
const rpc = vi.fn();
const from = vi.fn();
vi.mock('./supabase/client.js', () => ({ supabase: { rpc, from } }));
vi.mock('./errorReporter.js', () => ({ reportError: vi.fn() }));
const raiseFinancialAlert = vi.fn(async () => undefined);
vi.mock('./financialAlerts.js', () => ({ raiseFinancialAlert }));
vi.mock('../maintenance/freezeState.js', () => ({ isMaintenanceFrozen: () => false }));

const EVENT = 'b0000000-0000-0000-0000-000000000001';
const NOW = Date.parse('2026-11-15T01:40:00Z');

/** A thenable query that answers every chained filter with one fixed result. */
function query(result: { data?: unknown; error?: unknown; count?: number }) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'gt', 'or', 'order', 'limit']) chain[m] = () => chain;
  chain.then = (resolve: (v: unknown) => unknown) => resolve({ error: null, ...result });
  return chain;
}

function stage(openNow: boolean, missingCoverage: number) {
  from.mockImplementation((table: string) => {
    if (table === 'clubs') return query({ data: [{ id: 'club-1' }] });
    if (table === 'tournaments')
      return query({
        data: [
          {
            id: EVENT,
            name: '25 Chip Bankroll Builder (NLH)',
            status: 'RUNNING',
            format_contract: 'mtt-v2',
            start_time: '2026-11-15T00:00:00Z',
            started_at: '2026-11-15T00:00:00Z',
            current_level: 9,
            late_reg_levels: 9,
            rebuy_levels: 12,
            late_reg_mins: 0,
            buy_in_amount: 22.5,
            buy_in_fee: 2.5,
            bounty_amount: 0,
            guaranteed_prize: 1000,
            blind_structure: null,
            max_players: null,
            prize_pool_finalized: false,
            add_on_available: false,
          },
        ],
      });
    return query({ count: 30 });
  });
  rpc.mockImplementation(async (name: string) => {
    if (name === 'fn_ca_guarantee_funding')
      return {
        data: { guarantee: 1000, net_coverage: 1000 - missingCoverage, house_due: missingCoverage },
        error: null,
      };
    if (name === 'fn_tournament_late_registration_open') return { data: openNow, error: null };
    return { data: [], error: null };
  });
}

describe('a guarantee still short when entries stop', () => {
  beforeEach(() => {
    rpc.mockReset();
    from.mockReset();
    raiseFinancialAlert.mockClear();
  });

  it('raises one durable alert per event and keeps the rebuy boost published', async () => {
    const { lateRegisterHorsesOnce } = await import('./HorseOverlayGuard.js');
    const { guaranteeShortNow } = await import('./horseOverlayCover.js');
    stage(false, 250);
    const added = await lateRegisterHorsesOnce(undefined, () => true, NOW);
    expect(added).toBe(0);
    const calls = raiseFinancialAlert.mock.calls.filter(
      (c) => (c as unknown[])[1] === 'HorseOverlayGuard.guarantee_short_at_entry_close'
    );
    expect(calls).toHaveLength(1);
    const [severity, , message, meta, key] = calls[0] as unknown as [
      string,
      string,
      string,
      { missing_entries: number },
      string,
    ];
    expect(severity).toBe('warning');
    expect(message).toContain('25 Chip Bankroll Builder (NLH) stopped taking entries');
    expect(meta.missing_entries).toBeGreaterThan(0);
    expect(key).toBe(`${EVENT}:guarantee_short_at_entry_close`);
    // The rebuy and add-on rate boost reads this while the pool stays open.
    expect(guaranteeShortNow(EVENT, NOW + 60_000)).toBe(true);
  });

  it('stays silent once the guarantee is covered', async () => {
    const { lateRegisterHorsesOnce } = await import('./HorseOverlayGuard.js');
    stage(false, 0);
    await lateRegisterHorsesOnce(undefined, () => true, NOW);
    expect(
      raiseFinancialAlert.mock.calls.some(
        (c) => (c as unknown[])[1] === 'HorseOverlayGuard.guarantee_short_at_entry_close'
      )
    ).toBe(false);
  });
});
