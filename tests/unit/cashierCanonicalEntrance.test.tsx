import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Suspense } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CashierEntrance from '../../src/components/navigation/CashierEntrance';
import CashierTradePage from '../../src/pages/CashierTradePage';
// Preload the actual wallet module so cold compilation happens outside the UI assertions.
import '../../src/pages/CashierPage';
import { supabase } from '../../src/lib/supabase';
import { cashoutService } from '../../src/services/CashoutService';

const fixture = vi.hoisted(() => ({
  club: '1946a17a-2890-431a-8fbe-f52112828a50',
  actor: 'c4ba3f80-1508-4e1e-91c3-521070030027',
  role: 'owner',
  mintScope: 'club' as string | null,
  reads: [] as string[],
}));
vi.mock('../../src/hooks/useAuthUser', () => ({
  useAuthUser: () => ({ user: { id: fixture.actor }, isHydrating: false }),
}));
vi.mock('../../src/core/IdentityDNA', async (original) => ({
  ...(await original<typeof import('../../src/core/IdentityDNA')>()),
  getIdentityDNAStatus: () => ({ loaded: true, authenticated: true, userId: fixture.actor }),
}));
vi.mock('../../src/hooks/useMasterBusChannel', () => ({ useMasterBusChannel: vi.fn() }));
vi.mock('../../src/components/common/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));
vi.mock('../../src/services/GameServerAPI', async (original) => ({
  ...(await original<typeof import('../../src/services/GameServerAPI')>()),
  getServerStatus: vi.fn(async () => null),
}));
vi.mock('../../src/services/UnionService', () => ({
  UnionService: { getOwnedUnions: vi.fn(async () => []) },
}));
vi.mock('../../src/utils/clubIdResolver', async (original) => ({
  ...(await original<typeof import('../../src/utils/clubIdResolver')>()),
  resolveClubUUID: vi.fn(async (id: string) => (id === 'fixture-club' ? fixture.club : id)),
}));
vi.mock('../../src/utils/clubQuickLink', async (original) => ({
  ...(await original<typeof import('../../src/utils/clubQuickLink')>()),
  readCachedQuickLinkClubs: vi.fn(() => [
    { id: fixture.club, name: 'Fixture Club', is_union: false },
  ]),
}));

function Address() {
  const at = useLocation();
  return (
    <output aria-label="Current Address">
      {at.pathname}
      {at.search}
      {at.hash}
    </output>
  );
}
function mount(entry: string) {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Address />
      <Suspense fallback={<p>Opening Cashier</p>}>
        <Routes>
          <Route path="/cashier" element={<CashierEntrance />} />
          <Route path="/clubs/:clubId/cashier-classic" element={<CashierEntrance />} />
          <Route path="/clubs/:clubId/cashier" element={<CashierTradePage />} />
        </Routes>
      </Suspense>
    </MemoryRouter>
  );
}
beforeEach(() => {
  fixture.role = 'owner';
  fixture.mintScope = 'club';
  fixture.reads = [];
  localStorage.clear();
  vi.clearAllMocks();
  const club = {
    name: 'Fixture Club',
    slug: 'fixture-club',
    club_id: 101,
    is_union: false,
    get owner_id() {
      return fixture.role === 'owner' ? fixture.actor : '65cc263c-7c01-4819-a421-dc5d75dfc891';
    },
  };
  vi.mocked(supabase.rpc).mockImplementation((name, args) => {
    if (name === 'fn_cashier_mint_scope')
      return Promise.resolve({ data: fixture.mintScope, error: null }) as never;
    if (name === 'get_my_full_profile') return supabase.from('profiles') as never;
    if (name === 'fn_club_money_panel') {
      const data = {
        authorized: true,
        scope: fixture.role === 'owner' ? 'club' : 'member',
        in_union: false,
        club_treasury: 0,
        club_promo_wallet: 0,
        bbj: { main: 0, backup: 0 },
      };
      const result = Promise.resolve({ data, error: null });
      return Object.assign(result, { abortSignal: () => result }) as never;
    }
    if (name === 'fn_cashier_history_summary') {
      const data =
        args?.p_scope === 'club'
          ? { mode: 'club', entries: 0, volume: 0, cashouts_paid: 0, complete: true }
          : { mode: 'wallet', incoming: 0, outgoing: 0, net: 0 };
      return Promise.resolve({ data, error: null }) as never;
    }
    return Promise.resolve({ data: [], error: null }) as never;
  });
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    let columns = '';
    const q: Record<string, unknown> = {};
    for (const key of [
      'in',
      'or',
      'order',
      'range',
      'gte',
      'lte',
      'neq',
      'limit',
      'is',
      'gt',
      'lt',
      'not',
      'match',
      'filter',
      'abortSignal',
    ])
      q[key] = () => q;
    q.select = (value: string) => {
      columns = value;
      return q;
    };
    q.eq = (key: string, value: string) => {
      if (key === 'club_id' && table === 'club_members') fixture.reads.push(value);
      return q;
    };
    q.single = q.maybeSingle = async () => ({
      data:
        table === 'club_members'
          ? { role: fixture.role, status: 'active', chip_balance: 250 }
          : table === 'agents'
            ? { status: 'active', agent_wallet_balance: 500 }
            : table === 'clubs'
              ? club
              : table === 'profiles'
                ? { id: fixture.actor, diamonds: 8 }
                : null,
      error: null,
    });
    q.then = (resolve: (value: unknown) => unknown, reject: (err: unknown) => unknown) =>
      Promise.resolve({
        data:
          table === 'club_members' && columns.includes('clubs:club_id')
            ? [{ club_id: fixture.club, role: fixture.role, chip_balance: 250, clubs: club }]
            : [],
        error: null,
        count: 0,
      }).then(resolve, reject);
    return q as never;
  });
});
afterEach(cleanup);

