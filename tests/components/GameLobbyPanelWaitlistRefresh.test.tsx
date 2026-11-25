import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { WaitlistEntry } from '../../src/services/WaitlistService';

const mocks = vi.hoisted(() => ({
  waitlist: vi.fn(),
  gameLobby: vi.fn(),
  tick: vi.fn(),
  seats: vi.fn(
    async (): Promise<{ data: { seat_number: number; user_id: string }[]; error: null }> => ({
      data: [],
      error: null,
    })
  ),
  averagePot: vi.fn(async () => null),
}));
vi.mock('../../src/services/cashGameLobby', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/cashGameLobby')>()),
  fetchCashGameLobby: mocks.gameLobby,
}));
vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ is: mocks.seats, maybeSingle: mocks.tick }) }) }),
  },
}));
vi.mock('../../src/services/AvatarService', () => ({
  avatarService: { getUserAvatars: vi.fn(async () => new Map()) },
}));
vi.mock('../../src/services/WaitlistService', () => ({
  waitlistService: { getTableWaitlist: mocks.waitlist },
}));
vi.mock('../../src/services/TableService', () => ({
  tableService: { getAveragePot: mocks.averagePot },
}));
vi.mock('../../src/services/TournamentService', () => ({
  tournamentService: { getTournament: vi.fn(async () => null) },
}));
vi.mock('../../src/components/lobby/game-cards/ArenaGameCard', () => ({
  default: () => null,
}));
import GameLobbyPanel from '../../src/components/lobby/GameLobbyPanel';
import { cashEntry } from '../../src/components/lobby/lobbyEntries';

const entry = cashEntry({
  id: 'cash-table',
  name: 'Waitlist Test',
  game_variant: 'nlh',
  small_blind: 1,
  big_blind: 2,
  min_buy_in: 40,
  max_buy_in: 200,
  current_players: 6,
  max_players: 6,
  status: 'active',
});
const queued = {
  id: 'queue-row',
  tableId: entry.id,
  userId: 'hero',
  status: 'waiting',
  createdAt: '2026-09-10T00:00:00Z',
  joinedAt: '2026-09-10T00:00:00Z',
  notifiedAt: null,
  position: 1,
  tableName: entry.name,
  table: null,
  tableVariant: '',
  tableStakes: '',
  displayName: 'Hero',
  holdExpiresAt: null,
} satisfies WaitlistEntry;
const callbacks = {
  onClose: vi.fn(),
  onJoinTable: vi.fn(),
  onWaitlistToggle: vi.fn(),
  onRegister: vi.fn(),
  onUnregister: vi.fn(),
  onSpinJoin: vi.fn(),
};

function drawer(waitlisted: boolean, busy = false, selected = entry, staff = false) {
  return (
    <MemoryRouter>
      <GameLobbyPanel
        entry={selected}
        clubId="club"
        currentUserId="hero"
        waitlisted={waitlisted}
        busy={busy}
        staff={staff}
        seated={false}
        registered={false}
        {...callbacks}
      />
    </MemoryRouter>
  );
}
const waitingCount = () => screen.getByText('Waiting', { exact: true }).nextElementSibling;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.waitlist.mockReset().mockResolvedValue([]);
  mocks.gameLobby.mockReset();
});

