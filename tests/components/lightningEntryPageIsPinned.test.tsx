/**
 * THE LIGHTNING ENTRY IS PINNED BEFORE ITS FRAME MOVES
 * (#SmarterDesign batch D1, 2026-11-28)
 *
 * /lightning/:clusterId is moving from a flat sheet of EmptyState boxes to the
 * arena workspace; the approved Lightning cash-game card itself does not
 * change. The condition on a page that takes a buy-in: no stake, buy-in
 * range, player count, word, data hook, live region or control (with its name
 * and state) may change, and Join keeps its behaviour. This renders the real
 * page with the same synthetic database the route's own tests use and pins it
 * (tests/helpers/reflowedSurfacePin.ts) in every state it shows: a broken
 * link, the read failed, a held seat, the entry open, joins closed by an
 * operator, and a closed Cluster.
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reflowedSurfacePin } from '../helpers/reflowedSurfacePin';

const CLUSTER = '22222222-2222-4222-8222-222222222222';
const ANCHOR = '33333333-3333-4333-8333-333333333333';

const rpc = vi.fn();
const metadataRead = vi.fn();
const gameRow = {
  id: CLUSTER,
  club_id: null,
  name: 'NLH 1/2 Action',
  template_name: 'action',
  variant: 'nlh',
  sb: 1,
  bb: 2,
  min_buy_in: 40,
  max_buy_in: 200,
  handedness: 6,
  cluster_mode: 'lightning',
  enabled: true,
};
vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]) =>
      a[0] === 'fn_entry_purchases_frozen'
        ? Promise.resolve({ data: null, error: { message: 'guard not read in this test' } })
        : a[0] === 'fn_maintenance_break_state'
          ? Promise.resolve({ data: [], error: null })
          : rpc(...a),
    from: () => {
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq']) chain[m] = () => chain;
      chain.maybeSingle = () => metadataRead();
      return chain;
    },
  },
}));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('../../src/services/tableWarmup', () => ({
  warmTable: vi.fn(),
  warmLightningRoom: vi.fn(),
}));
const toast = { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() };
vi.mock('../../src/components/common/Toast', () => ({ useToast: () => toast }));
vi.mock('../../src/services/SoundService', () => ({
  haptic: vi.fn(),
  soundService: { playBuyInConfirm: vi.fn(), playButtonClick: vi.fn() },
}));

import LightningEntryPage from '../../src/pages/LightningEntryPage';
import { __resetEntryFreezeForTests } from '../../src/hooks/useEntryFreeze';
import { resetLightningRegistryForTests } from '../../src/lightning/lightningSession';

const POOL_OPEN = {
  players: 21,
  status: 'ACTIVE',
  joinable: true,
  joins_enabled: true,
  draining: false,
  multi_table_limit: { mobile: 2, tablet: 3, desktop: 4 },
};

function answer(session: unknown, pool: unknown = POOL_OPEN) {
  rpc.mockImplementation(async (name: string) =>
    name === 'fn_lightning_my_session'
      ? { data: session, error: null }
      : name === 'fn_lightning_pool_status'
        ? { data: pool, error: null }
        : { data: null, error: null }
  );
}

const NO_SESSION = { pool_session_id: null, state: null, cluster_mode: 'lightning' };

function pinFile(name: string) {
  return `./__pins__/lightning-entry-${name}.pin.txt`;
}

function pin(container: HTMLElement): string {
  return `${JSON.stringify(reflowedSurfacePin(container), null, 2)}\n`;
}

function mount(id = CLUSTER) {
  return render(
    <MemoryRouter initialEntries={[`/lightning/${id}`]}>
      <Routes>
        <Route path="/lightning/:clusterId" element={<LightningEntryPage />} />
      </Routes>
    </MemoryRouter>
  );
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 30; i++) await Promise.resolve();
  });
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  resetLightningRegistryForTests();
  __resetEntryFreezeForTests();
  rpc.mockReset();
  metadataRead.mockReset().mockResolvedValue({ data: gameRow, error: null });
  answer(NO_SESSION);
});

afterEach(cleanup);

describe('the Lightning entry prints the same stakes, words and controls', () => {
  it('a broken link', async () => {
    const { container } = mount('not-a-cluster');
    await screen.findByText('Game Unavailable');
    await expect(pin(container)).toMatchFileSnapshot(pinFile('invalid'));
  });

  it('the read failed', async () => {
    rpc.mockRejectedValue(new Error('down'));
    const { container } = mount();
    await screen.findByRole('button', { name: 'Try Again' });
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('failed'));
  });

  it('a seat already held while the Cluster runs as Lightning', async () => {
    answer({ pool_session_id: null, seat_table_id: ANCHOR, cluster_mode: 'lightning' });
    const { container } = mount();
    await screen.findByText('NLH 1/2 Action');
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('seat'));
  });

  it('the entry open', async () => {
    const { container } = mount();
    await screen.findByRole('button', { name: 'Join Lightning' });
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('open'));
  });

  it('joins closed by an operator', async () => {
    answer(NO_SESSION, { ...POOL_OPEN, joinable: false, joins_enabled: false });
    const { container } = mount();
    await screen.findByTestId('lightning-entry-why');
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('joins-closed'));
  });

  it('a closed Cluster', async () => {
    metadataRead.mockResolvedValue({ data: { ...gameRow, enabled: false }, error: null });
    const { container } = mount();
    await screen.findByRole('button', { name: 'Join Lightning' });
    await settle();
    expect(
      (screen.getByRole('button', { name: 'Join Lightning' }) as HTMLButtonElement).disabled
    ).toBe(true);
    await expect(pin(container)).toMatchFileSnapshot(pinFile('closed'));
  });

  it('keeps the route hook and prints nothing in it while it resolves', async () => {
    rpc.mockReturnValue(new Promise(() => {}));
    mount();
    const page = screen.getByTestId('lightning-entry');
    expect(page.getAttribute('aria-busy')).toBe('true');
    expect(page.textContent).toBe('');
  });
});