describe('one mounted club cashier', () => {
  it.each([
    ['/clubs/fixture-club/cashier-classic?table=77&origin=menu#seat', 'fixture-club'],
    ['/cashier?club=' + fixture.club + '&table=77&origin=menu#seat', fixture.club],
    ['/cashier?table=77&origin=menu#seat', fixture.club],
  ])(
    'opens the canonical club desk and preserves its table return context: %s',
    async (entry, club) => {
      mount(entry);
      await screen.findByRole('group', { name: 'Wallet Actions' });
      const address = new URL(
        screen.getByLabelText('Current Address').textContent!,
        'https://arena.test'
      );
      expect(address.pathname).toBe('/clubs/' + club + '/cashier');
      expect([...address.searchParams].sort()).toEqual([
        ['origin', 'menu'],
        ['table', '77'],
      ]);
      expect(address.hash).toBe('#seat');
      expect(screen.queryByRole('region', { name: 'Wallet Operations' })).toBeNull();
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    }
  );

  it.each(['owner', 'player', 'admin'])(
    'keeps only the direct Cashier controls for %s even from an old workspace link',
    async (role) => {
      fixture.role = role;
      mount('/clubs/' + fixture.club + '/cashier?walletTools=open');
      const actions = await screen.findByRole('group', { name: 'Wallet Actions' });
      expect(screen.getByLabelText('Current Address')).not.toHaveTextContent('walletTools');
      expect(within(actions).queryByRole('button', { name: /^(Send|Distribute)$/ })).toBeNull();
      expect(!!within(actions).queryByRole('button', { name: 'Cash-Out' })).toBe(role !== 'admin');
      fireEvent.click(within(actions).getByRole('button', { name: 'History' }));
      fireEvent.click(screen.getByRole('button', { name: /^Requests, Tickets And Tools/ }));
      const tabs = await screen.findByRole('tablist', { name: 'Cashier Actions' });
      const history = within(tabs).getByRole('tab', {
        name: 'Transaction History',
        selected: true,
      });
      const panel = screen.getByRole('tabpanel', { name: 'Transaction History' });
      expect(history).toHaveAttribute('aria-controls', panel.id);
      expect(panel).toHaveAttribute('aria-labelledby', history.id);
      history.focus();
      fireEvent.keyDown(history, { key: 'End' });
      expect(within(tabs).getAllByRole('tab').at(-1)).toHaveFocus();
      for (const tab of within(tabs).getAllByRole('tab', { selected: false }))
        expect(tab).not.toHaveAttribute('aria-controls');
      expect(screen.queryByRole('button', { name: 'Wallet Operations' })).toBeNull();
      expect(screen.queryByRole('region', { name: 'Wallet Operations' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Financials' }) !== null).toBe(role !== 'player');
    }
  );

  it.each(['club', 'union', null])(
    'offers club-bank Mint only after confirmed standalone permission (%s)',
    async (scope) => {
      fixture.mintScope = scope;
      mount('/clubs/' + fixture.club + '/cashier');
      fireEvent.click(await screen.findByRole('button', { name: 'Open Club Balance' }));
      await waitFor(() =>
        expect(vi.mocked(supabase.rpc)).toHaveBeenCalledWith('fn_cashier_mint_scope', {
          p_club_id: fixture.club,
        })
      );
      if (scope === 'club')
        expect(
          await screen.findByRole('button', { name: 'Mint Chips Into The Club Bank' })
        ).toBeVisible();
      else
        expect(screen.queryByRole('button', { name: 'Mint Chips Into The Club Bank' })).toBeNull();
    }
  );
  it('exposes the actual cashout queue state and opens a fresh authorized read after a failure', async () => {
    let refuse!: (error: Error) => void;
    const queue = vi
      .spyOn(cashoutService, 'getAgentPendingCashouts')
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            refuse = reject;
          })
      )
      .mockResolvedValue([]);
    try {
      mount('/clubs/' + fixture.club + '/cashier');
      const trigger = await screen.findByRole('button', { name: /Cash Out Requests/ });
      expect(trigger).toHaveAccessibleName(/Loading/);
      await act(async () => refuse(new Error('Queue Read Unavailable')));
      expect(trigger).toHaveAccessibleName(/Unavailable/);
      expect(trigger).not.toHaveTextContent(/None Pending|0 Pending/);
      fireEvent.click(trigger);
      const panel = within(await screen.findByRole('dialog'));
      expect(await panel.findByText('No Pending Cashout Requests')).toBeVisible();
      expect(queue).toHaveBeenLastCalledWith(fixture.actor, fixture.club);
    } finally {
      queue.mockRestore();
    }
  });

  it('keeps one reconciliation action and one receipt reader while switching cashier tabs', async () => {
    mount('/clubs/' + fixture.club + '/cashier');
    fireEvent.click(await screen.findByRole('button', { name: /^Requests, Tickets And Tools/ }));
    const recoveryReads = () =>
      vi
        .mocked(supabase.rpc)
        .mock.calls.filter(
          ([name, args]) => name === 'fn_cashier_browser_recovery_read' && args?.p_kind === 'wallet'
        ).length;
    await waitFor(() => expect(recoveryReads()).toBeGreaterThan(0));
    const beforeOpen = recoveryReads();
    fireEvent.click(await screen.findByRole('tab', { name: /Tickets/ }));
    expect(screen.getAllByRole('button', { name: 'Reconcile Now' })).toHaveLength(1);
    expect(recoveryReads()).toBe(beforeOpen);
    expect(
      screen.getByRole('button', { name: 'Reconcile Now' }).closest('[data-cashier-recovery]')
    ).toBeTruthy();
  });

  it('returns focus to the switcher when the current club is selected', async () => {
    mount('/clubs/' + fixture.club + '/cashier');
    const switcher = await screen.findByRole('button', { name: /Open Another Club Cashier/ });
    fireEvent.click(switcher);
    const option = await screen.findByRole('option', { name: /Fixture Club/ });
    option.focus();
    fireEvent.click(option);
    expect(screen.queryByRole('listbox', { name: 'Club Cashiers' })).toBeNull();
    expect(switcher).toHaveFocus();
    expect(screen.getByLabelText('Current Address')).toHaveTextContent(
      '/clubs/' + fixture.club + '/cashier'
    );
  });

  it('opens the Player and Diamond ledgers and carries the club into the Diamond store', async () => {
    mount('/clubs/' + fixture.club + '/cashier');
    const wallets = await screen.findByRole('region', { name: 'My Wallets' });
    fireEvent.click(await within(wallets).findByRole('button', { name: 'Open Player Wallet' }));
    const player = await screen.findByRole('dialog', { name: 'Player Wallet' });
    fireEvent.click(within(player).getByText('Close', { selector: 'button' }));
    expect(screen.queryByRole('dialog', { name: 'Player Wallet' })).toBeNull();
    fireEvent.click(within(wallets).getByRole('button', { name: 'Open Diamond Wallet' }));
    const diamond = await screen.findByRole('dialog', { name: 'Diamond Wallet' });
    fireEvent.click(within(diamond).getByRole('button', { name: 'Buy Diamonds' }));
    expect(screen.getByLabelText('Current Address')).toHaveTextContent('/vip?club=' + fixture.club);
  });

  it.each(['Disputes', 'Financials'])(
    'opens the authorized %s route from Cashier tools',
    async (label) => {
      mount('/clubs/' + fixture.club + '/cashier?walletTools=open');
      fireEvent.click(await screen.findByRole('button', { name: /^Requests, Tickets And Tools/ }));
      fireEvent.click(await screen.findByRole('button', { name: label, exact: true }));
      expect(screen.getByLabelText('Current Address')).toHaveTextContent(
        '/clubs/' + fixture.club + '/' + label.toLowerCase()
      );
    }
  );

  it.each([
    ['Buy-In', 'Go To Table To Buy In'],
    ['Cash-Out', 'Go To Table To Cash Out'],
  ])(
    'routes the table-specific %s action to that table without moving funds',
    async (_tab, label) => {
      fixture.role = 'player';
      mount('/clubs/' + fixture.club + '/cashier?walletTools=open&table=77');
      fireEvent.click(await screen.findByRole('button', { name: /^Requests, Tickets And Tools/ }));
      fireEvent.click(await screen.findByRole('button', { name: label }));
      expect(screen.getByLabelText('Current Address')).toHaveTextContent('/table/77');
      expect(
        vi.mocked(supabase.rpc).mock.calls.some(([method]) => /buyin|request_cashout/i.test(method))
      ).toBe(false);
    }
  );

  it('opens the full statement for the current club from History', async () => {
    mount('/clubs/' + fixture.club + '/cashier');
    const wallet = await screen.findByRole('group', { name: 'Wallet Actions' });
    fireEvent.click(within(wallet).getByRole('button', { name: 'History' }));
    const panel = await screen.findByRole('tabpanel', { name: 'Transaction History' });
    const summary = within(panel).getByText('Statement Tools', { selector: 'summary' });
    fireEvent.click(summary);
    fireEvent.click(within(panel).getByRole('button', { name: 'Full Statement' }));
    expect(screen.getByLabelText('Current Address')).toHaveTextContent(
      '/clubs/' + fixture.club + '/cashier/statements'
    );
  });

  it('retains help and accessible Cashier tool disclosure references', async () => {
    mount('/clubs/' + fixture.club + '/cashier');
    expect(await screen.findByRole('button', { name: 'Page Help' })).toBeVisible();
    const toggle = await screen.findByRole('button', { name: /^Requests, Tickets And Tools/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    const tabs = await screen.findByRole('tablist', { name: 'Cashier Actions' });
    expect(toggle).toHaveAttribute('aria-controls', tabs.id);
    fireEvent.click(toggle);
    expect(screen.queryByRole('tablist', { name: 'Cashier Actions' })).toBeNull();
  });
});