describe('the open game drawer follows a settled waitlist change', () => {
  it.each([false, true])(
    'refreshes after a successful %s membership change',
    async (wasWaitlisted) => {
      const before = wasWaitlisted ? [queued] : [];
      const after = wasWaitlisted ? [] : [queued];
      mocks.waitlist.mockResolvedValueOnce(before).mockResolvedValueOnce(after);
      const view = render(drawer(wasWaitlisted));
      await waitFor(() => expect(waitingCount()).toHaveTextContent(String(before.length)));
      await act(async () => {});
      view.rerender(drawer(!wasWaitlisted, true));
      expect(mocks.waitlist).toHaveBeenCalledTimes(1);
      expect(waitingCount()).toHaveTextContent(String(before.length));
      view.rerender(drawer(!wasWaitlisted, false));
      await waitFor(() => expect(waitingCount()).toHaveTextContent(String(after.length)));
      expect(mocks.waitlist).toHaveBeenCalledTimes(2);
      expect(mocks.averagePot).toHaveBeenCalledTimes(1);
      if (wasWaitlisted) expect(screen.queryByText('You', { exact: true })).toBeNull();
      else expect(screen.getByText('You', { exact: true })).toBeInTheDocument();
    }
  );

  it('keeps the confirmed queue when an optimistic leave is refused', async () => {
    mocks.waitlist.mockResolvedValue([queued]);
    const view = render(drawer(true));
    await waitFor(() => expect(waitingCount()).toHaveTextContent('1'));
    view.rerender(drawer(false, true));
    view.rerender(drawer(true, false));
    await act(async () => {});
    expect(waitingCount()).toHaveTextContent('1');
    expect(screen.getByText('You', { exact: true })).toBeInTheDocument();
    expect(mocks.waitlist).toHaveBeenCalledTimes(1);
  });

  it('retries an initial read retired by a pending action', async () => {
    let finishInitial!: (rows: WaitlistEntry[]) => void;
    mocks.waitlist
      .mockReturnValueOnce(
        new Promise<WaitlistEntry[]>((resolve) => {
          finishInitial = resolve;
        })
      )
      .mockResolvedValueOnce([queued]);
    const view = render(drawer(true));
    view.rerender(drawer(false, true));
    await act(async () => finishInitial([]));
    view.rerender(drawer(true, false));
    await waitFor(() => expect(waitingCount()).toHaveTextContent('1'));
    expect(mocks.waitlist).toHaveBeenCalledTimes(2);
  });

  it('shows an unknown queue if the settled-change refresh fails', async () => {
    mocks.waitlist.mockResolvedValueOnce([queued]).mockResolvedValueOnce(null);
    const view = render(drawer(true));
    await waitFor(() => expect(waitingCount()).toHaveTextContent('1'));
    view.rerender(drawer(false, true));
    view.rerender(drawer(false, false));
    await waitFor(() => expect(waitingCount()).toHaveTextContent('-'));
    expect(screen.queryByText('You', { exact: true })).toBeNull();
    mocks.waitlist.mockResolvedValueOnce([queued]);
    view.rerender(drawer(true, true));
    view.rerender(drawer(true, false));
    await waitFor(() => expect(waitingCount()).toHaveTextContent('1'));
    expect(mocks.waitlist).toHaveBeenCalledTimes(3);
  });
});

