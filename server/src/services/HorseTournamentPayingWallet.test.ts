import { afterEach, describe, expect, it, vi } from 'vitest';
import { TournamentRecurringService } from './TournamentRecurringService.js';
import { supabase } from './supabase.js';
import { bankrollPolicyFor } from './HorseBankroll.js';
import { reportError } from './errorReporter.js';
import { orderHorseTournamentCandidates } from './HorseTournamentCandidateOrder.js';
vi.mock('../maintenance/freezeState.js', () => ({ isMaintenanceFrozen: () => false }));
vi.mock('./errorReporter.js', () => ({ reportError: vi.fn() }));
vi.mock('./HorseBehavior.js', async (original) => ({
  ...(await original<typeof import('./HorseBehavior.js')>()),
  isActiveNow: () => true,
}));
afterEach(() => vi.restoreAllMocks());
const horse = '4bbd6b61-f9a5-42e5-a6a0-3e175cb94060';
function harness(payingBalance: number, minBalance = 5.63, ids = [horse]) {
  const event = {
    id: 'event',
    format_contract: 'mtt-v2',
    status: 'RUNNING',
    club_id: 'union',
    union_id: 'union',
    buy_in_amount: 45,
    buy_in_fee: 5,
  };
  const svc = new TournamentRecurringService() as any;
  vi.spyOn(svc, 'horseLoadMap').mockResolvedValue(new Map());
  vi.spyOn(svc, 'clubMemberIdsForTournament').mockResolvedValue(new Set(ids));
  vi.spyOn(svc, 'diamondArenaHost').mockResolvedValue(false);
  const cheapestPaid: Array<{ buy_in_amount: number; buy_in_fee: number }> = [];
  vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
    const rows =
      table === 'profiles'
        ? ids.map((id) => ({ id }))
        : table === 'club_members'
          ? [
              { user_id: horse, club_id: 'default', chip_balance: payingBalance },
              { user_id: horse, club_id: 'other', chip_balance: minBalance },
            ]
          : table === 'tournaments'
            ? cheapestPaid
            : [];
    const q: any = {};
    for (const key of ['select', 'eq', 'in', 'order', 'range', 'limit', 'gt']) q[key] = () => q;
    q.maybeSingle = async () => ({ data: event, error: null });
    q.then = (resolve: any) => Promise.resolve({ data: rows, error: null }).then(resolve);
    return q;
  });
  const rpc = vi.spyOn(supabase, 'rpc').mockImplementation((name: string) => {
    const data =
      name === 'fn_horse_tournament_entry_ticket_hints'
        ? { ok: true, holder_ids: [] }
        : name === 'fn_ca_horse_tournament_bankrolls'
          ? ids.map((id) => ({ user_id: id, club_id: 'default', chip_balance: payingBalance }))
          : { ok: true };
    return Promise.resolve({ data, error: null }) as any;
  });
  return { svc, rpc, event, cheapestPaid };
}
describe('registration judges the wallet its ordinary entry door will debit', () => {
  it('does not discard a funded horse because an unrelated membership is broke', async () => {
    expect(bankrollPolicyFor(horse).tournamentBuyInsToEnter).toBe(60);
    const h = harness(9727.4);
    expect(await h.svc.registerHorses('event', 1)).toBe(1);
    expect(h.rpc).toHaveBeenCalledWith('fn_register_horse_for_tournament', {
      p_tournament_id: 'event',
      p_user_id: horse,
      p_allow_wallet_charge: true,
    });
  });
  it('does not add wallets together or use a richer wallet the entry will not debit', async () => {
    const h = harness(50, 10000);
    expect(await h.svc.registerHorses('event', 1)).toBe(0);
    expect(h.rpc.mock.calls.some(([name]) => name === 'fn_register_horse_for_tournament')).toBe(
      false
    );
  });
});

describe('refused candidates cannot monopolize the bounded offer queue', () => {
  it('advances past deferred purchases on the next pass', async () => {
    const ids = Array.from(
      { length: 11 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
    );
    const h = harness(1000000, 1000000, ids);
    const original = h.rpc.getMockImplementation()!;
    let purchases = 0;
    const rejected = new Set<string>();
    h.rpc.mockImplementation((name: string, args: any) => {
      if (name !== 'fn_register_horse_for_tournament') return original(name, args);
      purchases++;
      if (rejected.size < 10) rejected.add(args.p_user_id);
      return Promise.resolve({
        data: rejected.has(args.p_user_id)
          ? { ok: false, reason: 'horse_tournament_reservation_budget' }
          : { ok: true },
        error: null,
      }) as any;
    });
    expect(await h.svc.registerHorses('event', 1)).toBe(0);
    expect(purchases).toBe(10);
    expect(await h.svc.registerHorses('event', 1)).toBe(1);
    expect(purchases).toBe(11);
  });
});

describe('registration read failures remain visible', () => {
  it('reports an unexpected read exception rather than passing it off as no candidates', async () => {
    const h = harness(10000);
    const failure = new Error('registration read failed');
    vi.mocked(supabase.from).mockImplementation(() => {
      throw failure;
    });
    expect(await h.svc.registerHorses('event', 1)).toBe(0);
    expect(reportError).toHaveBeenCalledWith(
      failure,
      'TournamentRecurring.horse_registration_failed'
    );
  });
});

describe('freeroll recovery priority survives event-specific randomization', () => {
  it('randomizes within funding groups while offering broke horses first', async () => {
    vi.spyOn(Date.prototype, 'getUTCHours').mockReturnValue(12);
    const ids = Array.from(
      { length: 20 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
    );
    const ordered = orderHorseTournamentCandidates(
      ids.map((id) => ({ id })),
      'event',
      new Date().getUTCHours()
    );
    const broke = ordered[ordered.length - 1].id;
    const h = harness(1000000, 1000000, ids);
    h.event.buy_in_amount = 0;
    h.event.buy_in_fee = 0;
    h.cheapestPaid.push({ buy_in_amount: 1, buy_in_fee: 0 });
    const original = h.rpc.getMockImplementation()!;
    h.rpc.mockImplementation((name: string, args: any) =>
      name === 'fn_ca_horse_tournament_bankrolls'
        ? (Promise.resolve({
            data: ids.map((id) => ({
              user_id: id,
              club_id: 'default',
              chip_balance: id === broke ? 0 : 1000000,
            })),
            error: null,
          }) as any)
        : original(name, args)
    );
    expect(await h.svc.registerHorses('event', 2)).toBe(2);
    const entered = h.rpc.mock.calls
      .filter(([name]) => name === 'fn_register_horse_for_tournament')
      .map(([, args]) => (args as any).p_user_id);
    expect(entered).toEqual([broke, ordered[0].id]);
  });
});
