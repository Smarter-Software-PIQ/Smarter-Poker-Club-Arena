import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Current Data reports count Pacific calendar dates for every club.
const pacificToday = (): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
/** The instant `hhmmss` on the Chicago clock on calendar date `day` (DST aware). */
function chicagoInstant(day: string, hhmmss: string, zone = 'America/Chicago'): Date {
  const guess = new Date(`${day}T${hhmmss}Z`);
  const shown = new Date(guess.toLocaleString('en-US', { timeZone: zone }));
  const asUtc = new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(guess.getTime() + (asUtc.getTime() - shown.getTime()));
}

const CLUB_ID = 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4';
/** A calendar date moved by whole days (zone free). */
const shiftDay = (day: string, days: number): string => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
/**
 * The window-end picker shows the boundary the window stops at, the day after
 * the last day the readers are sent. This fixture's club is in no union, so
 * the boundary is Chicago midnight.
 */
const calendarName = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
function selectCalendarDay(day: string) {
  const target = calendarName(day);
  for (let i = 0; i < 120 && !screen.queryByRole('button', { name: target }); i++) {
    const shownMonth = Date.parse(screen.getByRole('grid').getAttribute('aria-label')!);
    fireEvent.click(
      screen.getByRole('button', {
        name: Date.parse(`${day}T12:00:00Z`) < shownMonth ? 'Previous Month' : 'Next Month',
      })
    );
  }
  fireEvent.click(screen.getByRole('button', { name: target }));
}
function applyCalendarRange(first: string, last = first) {
  fireEvent.click(screen.getByRole('button', { name: 'Select Date Range' }));
  selectCalendarDay(first);
  if (last !== first) selectCalendarDay(last);
  fireEvent.click(screen.getByRole('button', { name: 'Apply Dates' }));
}
const snapshotEnd = () =>
  rpcMock.mock.calls.filter(([fn]) => fn === 'ca_club_data_snapshot_v2').at(-1)?.[1]?.p_end;

const TEST_END_DATE = pacificToday();
const testRangeStart = new Date(`${TEST_END_DATE}T00:00:00Z`);
testRangeStart.setUTCDate(testRangeStart.getUTCDate());
const TEST_START_DATE = testRangeStart.toISOString().slice(0, 10);
const testPreviousEnd = new Date(testRangeStart);
testPreviousEnd.setUTCDate(testPreviousEnd.getUTCDate() - 1);
const testPreviousStart = new Date(testPreviousEnd);
testPreviousStart.setUTCDate(testPreviousStart.getUTCDate());

const snapshot = {
  range: { start: TEST_START_DATE, end: TEST_END_DATE, days: 1 },
  previous_range: {
    start: testPreviousStart.toISOString().slice(0, 10),
    end: testPreviousEnd.toISOString().slice(0, 10),
    days: 1,
  },
  filters: { game: 'ALL', stakes: 'ALL', search: null },
  summary: {
    games: 1,
    total_winnings: 2450,
    mtt_winnings: 500,
    cash_winnings: 1950,
    fee: 321.5,
    cash_fee: 250,
    mtt_fee: 71.5,
    hands: 900,
  },
  previous: {
    games: 10,
    total_winnings: 2000,
    mtt_winnings: 400,
    cash_winnings: 1600,
    fee: 300,
    hands: 800,
  },
  delta: { fee_pct: 7.2, games_pct: -90, winnings_abs: 450, fee_abs: 21.5 },
  rows: [
    {
      kind: 'CASH',
      id: 'game-1',
      name: 'Shark Table One',
      variant: 'NLH',
      game_class: 'HOLDEM',
      stakes_tier: 'SMALL',
      blinds: '1 / 2',
      rake_percent: 10,
      started_at: '2026-08-30T12:00:00Z',
      status: 'complete',
      creator_id: 'player-1',
      creator_name: 'Dealer One',
      creator_avatar: null,
      fee: 42.5,
      winnings: 120,
      hands: 80,
      players: 6,
    },
  ],
  row_count: 1,
  // A club in no union: it answers on Chicago midnight days and its "today"
  // is the calendar day (stage 2 readers: a union club states union_id).
  union_id: null,
  data_updated_at: '2026-08-30T12:05:00Z',
  generated_at: '2026-08-30T12:05:02Z',
};

