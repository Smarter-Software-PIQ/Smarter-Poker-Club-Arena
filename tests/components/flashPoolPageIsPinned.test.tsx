/**
 * THE FLASH POOL PAGE IS PINNED BEFORE ITS FRAME MOVES
 * (#SmarterDesign batch D1, 2026-11-28)
 *
 * /flash-pool is moving from inline-styled flat boxes to the arena workspace.
 * The page is parked (Dan 2026-10-16/17: fast-fold play is Lightning only) and
 * its Play key never moves a chip, but it still prints stakes, buy-in ranges
 * and the player's club balance. The condition: no figure, word, data hook,
 * live region or control (with its name, state and field limits) may change,
 * and Play keeps saying the pools are not open. This renders the real page
 * with a synthetic pool read and pins it (tests/helpers/reflowedSurfacePin.ts)
 * in every state it shows after loading: no pools, pools with a balance, and
 * pools for a signed-out reader.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reflowedSurfacePin } from '../helpers/reflowedSurfacePin';

const mocks = vi.hoisted(() => ({
  pools: [] as unknown[],
  balance: 12345.5 as number | null,
  user: { id: 'viewer' } as { id: string } | null,
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in']) chain[m] = () => chain;
      chain.order = () => Promise.resolve({ data: mocks.pools, error: null });
      chain.maybeSingle = () =>
        Promise.resolve({
          data: table === 'club_members' ? { chip_balance: mocks.balance } : null,
          error: null,
        });
      return chain;
    },
  },
}));
vi.mock('../../src/core/MasterBus', () => {
  const channel = { on: () => channel, subscribe: () => channel };
  return {
    masterBus: {
      getOrCreateChannel: () => channel,
      removeRegisteredChannel: () => undefined,
      subscribeDebounced: () => () => undefined,
    },
  };
});
vi.mock('../../src/hooks/useAuthUser', () => ({ useAuthUser: () => ({ user: mocks.user }) }));
vi.mock('../../src/components/common/Toast', () => ({ useToast: () => mocks.toast }));
vi.mock('../../src/hooks/useVisibilityRefresh', () => ({ useVisibilityRefresh: () => undefined }));
vi.mock('../../src/utils/resolvePageClubId', () => ({
  resolvePageClubId: async () => 'kings-club-id',
}));
vi.mock('../../src/utils/errorReporter', () => ({
  reportError: () => undefined,
  reportWarning: () => undefined,
}));

import FlashPoolPage from '../../src/pages/FlashPoolPage';

const POOLS = [
  {
    id: 'pool-a',
    small_blind: 1,
    big_blind: 2,
    active_players: 18,
    tables_running: 3,
    buy_in_min: 80,
    buy_in_max: 400,
    status: 'active',
  },
  {
    id: 'pool-b',
    small_blind: 5,
    big_blind: 10,
    active_players: 0,
    tables_running: 0,
    buy_in_min: null,
    buy_in_max: null,
    status: 'waiting',
  },
  {
    id: 'pool-c',
    small_blind: 25,
    big_blind: 50,
    active_players: 1250,
    tables_running: 210,
    buy_in_min: 2000,
    buy_in_max: 10000,
    status: 'closed',
  },
];

function pinFile(name: string) {
  return `./__pins__/flash-pool-${name}.pin.txt`;
}

function pin(container: HTMLElement): string {
  return `${JSON.stringify(reflowedSurfacePin(container), null, 2)}\n`;
}

function mount() {
  return render(
    <MemoryRouter initialEntries={['/flash-pool']}>
      <FlashPoolPage />
    </MemoryRouter>
  );
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pools = POOLS;
  mocks.balance = 12345.5;
  mocks.user = { id: 'viewer' };
});

afterEach(cleanup);

describe('the Flash Pool page prints the same stakes, words and controls', () => {
  it('no pools', async () => {
    mocks.pools = [];
    const { container } = mount();
    await screen.findByText('No Flash Pools Available Yet.');
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('empty'));
  });

  it('pools, with the club balance', async () => {
    const { container } = mount();
    await screen.findByText('1/2');
    await screen.findAllByText(/Your Balance/);
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('pools'));
  });

  it('pools, signed out', async () => {
    mocks.user = null;
    const { container } = mount();
    await screen.findByText('1/2');
    await settle();
    expect(screen.queryByText(/Your Balance/)).toBeNull();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('signed-out'));
  });

  it('Play never joins: it says the pools are not open, and a typed buy-in stays', async () => {
    const { container } = mount();
    await screen.findByText('1/2');
    const field = screen.getAllByPlaceholderText('Buy-In (80)')[0] as HTMLInputElement;
    fireEvent.change(field, { target: { value: '120' } });
    expect(field.value).toBe('120');
    fireEvent.click(screen.getAllByRole('button', { name: 'Play' })[0]);
    expect(mocks.toast.error).toHaveBeenCalledWith(
      'Flash Pools Are Not Open. Fast-Fold Play Is In Lightning Games.'
    );
    expect((screen.getByRole('button', { name: 'Closed' }) as HTMLButtonElement).disabled).toBe(
      true
    );
    expect(container.querySelectorAll('[data-flash-pools]')).toHaveLength(1);
  });

  it('keeps the page title and its way back', async () => {
    const { container } = mount();
    await screen.findByText('1/2');
    expect(container.textContent).toContain('Flash Pool');
    expect(screen.getByRole('button', { name: '← Back' })).toBeTruthy();
  });
});
