/**
 * Player Management, Active Now live (Dan, 2026-11-12): the Live Now strip
 * pins every seated member above the roster, a seated row names its table
 * and opens the observer view from it, and the loaded rows re-rank as the
 * seat and presence answers arrive, without a roster re-read.
 */
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { LiveSeat } from '../../src/lib/clubLiveSeats';

const f = vi.hoisted(() => ({
  actor: { user: { id: '00000000-0000-0000-0000-000000000042' } },
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
  page: vi.fn(),
  summary: vi.fn(),
  period: vi.fn(),
  navigate: vi.fn(),
  seatListener: null as null | ((byUser: Map<string, unknown[]>, seats: unknown[]) => void),
  presenceListener: null as null | ((answer: Map<string, boolean>) => void),
  watchAccess: vi.fn(),
}));
vi.mock('../../src/services/ClubRosterService', () => ({
  default: { getRosterPage: f.page, getSummary: f.summary, getMembersWinLoss: f.period },
}));
vi.mock('../../src/hooks/useAuthUser', () => ({ useAuthUser: () => f.actor }));
vi.mock('../../src/hooks/useMasterBusSubscription', () => ({ useMasterBusSubscriptions: () => {} }));
vi.mock('../../src/hooks/useMasterBusChannel', () => ({ useMasterBusChannel: () => {} }));
vi.mock('../../src/hooks/useMasterBusBroadcastChannel', () => ({
  useMasterBusBroadcastChannel: () => {},
}));
vi.mock('../../src/components/common/Toast', () => ({ useToast: () => f.toast }));
vi.mock('../../src/utils/strictClubIdResolver', () => ({
  resolveClubUUIDStrict: async () => '00000000-0000-0000-0000-000000000043',
  ClubNotFoundError: class extends Error {},
}));
vi.mock('../../src/lib/clubLiveSeats', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/clubLiveSeats')>();
  return {
    ...actual,
    watchClubLiveSeats: (_club: string, listener: typeof f.seatListener) => {
      f.seatListener = listener;
      return () => {
        f.seatListener = null;
      };
    },
    recheckClubLiveSeats: () => {},
  };
});
vi.mock('../../src/lib/profilePresence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/profilePresence')>();
  return {
    ...actual,
    watchProfilePresence: (_ids: string[], listener: typeof f.presenceListener) => {
      f.presenceListener = listener;
      return () => {
        f.presenceListener = null;
      };
    },
  };
});
vi.mock('../../src/services/PlayerSearchService', () => ({
  PlayerSearchService: { getTableWatchAccess: f.watchAccess },
}));
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => f.navigate };
});

import ClubMembersPage from '../../src/pages/ClubMembersPage';

const row = (user_id: string, alias: string, extra: Record<string, unknown> = {}) => ({
  user_id,
  alias,
  username: alias.toLowerCase(),
  role: 'player',
  can_view_financials: false,
  can_view_notes: false,
  downline_total: null,
  total_fees: null,
  is_seated: false,
  is_online: false,
  last_login: null,
  joined_at: '2026-11-01T00:00:00Z',
  ...extra,
});
const seat = (user_id: string, alias: string, name: string): LiveSeat => ({
  user_id,
  table_id: `table-${user_id}`,
  tournament_id: null,
  name,
  stakes: '1/2',
  is_tournament: false,
  alias,
  username: alias.toLowerCase(),
  avatar_url: null,
});

beforeEach(() => {
  vi.useFakeTimers();
  f.page.mockReset();
  f.summary.mockReset();
  f.navigate.mockReset();
  f.watchAccess.mockReset();
  f.toast.error.mockReset();
  f.period.mockResolvedValue(new Map());
  f.seatListener = null;
  f.presenceListener = null;
  sessionStorage.clear();
  localStorage.clear();
  f.summary.mockResolvedValue({
    viewer_role: 'owner',
    capabilities: {
      can_view_financials: false,
      can_export: false,
      can_manage_members: false,
      can_view_notes: false,
    },
    counts: { total: 3, online: 0, seated: 0, agents: 0, admins: 0 },
    data_version: null,
    page_size: 80,
  });
  /* Served in the Active Now order: nobody live, Amy last active most recently. */
  f.page.mockResolvedValue({
    items: [
      row('u-amy', 'Amy', { last_login: '2026-11-12T12:00:00Z' }),
      row('u-bob', 'Bob', { last_login: '2026-11-12T11:00:00Z' }),
      row('u-cal', 'Cal', { last_login: '2026-11-12T10:00:00Z' }),
    ],
    next_cursor: null,
    has_more: false,
    filtered_total: 3,
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function open() {
  render(
    <MemoryRouter initialEntries={['/clubs/kings-club/members']}>
      <Routes>
        <Route path="/clubs/:clubId/members" element={<ClubMembersPage />} />
      </Routes>
    </MemoryRouter>
  );
  await act(async () => {});
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
}

const names = () =>
  within(screen.getByRole('list', { name: 'Club Member Directory' }))
    .getAllByRole('listitem')
    .map((item) => item.querySelector('.member-alias')?.textContent);

it('re-ranks the loaded roster when a player sits down or comes online, with no roster re-read', async () => {
  await open();
  expect(names()).toEqual(['Amy', 'Bob', 'Cal']);
  expect(f.page).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('region', { name: 'Live Now' })).not.toBeInTheDocument();

  act(() => {
    f.presenceListener?.(new Map([['u-cal', true]]));
  });
  expect(names()).toEqual(['Cal', 'Amy', 'Bob']);

  const bobSeat = seat('u-bob', 'Bob', 'Midnight Cash');
  act(() => {
    f.seatListener?.(new Map([['u-bob', [bobSeat]]]), [bobSeat]);
  });
  expect(names()).toEqual(['Bob', 'Cal', 'Amy']);
  expect(f.page).toHaveBeenCalledTimes(1);

  const strip = screen.getByRole('region', { name: 'Live Now' });
  expect(within(strip).getByRole('listitem')).toHaveAccessibleName(
    'Watch Bob At Table, Midnight Cash'
  );
  expect(screen.getByRole('button', { name: 'Open Bob, Player, At A Table' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Watch At Table, Midnight Cash' })).toHaveTextContent(
    'Midnight Cash · 1/2'
  );
});

it('opens the observer view from the row chip after revalidating access, and reports a seat that is gone', async () => {
  await open();
  const bobSeat = seat('u-bob', 'Bob', 'Midnight Cash');
  act(() => {
    f.seatListener?.(new Map([['u-bob', [bobSeat]]]), [bobSeat]);
  });
  f.watchAccess.mockResolvedValueOnce({ can_watch: true, found: true });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Watch At Table, Midnight Cash' }));
  });
  expect(f.watchAccess).toHaveBeenCalledWith('table-u-bob', 'u-bob');
  expect(f.navigate).toHaveBeenCalledWith('/table/table-u-bob?observer=1');
  // The chip opened the table, not the player record.
  expect(f.navigate).toHaveBeenCalledTimes(1);

  f.watchAccess.mockResolvedValueOnce({ can_watch: false, found: false });
  await act(async () => {
    fireEvent.click(screen.getByRole('listitem', { name: 'Watch Bob At Table, Midnight Cash' }));
  });
  expect(f.toast.error).toHaveBeenCalledWith('This Player Has Left The Table.');
  expect(f.navigate).toHaveBeenCalledTimes(1);
});
