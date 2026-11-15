import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({
  navigate: vi.fn(),
  emit: vi.fn(),
  rows: [] as any[],
  gate: 'unavailable',
  stage: vi.fn(),
  route: null as string | null,
}));
vi.mock('react-router-dom', () => ({
  useNavigate: () => m.navigate,
  useLocation: () => ({ pathname: '/clubs/club' }),
  matchPath: () => (m.route ? { params: { tableId: m.route } } : null),
}));
vi.mock('../src/lib/visiblePokerTable', () => ({ useVisiblePokerTable: () => m.route }));
vi.mock('../src/hooks/useAuthUser', () => ({ useAuthUser: () => ({ user: { id: 'entrant' } }) }));
vi.mock('../src/hooks/useMasterBusSubscription', () => ({ useMasterBusSubscription: vi.fn() }));
vi.mock('../src/core/MasterBus', () => ({ masterBus: { emit: m.emit } }));
vi.mock('../src/services/tableWarmup', () => ({ warmTable: vi.fn() }));
vi.mock('../src/lib/supabase', () => ({
  supabase: {
    from: () => {
      const q: any = {
        select: () => q,
        eq: () => q,
        is: () => q,
        limit: async () => ({ data: m.rows, error: null }),
      };
      return q;
    },
  },
}));
vi.mock('../src/hooks/usePlatformCapability', () => ({ usePlatformCapability: () => m.gate }));
vi.mock('../src/services/TournamentStageService', () => ({ readTournamentStageView: m.stage }));
import TournamentAutoSeat from '../src/components/tournament/TournamentAutoSeat';
function seat(id: string, overrides = {}) {
  return {
    table_id: id,
    joined_at: new Date().toISOString(),
    tables: { tournament_id: 'event', status: 'running', name: 'Event' },
    ...overrides,
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  m.rows = [];
  m.gate = 'unavailable';
  m.route = null;
});
afterEach(cleanup);
it('opens and enters the fresh assigned tournament once, including after a remount', async () => {
  m.rows = [seat('assigned')];
  const view = render(<TournamentAutoSeat />);
  await waitFor(() =>
    expect(m.navigate).toHaveBeenCalledWith('/table/assigned', {
      state: { tournamentSeat: { tournamentId: 'event', lobbyTabId: null } },
    })
  );
  expect(m.emit).toHaveBeenCalledWith('TABLE_SEATED', {
    tableId: 'assigned',
    seat: 0,
    tournamentId: 'event',
  });
  view.unmount();
  render(<TournamentAutoSeat />);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(m.navigate).toHaveBeenCalledTimes(1);
});
it('does not redirect for cash games, old seats or closed tournaments', async () => {
  m.rows = [
    seat('cash', { tables: { tournament_id: null } }),
    seat('old', { joined_at: '2020-01-01' }),
    seat('closed', { tables: { tournament_id: 'event', status: 'closed' } }),
  ];
  render(<TournamentAutoSeat />);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(m.navigate).not.toHaveBeenCalled();
  expect(m.emit).not.toHaveBeenCalled();
});

it('does not select another table for the same admitted tournament', async () => {
  m.rows = [seat('first')];
  const view = render(<TournamentAutoSeat />);
  await waitFor(() => expect(m.navigate).toHaveBeenCalledTimes(1));
  view.unmount();
  m.rows = [seat('moved')];
  render(<TournamentAutoSeat />);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(m.emit).toHaveBeenCalledWith('TABLE_SEATED', {
    tableId: 'moved',
    seat: 0,
    tournamentId: 'event',
  });
  expect(m.navigate).toHaveBeenCalledTimes(1);
});
it('keeps later-day resumes in the background', async () => {
  m.gate = 'available';
  m.stage.mockResolvedValue({ status: 'ok', view: { currentStage: { stageNo: 2 } } });
  m.rows = [seat('day-two')];
  render(<TournamentAutoSeat />);
  await waitFor(() =>
    expect(m.emit).toHaveBeenCalledWith('TABLE_SEATED', {
      tableId: 'day-two',
      seat: 0,
      tournamentId: 'event',
    })
  );
  expect(m.navigate).not.toHaveBeenCalled();
});

it('Take My Seat on a blinded-off seat names its tournament, so a moved chair re-points its tab', async () => {
  // ONE TOURNAMENT, ONE CHAIR, ONE TAB (2026-11-14). Without the tournament the
  // multi-table layer cannot tell this seat is the chair it already shows.
  m.route = 'away-table';
  m.rows = [
    seat('away-table', {
      joined_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      is_sitting_out: true,
      stack: 1200,
    }),
  ];
  render(<TournamentAutoSeat />);
  fireEvent.click(await screen.findByRole('button', { name: 'Take My Seat' }));
  expect(m.emit).toHaveBeenCalledWith('TABLE_SEATED', {
    tableId: 'away-table',
    seat: 0,
    tournamentId: 'event',
  });
});
