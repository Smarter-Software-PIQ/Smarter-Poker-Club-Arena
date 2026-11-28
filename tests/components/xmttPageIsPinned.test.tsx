/**
 * THE XMTT LOBBY PAGE IS PINNED BEFORE ITS FRAME MOVES
 * (#SmarterDesign Batch T2, 2026-11-28)
 *
 * /xmtt is moving from five painted SpadeConsoles onto the arena workspace
 * language. Every figure, word, data hook (`[data-tournament-id]`,
 * `[data-xmtt-total]`), exact `Load More` button label, named region and
 * control state is recorded against origin/main and held unchanged after.
 */
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { surfacePin } from '../helpers/surfacePin';

const state = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  total: 0 as number | null,
  counts: { registering: 0, running: 0, completed: 0 } as Record<string, number>,
  hasMore: false,
  pending: false,
  loading: false,
  error: null as string | null,
  positions: {} as Record<string, number | null>,
  waitlistFail: false,
  detailTournament: null as Record<string, unknown> | null,
  detailRegs: [] as Array<Record<string, unknown>>,
  refresh: vi.fn(),
  loadMore: vi.fn(),
  register: vi.fn(),
  unregister: vi.fn(),
  leaveWaitlist: vi.fn(),
}));

vi.mock('../../src/hooks/useAuthUser', () => ({
  useAuthUser: () => ({ user: { id: 'player-1', username: 'Hero' }, loading: false }),
}));
vi.mock('../../src/hooks/usePlayerPreference', () => ({
  usePlayerPreference: <T,>(_key: string, initial: T) => useState<T>(initial),
}));
vi.mock('../../src/hooks/useXmttLobby', () => ({
  useXmttLobby: () => ({
    clubId: 'club-1',
    rows: state.rows,
    total: state.total,
    counts: state.counts,
    hasMore: state.hasMore,
    pending: state.pending,
    loading: state.loading,
    error: state.error,
    refresh: state.refresh,
    loadMore: state.loadMore,
  }),
}));
vi.mock('../../src/services/xmttLobbyReads', () => ({
  readXmttWaitlistPositions: vi.fn(async (ids: string[]) => {
    if (state.waitlistFail) throw new Error('offline');
    return Object.fromEntries(ids.map((id) => [id, state.positions[id] ?? null]));
  }),
}));
vi.mock('../../src/hooks/useTournamentRegistration', () => ({
  useTournamentRegistration: () => ({ register: state.register, isRegistering: false }),
}));
vi.mock('../../src/hooks/useVisibilityRefresh', () => ({ useVisibilityRefresh: vi.fn() }));
vi.mock('../../src/core/MasterBus', () => ({
  masterBus: { subscribeDebounced: vi.fn(() => () => {}) },
}));
vi.mock('../../src/components/common/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
}));
vi.mock('../../src/components/common/PageSkeleton', () => ({
  default: () => <div role="status" aria-label="Loading content" />,
}));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('../../src/services/TournamentService', () => ({
  tournamentService: {
    unregisterPlayer: (...args: unknown[]) => state.unregister(...args),
    leaveTournamentWaitlist: (...args: unknown[]) => state.leaveWaitlist(...args),
  },
  tournamentUnregisterSuccessText: () => 'Unregistered',
}));
vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.maybeSingle = () =>
        Promise.resolve({
          data: table === 'tournaments' ? state.detailTournament : null,
          error: null,
        });
      chain.then = (resolve: (value: unknown) => unknown) =>
        Promise.resolve({
          data: table === 'tournament_players' ? state.detailRegs : [],
          error: null,
        }).then(resolve);
      return chain;
    },
  },
}));

import XMTTPage from '../../src/pages/XMTTPage';

const SAMPLE_ROWS = [
  {
    format_contract: 'mtt-v1',
    id: 'xmtt-1',
    name: 'Sunday Major XMTT',
    status: 'registering',
    type: 'XMTT',
    buy_in: 100,
    buy_in_fee: 10,
    max_players: 500,
    registered_count: 124,
    start_time: '2026-12-01T18:00:00.000Z',
    created_at: '2026-11-28T10:00:00.000Z',
    prize_pool: 12400,
    guaranteed_prize: 25000,
  },
  {
    format_contract: 'mtt-v1',
    id: 'xmtt-2',
    name: 'Waitlisted Turbo',
    status: 'registering',
    type: 'XMTT',
    buy_in: 50,
    buy_in_fee: 5,
    max_players: null,
    registered_count: 42,
    start_time: '2026-12-01T20:00:00.000Z',
    created_at: '2026-11-28T10:00:00.000Z',
    prize_pool: 2100,
  },
  {
    format_contract: 'mtt-v1',
    id: 'xmtt-3',
    name: 'Live Deepstack',
    status: 'running',
    type: 'XMTT',
    buy_in: 200,
    buy_in_fee: 20,
    max_players: 200,
    registered_count: 88,
    start_time: '2026-11-28T16:00:00.000Z',
    created_at: '2026-11-28T09:00:00.000Z',
    prize_pool: 17600,
  },
];

function pinFile(name: string) {
  return `./__pins__/xmtt-${name}.pin.txt`;
}

function pin(container: HTMLElement): string {
  return `${JSON.stringify(surfacePin(container), null, 2)}\n`;
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  });
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/xmtt?club=club-1']}>
      <XMTTPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  state.rows = SAMPLE_ROWS;
  state.total = 75;
  state.counts = { registering: 40, running: 15, completed: 20 };
  state.hasMore = true;
  state.pending = false;
  state.loading = false;
  state.error = null;
  state.positions = { 'xmtt-2': 4 };
  state.waitlistFail = false;
  state.detailTournament = SAMPLE_ROWS[0];
  state.detailRegs = [
    { user_id: 'u-1', profiles: { alias: 'AceHigh', username: 'acehigh' }, chips: 15000 },
    { user_id: 'u-2', profiles: { alias: 'RiverRat', username: 'riverrat' }, chips: 12500 },
  ];
});

afterEach(cleanup);

describe('XMTTPage prints the same figures, words, data hooks and controls', () => {
  it('loading state', async () => {
    state.loading = true;
    const { container } = renderPage();
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('loading'));
  });

  it('ready list with waitlist position and Load More', async () => {
    const { container } = renderPage();
    await settle();
    expect(container.querySelector('[data-xmtt-total]')?.getAttribute('data-xmtt-total')).toBe(
      '75'
    );
    expect(container.querySelectorAll('[data-tournament-id]')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Load More', exact: true })).toBeInTheDocument();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('ready'));
  });

  it('selected tournament detail with registered players', async () => {
    const { container } = renderPage();
    await settle();
    fireEvent.click(container.querySelector('[data-tournament-id="xmtt-1"]')!);
    await screen.findByText('AceHigh');
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('detail'));
  });

  it('empty state', async () => {
    state.rows = [];
    state.total = 0;
    state.counts = { registering: 0, running: 0, completed: 0 };
    state.hasMore = false;
    state.positions = {};
    const { container } = renderPage();
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('empty'));
  });

  it('error state with failed lobby and waitlist reads', async () => {
    state.error = 'Tournament List Unavailable.';
    state.waitlistFail = true;
    state.hasMore = false;
    const { container } = renderPage();
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('error'));
  });
});
