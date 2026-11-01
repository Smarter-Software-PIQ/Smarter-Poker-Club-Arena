import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
const state = vi.hoisted(() => ({
  club: 'club-a',
  user: 'viewer-a',
  fail: false,
  hang: false,
  empty: false,
  reads: [] as Array<{ table: string; filters: Record<string, unknown>; signal?: AbortSignal }>,
  memberships: new Map<string, unknown>(),
}));
vi.mock('react-router-dom', async (original) => ({
  ...(await original<object>()),
  useParams: () => ({ clubId: state.club }),
}));
vi.mock('../../src/hooks/useAuthUser', () => ({
  useAuthUser: () => ({ user: { id: state.user } }),
}));
vi.mock('../../src/hooks/usePlayerPreference', () => ({
  usePlayerPreference: (_key: string, initial: unknown) => React.useState(initial),
}));
vi.mock('../../src/utils/clubIdResolver', () => ({ resolveClubUUID: async (id: string) => id }));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('../../src/hooks/useTournamentRegistration', () => ({
  useTournamentRegistration: () => ({ register: vi.fn() }),
}));
vi.mock('../../src/hooks/useTournamentStageView', () => ({ useTournamentStageViews: () => ({}) }));
vi.mock('../../src/components/common/Toast', () => ({ useToast: () => ({ error: vi.fn() }) }));
vi.mock('../../src/core/MasterBus', () => ({
  masterBus: { subscribeDebounced: () => () => {}, emit: vi.fn() },
}));
vi.mock('../../src/services/TournamentService', () => ({
  tournamentService: {},
  tournamentUnregisterSuccessText: () => '',
  TOURNAMENT_ARENA_EMBED: 'arena',
}));
vi.mock('../../src/services/diamondSpinCeilings', () => ({
  withDiamondSpinCeilings: async (rows: unknown) => rows,
}));
vi.mock('../../src/components/tournament/TournamentLobbyCard', () => ({
  default: ({ tournament, knownRegistration }: any) => (
    <div data-testid="event">
      {tournament.name}:{String(knownRegistration)}
    </div>
  ),
}));
vi.mock('../../src/components/rewards/RewardsSurfaceHeader', () => ({ default: () => null }));
vi.mock('../../src/components/club/ClubPageSection', () => ({
  ClubPageSection: ({ children, title }: any) => (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  ),
}));
vi.mock('../../src/components/skeletons/CardSkeleton', () => ({
  CardSkeleton: () => <span>Loading</span>,
}));
vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const read = {
        table,
        filters: {} as Record<string, unknown>,
        signal: undefined as AbortSignal | undefined,
      };
      const builder: any = {};
      for (const name of ['select', 'order', 'limit', 'lte', 'gt', 'or'])
        builder[name] = () => builder;
      builder.eq = (key: string, value: unknown) => {
        read.filters[key] = value;
        return builder;
      };
      builder.in = (key: string, value: unknown) => {
        read.filters[key] = value;
        return builder;
      };
      builder.abortSignal = (signal: AbortSignal) => {
        read.signal = signal;
        return builder;
      };
      const answer = () => {
        state.reads.push(read);
        if (table === 'union_clubs')
          return Promise.resolve(state.memberships.get(String(read.filters.club_id)) ?? null).then(
            (data) => ({ data, error: null })
          );
        if (table === 'tournament_players')
          return Promise.resolve({
            data: read.filters.user_id === 'viewer-a' ? [{ tournament_id: 'event' }] : [],
            error: null,
          });
        if (state.hang) return new Promise(() => {});
        if (state.fail) return Promise.resolve({ data: null, error: { message: 'Offline' } });
        const statuses = read.filters.status as string[];
        const data =
          !state.empty && statuses?.includes('REGISTERING') && read.filters.is_pinned !== true
            ? [
                {
                  id: 'event',
                  name: state.club,
                  club_id: state.club,
                  status: 'REGISTERING',
                  format_contract: 'mtt-v1',
                  start_time: '2026-11-01T12:00:00Z',
                  buy_in_amount: 10,
                  current_players: 3,
                },
              ]
            : [];
        return Promise.resolve({ data, error: null });
      };
      builder.then = (resolve: any, reject: any) => answer().then(resolve, reject);
      builder.maybeSingle = () => builder;
      return builder;
    },
  },
}));
import TournamentLobbyPage from '../../src/pages/tournament/TournamentLobbyPage';
const Page = () => (
  <MemoryRouter>
    <TournamentLobbyPage />
  </MemoryRouter>
);
async function settle() {
  await act(async () => {
    for (let i = 0; i < 30; i++) await Promise.resolve();
  });
}
beforeEach(() => {
  state.club = 'club-a';
  state.user = 'viewer-a';
  state.fail = false;
  state.hang = false;
  state.empty = false;
  state.reads = [];
  state.memberships.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it('changes the registration batch when the viewer changes', async () => {
  const view = render(<Page />);
  await settle();
  expect(screen.getByTestId('event')).toHaveTextContent('club-a:true');
  state.user = 'viewer-b';
  view.rerender(<Page />);
  await settle();
  expect(screen.getByTestId('event')).toHaveTextContent('club-a:false');
  expect(
    state.reads.some((r) => r.table === 'tournament_players' && r.filters.user_id === 'viewer-b')
  ).toBe(true);
});
it('does not render the old club when the new club read fails', async () => {
  const view = render(<Page />);
  await settle();
  state.club = 'club-b';
  state.fail = true;
  view.rerender(<Page />);
  await settle();
  expect(screen.queryByTestId('event')).toBeNull();
  expect(screen.getByText('Tournament List Unavailable')).toBeTruthy();
});
it('reports a failed board and retries explicitly', async () => {
  state.fail = true;
  render(<Page />);
  await settle();
  expect(screen.queryByText('Nothing Scheduled')).toBeNull();
  expect(screen.getByText('Tournament List Unavailable')).toBeTruthy();
  state.fail = false;
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await settle();
  expect(screen.getByTestId('event')).toBeTruthy();
});
it('bounds an unanswered board and aborts its transport', async () => {
  vi.useFakeTimers();
  state.hang = true;
  render(<Page />);
  await settle();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(12001);
  });
  expect(screen.getByText('Tournament List Unavailable')).toBeTruthy();
  expect(state.reads.filter((r) => r.table === 'tournaments').every((r) => r.signal?.aborted)).toBe(
    true
  );
});
it('retires the prior club transport on navigation', async () => {
  state.hang = true;
  const view = render(<Page />);
  await settle();
  const reads = [...state.reads.filter((r) => r.table === 'tournaments')];
  state.club = 'club-b';
  state.hang = false;
  view.rerender(<Page />);
  await settle();
  expect(reads.length).toBeGreaterThan(0);
  expect(reads.every((r) => r.signal?.aborted)).toBe(true);
  expect(screen.getByTestId('event')).toHaveTextContent('club-b');
});

it('offers creation after moving from a union to a standalone empty club', async () => {
  state.empty = true;
  state.memberships.set('club-a', { union_id: 'union' });
  const view = render(<Page />);
  await settle();
  expect(screen.queryByText('Create Tournament')).toBeNull();
  state.club = 'club-b';
  view.rerender(<Page />);
  await settle();
  expect(screen.getByText('Create Tournament')).toBeTruthy();
});
it('ignores a former union membership reply after navigation', async () => {
  state.empty = true;
  let resolve!: (value: unknown) => void;
  state.memberships.set(
    'club-a',
    new Promise((done) => {
      resolve = done;
    })
  );
  const view = render(<Page />);
  await settle();
  state.club = 'club-b';
  view.rerender(<Page />);
  await settle();
  await act(async () => {
    resolve({ union_id: 'union' });
  });
  await settle();
  expect(screen.getByText('Create Tournament')).toBeTruthy();
});
it('keeps a confirmed empty board distinct from an unreadable one', async () => {
  state.empty = true;
  render(<Page />);
  await settle();
  expect(screen.getByText('Nothing Scheduled')).toBeTruthy();
  expect(screen.queryByText('Tournament List Unavailable')).toBeNull();
});
