/**
 * Dan 2026-11-13: "FOR THE CASHIER, PLAYERS DISPLAYED SHOULD BE DEFAULTED BY
 * LAST TRANSACTION, AND NEXT TO 140 RESULTS, SHOULD BE TO SORT BUTTONS. SORT UP
 * OR DOWN BY AGENT WALLET BALANCE AND PLAYER WALLET BALANCE. THERE SHOULD BE A
 * TOGGLE TO INSTANTLY SHOW HIGH TO LOW OR LOW TO HIGH FOR BOTH. WITH HIGH TO
 * LOW BEING THE DEFAULT WHEN CLICKED."
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  compareCashierRoster,
  DEFAULT_CASHIER_ROSTER_SORT,
  mapCashierRosterSortKeys,
  nextCashierRosterSort,
  type DownlineRow,
} from '../../src/lib/cashierRoster';

const row = (userId: string, name: string, chipBalance: number): DownlineRow => ({
  userId,
  name,
  username: name.toLowerCase(),
  avatarUrl: null,
  role: 'player',
  chipBalance,
  depth: 1,
  isMine: true,
  playerNumber: null,
  isSelf: false,
});

const rows = [
  row('a', 'Hank', 30),
  row('b', 'Jmarov', 6.13),
  row('c', 'Burls', 0),
  row('d', 'Zed', 99),
];
const keys = mapCashierRosterSortKeys([
  { user_id: 'a', player_wallet: 30, agent_wallet: 0, last_transaction_at: '2026-11-10T00:00:00Z' },
  {
    user_id: 'b',
    player_wallet: 6.13,
    agent_wallet: 0,
    last_transaction_at: '2026-11-13T00:00:00Z',
  },
  {
    user_id: 'c',
    player_wallet: 0,
    agent_wallet: 465,
    last_transaction_at: '2026-11-12T00:00:00Z',
  },
  { user_id: 'd', player_wallet: 99, agent_wallet: null, last_transaction_at: null },
]);
const order = (sort: Parameters<typeof compareCashierRoster>[0]) =>
  [...rows].sort(compareCashierRoster(sort, keys)).map((r) => r.userId);

describe('cashier roster order', () => {
  it('defaults to last transaction, newest first, never-transacted last', () => {
    expect(DEFAULT_CASHIER_ROSTER_SORT).toEqual({ by: 'last_transaction' });
    expect(order(DEFAULT_CASHIER_ROSTER_SORT)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('a wallet button starts High To Low and the next tap flips it', () => {
    const first = nextCashierRosterSort(DEFAULT_CASHIER_ROSTER_SORT, 'agent_wallet');
    expect(first).toEqual({ by: 'agent_wallet', dir: 'desc' });
    expect(nextCashierRosterSort(first, 'agent_wallet')).toEqual({
      by: 'agent_wallet',
      dir: 'asc',
    });
    expect(nextCashierRosterSort({ by: 'agent_wallet', dir: 'asc' }, 'player_wallet')).toEqual({
      by: 'player_wallet',
      dir: 'desc',
    });
  });

  it('sorts by agent wallet and player wallet both ways', () => {
    expect(order({ by: 'agent_wallet', dir: 'desc' })[0]).toBe('c');
    expect(order({ by: 'agent_wallet', dir: 'asc' }).at(-1)).toBe('c');
    expect(order({ by: 'player_wallet', dir: 'desc' })).toEqual(['d', 'a', 'b', 'c']);
    expect(order({ by: 'player_wallet', dir: 'asc' })).toEqual(['c', 'b', 'a', 'd']);
  });

  it('the page reads keys for the whole roster and opens on the default', () => {
    const page = readFileSync('src/pages/CashierTradePage.tsx', 'utf8');
    expect(page).toContain("supabase.rpc('fn_cashier_roster_sort_keys'");
    expect(page).toMatch(/useState<CashierRosterSort>\(DEFAULT_CASHIER_ROSTER_SORT\)/);
    expect(page).toContain('Agent Wallet');
    expect(page).toContain('Player Wallet');
  });
});
