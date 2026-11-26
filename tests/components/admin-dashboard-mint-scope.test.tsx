import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import AdminDashboardPage from '../../src/pages/AdminDashboardPage';

const m = vi.hoisted(() => ({ actor: 'owner1', role: 'owner', readScope: vi.fn() }));
vi.mock('../../src/hooks/useAuthUser', () => ({
  useAuthUser: () => ({ user: m.actor ? { id: m.actor } : null }),
}));
vi.mock('../../src/services/cashierMintScope', () => ({ readCashierMintScope: m.readScope }));
vi.mock('../../src/utils/resolvePageClubId', () => ({
  resolvePageClubId: ({ routeClubId }: { routeClubId: string }) => Promise.resolve(routeClubId),
  pickPreferredClubId: () => null,
}));

vi.mock('../../src/utils/unionScope', () => ({ clubGamesOrFilter: async () => 'test' }));
vi.mock('../../src/components/wallet/WalletCashierModal', () => ({
  default: ({
    clubId,
    role,
    walletType,
    onClose,
  }: {
    clubId: string;
    role: string;
    walletType: string;
    onClose: () => void;
  }) => (
    <section role="dialog" aria-label="Active Club Bank">
      {[clubId, role, walletType].join(' ')}
      <button onClick={onClose}>Leave Bank</button>
    </section>
  ),
}));
vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        or: () => query,
        gte: () => query,
        in: () => query,
        order: () => query,
        limit: () => query,
        maybeSingle: () => Promise.resolve({ data: { role: m.role }, error: null }),
        then: (done: (result: unknown) => unknown) =>
          Promise.resolve({ data: [], error: null, count: 0 }).then(done),
      };
      return query;
    },
  },
}));
function Route() {
  const navigate = useNavigate();
  return (
    <>
      <button onClick={() => navigate('/admin?club=member')}>Switch Club</button>
      <AdminDashboardPage />
    </>
  );
}
const app = (
  <MemoryRouter initialEntries={['/admin?club=solo']}>
    <Route />
  </MemoryRouter>
);
beforeEach(() => {
  m.actor = 'owner1';
  m.role = 'owner';
  m.readScope.mockReset();
});

it('opens only the verified standalone owner bank and closes it immediately on club or account change', async () => {
  let finishMember!: (value: null) => void;
  m.readScope.mockImplementation((id: string) =>
    id === 'solo'
      ? Promise.resolve('club')
      : new Promise<null>((resolve) => {
          finishMember = resolve;
        })
  );
  const view = render(app);
  fireEvent.click(await screen.findByRole('tab', { name: 'Club Bank' }));
  expect(screen.getByRole('dialog')).toHaveTextContent('solo owner club_bank');
  fireEvent.click(screen.getByRole('button', { name: 'Leave Bank' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Club Bank' }));
  fireEvent.click(screen.getByText('Switch Club'));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByRole('tab', { name: 'Club Bank' })).not.toBeInTheDocument();
  await screen.findByRole('tab', { name: 'Settings' });
  await act(async () => finishMember(null));
  expect(screen.queryByRole('tab', { name: 'Club Bank' })).not.toBeInTheDocument();
  m.role = 'owner';
  m.actor = 'owner2';
  m.readScope.mockResolvedValue('club');
  view.rerender(
    <MemoryRouter>
      <Route />
    </MemoryRouter>
  );
  fireEvent.click(await screen.findByRole('tab', { name: 'Club Bank' }));
  m.actor = '';
  view.rerender(
    <MemoryRouter>
      <Route />
    </MemoryRouter>
  );
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it.each([null, 'union'])(
  'keeps unrelated owner tools available with non-standalone mint scope %s',
  async (scope) => {
    m.readScope.mockResolvedValue(scope);
    render(app);
    expect(await screen.findByRole('tab', { name: 'Settings' })).toBeVisible();
    expect(screen.queryByRole('tab', { name: 'Club Bank' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Mint' })).not.toBeInTheDocument();
  }
);
it('keeps an admin outside the owner-only dashboard bank entry', async () => {
  m.role = 'admin';
  m.readScope.mockResolvedValue('club');
  render(app);
  expect(await screen.findByRole('tab', { name: 'Audit' })).toBeVisible();
  expect(screen.queryByRole('tab', { name: 'Club Bank' })).not.toBeInTheDocument();
  expect(m.readScope).not.toHaveBeenCalled();
});
