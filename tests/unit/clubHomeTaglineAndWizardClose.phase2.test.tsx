/**
 * The club lobby, two repairs (integration I4, 2026-09-23).
 *
 * - The club tag line is typed by the owner, so it is data, and data is Title
 *   Cased where it is printed (skill v1.5.0). It printed raw.
 * - Closing the opening wizard re-reads the setup state once, through the
 *   page's existing load path and with no timer, so a close that followed a
 *   setup the server already holds ("Already Completed") resolves the
 *   checklist step without a reload. It used to stay on Start Setup.
 *
 * The harness is the reduced shape of clubHomeOpeningChecklistMounted.phase2.test.tsx.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };
type SetupRead = {
  data: { completed_at: string | null } | null;
  error: { code: string; message: string } | null;
};

const h = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  clubReads: [] as any[],
  setupReads: [] as SetupRead[],
  setupCalls: 0,
  tagline: null as string | null,
  tournaments: [] as any[],
  tables: [] as any[],
  lightningStates: {} as Record<string, any>,
  register: vi.fn(),
}));

vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    from: h.from,
    rpc: h.rpc,
    auth: { getSession: vi.fn(async () => ({ data: { session: null }, error: null })) },
  },
  getAuthUser: vi.fn(async () => ({ data: { user: { id: 'viewer' } }, error: null })),
}));
vi.mock('../../src/core/MasterBus', () => ({
  masterBus: {
    registerChannelFactory: vi.fn(),
    removeChannelFactory: vi.fn(),
    removeRegisteredChannel: vi.fn(),
    getOrCreateChannel: () => {
      const channel: any = { on: vi.fn(), subscribe: vi.fn() };
      channel.on.mockReturnValue(channel);
      channel.subscribe.mockReturnValue(channel);
      return channel;
    },
    subscribeDebounced: () => () => {},
    subscribe: () => () => {},
    emit: vi.fn(),
  },
  busToast: vi.fn(),
}));
vi.mock('../../src/lightning/lightningLobbyFeed', () => ({
  useLightningLobbyStates: () => h.lightningStates,
}));
vi.mock('../../src/lib/bbjPoolFeed', () => ({ watchBbjPool: () => vi.fn() }));
vi.mock('../../src/lib/bbjHitFeed', () => ({ watchBbjHits: () => vi.fn() }));
// This lobby test owns no engine fixture. Keep its scope on the rendered tag
// line and setup reread instead of letting speculative table warm-up contact a
// developer engine on localhost:8080 and print a connection error.
vi.mock('../../src/services/tableWarmup', () => ({
  warmTable: vi.fn(),
  observeLobbyTableWarmups: () => () => {},
}));
vi.mock('../../src/utils/ChunkPreloader', () => ({
  prefetchIntent: vi.fn(),
  preloadRoute: vi.fn(),
}));
vi.mock('../../src/hooks/useMaintenanceBreak', () => ({
  useMaintenanceBreak: () => ({
    maintenanceBreak: { active: false, phase: 'idle', breakEndsAtMs: null, reason: '' },
  }),
}));
vi.mock('../../src/components/wallet/DynamicWallet', () => ({ default: () => null }));
vi.mock('../../src/hooks/useMasterBusChannel', () => ({ useMasterBusChannel: vi.fn() }));
vi.mock('../../src/hooks/useTournamentRegistration', () => ({
  useTournamentRegistration: () => ({ register: h.register, isRegistering: false }),
}));
vi.mock('../../src/utils/clubIdResolver', async (original) => ({
  ...(await original<any>()),
  resolveClubUUID: async (id: string) => id,
  resolveClubUUIDSync: () => null,
  resolveClubIdFilter: (id: string) => ({ column: 'id', value: id }),
}));
vi.mock('../../src/stores/useUserStore', () => ({
  useUserStore: Object.assign(
    (selector: any = (state: any) => state) => selector({ user: { id: 'viewer' } }),
    { getState: () => ({ user: { id: 'viewer' }, setCurrentClub: vi.fn() }) }
  ),
}));
vi.mock('../../src/components/common/Toast', () => ({
  useToast: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('../../src/components/lobby/lobbyViewPrefs', async (original) => ({
  ...(await original<any>()),
  fetchRemoteViewPrefs: async () => null,
}));
/* The wizard itself is proven elsewhere; here only its close matters. */
vi.mock('../../src/components/club/ClubOpeningWizard', () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div role="dialog" aria-label="Opening Setup Stub">
      <button type="button" onClick={onClose}>
        Close Opening Setup Stub
      </button>
    </div>
  ),
}));