const zeroSnapshot = {
  ...snapshot,
  summary: {
    games: 0,
    total_winnings: 0,
    mtt_winnings: 0,
    cash_winnings: 0,
    fee: 0,
    cash_fee: 0,
    mtt_fee: 0,
    hands: 0,
  },
  previous: {
    games: 0,
    total_winnings: 0,
    mtt_winnings: 0,
    cash_winnings: 0,
    fee: 0,
    cash_fee: 0,
    mtt_fee: 0,
    hands: 0,
  },
  delta: { fee_pct: null, games_pct: null, winnings_abs: 0, fee_abs: 0 },
  rows: [],
  row_count: 0,
};

const playerBreakdown = {
  range: snapshot.range,
  rake_complete_through: '2026-08-29',
  totals: { players: 1, net: 120, rake: 42.5, hands: 80 },
  players: [
    {
      user_id: 'player-1',
      username: 'Table Regular',
      avatar_url: null,
      is_horse: true,
      net: 120,
      cash_net: 120,
      tournament_net: 0,
      rake: 42.5,
      hands: 80,
    },
  ],
  player_count: 1,
  generated_at: '2026-08-30T12:05:02Z',
};

const gamePage = {
  sort: 'recent',
  rows: snapshot.rows,
  next_cursor: null,
  has_more: false,
  filtered_count: snapshot.row_count,
  generated_at: snapshot.generated_at,
};

const playerPage = {
  sort: 'winners',
  rows: playerBreakdown.players,
  next_cursor: null,
  has_more: false,
  filtered_count: playerBreakdown.player_count,
  generated_at: playerBreakdown.generated_at,
};

function gamePageFor(args: Record<string, unknown> = {}, overrides: Record<string, unknown> = {}) {
  return {
    ...gamePage,
    sort: args.p_sort ?? 'recent',
    contract: 'ca_club_game_page.v2',
    contract_version: 2,
    club_id: args.p_club_id ?? CLUB_ID,
    requested_start: args.p_start ?? TEST_START_DATE,
    requested_end: args.p_end ?? TEST_END_DATE,
    requested_game: args.p_game ?? 'ALL',
    requested_stakes: args.p_stakes ?? 'ALL',
    requested_search: args.p_search ?? null,
    requested_sort: args.p_sort ?? 'recent',
    requested_cursor: args.p_cursor ?? null,
    requested_limit: args.p_limit ?? 100,
    ...overrides,
  };
}

function playerPageFor(
  args: Record<string, unknown> = {},
  overrides: Record<string, unknown> = {}
) {
  return {
    ...playerPage,
    sort: args.p_sort ?? 'winners',
    contract: 'ca_club_player_page.v2',
    contract_version: 2,
    club_id: args.p_club_id ?? CLUB_ID,
    requested_start: args.p_start ?? TEST_START_DATE,
    requested_end: args.p_end ?? TEST_END_DATE,
    requested_sort: args.p_sort ?? 'winners',
    requested_search: args.p_search ?? null,
    requested_cursor: args.p_cursor ?? null,
    requested_limit: args.p_limit ?? 100,
    ...overrides,
  };
}

function snapshotWithRows(rows: typeof snapshot.rows, rowCount: number) {
  return {
    ...snapshot,
    summary: { ...snapshot.summary, games: rowCount },
    delta: {
      ...snapshot.delta,
      games_pct:
        Math.round(((rowCount - snapshot.previous.games) / snapshot.previous.games) * 1000) / 10,
    },
    rows,
    row_count: rowCount,
  };
}

function playerBreakdownWithRows(rows: typeof playerBreakdown.players, playerCount: number) {
  return {
    ...playerBreakdown,
    totals: { ...playerBreakdown.totals, players: playerCount },
    players: rows,
    player_count: playerCount,
  };
}

const latestInvoice = {
  invoice_id: 'invoice-1',
  status: 'awaiting_payment',
  overdue: false,
  paid_total: 0,
  outstanding: 350,
  issued_at: '2026-08-30T09:00:00Z',
  due_at: '2026-09-02T09:00:00Z',
  amount: 350,
  direction: 'club owes union',
  period_start: '2026-08-23',
  period_end: '2026-08-29',
  breakdown: { rake_generated: 500, rakeback_due: 150, union_fee_kept: 350 },
  message_sent: true,
};

const authState = vi.hoisted(() => ({
  current: { user: { id: 'owner-1' } as { id: string } | null, isHydrating: false },
}));

