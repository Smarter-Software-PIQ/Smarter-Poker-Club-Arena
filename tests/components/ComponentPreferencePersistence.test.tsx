import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { VIPActivityHistory } from '../../src/components/vip/VIPActivityHistory';
import { useUserStore } from '../../src/stores/useUserStore';

const remote = vi.hoisted(() => ({ rows: new Map<string, unknown>(), revision: 0 }));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => {
        const keys: string[] = [];
        const query = {
          eq: (_column: string, value: string) => {
            keys.push(value);
            return query;
          },
          maybeSingle: async () => ({
            data: remote.rows.has(keys.join(':'))
              ? { value: remote.rows.get(keys.join(':')) }
              : null,
            error: null,
          }),
        };
        return query;
      },
    }),
    /* fn_save_page_preferences (2026-11-05): every write goes through the
       owner-only, revision-checked function, acting for the signed-in player. */
    rpc: async (fn: string, args: any) => {
      const { useUserStore } = await import('../../src/stores/useUserStore');
      const user = useUserStore.getState().user?.id;
      if (fn !== 'fn_save_page_preferences' || !user) return { data: null, error: { message: fn } };
      const c = args.p_changes[0];
      remote.rows.set(`${user}:${c.field}`, c.value);
      remote.revision += 1;
      return {
        data: {
          ok: true,
          results: [{ field: c.field, status: 'applied', revision: remote.revision, value: c.value }],
        },
        error: null,
      };
    },
  },
}));
const activity = [
  {
    id: 'earned',
    date: new Date('2026-10-01'),
    action: 'earned' as const,
    description: 'Daily reward',
    diamonds: 10,
    balanceAfter: 10,
  },
  {
    id: 'spent',
    date: new Date('2026-10-02'),
    action: 'spent' as const,
    description: 'Avatar purchase',
    diamonds: 5,
    balanceAfter: 5,
  },
];
const view = () => render(<VIPActivityHistory activities={activity} />);
const filters = () => within(screen.getByRole('group', { name: 'Filter Diamond Activity' }));
beforeEach(() => {
  localStorage.clear();
  remote.rows.clear();
  useUserStore.setState({ user: { id: 'component-player-a' } as any });
});
it('restores the selected activity filter from the account on a fresh device and isolates logout/login', async () => {
  const first = view();
  fireEvent.click(filters().getByRole('button', { name: /Diamonds Spent/ }));
  expect(screen.queryByText(/Daily Reward/i)).toBeNull();
  await waitFor(() =>
    expect(remote.rows.get('component-player-a:vipActivity.filter:global')).toBe('spent')
  );
  first.unmount();
  localStorage.clear(); // A second device has no preference cache or pending writes.
  const second = view();
  await waitFor(() =>
    expect(filters().getByRole('button', { name: /Diamonds Spent/ })).toHaveClass('active')
  );
  expect(screen.queryByText(/Daily Reward/i)).toBeNull();
  act(() => useUserStore.setState({ user: null }));
  await waitFor(() => expect(screen.getByText(/Daily Reward/i)).toBeTruthy());
  act(() => useUserStore.setState({ user: { id: 'component-player-b' } as any }));
  await waitFor(() => expect(screen.getByText(/Daily Reward/i)).toBeTruthy());
  act(() => useUserStore.setState({ user: { id: 'component-player-a' } as any }));
  await waitFor(() => expect(screen.queryByText(/Daily Reward/i)).toBeNull());
  second.unmount();
});
