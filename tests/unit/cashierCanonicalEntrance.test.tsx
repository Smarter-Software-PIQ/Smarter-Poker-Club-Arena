import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Suspense } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CashierEntrance from '../../src/components/navigation/CashierEntrance';
import CashierTradePage from '../../src/pages/CashierTradePage';
import { supabase } from '../../src/lib/supabase';

const fixture = vi.hoisted(() => ({
  club: '1946a17a-2890-431a-8fbe-f52112828a50',
  actor: 'c4ba3f80-1508-4e1e-91c3-521070030027',
  role: 'owner',
  reads: [] as string[],
}));
vi.mock('../../src/hooks/useAuthUser', () => ({
  useAuthUser: () => ({ user: { id: fixture.actor }, isHydrating: false }),
}));
vi.mock('../../src/hooks/useMasterBusChannel', () => ({ useMasterBusChannel: vi.fn() }));
vi.mock('../../src/components/common/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
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
          <Route path="/clubs/:clubId/cashier-classic" element={<CashierEntrance legacy />} />
          <Route path="/clubs/:clubId/cashier" element={<CashierTradePage />} />
        </Routes>
      </Suspense>
    </MemoryRouter>
  );
}
beforeEach(() => {
  fixture.role = 'owner';
  fixture.reads = [];
  localStorage.clear();
  vi.clearAllMocks();
  const club = {
    name: 'Fixture Club',
    slug: 'fixture-club',
    club_id: 101,
    is_union: false,
    owner_id: fixture.actor,
  };
  vi.mocked(supabase.rpc).mockResolvedValue({ data: [], error: null } as never);
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
    'opens legacy wallet operations at the same club with the full table context: %s',
    async (entry, club) => {
      mount(entry);
      const tabs = await screen.findByRole('tablist', { name: 'Wallet Operations' });
      await within(tabs).findByRole('tab', { name: 'Mint' });
      const address = new URL(
        screen.getByLabelText('Current Address').textContent!,
        'https://arena.test'
      );
      expect(address.pathname).toBe('/clubs/' + club + '/cashier');
      expect([...address.searchParams].sort()).toEqual([
        ['origin', 'menu'],
        ['table', '77'],
        ['walletTools', 'open'],
      ]);
      expect(address.hash).toBe('#seat');
      expect(fixture.reads).toContain(fixture.club);
      expect(fixture.reads).not.toContain('fixture-club');
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(screen.getByRole('heading', { level: 1, name: 'Cashier' })).toBeVisible();
      fireEvent.click(within(tabs).getByRole('tab', { name: 'Mint' }));
      expect(await screen.findByRole('tabpanel', { name: 'Mint' })).toBeVisible();
    }
  );
  it('returns to Send from another open wallet tab without losing the table return link', async () => {
    mount('/clubs/' + fixture.club + '/cashier?table=77&origin=menu#seat');
    const actions = await screen.findByRole('group', { name: 'Wallet Actions' });
    const send = within(actions).getByRole('button', { name: 'Send' });
    fireEvent.click(send);
    const tabs = await screen.findByRole('tablist', { name: 'Wallet Operations' });
    fireEvent.click(await within(tabs).findByRole('tab', { name: 'Mint' }));
    expect(await screen.findByRole('tabpanel', { name: 'Mint' })).toBeVisible();
    fireEvent.click(send);
    expect(within(tabs).getByRole('tab', { name: 'Send' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    const sendPanel = screen.getByRole('tabpanel', { name: 'Send' });
    const amounts = within(sendPanel).getByRole('group', { name: 'Send Amount Presets' });
    expect(
      within(amounts)
        .getAllByRole('button')
        .map((button) => button.textContent)
    ).toEqual(['100', '500', '1,000', '5,000', 'Max']);
    fireEvent.click(within(amounts).getByRole('button', { name: 'Max' }));
    expect(within(sendPanel).getByRole('textbox', { name: 'Amount' })).toHaveValue('500');
    expect(screen.getByLabelText('Current Address').textContent).toBe(
      '/clubs/' + fixture.club + '/cashier?table=77&origin=menu&walletTools=open#seat'
    );
    fireEvent.click(within(actions).getByRole('button', { name: 'History' }));
    expect(screen.getByLabelText('Current Address').textContent).toBe(
      '/clubs/' + fixture.club + '/cashier?table=77&origin=menu#seat'
    );
  });

  it('keeps player wallet permissions after opening the embedded controls from the normal desk', async () => {
    fixture.role = 'player';
    mount('/clubs/' + fixture.club + '/cashier?origin=directory');
    fireEvent.click(await screen.findByRole('button', { name: /^Requests, Tickets And Tools/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Wallet Operations' }));
    const tabs = await screen.findByRole('tablist', { name: 'Wallet Operations' });
    const history = await within(tabs).findByRole('tab', { name: 'History' });
    expect(tabs).not.toHaveAttribute('aria-busy', 'true');
    const mast = screen.getByRole('heading', { level: 1, name: 'Cashier' }).closest('header')!;
    expect(within(mast).getByText('Club Wallets')).toBeVisible();
    expect(within(tabs).queryByRole('tab', { name: 'Mint' })).toBeNull();
    expect(within(tabs).queryByRole('tab', { name: 'Distribute' })).toBeNull();
    fireEvent.click(history);
    expect(await screen.findByRole('tabpanel', { name: 'History' })).toBeVisible();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByLabelText('Current Address')).toHaveTextContent('origin=directory');
    const actions = screen.getByRole('tablist', { name: 'Cashier Actions' });
    expect(within(actions).queryByRole('tab', { selected: true })).toBeNull();
    for (const tab of within(actions).getAllByRole('tab')) {
      expect(tab).not.toHaveAttribute('aria-controls');
    }
    const firstAction = within(actions).getAllByRole('tab')[0];
    firstAction.focus();
    fireEvent.keyDown(firstAction, { key: 'Home' });
    expect(firstAction).toHaveFocus();
    expect(firstAction).toHaveAttribute('aria-selected', 'true');
    const firstPanel = screen.getByRole('tabpanel', { name: 'Transaction History' });
    expect(firstAction).toHaveAttribute('aria-controls', firstPanel.id);
    expect(firstPanel).toHaveAttribute('aria-labelledby', firstAction.id);
    for (const tab of within(actions).getAllByRole('tab', { selected: false })) {
      expect(tab).not.toHaveAttribute('aria-controls');
    }
    expect(screen.queryByRole('tablist', { name: 'Wallet Operations' })).toBeNull();
  });
  it('keeps Wallet Operations control references valid across opening and closing the panel', async () => {
    mount('/clubs/' + fixture.club + '/cashier');
    const actions = await screen.findByRole('group', { name: 'Wallet Actions' });
    const send = within(actions).getByRole('button', { name: 'Send' });
    const mast = screen.getByRole('heading', { level: 1, name: 'Cashier' }).closest('header')!;
    expect(mast.querySelector('small')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Cashier Tools' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Page Help' })).toBeVisible();
    const panelId = 'cashier-wallet-operations';
    const expectValidReferences = () => {
      for (const button of document.querySelectorAll(`button[aria-controls="${panelId}"]`)) {
        expect(document.getElementById(button.getAttribute('aria-controls')!)).not.toBeNull();
      }
    };
    expectValidReferences();
    fireEvent.click(screen.getByRole('button', { name: /^Requests, Tickets And Tools/ }));
    const wallet = await screen.findByRole('button', { name: 'Wallet Operations' });
    expect(wallet).toHaveAttribute('aria-expanded', 'false');
    expectValidReferences();
    fireEvent.click(send);
    const panel = await screen.findByRole('region', { name: 'Wallet Operations' });
    expect(panel.id).toBe(panelId);
    expect(send).toHaveAttribute('aria-controls', panel.id);
    expect(wallet).toHaveAttribute('aria-controls', panel.id);
    expect(wallet).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(wallet);
    expect(screen.queryByRole('region', { name: 'Wallet Operations' })).toBeNull();
    expectValidReferences();
  });
});