import ClubHomePage from '../../src/pages/ClubHomePage';

const deferred = <T = any,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const flush = () => act(async () => {});
const settle = async () => {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
  }
};

const NOT_DONE: SetupRead = { data: { completed_at: null }, error: null };
const DONE: SetupRead = { data: { completed_at: '2026-09-23T11:00:00Z' }, error: null };

/** A new standalone club the viewer owns, exactly as the checklist harness has it. */
const newClub = () => ({
  id: 'club-a',
  club_id: 1,
  name: 'Test Club',
  member_count: 1,
  owner_id: 'viewer',
  union_id: null,
  is_union: false,
  opening_checklist_started_at: '2026-09-20T10:00:00Z',
  logo_url: '/hub/club-arena/club-logos/preset-09.webp',
  avatar_url: null,
  tagline: h.tagline,
  chip_treasury: 100000,
  spins_enabled: false,
});

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
  h.clubReads.length = 0;
  h.setupReads = [];
  h.setupCalls = 0;
  h.tagline = null;
  h.tournaments = [];
  h.tables = [];
  h.lightningStates = {};
  h.rpc.mockImplementation((name: string) => {
    if (name === 'fn_club_opening_checklist_state') {
      return Promise.resolve({
        data: { clubId: 'club-a', completedAt: null, skippedTaskIds: [] },
        error: null,
      });
    }
    return Promise.resolve({ data: 0, error: null });
  });
  h.from.mockImplementation((table: string) => {
    const result = table === 'clubs' ? deferred() : null;
    if (result) h.clubReads.push(result);
    const q: any = {};
    for (const method of ['select', 'eq', 'is', 'not', 'or', 'order', 'limit', 'in', 'lte'])
      q[method] = () => q;
    q.maybeSingle = () => {
      if (result) return result.promise;
      if (table === 'club_opening_setups') {
        h.setupCalls += 1;
        return Promise.resolve(h.setupReads.shift() ?? { data: null, error: null });
      }
      if (table === 'union_clubs') return Promise.resolve({ data: null, error: null });
      if (table === 'club_members') {
        return Promise.resolve({ data: { role: 'owner', status: 'active' }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    };
    q.then = (resolve: any, reject: any) =>
      (
        result?.promise ??
        Promise.resolve({
          data: table === 'tournaments' ? h.tournaments : table === 'tables' ? h.tables : [],
          error: null,
        })
      ).then(resolve, reject);
    return q;
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function mountLobby(query = '') {
  const read = h.clubReads.length;
  render(
    <MemoryRouter initialEntries={['/clubs/club-a' + query]}>
      <Routes>
        <Route path="/clubs/:clubId" element={<ClubHomePage />} />
        <Route
          path="/tournaments/:id"
          element={<div data-testid="tournament-destination">Tournament Review</div>}
        />
      </Routes>
    </MemoryRouter>
  );
  await flush();
  await act(async () => h.clubReads[read].resolve({ data: newClub(), error: null }));
  await settle();
}

const wizardRow = () => screen.getByText('Club Defaults').closest('article') as HTMLElement;

describe('the club tag line', () => {
  it('prints Title Cased, as every string a player reads', async () => {
    h.tagline = 'all sharks welcome, bring your A game';
    h.setupReads = [DONE];
    await mountLobby();

    const line = document.querySelector('.club-lobby-command-top__tagline');
    expect(line?.textContent).toBe('All Sharks Welcome, Bring Your A Game');
  });
});

describe('closing the opening wizard', () => {
  it('reads the setup state once more, so a setup already held resolves the step', async () => {
    h.setupReads = [NOT_DONE, DONE];
    await mountLobby();
    expect(h.setupCalls).toBe(1);
    fireEvent.click(within(wizardRow()).getByRole('button', { name: 'Open Setup' }));
    expect(screen.getByRole('dialog', { name: 'Opening Setup Stub' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Close Opening Setup Stub' }));
    await settle();

    expect(screen.queryByRole('dialog', { name: 'Opening Setup Stub' })).toBeNull();
    expect(h.setupCalls).toBe(2);
    expect(within(wizardRow()).getByRole('button', { name: 'Done' })).toBeTruthy();

    /* One read per close, and nothing on a timer afterwards. */
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(h.setupCalls).toBe(2);
  });
});

/** Live certification uses a reserved cash-only club, so the optional live
 * MTT case may have no input. This mounts the real owning page with synthetic
 * read results, every admitted status, and its actual React Router callback.
 * No database fixture, registration, chips or fabricated live result. */
describe('the tournament row reviews every lobby-admitted status', () => {
  it.each(['REGISTERING', 'RUNNING', 'LATE_REG', 'STARTING_SOON', 'BAGGED'])(
    '%s selects its own screen without registering',
    async (status) => {
      h.setupReads = [DONE];
      h.tournaments = [
        {
          id: 'event-a',
          club_id: 'club-a',
          name: 'Synthetic MTT',
          format_contract: 'mtt-v1',
          variant: 'mtt',
          game_type: 'NLH',
          status,
          start_time: new Date().toISOString(),
          started_at: new Date().toISOString(),
          current_players: 2,
          max_players: null,
          buy_in_amount: 10,
          buy_in_fee: 1,
          starting_chips: 1000,
          table_size: 9,
          blind_structure: [],
          is_private: true,
        },
      ];
      await mountLobby();
      fireEvent.click(screen.getByRole('button', { name: 'Tournaments', exact: true }));
      fireEvent.click(screen.getByRole('tab', { name: "MTT'S", exact: true }));
      await flush();
      const row = document.querySelector('.lt-row[data-kind="mtt"][data-id="event-a"]');
      expect(row, 'the actual lobby did not render the synthetic admitted event').not.toBeNull();
      fireEvent.click(row!);
      await flush();
      /* Dan 2026-11-01: "WHEN YOU CLICK ON A TOURNAMENT THATS 'RUNNING' IT
         SHOULD TAKE YOU DIRECTLY TO THE LOBBY. OR REALLY ANY TOURNAMENT, IT
         SHOULD NOT TAKE YOU TO THIS PAGE FIRST." The pre-commit drawer never
         opens for a tournament row; the row lands on the tournament's own
         screen at every admitted status, and still spends nothing. */
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.getByTestId('tournament-destination')).toBeTruthy();
      expect(h.register).not.toHaveBeenCalled();
      expect(
        h.rpc.mock.calls.some(([name]) => /register|buyin|buy_in|purchase/i.test(String(name)))
      ).toBe(false);
    }
  );
});

describe('Find Your Game starts with two separate sections', () => {
  it('requires a choice, separates controls and results, switches and closes', async () => {
    h.setupReads = [DONE];
    h.tables = [
      {
        id: 'cash-a',
        club_id: 'club-a',
        name: 'Cash Fixture',
        game_variant: 'nlh',
        status: 'running',
        max_players: 6,
        current_players: 2,
        small_blind: 1,
        big_blind: 2,
        min_buy_in: 40,
        max_buy_in: 200,
      },
    ];
    h.tournaments = [
      {
        id: 'event-a',
        club_id: 'club-a',
        name: 'Tournament Fixture',
        format_contract: 'mtt-v1',
        variant: 'mtt',
        game_type: 'NLH',
        status: 'REGISTERING',
        start_time: new Date().toISOString(),
        current_players: 2,
        buy_in_amount: 10,
        buy_in_fee: 1,
        starting_chips: 1000,
        table_size: 9,
      },
    ];
    await mountLobby();
    const cash = screen.getByRole('button', { name: 'Cash Games', exact: true });
    const tournaments = screen.getByRole('button', { name: 'Tournaments', exact: true });
    expect(cash.getAttribute('aria-expanded')).toBe('false');
    expect(tournaments.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('tablist', { name: 'Game Type' })).toBeNull();
    expect(document.querySelector('.club-home__games')?.hasAttribute('hidden')).toBe(true);
    expect(screen.queryByText('Live Club Schedule')).toBeNull();
    expect(document.querySelector('.lobby-controls__total')).toBeNull();

    fireEvent.click(cash);
    await flush();
    const names = () =>
      within(screen.getByRole('tablist', { name: 'Game Type' }))
        .getAllByRole('tab')
        .map((t) => t.textContent);
    expect(names()).toEqual(['ALL', 'NLH', 'PLO', 'LIMIT']);
    expect(
      within(screen.getByLabelText('Game Status'))
        .getAllByRole('button')
        .map((t) => t.textContent)
    ).toEqual(['All', 'Running', 'Sort']);
    expect(document.querySelector('.lt-row[data-id="cash-a"]')).not.toBeNull();
    expect(document.querySelector('.lt-row[data-id="event-a"]')).toBeNull();
    expect(document.querySelector('.club-home__games')?.hasAttribute('hidden')).toBe(false);
    fireEvent.click(screen.getByRole('tab', { name: 'PLO', exact: true }));
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Filters And Sort', exact: true }));
    await flush();
    const filterTabs = within(screen.getByRole('dialog', { name: 'Advanced Filters' })).getByRole(
      'group',
      { name: 'Game Type' }
    );
    expect(
      within(filterTabs)
        .getAllByRole('button')
        .map((t) => t.textContent)
    ).not.toContain("MTT'S");
    fireEvent.click(screen.getByRole('button', { name: 'Close Game Filters' }));
    await flush();
    fireEvent.click(tournaments);
    await flush();
    expect(names()).toEqual(["MTT'S", 'SPINS', "SIT N GO'S", 'SATELLITES']);
    expect(document.querySelector('.lt-row[data-id="event-a"]')).not.toBeNull();
    expect(document.querySelector('.lt-row[data-id="cash-a"]')).toBeNull();
    expect(cash.getAttribute('aria-expanded')).toBe('false');
    expect(tournaments.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(tournaments);
    await flush();
    expect(screen.queryByRole('tablist', { name: 'Game Type' })).toBeNull();
    expect(document.querySelector('.club-home__games')?.hasAttribute('hidden')).toBe(true);
    expect(h.register).not.toHaveBeenCalled();
  });
});

it('opens the saved cash section and tab immediately on return', async () => {
  h.setupReads = [DONE];
  localStorage.setItem(
    'ca_lobby_view_viewer:club-a',
    JSON.stringify({ tab: 'OMAHA', sortByTab: {}, favoritesOnly: false })
  );
  await mountLobby();
  expect(screen.getByRole('button', { name: 'Cash Games', exact: true })).toHaveAttribute(
    'aria-expanded',
    'true'
  );
  expect(screen.getByRole('tab', { name: 'PLO', exact: true }).getAttribute('aria-selected')).toBe(
    'true'
  );
});

it('shows only recorded MTT and SNG satellites when Satellites is selected', async () => {
  h.setupReads = [DONE];
  const row = {
    club_id: 'club-a',
    game_type: 'NLH',
    status: 'REGISTERING',
    start_time: new Date().toISOString(),
    current_players: 0,
    buy_in_amount: 10,
    buy_in_fee: 1,
    starting_chips: 1000,
    table_size: 9,
  };
  h.tournaments = [
    {
      ...row,
      id: 'sat-mtt',
      name: 'MTT Qualifier',
      format_contract: 'mtt-v1',
      tournament_type: 'SATELLITE',
    },
    {
      ...row,
      id: 'sat-sng',
      name: 'SNG Qualifier',
      format_contract: 'seat-first-satellite-v1',
      max_players: 2,
    },
    { ...row, id: 'regular-mtt', name: 'Satellite Name Only', format_contract: 'mtt-v1' },
    { ...row, id: 'regular-sng', name: 'Regular SNG', format_contract: 'sng-v1', max_players: 6 },
  ];
  await mountLobby();
  fireEvent.click(screen.getByRole('button', { name: 'Tournaments', exact: true }));
  fireEvent.click(screen.getByRole('tab', { name: 'SATELLITES', exact: true }));
  await flush();
  for (const id of ['sat-mtt', 'sat-sng'])
    expect(document.querySelector(`.lt-row[data-id="${id}"]`)).not.toBeNull();
  for (const id of ['regular-mtt', 'regular-sng'])
    expect(document.querySelector(`.lt-row[data-id="${id}"]`)).toBeNull();
  expect(h.register).not.toHaveBeenCalled();
});

/** Filter regressions exercise the real page, sheet and row predicate together. */
describe('lobby filters stay attached to the selected game', () => {
  const tournament = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    club_id: 'club-a',
    name: id,
    game_type: 'NLH',
    variant: 'mtt',
    format_contract: 'mtt-v1',
    status: 'REGISTERING',
    start_time: new Date(Date.now() + 3_600_000).toISOString(),
    current_players: 0,
    max_players: 100,
    buy_in_amount: 10,
    buy_in_fee: 1,
    starting_chips: 1000,
    table_size: 9,
    ...extra,
  });

  it('filters a satellite by poker game instead of its satellite subtype', async () => {
    h.setupReads = [DONE];
    h.tournaments = [
      tournament('nlh-satellite', { variant: 'satellite', tournament_type: 'SATELLITE' }),
      tournament('plo-satellite', {
        variant: 'satellite',
        tournament_type: 'SATELLITE',
        game_type: 'PLO4',
      }),
    ];
    localStorage.setItem(
      'ca_advanced_filters_viewer:club-a',
      JSON.stringify({
        SATELLITE: {
          games: ['nlh'],
          format: [],
          styles: [],
          statuses: [],
          mustHave: [],
          hide: [],
          rangeMin: 0,
          rangeMax: 15000,
          seatMin: 2,
          seatMax: 9,
        },
      })
    );
    await mountLobby();
    fireEvent.click(screen.getByRole('button', { name: 'Tournaments', exact: true }));
    fireEvent.click(screen.getByRole('tab', { name: 'SATELLITES', exact: true }));
    await flush();
    expect(document.querySelector('.lt-row[data-id="nlh-satellite"]')).not.toBeNull();
    expect(document.querySelector('.lt-row[data-id="plo-satellite"]')).toBeNull();
    expect(h.register).not.toHaveBeenCalled();
  });

  it('keeps Favorites available to undo when moving from cash to tournaments', async () => {
    h.setupReads = [DONE];
    h.tournaments = [tournament('ordinary-mtt')];
    await mountLobby();
    fireEvent.click(screen.getByRole('button', { name: 'Cash Games', exact: true }));
    fireEvent.click(screen.getByRole('tab', { name: 'NLH', exact: true }));
    await flush();
    fireEvent.click(
      within(screen.getByRole('navigation', { name: 'Quick Lobby Filters' })).getByRole('button', {
        name: 'Favorites',
        exact: true,
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Tournaments', exact: true }));
    await flush();
    const favorites = within(
      screen.getByRole('navigation', { name: 'Quick Lobby Filters' })
    ).getByRole('button', {
      name: 'Favorites',
      exact: true,
    });
    expect(
      within(screen.getByLabelText('Game Status')).queryByRole('button', {
        name: 'Favorites',
        exact: true,
      })
    ).toBeNull();
    expect(
      within(screen.getByLabelText('Game Status')).getAllByRole('button').at(-1)
    ).toHaveAccessibleName('Filters And Sort');
    expect(favorites).toHaveAttribute('aria-pressed', 'true');
    expect(document.querySelector('.lt-row[data-id="ordinary-mtt"]')).toBeNull();
    fireEvent.click(favorites);
    await flush();
    expect(favorites).toHaveAttribute('aria-pressed', 'false');
    expect(document.querySelector('.lt-row[data-id="ordinary-mtt"]')).not.toBeNull();
  });

  it('sheet tab changes switch the board and save sorting under the new tab only', async () => {
    h.setupReads = [DONE];
    h.tournaments = [
      tournament('mtt'),
      tournament('spin', { variant: 'spin', format_contract: 'spin-v1', max_players: 3 }),
    ];
    await mountLobby();
    fireEvent.click(screen.getByRole('button', { name: 'Tournaments', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Filters And Sort', exact: true }));
    await flush();
    const dialog = screen.getByRole('dialog', { name: 'Advanced Filters' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Spins', exact: true }));
    await flush();
    expect(screen.getByRole('tab', { name: 'SPINS', exact: true })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(
      within(dialog).getByRole('button', { name: 'Most Players', exact: true })
    ).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Stakes: Low To High', exact: true })
    );
    await flush();
    const prefs = JSON.parse(localStorage.getItem('ca_lobby_view_viewer:club-a')!);
    expect(prefs.sortByTab.SPIN).toBe('stakes_low');
    expect(prefs.sortByTab.MTT).toBeUndefined();
    fireEvent.click(within(dialog).getByRole('button', { name: 'MTT', exact: true }));
    await flush();
    expect(screen.getByRole('tab', { name: "MTT'S", exact: true })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(
      within(dialog).getByRole('button', { name: 'Recommended', exact: true })
    ).toHaveAttribute('aria-pressed', 'true');
    expect(h.register).not.toHaveBeenCalled();
  });
});

it.each(['SPINS', "SIT N GO'S"])(
  '%s does not advertise a recycler timestamp as a scheduled start sort',
  async (label) => {
    h.setupReads = [DONE];
    await mountLobby();
    fireEvent.click(screen.getByRole('button', { name: 'Tournaments', exact: true }));
    fireEvent.click(screen.getByRole('tab', { name: label, exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Filters And Sort', exact: true }));
    await flush();
    const dialog = screen.getByRole('dialog', { name: 'Advanced Filters' });
    expect(within(dialog).queryByRole('button', { name: 'Starting Time', exact: true })).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Most Players', exact: true })).toBeTruthy();
  }
);

it('Satellite Starting Time puts scheduled MTT dates ahead of seat-first recycler timestamps', async () => {
  h.setupReads = [DONE];
  const base = {
    club_id: 'club-a',
    game_type: 'NLH',
    status: 'REGISTERING',
    current_players: 0,
    buy_in_amount: 10,
    buy_in_fee: 1,
    starting_chips: 1000,
    table_size: 9,
    tournament_type: 'SATELLITE',
    satellite_target_id: 'target',
  };
  h.tournaments = [
    {
      ...base,
      id: 'seat-first-satellite',
      name: 'Seat First Qualifier',
      format_contract: 'seat-first-satellite-v1',
      max_players: 2,
      start_time: new Date(Date.now() - 172_800_000).toISOString(),
    },
    {
      ...base,
      id: 'scheduled-satellite',
      name: 'Scheduled Qualifier',
      format_contract: 'mtt-v1',
      max_players: null,
      start_time: new Date(Date.now() + 3_600_000).toISOString(),
    },
  ];
  await mountLobby();
  fireEvent.click(screen.getByRole('button', { name: 'Tournaments', exact: true }));
  fireEvent.click(screen.getByRole('tab', { name: 'SATELLITES', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Filters And Sort', exact: true }));
  await flush();
  fireEvent.click(
    within(screen.getByRole('dialog', { name: 'Advanced Filters' })).getByRole('button', {
      name: 'Starting Time',
      exact: true,
    })
  );
  await flush();
  let witnessed = 0;
  for (const body of document.querySelectorAll('tbody')) {
    const ids = Array.from(body.querySelectorAll('.lt-row[data-id]')).map((row) =>
      row.getAttribute('data-id')
    );
    if (ids.includes('scheduled-satellite')) {
      expect(ids).toEqual(['scheduled-satellite', 'seat-first-satellite']);
      witnessed += 1;
    }
  }
  expect(witnessed).toBeGreaterThan(0);
  expect(h.register).not.toHaveBeenCalled();
});

it.each([false, true])(
  'ALL Most Players sorts whole games, including Lightning pools (%s)',
  async (lightning) => {
    h.setupReads = [DONE];
    const table = (id: string, cluster: string, players: number, main = true) => ({
      id,
      club_id: 'club-a',
      name: id,
      game_variant: 'nlh',
      status: 'running',
      lifecycle: 'live',
      current_players: players,
      max_players: 6,
      small_blind: 1,
      big_blind: 2,
      cluster_id: cluster,
      role: main ? 'main' : 'feeder',
      main_index: main ? 1 : null,
      cluster_mode: lightning && cluster === 'large' ? 'lightning' : 'must_move',
      cluster_template: 'action',
      cluster_handedness: 6,
    });
    h.tables = [
      table('large-main', 'large', 1),
      table('large-feeder', 'large', 19, false),
      table('small-main', 'small', 5),
      table('small-feeder', 'small', 3, false),
    ];
    if (lightning)
      h.lightningStates.large = {
        clusterMode: 'lightning',
        poolPlayers: 30,
        liveEligible: 20,
        onThreshold: 18,
        offThreshold: 12,
      };
    localStorage.setItem(
      'ca_lobby_view_viewer:club-a',
      JSON.stringify({ tab: 'ALL', sortByTab: { ALL: 'players' }, favoritesOnly: false })
    );
    await mountLobby();
    let witnessed = 0;
    for (const body of document.querySelectorAll('tbody')) {
      const rows = Array.from(body.querySelectorAll('.lt-row[data-kind="cash"][data-id]'));
      if (!rows.length) continue;
      expect(rows.map((row) => row.getAttribute('data-id'))).toEqual(['large-main', 'small-main']);
      expect(rows[0].querySelector('.lt-col-players')?.textContent).toContain(
        String(lightning ? 30 : 20)
      );
      witnessed += 1;
    }
    expect(witnessed).toBeGreaterThan(0);
    expect(h.register).not.toHaveBeenCalled();
  }
);