const routeState = vi.hoisted(() => ({ clubId: 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4' }));
const rakePanelProps = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
const rpcMock = vi.hoisted(() => vi.fn());
const fromMock = vi.hoisted(() => vi.fn());
const downloadMock = vi.hoisted(() => vi.fn(() => true));
const realtimeState = vi.hoisted(() => ({
  channels: [] as Array<Record<string, any>>,
  busHandler: null as ((payload: unknown) => void) | null,
  busEvents: [] as string[],
}));

vi.mock('../../src/hooks/useAuthUser', () => ({
  useAuthUser: () => authState.current,
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ clubId: routeState.clubId }),
  useSearchParams: () => useState(() => new URLSearchParams()),
}));

vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    rpc: rpcMock,
    from: fromMock,
  },
}));

vi.mock('../../src/utils/downloadCsv', async () => {
  const actual = await vi.importActual<typeof import('../../src/utils/downloadCsv')>(
    '../../src/utils/downloadCsv'
  );
  return { ...actual, downloadCsv: downloadMock };
});

vi.mock('../../src/hooks/useMasterBusChannel', () => ({
  useMasterBusChannel: (options: Record<string, any>) => realtimeState.channels.push(options),
}));

vi.mock('../../src/hooks/useMasterBusSubscription', () => ({
  useMasterBusSubscriptions: (events: string[], handler: (payload: unknown) => void) => {
    realtimeState.busEvents = events;
    realtimeState.busHandler = handler;
  },
}));

/**
 * The rake snapshot panel is stubbed here, and the reason is worth writing down
 * because the failure was confusing.
 *
 * This file's bus mock keeps ONE handler:  realtimeState.busHandler = handler.
 * The panel subscribes to the same events as the page, so the moment it gained
 * a subscription the panel's handler replaced the page's, and firing
 * busHandler exercised the panel while asserting on the page. Two tests began
 * failing with "expected 1 to be 2" - the page had simply never been told.
 *
 * Nothing was wrong in production: the real bus fans out to every subscriber
 * and both components refresh. The single-handler double could not represent a
 * second subscriber, and this file is about the LEDGER, not the panel, which
 * has its own tests. Stubbing it keeps the subject of these assertions the
 * thing they are named after - and removes the panel's unmocked RPC from the
 * stderr of every test in the file.
 */
vi.mock('../../src/components/club/RakeSnapshotPanel', () => ({
  default: (props: Record<string, unknown>) => {
    rakePanelProps.current = props;
    return null;
  },
}));

import ClubDataPage from '../../src/pages/club/ClubDataPage';
import {
  CLUB_DATA_CACHE_PREFIX,
  clubDataQueryKey,
  writeClubDataCache,
} from '../../src/lib/clubDataCache';

afterEach(() => cleanup());

beforeEach(() => {
  authState.current = { user: { id: 'owner-1' }, isHydrating: false };
  routeState.clubId = CLUB_ID;
  rpcMock.mockReset();
  downloadMock.mockClear();
  sessionStorage.clear();
  localStorage.clear();
  realtimeState.channels = [];
  realtimeState.busHandler = null;
  realtimeState.busEvents = [];
  rpcMock.mockImplementation(async (fn: string, args?: Record<string, unknown>) => {
    if (fn === 'ca_club_data_snapshot_v2') return { data: snapshot, error: null };
    if (fn === 'ca_club_game_page') {
      return { data: gamePageFor(args), error: null };
    }
    if (fn === 'ca_club_player_breakdown') return { data: playerBreakdown, error: null };
    if (fn === 'ca_club_player_page') {
      return { data: playerPageFor(args), error: null };
    }
    if (fn === 'ca_club_union_invoices') return { data: [], error: null };
    return { data: null, error: null };
  });
  fromMock.mockReset();
  fromMock.mockImplementation(() => ({
    select: () => ({
      eq: () => ({ maybeSingle: async () => ({ data: { name: 'Shark Club' }, error: null }) }),
    }),
  }));
});