describe('cash drawer follows the queue and seats for the selected game', () => {
  it('waits for a confirmed count, updates on board changes, and uses actual positions past ten rows', async () => {
    let finish!: (rows: WaitlistEntry[]) => void;
    mocks.waitlist.mockReturnValueOnce(
      new Promise<WaitlistEntry[]>((resolve) => {
        finish = resolve;
      })
    );
    const view = render(drawer(false));
    expect(waitingCount()).toHaveTextContent('-');
    await act(async () => finish([]));
    expect(waitingCount()).toHaveTextContent('0');
    const rows = Array.from({ length: 12 }, (_, i) => ({
      ...queued,
      id: String(i),
      userId: String(i),
      displayName: 'Member ' + i,
      position: i,
      status: i === 0 ? 'notified' : 'waiting',
    }));
    mocks.waitlist.mockResolvedValueOnce(rows);
    view.rerender(
      drawer(false, false, cashEntry(entry.raw as Parameters<typeof cashEntry>[0], 12))
    );
    await waitFor(() => expect(waitingCount()).toHaveTextContent('11'));
    expect(screen.getByText('Member 0').closest('li')).toHaveTextContent('Seat Offered');
    expect(screen.getByText('Member 11').closest('li')?.firstElementChild).toHaveTextContent(
      /^11$/
    );
  });

  it('reads a clustered game queue by game ID and preserves totals beyond the returned names', async () => {
    const cluster = {
      ...entry,
      capacity: 0,
      game: { id: 'cash-cluster', mustMove: true, template: 'action', tables: 2, state: 'active' },
    };
    mocks.gameLobby.mockResolvedValueOnce({
      waitlist: { waiting: 32, players: [{ position: 1, user_id: 'visitor', alias: 'River Fox' }] },
    });
    render(drawer(false, false, cluster));
    await waitFor(() => expect(waitingCount()).toHaveTextContent('32'));
    expect(mocks.gameLobby).toHaveBeenCalledWith('cash-cluster');
    expect(mocks.waitlist).not.toHaveBeenCalled();
    expect(screen.getByText('River Fox')).toBeVisible();
  });

  it('shows the game-wide total when a lobby payload omits its named players', async () => {
    mocks.gameLobby.mockResolvedValue({ waitlist: { waiting: 17 } });
    render(
      drawer(false, false, {
        ...entry,
        capacity: 0,
        game: { id: 'legacy', mustMove: true, template: 'action', tables: 3, state: 'active' },
      })
    );
    await waitFor(() => expect(waitingCount()).toHaveTextContent('17'));
    expect(screen.queryByText('Waiting List')).toBeNull();
    expect(mocks.waitlist).not.toHaveBeenCalled();
  });

  it('clears occupied seats when a different table cannot be read', async () => {
    mocks.waitlist.mockResolvedValue([]);
    mocks.seats.mockResolvedValueOnce({
      data: [{ seat_number: 1, user_id: 'other' }],
      error: null,
    });
    const view = render(drawer(false));
    await screen.findByText('Taken');
    mocks.seats.mockRejectedValueOnce(new Error('seat read unavailable'));
    view.rerender(drawer(false, false, { ...entry, id: 'new-table' }));
    await waitFor(() => expect(mocks.seats).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Taken')).toBeNull();
    expect(screen.queryByText('Seat Map')).toBeNull();
  });
});

it('withdraws staff tick information when the next selected game cannot be read', async () => {
  const cluster = {
    ...entry,
    capacity: 0,
    game: { id: 'first', mustMove: true, template: 'action', tables: 2, state: 'active' },
  };
  mocks.gameLobby.mockResolvedValue({ waitlist: { waiting: 0 } });
  mocks.tick.mockResolvedValueOnce({
    data: { last_tick_at: new Date().toISOString(), last_tick_actions: null },
    error: null,
  });
  const view = render(drawer(false, false, cluster, true));
  await screen.findByTestId('glp-staff-tick');
  mocks.tick.mockRejectedValueOnce(new Error('tick unavailable'));
  view.rerender(
    drawer(false, false, { ...cluster, game: { ...cluster.game, id: 'second' } }, true)
  );
  await waitFor(() => expect(mocks.tick).toHaveBeenCalledTimes(2));
  expect(screen.queryByTestId('glp-staff-tick')).toBeNull();
});

it('reconciles a same-size queue and occupied seat when returning to the open drawer', async () => {
  mocks.waitlist
    .mockResolvedValueOnce([{ ...queued, userId: 'a', displayName: 'First Member' }])
    .mockResolvedValueOnce([{ ...queued, userId: 'b', displayName: 'Second Member' }]);
  mocks.seats
    .mockResolvedValueOnce({ data: [{ seat_number: 2, user_id: 'other' }], error: null })
    .mockResolvedValueOnce({ data: [{ seat_number: 3, user_id: 'hero' }], error: null });
  render(drawer(false));
  await screen.findByText('First Member');
  await screen.findByText('Taken');
  fireEvent.focus(window);
  await screen.findByText('Second Member');
  expect(screen.queryByText('First Member')).toBeNull();
  expect(screen.getByText('You').closest('.glp__seat')?.querySelector('i')).toHaveTextContent('3');
});

it('recovers a failed read with an unchanged board count on the next visible refresh', async () => {
  mocks.waitlist.mockResolvedValueOnce(null).mockResolvedValueOnce([queued]);
  render(drawer(true));
  await act(async () => {});
  expect(waitingCount()).toHaveTextContent('-');
  fireEvent.focus(window);
  await waitFor(() => expect(waitingCount()).toHaveTextContent('1'));
});