describe('Simple Club Data', () => {
  it.each([false, true])(
    'refresh reconnects only failed live feeds (Advanced=%s)',
    async (advanced) => {
      render(<ClubDataPage />);
      await screen.findByText('Shark Table One');
      if (advanced)
        fireEvent.click(screen.getByRole('button', { name: 'Report Tools', exact: true }));
      const latest = () => realtimeState.channels.slice(-4);
      act(() => latest().forEach((config) => config.onSubscriptionStatus('SUBSCRIBED')));
      act(() =>
        latest()
          .find((config) => config.table === 'tables')
          ?.onSubscriptionStatus('TIMED_OUT')
      );
      fireEvent.click(
        screen.getByRole('button', {
          name: advanced ? 'Refresh Club Ledger' : 'Refresh Simple Club Data',
          exact: true,
        })
      );
      expect(latest().find((config) => config.table === 'tables')?.restartKey).toBe(1);
      expect(
        latest()
          .filter((config) => config.table !== 'tables')
          .map((config) => config.restartKey ?? 0)
      ).toEqual([0, 0, 0]);
      await waitFor(() =>
        expect(
          screen.getByRole('button', {
            name: advanced ? 'Refresh Club Ledger' : 'Refresh Simple Club Data',
            exact: true,
          })
        ).toBeEnabled()
      );
      act(() =>
        latest()
          .find((config) => config.table === 'tables')
          ?.onSubscriptionStatus('SUBSCRIBED')
      );
      fireEvent.click(
        screen.getByRole('button', {
          name: advanced ? 'Refresh Club Ledger' : 'Refresh Simple Club Data',
          exact: true,
        })
      );
      expect(latest().find((config) => config.table === 'tables')?.restartKey).toBe(1);
    }
  );
  it('defaults to Simple and restores all Advanced tools without resetting verified rows', async () => {
    render(<ClubDataPage />);
    await screen.findByText('Shark Table One');
    const page = document.querySelector('[data-page="club-data"]');

    expect(page).toHaveAttribute('data-club-data-mode', 'simple');
    expect(screen.queryByRole('button', { name: /^(Simple|Advanced)$/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Report Tools' })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    expect(screen.queryByRole('heading', { name: 'Data Integrity' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Players' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Search Games' })).toBeInTheDocument();
    expect(
      screen.getByRole('group', { name: 'Date Range' }).querySelectorAll('button')
    ).toHaveLength(3);
    const calls = rpcMock.mock.calls.filter(([fn]) => fn === 'ca_club_data_snapshot_v2').length;
    fireEvent.click(screen.getByRole('button', { name: 'Report Tools', exact: true }));
    expect(page).toHaveAttribute('data-report-tools', 'open');
    expect(screen.getByRole('heading', { name: 'Data Integrity' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Players' })).toBeInTheDocument();
    expect(
      screen.getByRole('group', { name: 'Date Range' }).querySelectorAll('button')
    ).toHaveLength(5);
    expect(screen.getByText('Shark Table One')).toBeInTheDocument();
    expect(rpcMock.mock.calls.filter(([fn]) => fn === 'ca_club_data_snapshot_v2')).toHaveLength(
      calls
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Players' }));
    await screen.findByText('Table Regular');
    fireEvent.click(screen.getByRole('button', { name: 'Report Tools', exact: true }));
    expect(screen.getByText('Shark Table One')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Players' })).not.toBeInTheDocument();
  });
  it('routes the calendar and simple game/stakes controls into the authoritative query', async () => {
    render(<ClubDataPage />);
    await screen.findByText('Shark Table One');
    applyCalendarRange(TEST_END_DATE);
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith(
        'ca_club_data_snapshot_v2',
        expect.objectContaining({ p_end: TEST_END_DATE })
      )
    );
    fireEvent.click(screen.getByRole('button', { name: 'Omaha', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Micro', exact: true }));
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith(
        'ca_club_data_snapshot_v2',
        expect.objectContaining({ p_game: 'OMAHA', p_stakes: 'MICRO' })
      )
    );
    fireEvent.click(screen.getByRole('button', { name: 'Micro', exact: true }));
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith(
        'ca_club_data_snapshot_v2',
        expect.objectContaining({ p_game: 'OMAHA', p_stakes: 'ALL' })
      )
    );
  });
});

for (const advanced of [false, true]) {
  for (const scope of ['account', 'club']) {
    it(`keeps refresh ownership across ${scope} changes in ${advanced ? 'Advanced' : 'Simple'}`, async () => {
      const view = render(<ClubDataPage />);
      await screen.findByText('Shark Table One');
      if (advanced)
        fireEvent.click(screen.getByRole('button', { name: 'Report Tools', exact: true }));
      const refresh = () =>
        screen.getByRole('button', {
          name: advanced ? 'Refresh Club Ledger' : 'Refresh Simple Club Data',
        });
      let resolveOld!: (result: any) => void;
      let resolveNew!: (result: any) => void;
      let incomingCalls = 0;
      rpcMock.mockImplementation(async (fn: string, args?: Record<string, unknown>) => {
        if (fn === 'ca_club_data_snapshot_v2') {
          if (authState.current.user?.id === 'owner-1' && routeState.clubId === CLUB_ID)
            return await new Promise((resolve) => {
              resolveOld = resolve;
            });
          incomingCalls++;
          if (incomingCalls === 2)
            return await new Promise((resolve) => {
              resolveNew = resolve;
            });
          return { data: snapshot, error: null };
        }
        if (fn === 'ca_club_game_page') return { data: gamePageFor(args), error: null };
        if (fn === 'ca_club_union_invoices') return { data: [], error: null };
        return { data: null, error: null };
      });
      fireEvent.click(refresh());
      await waitFor(() => expect(resolveOld).toBeTypeOf('function'));
      if (scope === 'account') authState.current = { user: { id: 'owner-2' }, isHydrating: false };
      else routeState.clubId = 'b52545cc-9e1d-411b-9f1e-f9c4e76bf0e5';
      view.rerender(<ClubDataPage />);
      await screen.findByText('Shark Table One');
      fireEvent.click(refresh());
      await waitFor(() => expect(resolveNew).toBeTypeOf('function'));
      await act(async () => {
        resolveOld({ data: snapshot, error: null });
      });
      expect(refresh()).toBeDisabled();
      expect(refresh()).toHaveTextContent('Refreshing');
      expect(screen.queryByText('Club Ledger Refreshed.')).not.toBeInTheDocument();
      await act(async () => {
        resolveNew({ data: snapshot, error: null });
      });
      await waitFor(() => expect(refresh()).toBeEnabled());
      expect(screen.getAllByText('Club Ledger Refreshed.').length).toBeGreaterThan(0);
    });
  }
}

for (const historical of [false, true]) {
  it(`rolls the current Pacific day at midnight while preserving ${historical ? 'historical' : 'current'} intent`, async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(chicagoInstant(TEST_END_DATE, '23:59:50', 'America/Los_Angeles'));
    try {
      render(<ClubDataPage />);
      await screen.findByText('Shark Table One');
      const chosen = historical ? shiftDay(TEST_END_DATE, -13) : TEST_END_DATE;
      if (historical) applyCalendarRange(chosen);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      const expected = historical ? chosen : shiftDay(TEST_END_DATE, 1);
      expect(snapshotEnd()).toBe(expected);
      expect(rpcMock).toHaveBeenCalledWith(
        'ca_club_data_snapshot_v2',
        expect.objectContaining({ p_end: expected })
      );
    } finally {
      cleanup();
      vi.useRealTimers();
    }
  });
}

for (const advanced of [false, true]) {
  it(`never relabels the outgoing game's money during an uncached query in ${advanced ? 'Advanced' : 'Simple'}`, async () => {
    render(<ClubDataPage />);
    await screen.findByText('Shark Table One');
    if (advanced)
      fireEvent.click(screen.getByRole('button', { name: 'Report Tools', exact: true }));
    let resolveQuery!: (result: any) => void;
    rpcMock.mockImplementation(async (fn: string) => {
      if (fn === 'ca_club_data_snapshot_v2')
        return await new Promise((resolve) => {
          resolveQuery = resolve;
        });
      return { data: null, error: null };
    });
    fireEvent.click(screen.getByRole('button', { name: 'Omaha', exact: true }));
    await waitFor(() => expect(resolveQuery).toBeTypeOf('function'));
    expect(screen.queryByText('Shark Table One')).not.toBeInTheDocument();
    expect(screen.getByText('Finding Matching Games')).toBeInTheDocument();
    expect(screen.queryByText('0 Matching Games')).not.toBeInTheDocument();
    expect(
      within(screen.getByLabelText('Club Performance Summary')).queryByText('2.4K')
    ).not.toBeInTheDocument();
    await act(async () => {
      resolveQuery({ data: null, error: null });
    });
    expect(screen.queryByText('Shark Table One')).not.toBeInTheDocument();
    expect(screen.getByText('Matching Games Unavailable')).toBeInTheDocument();
  });
}

for (const intent of ['calendar', 'previous period']) {
  it(`preserves an explicit ${intent} choice made after midnight before the next poll`, async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(chicagoInstant(TEST_END_DATE, '23:59:50', 'America/Los_Angeles'));
    try {
      render(<ClubDataPage />);
      await screen.findByText('Shark Table One');
      const tomorrowDay = new Date(`${TEST_END_DATE}T00:00:00Z`);
      tomorrowDay.setUTCDate(tomorrowDay.getUTCDate() + 1);
      const tomorrow = chicagoInstant(
        tomorrowDay.toISOString().slice(0, 10),
        '00:00:10',
        'America/Los_Angeles'
      );
      vi.setSystemTime(tomorrow);
      const tomorrowIso = tomorrowDay.toISOString().slice(0, 10);
      applyCalendarRange(tomorrowIso);
      if (intent === 'calendar') {
        applyCalendarRange(TEST_END_DATE);
      } else {
        fireEvent.click(screen.getByRole('button', { name: '1 Day', exact: true }));
        fireEvent.click(screen.getByRole('button', { name: 'Previous Period' }));
      }
      expect(snapshotEnd()).toBe(TEST_END_DATE);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(snapshotEnd()).toBe(TEST_END_DATE);
    } finally {
      cleanup();
      vi.useRealTimers();
    }
  });
}

/* STAGE 2 (2026-11-15): a union club's readers answer on the 02:00 Chicago
   accounting day; the report counts, selects and labels the window by it. */
it('a union club reads the 02:00 accounting window and says what it counts', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  // Noon: the calendar and accounting days agree, so the request is today's.
  vi.setSystemTime(chicagoInstant(TEST_END_DATE, '12:00:00'));
  try {
    const union = {
      ...snapshot,
      summary: { ...snapshot.summary, on_felt: 640.5 },
      accounting_basis: 'union_invoice_accounting',
      day_basis: 'America/Chicago 02:00',
      accounting_coverage: {
        complete: false,
        missing_days: [],
        failed_days: ['2026-11-04'],
        not_invoice_exact_days: [],
        provisional: true,
        provisional_from: '2026-11-09',
        window_start: '2026-11-02T08:00:00+00:00',
        window_end: '2026-11-16T08:00:00+00:00',
      },
    };
    rpcMock.mockImplementation(async (fn: string, args?: Record<string, unknown>) => {
      if (fn === 'ca_club_data_snapshot_v2') return { data: union, error: null };
      if (fn === 'ca_club_game_page') return { data: gamePageFor(args), error: null };
      if (fn === 'ca_club_union_invoices') return { data: [], error: null };
      return { data: null, error: null };
    });
    render(<ClubDataPage />);
    await screen.findByText('Shark Table One');
    expect(rpcMock).toHaveBeenCalledWith(
      'ca_club_data_snapshot_v2',
      expect.objectContaining({ p_start: TEST_START_DATE, p_end: TEST_END_DATE })
    );
    // The chip prints the reader's own boundary instants.
    expect(screen.getByText('Nov 2, 2026 2:00 AM To Now')).toBeInTheDocument();
    // The basis follows the verified answer (an effect after it paints).
    fireEvent.click(screen.getByRole('button', { name: 'Select Date Range' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Pacific Accounting Dates');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(
      screen.getByText(
        'Days Run Midnight To Midnight Pacific Time. Weeks Run Monday Through Sunday.'
      )
    ).toBeInTheDocument();
    expect(screen.getByText(/^Union Invoice Basis\. Fee Is The Rake Credited/)).toBeInTheDocument();
    expect(
      screen.getByText(/^Provisional From Nov 9, 2026 2:00 AM Chicago Time: No Weekly Invoice/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Incomplete: Load Failed: Nov 4, 2026. These Totals Can Differ From The Union Invoice Until Those Days Are Whole.'
      )
    ).toBeInTheDocument();
    expect(screen.getByText('On The Felt Now 640.50')).toBeInTheDocument();
    // Explanations sit behind a closed "?" (Dan, 2026-11-15), never on the page.
    expect(screen.getByText(/^Union Invoice Basis\. Fee Is/).closest('details')?.open).toBe(false);
    expect(screen.getByTestId('rake-snapshot-basis').closest('details')).not.toBeNull();
    // The rake snapshot keeps its own basis and never reads as the Fee tile.
    expect(screen.getByTestId('rake-snapshot-basis')).toHaveTextContent(
      'Invoice Headlines Include All Recorded Fees. Agent Rows Show Gross Cash Rake By Seat Club And Downline In Pacific Midnight Days.'
    );
    expect(rakePanelProps.current?.headlineLabel).toBeUndefined();
  } finally {
    cleanup();
    vi.useRealTimers();
  }
});

it('a club in no union keeps the rake snapshot exactly as it was', async () => {
  rakePanelProps.current = null;
  render(<ClubDataPage />);
  await screen.findByText('Shark Table One');
  await waitFor(() => expect(rakePanelProps.current).not.toBeNull());
  expect(rakePanelProps.current?.headlineLabel).toBeUndefined();
  expect(screen.queryByTestId('rake-snapshot-basis')).toBeNull();
});

/* REVIEW BLOCKER (2026-11-15): between midnight and 02:00 Chicago a union
   club's reader clamps the last day to the accounting day still open. The
   page asks for the calendar day before it knows the basis; the clamped
   answer must teach it the basis and lead to a re-read, never to "Could Not
   Load Club Data". */
describe('a union club opened between midnight and 02:00 Chicago', () => {
  const OPEN_DAY = '2026-11-15'; // fn_ca_accounting_day at Mon 2026-11-16 01:30 CST
  function unionAnswer(args: Record<string, unknown>) {
    const requestedEnd = String(args.p_end);
    const end = requestedEnd > OPEN_DAY ? OPEN_DAY : requestedEnd;
    const start = String(args.p_start);
    const days =
      Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) +
      1;
    return {
      ...snapshot,
      range: { start, end, days },
      previous_range: { start: shiftDay(start, -days), end: shiftDay(start, -1), days },
      accounting_basis: 'union_invoice_accounting',
      day_basis: 'America/Chicago 02:00',
      accounting_coverage: {
        complete: true,
        missing_days: [],
        failed_days: [],
        not_invoice_exact_days: [],
        provisional: true,
        provisional_from: '2026-11-09',
        window_start: `${start}T08:00:00+00:00`,
        window_end: `${shiftDay(end, 1)}T08:00:00+00:00`,
      },
    };
  }

  it('re-reads the open accounting day and paints the ledger, with a union CSV window', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-11-16T07:30:00Z'));
    try {
      rpcMock.mockImplementation(async (fn: string, args?: Record<string, unknown>) => {
        if (fn === 'ca_club_data_snapshot_v2') return { data: unionAnswer(args!), error: null };
        if (fn === 'ca_club_union_invoices') return { data: [], error: null };
        if (fn === 'ca_club_game_export_start') {
          return { data: { export_id: 'export-u', total_rows: 1, status: 'ready' }, error: null };
        }
        if (fn === 'ca_club_data_export_page') {
          return {
            data: { rows: [snapshot.rows[0]], total_rows: 1, next_offset: 1, has_more: false },
            error: null,
          };
        }
        if (fn === 'ca_club_data_export_cancel') return { data: true, error: null };
        return { data: null, error: null };
      });
      render(<ClubDataPage />);
      expect(await screen.findByText('Shark Table One')).toBeInTheDocument();
      const asked = rpcMock.mock.calls
        .filter(([fn]) => fn === 'ca_club_data_snapshot_v2')
        .map(([, a]) => a as Record<string, string>);
      expect(asked[0]).toMatchObject({ p_start: OPEN_DAY, p_end: OPEN_DAY });
      expect(asked.at(-1)).toMatchObject({ p_start: OPEN_DAY, p_end: OPEN_DAY });
      expect(snapshotEnd()).toBe(OPEN_DAY);
      expect(screen.getByText('Nov 15, 2026 2:00 AM To Now')).toBeInTheDocument();
      expect(screen.queryByText('Ledger Unavailable')).toBeNull();
      expect(screen.queryByText(/Could Not Load/i)).toBeNull();

      // The export states the same window, from the answer it belongs to.
      fireEvent.click(screen.getByRole('button', { name: 'Report Tools', exact: true }));
      const exportButton = await screen.findByRole('button', { name: 'Export As CSV' });
      await waitFor(() => expect(exportButton).toBeEnabled());
      fireEvent.click(exportButton);
      await waitFor(() => expect(downloadMock).toHaveBeenCalledOnce(), { timeout: 10_000 });
      const [name, csv] = downloadMock.mock.calls[0] as unknown as [string, string];
      expect(name).toBe('club_data_2026-11-15_to_2026-11-16.csv');
      const [head, row] = csv.split('\n');
      expect(head.endsWith(',window_start,window_end')).toBe(true);
      expect(row.split(',').slice(-2)).toEqual([
        '2026-11-15T08:00:00.000Z',
        '2026-11-16T08:00:00.000Z',
      ]);
    } finally {
      cleanup();
      vi.useRealTimers();
    }
  }, 20_000);
});

/* #10921 review: a union club's window that starts before its join day is
   answered on its pre-union Chicago basis, and the report says so. */
it('a union club window before its join day shows the Chicago-basis labels', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-11-16T18:00:00Z')); // Mon 12:00 CST
  const JOIN_DAY = '2026-11-02';
  try {
    rpcMock.mockImplementation(async (fn: string, args?: Record<string, unknown>) => {
      if (fn === 'ca_club_data_snapshot_v2') {
        const start = String(args!.p_start);
        const end = String(args!.p_end);
        const days =
          Math.round(
            (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000
          ) + 1;
        const base = {
          ...snapshot,
          union_id: 'fade0000-0000-0000-0000-000000000001',
          range: { start, end, days },
          previous_range: { start: shiftDay(start, -days), end: shiftDay(start, -1), days },
        };
        return {
          data:
            start >= JOIN_DAY
              ? {
                  ...base,
                  accounting_basis: 'union_invoice_accounting',
                  day_basis: 'America/Chicago 02:00',
                }
              : {
                  ...base,
                  accounting_basis: 'chicago_net_money_flow',
                  day_basis: 'America/Chicago',
                },
          error: null,
        };
      }
      if (fn === 'ca_club_union_invoices') return { data: [], error: null };
      return { data: null, error: null };
    });
    render(<ClubDataPage />);
    await screen.findByText('Shark Table One');
    expect(snapshotEnd()).toBe('2026-11-16');
    expect(screen.getByText(/^Union Invoice Basis\./)).toBeInTheDocument();
    // Pick a window that ends Oct 15: its 14 days start Oct 1, before the join day.
    applyCalendarRange('2026-10-01', '2026-10-14');
    expect(
      await screen.findByText('Oct 1, 2026 12:00 AM To Oct 15, 2026 12:00 AM')
    ).toBeInTheDocument();
    expect(rpcMock).toHaveBeenCalledWith(
      'ca_club_data_snapshot_v2',
      expect.objectContaining({ p_start: '2026-10-01', p_end: '2026-10-14' })
    );
    expect(snapshotEnd()).toBe('2026-10-14');
    expect(screen.getByText('Days Run Midnight To Midnight Chicago Time.')).toBeInTheDocument();
    expect(screen.queryByText(/^Union Invoice Basis\./)).toBeNull();
    expect(screen.queryByTestId('rake-snapshot-basis')).toBeNull();
  } finally {
    cleanup();
    vi.useRealTimers();
  }
});

/* REVIEW BLOCKER (2026-11-15): "today" follows the club, not the answer. A
   union club whose window starting before its join day is answered on its
   pre-union Chicago basis must not flip today between the two days. */
it('a union club at 01:30 CST settles in two reads when its window crosses the join day', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-11-16T07:30:00Z')); // Mon 01:30 CST
  const OPEN_DAY = '2026-11-15';
  const JOIN_DAY = '2026-11-16'; // the fresh calendar day is before Pacific midnight
  try {
    rpcMock.mockImplementation(async (fn: string, args?: Record<string, unknown>) => {
      if (fn === 'ca_club_data_snapshot_v2') {
        const start = String(args!.p_start);
        const union = start >= JOIN_DAY;
        const requested = String(args!.p_end);
        // The union basis clamps the last day to the open accounting day.
        const end = union && requested > OPEN_DAY ? OPEN_DAY : requested;
        const days =
          Math.round(
            (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000
          ) + 1;
        return {
          data: {
            ...snapshot,
            union_id: 'fade0000-0000-0000-0000-000000000001',
            range: { start, end, days },
            previous_range: { start: shiftDay(start, -days), end: shiftDay(start, -1), days },
            ...(union
              ? { accounting_basis: 'union_invoice_accounting', day_basis: 'America/Chicago 02:00' }
              : { accounting_basis: 'chicago_net_money_flow', day_basis: 'America/Chicago' }),
          },
          error: null,
        };
      }
      if (fn === 'ca_club_union_invoices') return { data: [], error: null };
      return { data: null, error: null };
    });
    render(<ClubDataPage />);
    await screen.findByText('Shark Table One');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    const asked = rpcMock.mock.calls
      .filter(([fn]) => fn === 'ca_club_data_snapshot_v2')
      .map(([, a]) => a as Record<string, string>);
    expect(asked.length).toBeLessThanOrEqual(2);
    expect(asked[0]).toMatchObject({ p_start: OPEN_DAY, p_end: OPEN_DAY });
    expect(asked.at(-1)).toMatchObject({ p_start: OPEN_DAY, p_end: OPEN_DAY });
    // The window is labelled on the basis it was answered on; today stays 2 AM.
    expect(screen.getByText('Nov 15, 2026 12:00 AM To Now')).toBeInTheDocument();
    expect(snapshotEnd()).toBe(OPEN_DAY);
  } finally {
    cleanup();
    vi.useRealTimers();
  }
}, 20_000);
