import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Current Data reports count Pacific calendar dates for every club.
const pacificToday = (): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

const CLUB_ID = 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4';

const { rpcMock, authState, clubRow, unionRow, rosterMock, navigateMock, routeState } = vi.hoisted(
  () => ({
    routeState: { search: new URLSearchParams() },
    rpcMock: vi.fn(),
    rosterMock: vi.fn(),
    navigateMock: vi.fn(),
    unionRow: {
      current: { unions: { name: 'Midway Union' } } as { unions: { name: string } } | null,
    },
    clubRow: { current: { name: 'Club JAQK' } as { name: string } | null },
    authState: { current: { user: { id: 'owner-1' }, isHydrating: false } as any },
  })
);

vi.mock('../../src/services/ClubRosterService', () => ({
  ClubRosterService: { getDataPlayerMatches: rosterMock },
}));

vi.mock('../../src/hooks/useAuthUser', () => ({ useAuthUser: () => authState.current }));
vi.mock('react-router-dom', async () => {
  const { useState } = await import('react');
  return {
    useNavigate: () => navigateMock,
    useParams: () => ({ clubId: CLUB_ID }),
    useSearchParams: () => {
      const [params, setParams] = useState(routeState.search);
      return [
        params,
        (next: URLSearchParams) => {
          routeState.search = next;
          setParams(next);
        },
      ];
    },
  };
});
vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    rpc: rpcMock,
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: table === 'union_clubs' ? unionRow.current : clubRow.current,
            error: null,
          }),
        }),
      }),
    }),
  },
}));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));

import ClubDataSimplePage, {
  addDays,
  formatMoney,
  formatTotal,
  headerTitle,
  isSnapshot,
  refreshIntervalMs,
} from '../../src/pages/club/ClubDataSimplePage';

const today = pacificToday();
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

const live = {
  scope: 'club',
  range: { start: today, end: today, days: 1 },
  summary: {
    games: 3,
    total_winnings: -1234.5,
    mtt_winnings: 210,
    cash_winnings: -1444.5,
    fee: 987.25,
    on_felt: 5400,
  },
  rows: [
    {
      kind: 'CASH',
      id: 'table-1',
      name: 'Shark Tank',
      variant: 'NLH',
      blinds: '1/2',
      started_at: `${today}T00:10:00Z`,
      fee: 50,
      winnings: -50,
      players: 6,
      live: true,
      seated: 5,
      on_felt: 900,
    },
  ],
  generated_at: `${today}T00:30:00Z`,
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

beforeEach(() => {
  routeState.search = new URLSearchParams();
  rpcMock.mockReset();
  rosterMock.mockReset().mockResolvedValue({ items: [] });
  navigateMock.mockReset();
  clubRow.current = { name: 'Club JAQK' };
  unionRow.current = { unions: { name: 'Midway Union' } };
  authState.current = { user: { id: 'owner-1' }, isHydrating: false };
});

describe('helpers', () => {
  it('formats money with two decimals and a dash for nothing', () => {
    expect(formatMoney(1234.5)).toBe('1,234.50');
    expect(formatMoney(-0.1)).toBe('-0.10');
    expect(formatMoney(undefined)).toBe('-');
  });

  it('steps calendar days without drifting across a month', () => {
    expect(addDays('2026-10-01', -1)).toBe('2026-09-30');
    expect(addDays('2026-10-14', 0)).toBe('2026-10-14');
  });

  it('fits a large total in its tile without losing the exact figure', () => {
    expect(formatTotal(9_999.5)).toBe('9,999.50');
    expect(formatTotal(149_602.37)).toBe('149,602.37');
    expect(formatTotal(-55_668.2)).toBe('-55,668.20');
    expect(formatTotal(3_544_599.22)).toBe('3,544,599.22');
    expect(formatTotal(undefined)).toBe('-');
  });

  it('refreshes faster on the live day', () => {
    expect(refreshIntervalMs(1)).toBe(15_000);
    expect(refreshIntervalMs(14)).toBe(60_000);
  });

  it('refuses a payload without the four totals', () => {
    expect(isSnapshot(live)).toBe(true);
    expect(isSnapshot({ range: {}, summary: { games: 1 }, rows: [] })).toBe(false);
    expect(isSnapshot(null)).toBe(false);
  });
});

describe('ClubDataSimplePage', () => {
  it('renders reconciliation from the same accepted headline snapshot', async () => {
    rpcMock.mockResolvedValue({
      data: {
        ...live,
        accounting_basis: 'union_invoice_accounting',
        accounting_coverage: { complete: true, provisional: true, awaiting_boundary_days: [today] },
        summary: {
          ...live.summary,
          reconciliation: {
            complete: true,
            missing_days: [],
            bbj_gross: 12.5,
            bbj_awards: 3.25,
            bbj_net: 9.25,
            cash_fee: 987.25,
            cash_winnings: -1444.5,
            tournament_fee: 0,
            tournament_winnings: 210,
            cash_residual: 448,
            tournament_flow_difference: -210,
          },
        },
      },
      error: null,
    });
    render(<ClubDataSimplePage />);
    expect(await screen.findByText('BBJ Collected')).toBeInTheDocument();
    expect(screen.getByText('12.50')).toBeInTheDocument();
    expect(screen.getByText('Final Billing Pending')).toBeInTheDocument();
  });
  it('retires owner figures immediately when an agent account is still hydrating', async () => {
    rpcMock.mockResolvedValue({ data: live, error: null });
    const view = render(<ClubDataSimplePage />);
    await screen.findByText('Shark Tank');
    authState.current = { user: { id: 'agent-1' }, isHydrating: true };
    view.rerender(<ClubDataSimplePage />);
    expect(screen.queryByText('Shark Tank')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Advanced$/i })).not.toBeInTheDocument();
  });

  it('ignores a previous owner response after switching to an agent', async () => {
    let finishOwner!: (value: unknown) => void;
    rpcMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOwner = resolve;
        })
    );
    const view = render(<ClubDataSimplePage />);
    await waitFor(() => expect(rpcMock).toHaveBeenCalled());
    authState.current = { user: { id: 'agent-1' }, isHydrating: false };
    rpcMock.mockResolvedValue({ data: { ...live, scope: 'downline', rows: [] }, error: null });
    view.rerender(<ClubDataSimplePage />);
    await screen.findByText('You And Your Downline');
    await act(async () => finishOwner({ data: live, error: null }));
    expect(screen.queryByText('Shark Tank')).not.toBeInTheDocument();
    expect(screen.getByText('You And Your Downline')).toBeInTheDocument();
  });

  it('removes previously visible figures when authorization is revoked', async () => {
    rpcMock.mockResolvedValue({ data: live, error: null });
    render(<ClubDataSimplePage />);
    await screen.findByText('Shark Tank');
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'not authorized for this club' },
    });
    fireEvent(document, new Event('visibilitychange'));
    await waitFor(() => expect(screen.queryByText('Shark Tank')).not.toBeInTheDocument());
  });

  it('follows Pacific midnight even when the 15 second refresh renders first', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-23T06:59:50Z'));
    rpcMock.mockResolvedValue({ data: live, error: null });
    await act(async () => {
      render(<ClubDataSimplePage />);
    });
    expect(rpcMock.mock.calls.at(-1)?.[1].p_end).toBe('2026-10-22');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(rpcMock.mock.calls.at(-1)?.[1]).toMatchObject({
      p_start: '2026-10-23',
      p_end: '2026-10-23',
    });
  });

  it.each([
    ['2026-03-08T08:00:00Z', '2026-03-09T07:00:00Z'],
    ['2026-11-01T07:00:00Z', '2026-11-02T08:00:00Z'],
    ['2026-10-22T20:00:00Z', '2026-10-25T20:00:00Z'],
  ])('follows the calendar after returning from %s to %s', async (before, after) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(before));
    rpcMock.mockResolvedValue({ data: live, error: null });
    await act(async () => {
      render(<ClubDataSimplePage />);
    });
    vi.setSystemTime(new Date(after));
    await act(async () => {
      fireEvent(document, new Event('visibilitychange'));
    });
    expect(rpcMock.mock.calls.at(-1)?.[1]).toMatchObject({
      p_start: pacificToday(),
      p_end: pacificToday(),
    });
  });

  it('keeps a deliberately selected historical day after returning later', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-22T20:00:00Z'));
    rpcMock.mockResolvedValue({ data: live, error: null });
    await act(async () => {
      render(<ClubDataSimplePage />);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Previous Period' }));
    });
    vi.setSystemTime(new Date('2026-10-25T20:00:00Z'));
    await act(async () => {
      fireEvent(document, new Event('visibilitychange'));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(rpcMock.mock.calls.at(-1)?.[1]).toMatchObject({
      p_start: '2026-10-21',
      p_end: '2026-10-21',
    });
  });

  it('identifies an authorized union aggregate and its Chicago money-flow basis', async () => {
    rpcMock.mockResolvedValue({
      data: { ...live, reporting_scope: 'union', accounting_basis: 'chicago_net_money_flow' },
      error: null,
    });
    render(<ClubDataSimplePage />);
    expect(await screen.findByText('All Member Clubs And Union Account')).toBeTruthy();
    expect(screen.getByText(/Net Entries And Payouts In Chicago Time/)).toBeTruthy();
    expect(screen.getByText(/MTT Winnings Count Finished MTTs Only/)).toBeTruthy();
    expect(screen.getAllByText('Chicago Time').length).toBeGreaterThan(0);
  });

  it('a page served by the old database still says what it counts', async () => {
    rpcMock.mockResolvedValue({
      data: { ...live, accounting_basis: 'utc_net_money_flow' },
      error: null,
    });
    render(<ClubDataSimplePage />);
    expect(await screen.findByText(/Unfinished Event Entries Included/)).toBeTruthy();
  });

  it('shows Unfinished MTT Entries beside finished MTT Winnings', async () => {
    rpcMock.mockResolvedValue({
      data: { ...live, summary: { ...live.summary, running_mtt_entries: -3_570 } },
      error: null,
    });
    render(<ClubDataSimplePage />);
    expect(await screen.findByText('Unfinished MTT Entries')).toBeTruthy();
    expect(screen.getByText('-3,570.00')).toBeTruthy();
    expect(screen.getByText('210.00')).toBeTruthy();
  });

  it('asks for the Pacific day, not the UTC day', async () => {
    rpcMock.mockResolvedValue({ data: live, error: null });
    render(<ClubDataSimplePage />);
    await screen.findByText('987.25');
    expect(rpcMock.mock.calls[0][1]).toMatchObject({ p_start: today, p_end: today });
  });

  it('attributes games to the union even when the creator is missing or named', async () => {
    rpcMock.mockResolvedValue({
      data: {
        ...live,
        rows: [
          { ...live.rows[0], creator_name: 'kingfish' },
          { ...live.rows[0], id: 'table-2', creator_name: null },
        ],
      },
      error: null,
    });
    render(<ClubDataSimplePage />);
    await waitFor(() => expect(screen.getAllByText('By Midway Union')).toHaveLength(2));
    expect(screen.queryByText(/kingfish/i)).toBeNull();
  });

  it('uses the club name when there is no hosting union, never the creator', async () => {
    unionRow.current = null;
    rpcMock.mockResolvedValue({
      data: { ...live, rows: [{ ...live.rows[0], creator_name: 'kingfish' }] },
      error: null,
    });
    render(<ClubDataSimplePage />);
    expect(await screen.findByText('By Club JAQK')).toBeTruthy();
    expect(screen.queryByText(/kingfish/i)).toBeNull();
  });

  it('counts all live games beyond the 200 displayed rows', async () => {
    rpcMock.mockResolvedValue({
      data: { ...live, summary: { ...live.summary, live_games: 245 } },
      error: null,
    });
    render(<ClubDataSimplePage />);
    expect(await screen.findByText(/245 Games In Play/)).toBeTruthy();
  });

  it('shows the four live totals and a live game', async () => {
    rpcMock.mockResolvedValue({ data: live, error: null });
    render(<ClubDataSimplePage />);
    expect(await screen.findByText('987.25')).toBeTruthy();
    expect(screen.getByText('-1,234.50')).toBeTruthy();
    expect(screen.getByText('210.00')).toBeTruthy();
    expect(screen.getByText('Shark Tank')).toBeTruthy();
    expect(screen.getByText('Live', { selector: 'span' })).toBeTruthy();
    const [fn, args] = rpcMock.mock.calls[0];
    expect(fn).toBe('ca_club_data_screen');
    expect(args).toMatchObject({ p_club_id: CLUB_ID, p_start: today, p_end: today, p_game: 'ALL' });
  });

  it('says there is no data only when the read succeeded and found none', async () => {
    rpcMock.mockResolvedValue({
      data: { ...live, summary: { ...live.summary, games: 0 }, rows: [] },
      error: null,
    });
    render(<ClubDataSimplePage />);
    expect(await screen.findByText('No Data In This Period.')).toBeTruthy();
  });

  it('keeps the last good figures when a refresh fails, and never paints zeros', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    rpcMock.mockResolvedValueOnce({ data: live, error: null });
    rpcMock.mockResolvedValue({ data: null, error: { code: '57014', message: 'timeout' } });
    render(<ClubDataSimplePage />);
    expect(await screen.findByText('987.25')).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(15_000);
    });
    await waitFor(() =>
      expect(
        screen.getAllByText('Club Data Could Not Be Read. Showing The Last Good Figures.')[0]
      ).toBeTruthy()
    );
    expect(screen.getByText('987.25')).toBeTruthy();
  });

  /* UPDATED 2026-10-17: agents of every rank now read their own downline
     (fn_ca_club_data_scope); a regular player is the one refused. */
  it('tells a viewer without finance rights why, instead of showing zeros', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'not authorized for this club' },
    });
    render(<ClubDataSimplePage />);
    expect(
      await screen.findByText('Club Data Is Open To The Club Owner, Admins And Agents.')
    ).toBeTruthy();
    expect(screen.queryByText('0.00')).toBeNull();
  });

  it('names the club next to Club Data: "CLUB JAQK - CLUB DATA"', async () => {
    rpcMock.mockResolvedValue({
      data: { ...live, club_name: 'Club JAQK', scope: 'club' },
      error: null,
    });
    render(<ClubDataSimplePage />);
    const title = await screen.findByRole('heading', { level: 1 });
    expect(title).toHaveTextContent('Club Data');
    await waitFor(() => expect(title.closest('header')).toHaveTextContent('Club JAQK'));
    expect(headerTitle(null)).toBe('Club Data');
    fireEvent.click(screen.getByRole('button', { name: 'Open Club Report' }));
    expect(navigateMock).toHaveBeenCalledWith(
      `/clubs/${CLUB_ID}/data/advanced?dataStart=${today}&dataEnd=${today}&dataGame=ALL&dataStakes=ALL&dataSearch=&view=advanced`
    );
  });

  it('an agent reads his own downline, and has no whole-club report door', async () => {
    rpcMock.mockResolvedValue({
      data: { ...live, club_name: 'Club JAQK', scope: 'downline' },
      error: null,
    });
    render(<ClubDataSimplePage />);
    expect(await screen.findByText(/You And Your Downline/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open Club Report' })).toBeNull();
  });
});

describe('earned fees and direct player lookup', () => {
  it('prints the canonical personal share instead of gross downline rake', async () => {
    rpcMock.mockResolvedValue({
      data: {
        ...live,
        scope: 'downline',
        member_fees: {
          cash_fees: 924.25,
          tournament_fees: 3.5,
          total_fees: 927.75,
          day_basis: 'UTC',
        },
        summary: { ...live.summary, fee: 2163.29 },
      },
      error: null,
    });
    render(<ClubDataSimplePage />);
    expect(await screen.findByText('927.75')).toBeVisible();
    expect(screen.getByText('My Fees Earned')).toBeVisible();
    expect(screen.queryByText('2,163.29')).not.toBeInTheDocument();
  });

  it('prints full large club fees', async () => {
    rpcMock.mockResolvedValue({
      data: { ...live, summary: { ...live.summary, fee: 31400.25 } },
      error: null,
    });
    render(<ClubDataSimplePage />);
    expect(await screen.findByText('31,400.25')).toBeVisible();
  });

  it('finds a named permitted player and opens their actual record', async () => {
    rpcMock.mockResolvedValue({ data: live, error: null });
    rosterMock.mockResolvedValue({
      items: [
        {
          user_id: 'woo-id',
          alias: 'WooWoo',
          display_name: 'Private Legal Name',
          username: 'account-name',
          can_view_financials: true,
          management_club_id: CLUB_ID,
        },
        { user_id: 'private-id', alias: 'Private', can_view_financials: false },
      ],
    });
    render(<ClubDataSimplePage />);
    await screen.findByText('Shark Tank');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'WooWoo' } });
    fireEvent.click(await screen.findByRole('button', { name: /WooWoo.*View Player Data/i }));
    expect(navigateMock).toHaveBeenCalledWith(
      `/clubs/${CLUB_ID}/members/woo-id?dataClub=${CLUB_ID}&dataStart=${today}&dataEnd=${today}&dataGame=ALL&dataStakes=ALL&dataSearch=WooWoo`
    );
    expect(screen.queryByText('Private')).not.toBeInTheDocument();
    expect(screen.queryByText('Private Legal Name')).not.toBeInTheDocument();
  });

  it('opens KingFish from the identity-only result instead of a crowded upline page', async () => {
    rpcMock.mockResolvedValue({ data: live, error: null });
    rosterMock.mockResolvedValue({
      items: [
        {
          user_id: 'kingfish-id',
          alias: 'KingFish',
          username: 'kingfish',
          can_view_financials: true,
          management_club_id: 'management-club',
        },
      ],
    });
    render(<ClubDataSimplePage />);
    await screen.findByText('Shark Tank');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'KingFish' } });
    fireEvent.click(await screen.findByRole('button', { name: /KingFish.*View Player Data/i }));
    expect(rosterMock).toHaveBeenCalledWith(CLUB_ID, {
      search: 'KingFish',
      signal: expect.any(AbortSignal),
    });
    expect(navigateMock).toHaveBeenCalledWith(
      `/clubs/management-club/members/kingfish-id?dataClub=${CLUB_ID}&dataStart=${today}&dataEnd=${today}&dataGame=ALL&dataStakes=ALL&dataSearch=KingFish`
    );
  });

  it('discards player results after account hydration begins', async () => {
    rpcMock.mockResolvedValue({ data: live, error: null });
    let finish!: (value: unknown) => void;
    rosterMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const view = render(<ClubDataSimplePage />);
    await screen.findByText('Shark Tank');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'WooWoo' } });
    await waitFor(() => expect(rosterMock).toHaveBeenCalled());
    authState.current = { user: { id: 'other-account' }, isHydrating: true };
    view.rerender(<ClubDataSimplePage />);
    await act(async () =>
      finish({ items: [{ user_id: 'woo', alias: 'WooWoo', can_view_financials: true }] })
    );
    expect(screen.queryByRole('button', { name: /View Player Data/i })).not.toBeInTheDocument();
  });
});

it('finds a player independently when the game search fails', async () => {
  routeState.search = new URLSearchParams('dataSearch=');
  rpcMock.mockResolvedValueOnce({ data: live, error: null });
  rpcMock.mockResolvedValue({
    data: null,
    error: { code: '57014', message: 'Game Read Timed Out' },
  });
  rosterMock.mockResolvedValue({
    items: [
      {
        user_id: 'woo-id',
        alias: 'WooWoo',
        can_view_financials: true,
        management_club_id: CLUB_ID,
      },
    ],
  });
  render(<ClubDataSimplePage />);
  await screen.findByText('Shark Tank');
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'WooWoo' } });
  expect(await screen.findByRole('button', { name: /WooWoo.*View Player Data/i })).toBeVisible();
  await waitFor(() =>
    expect(
      screen.getAllByText('Club Data Could Not Be Read. Showing The Last Good Figures.')[0]
    ).toBeVisible()
  );
});

describe('Selectable Chicago Dates And Player Totals', () => {
  beforeEach(() => rpcMock.mockResolvedValue({ data: live, error: null }));
  it('applies exact custom dates, shifts the same inclusive span and restores presets', async () => {
    render(<ClubDataSimplePage />);
    await screen.findByText('Shark Tank');
    fireEvent.click(screen.getByRole('button', { name: 'Select Date Range' }));
    selectCalendarDay(addDays(today, -5));
    selectCalendarDay(addDays(today, -2));
    fireEvent.click(screen.getByRole('button', { name: 'Apply Dates' }));
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith(
        'ca_club_data_screen',
        expect.objectContaining({ p_start: addDays(today, -5), p_end: addDays(today, -2) })
      )
    );
    fireEvent.click(screen.getByRole('button', { name: 'Previous Period' }));
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith(
        'ca_club_data_screen',
        expect.objectContaining({ p_start: addDays(today, -9), p_end: addDays(today, -6) })
      )
    );
    fireEvent.click(screen.getByRole('button', { name: '1 Day' }));
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith(
        'ca_club_data_screen',
        expect.objectContaining({ p_start: today, p_end: today })
      )
    );
  });
  it('offers keyboard-accessible breakdown actions for all three totals', async () => {
    render(<ClubDataSimplePage />);
    await screen.findByText('Shark Tank');
    expect(
      screen.getByRole('button', { name: 'View Total Winnings By Player' })
    ).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'View MTT Winnings By Player' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'View Fees By Player' })).not.toBeDisabled();
  });
});

it('keeps selected dates when access hydration unmounts and remounts the page', async () => {
  rpcMock.mockResolvedValue({ data: live, error: null });
  routeState.search = new URLSearchParams('club=preserved');
  const view = render(<ClubDataSimplePage />);
  await screen.findByText('Shark Tank');
  fireEvent.click(screen.getByRole('button', { name: 'Select Date Range' }));
  selectCalendarDay(addDays(today, -5));
  selectCalendarDay(addDays(today, -2));
  fireEvent.click(screen.getByRole('button', { name: 'Apply Dates' }));
  expect(routeState.search.get('dataEnd')).toBe(addDays(today, -2));
  expect(routeState.search.has('dataUntil')).toBe(false);
  view.unmount();
  rpcMock.mockClear();
  render(<ClubDataSimplePage />);
  await screen.findByText('Shark Tank');
  expect(rpcMock.mock.calls.at(-1)?.[1]).toMatchObject({
    p_start: addDays(today, -5),
    p_end: addDays(today, -2),
  });
  expect(routeState.search.get('club')).toBe('preserved');
});

it.each([
  ['2026-02-30', '2026-03-01'],
  ['2026-11-05', '2026-11-04'],
  ['2020-01-01', '2026-11-01'],
  ['2099-01-01', '2099-01-02'],
])('does not send invalid URL dates %s to %s to the reporting RPC', async (start, end) => {
  routeState.search = new URLSearchParams({ dataStart: start, dataEnd: end });
  rpcMock.mockResolvedValue({ data: live, error: null });
  render(<ClubDataSimplePage />);
  expect(screen.getByRole('alert')).toBeVisible();
  expect(rpcMock).not.toHaveBeenCalled();
});

it('retains a shifted preset after remount and resumes today when shifted back', async () => {
  rpcMock.mockResolvedValue({ data: live, error: null });
  const view = render(<ClubDataSimplePage />);
  await screen.findByText('Shark Tank');
  fireEvent.click(screen.getByRole('button', { name: 'Previous Period' }));
  view.unmount();
  render(<ClubDataSimplePage />);
  await screen.findByText('Shark Tank');
  expect(rpcMock.mock.calls.at(-1)?.[1]).toMatchObject({
    p_start: addDays(today, -1),
    p_end: addDays(today, -1),
  });
  fireEvent.click(screen.getByRole('button', { name: 'Next Period' }));
  await waitFor(() =>
    expect(rpcMock.mock.calls.at(-1)?.[1]).toMatchObject({
      p_start: today,
      p_end: today,
    })
  );
  expect(routeState.search.has('dataEnd')).toBe(false);
});

/* STAGE 2 (2026-11-15): a Midway Union club's readers answer on the union
   invoice's 02:00 Chicago accounting day and say so; the screen counts,
   selects and labels the window by that answer. */
describe('the union invoice basis', () => {
  const unionLive = {
    ...live,
    range: { start: '2026-11-02', end: '2026-11-08', days: 7 },
    accounting_basis: 'union_invoice_accounting',
    day_basis: 'America/Chicago 02:00',
    accounting_coverage: {
      complete: false,
      missing_days: ['2026-11-03'],
      failed_days: [],
      not_invoice_exact_days: ['2026-11-02'],
      provisional: true,
      provisional_from: '2026-11-09',
      window_start: '2026-11-02T08:00:00+00:00',
      window_end: '2026-11-09T08:00:00+00:00',
      day_boundary: '02:00',
      day_zone: 'America/Chicago',
      source: 'ca_club_acct_fact',
    },
  };

  it.each([
    ['dataUntil', { dataStart: '2026-11-02', dataUntil: '2026-11-09' }],
    ['legacy dataEnd', { dataStart: '2026-11-02', dataEnd: '2026-11-08' }],
  ])('reads the %s pair as the seven-day invoice week and labels it', async (_n, params) => {
    routeState.search = new URLSearchParams(params);
    rpcMock.mockResolvedValue({ data: unionLive, error: null });
    render(<ClubDataSimplePage />);
    await screen.findByText('Shark Tank');
    expect(rpcMock.mock.calls.at(-1)?.[1]).toMatchObject({
      p_start: '2026-11-02',
      p_end: '2026-11-08',
    });
    expect(screen.getByText('Nov 2, 2026 2:00 AM To Nov 9, 2026 2:00 AM')).toBeTruthy();
    expect(screen.getAllByText('Chicago Time').length).toBeGreaterThan(0);
    // Explanations live behind the "?" (Dan, 2026-11-15), never on the page.
    const tip = screen.getByTestId('data-help-tip');
    expect(tip.hasAttribute('open')).toBe(false);
    expect(tip.textContent).toMatch(
      /Days Run Midnight To Midnight Pacific Time\. Weeks Run Monday Through Sunday\./
    );
    expect(screen.getByText(/^Union Invoice Basis\./).closest('details')).toBe(tip);
    expect(screen.getByText(/Total Winnings Equals Its Player Win\/Loss/)).toBeTruthy();
    // Tournament fees count when the tournament settles; no running MTT fee.
    expect(
      screen.getByText(/Tournament Fees Are Recognized When The Tournament Settles\./)
    ).toBeTruthy();
    expect(screen.queryByText(/Running MTT Fee/i)).toBeNull();
    // Total Winnings is cash plus every tournament result; MTT Winnings is
    // finished MTTs only (review, 2026-11-15).
    expect(
      screen.getByText(
        /Plus Tournament Results \(MTT Winnings, Sit And Go Results And Unfinished MTT Entries\)\. MTT Winnings Are Finished MTTs Only/
      )
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Provisional From Nov 9, 2026 2:00 AM Chicago Time: No Weekly Invoice Has Been Issued For That Part Of The Window Yet, So These Figures Can Still Change.'
      )
    ).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe(
      'Incomplete: Not Yet Loaded: Nov 3, 2026. Week Boundary Not Invoice-Exact: Nov 2, 2026. These Totals Can Differ From The Union Invoice Until Those Days Are Whole.'
    );
    // Shown, never added: the felt sits beside Total Winnings.
    expect(screen.getByText('On The Felt Now')).toBeTruthy();
    expect(screen.getByText('5,400.00')).toBeTruthy();
    expect(screen.queryByText(/Net Entries And Payouts In Chicago Time/)).toBeNull();
  });

  it('a window before the club joined its union reads and says the Chicago basis', async () => {
    // The readers answer a union club's window that starts before its join
    // day on the club's pre-union Chicago midnight basis (#10921 review).
    rpcMock.mockImplementation(async (_fn: string, args: Record<string, string>) => ({
      data:
        args.p_start >= '2026-11-02'
          ? unionLive
          : {
              ...live,
              range: { start: args.p_start, end: args.p_end, days: 7 },
              accounting_basis: 'chicago_net_money_flow',
              day_basis: 'America/Chicago',
            },
      error: null,
    }));
    routeState.search = new URLSearchParams({ dataStart: '2026-11-02', dataUntil: '2026-11-09' });
    render(<ClubDataSimplePage />);
    expect(await screen.findByText('Nov 2, 2026 2:00 AM To Nov 9, 2026 2:00 AM')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Select Date Range' }));
    selectCalendarDay('2026-10-01');
    selectCalendarDay('2026-10-07');
    fireEvent.click(screen.getByRole('button', { name: 'Apply Dates' }));
    expect(await screen.findByText('Oct 1, 2026 12:00 AM To Oct 8, 2026 12:00 AM')).toBeTruthy();
    expect(rpcMock.mock.calls.at(-1)?.[1]).toMatchObject({
      p_start: '2026-10-01',
      p_end: '2026-10-07',
    });
    expect(screen.getByText(/Net Entries And Payouts In Chicago Time/)).toBeTruthy();
    expect(screen.queryByText(/Union Invoice Basis/)).toBeNull();
    expect(screen.queryByText(/Provisional/)).toBeNull();
    expect(screen.queryByText('On The Felt Now (Not In Total Winnings)')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Select Date Range' }));
    expect(screen.getByText(/^Days Run Midnight To Midnight Chicago Time\./)).toBeTruthy();
  });

  it('selects one inclusive accounting day with one click and Apply', async () => {
    routeState.search = new URLSearchParams({ dataStart: '2026-11-02', dataUntil: '2026-11-09' });
    rpcMock.mockResolvedValue({ data: unionLive, error: null });
    render(<ClubDataSimplePage />);
    await screen.findByText('Shark Tank');
    fireEvent.click(screen.getByRole('button', { name: 'Select Date Range' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Through Nov 8, 2026');
    expect(screen.queryByLabelText('Start Date')).toBeNull();
    selectCalendarDay('2026-11-02');
    fireEvent.click(screen.getByRole('button', { name: 'Apply Dates' }));
    await waitFor(() =>
      expect(rpcMock.mock.calls.at(-1)?.[1]).toMatchObject({
        p_start: '2026-11-02',
        p_end: '2026-11-02',
      })
    );
  });

  it('between midnight and 02:00 Chicago it reads the accounting day still open', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-16T07:30:00Z')); // Mon 01:30 CST
    // Like the server: a union club's reader clamps the last day to the
    // accounting day still open (LEAST(p_end, fn_ca_accounting_day(now()))).
    rpcMock.mockImplementation(async (_fn: string, args: Record<string, string>) => {
      const end = args.p_end > '2026-11-15' ? '2026-11-15' : args.p_end;
      const start = args.p_start > end ? end : args.p_start;
      return { data: { ...unionLive, range: { start, end, days: 1 } }, error: null };
    });
    await act(async () => {
      render(<ClubDataSimplePage />);
    });
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
    }
    // Calendar until the reader answers; then the open accounting day.
    expect(rpcMock.mock.calls[0][1]).toMatchObject({ p_start: '2026-11-15', p_end: '2026-11-15' });
    expect(rpcMock.mock.calls.at(-1)?.[1]).toMatchObject({
      p_start: '2026-11-15',
      p_end: '2026-11-15',
    });
  });

  it('says unfinished MTT entries are inside Total Winnings on the union basis', async () => {
    rpcMock.mockResolvedValue({
      data: { ...unionLive, summary: { ...unionLive.summary, running_mtt_entries: -3_570 } },
      error: null,
    });
    render(<ClubDataSimplePage />);
    expect(await screen.findByText('Unfinished MTT Entries')).toBeTruthy();
    expect(
      screen
        .getByText(
          /Unfinished MTT Entries Are Buy-Ins For MTTs Not Yet Finished, Included In Total/
        )
        .closest('details')
    ).toBeTruthy();
    expect(screen.getByText('-3,570.00')).toBeTruthy();
  });

  it('settles in two reads at 01:30 CST when the day crosses the join day', async () => {
    // "Today" follows the club, not the answer (review, 2026-11-15). The club
    // joined on Nov 16: its 2 AM day Nov 15 is answered on the Chicago basis.
    // No search, game or stakes choice left over from another test.
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-16T07:30:00Z')); // Mon 01:30 CST
    rpcMock.mockImplementation(async (_fn: string, args: Record<string, string>) => {
      const union = args.p_start >= '2026-11-16';
      const end = union && args.p_end > '2026-11-15' ? '2026-11-15' : args.p_end;
      return {
        data: union
          ? { ...unionLive, union_id: 'u-1', range: { start: args.p_start, end, days: 1 } }
          : {
              ...live,
              union_id: 'u-1',
              range: { start: args.p_start, end, days: 1 },
              accounting_basis: 'chicago_net_money_flow',
              day_basis: 'America/Chicago',
            },
        error: null,
      };
    });
    await act(async () => {
      render(<ClubDataSimplePage />);
    });
    for (let i = 0; i < 10; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
    }
    const asked = rpcMock.mock.calls.map(([, a]) => a as Record<string, string>);
    expect(
      asked.length,
      JSON.stringify(asked.map((x) => [x.p_start, x.p_end]))
    ).toBeLessThanOrEqual(2);
    expect(asked[0]).toMatchObject({ p_start: '2026-11-15', p_end: '2026-11-15' });
    expect(asked.at(-1)).toMatchObject({ p_start: '2026-11-15', p_end: '2026-11-15' });
    expect(screen.getByText('Nov 15, 2026 12:00 AM To Now')).toBeTruthy();
    expect(screen.getByText(/Net Entries And Payouts In Chicago Time/)).toBeTruthy();
  });

  it('an agent of a union club sees downline fees on the same basis', async () => {
    rpcMock.mockResolvedValue({
      data: {
        ...unionLive,
        scope: 'downline',
        member_fees: {
          cash_fees: 900,
          tournament_fees: 27.75,
          total_fees: 927.75,
          day_basis: 'America/Chicago 02:00',
          definition: 'downline_accounting_fees',
          source: 'ca_club_acct_fact',
        },
      },
      error: null,
    });
    render(<ClubDataSimplePage />);
    expect(await screen.findByText('Downline Fees')).toBeTruthy();
    expect(screen.getByText('927.75')).toBeTruthy();
    expect(screen.getByText(/Downline Fees Are The Rake Credited For You And Your/)).toBeTruthy();
    expect(screen.queryByText('My Fees Earned')).toBeNull();
  });

  it('the player drilldown labels the same window and totals exactly', async () => {
    routeState.search = new URLSearchParams({ dataStart: '2026-11-02', dataUntil: '2026-11-09' });
    rpcMock.mockImplementation((fn: string, args: Record<string, unknown>) => {
      if (fn === 'ca_club_data_player_totals') {
        const answer = {
          data: {
            contract: 'ca_club_data_player_totals.v1',
            club_id: CLUB_ID,
            range: { start: args.p_start, end: args.p_end },
            filters: { game: 'ALL', stakes: 'ALL', search: null },
            scope: 'club',
            day_basis: 'America/Chicago 02:00',
            accounting_basis: 'union_invoice_accounting',
            accounting_coverage: { ...unionLive.accounting_coverage, missing_days: [] },
            players: [
              { user_id: 'a', name: 'Alpha', total_winnings: 0.1, mtt_winnings: 0, fee: 1 },
              { user_id: 'b', name: 'Bravo', total_winnings: 0.2, mtt_winnings: 0, fee: 2 },
              {
                user_id: 'c',
                name: 'Charlie',
                total_winnings: -1951998.47,
                mtt_winnings: 0,
                fee: 3,
              },
            ],
            generated_at: '2026-11-15T12:00:00Z',
          },
          error: null,
        };
        return { abortSignal: () => Promise.resolve(answer) };
      }
      return Promise.resolve({ data: unionLive, error: null });
    });
    render(<ClubDataSimplePage />);
    await screen.findByText('Shark Tank');
    fireEvent.click(screen.getByRole('button', { name: 'View Total Winnings By Player' }));
    expect(await screen.findByText('Winning Players')).toBeTruthy();
    expect(
      screen.getByText('Nov 2, 2026 2:00 AM To Nov 9, 2026 2:00 AM Chicago Time')
    ).toBeTruthy();
    expect(
      screen.getByText(/^Union Invoice Basis: Cash Winnings \(The Stack Change Of Each Cash Hand/)
    ).toBeTruthy();
    expect(screen.getByText('0.30')).toBeTruthy(); // 0.1 + 0.2, exactly
    expect(screen.getByText('-1,951,998.17')).toBeTruthy(); // the net, exactly
    // The drilldown states its own coverage: Nov 2's boundary, not yet invoiced week.
    expect(
      screen.getAllByText(
        'Incomplete: Week Boundary Not Invoice-Exact: Nov 2, 2026. These Totals Can Differ From The Union Invoice Until Those Days Are Whole.'
      ).length
    ).toBeGreaterThan(0);
  });
});

it('starts a fresh visit on today even with a saved previous preset', async () => {
  localStorage.setItem('ca_player_preference:guest:club/ClubDataSimplePage:preset', '14');
  localStorage.setItem('ca_player_preference:owner-1:club/ClubDataSimplePage:preset', '14');
  rpcMock.mockResolvedValue({ data: live, error: null });
  render(<ClubDataSimplePage />);
  await screen.findByText('Shark Tank');
  expect(screen.getByRole('button', { name: '1 Day' })).toHaveAttribute('aria-pressed', 'true');
  expect(rpcMock).toHaveBeenCalledWith(
    'ca_club_data_screen',
    expect.objectContaining({ p_start: today, p_end: today })
  );
});

it('selects Monday through Sunday as seven inclusive accounting dates', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-11-16T18:00:00Z'));
  rpcMock.mockResolvedValue({
    data: {
      ...live,
      accounting_basis: 'union_invoice_accounting',
      day_basis: 'America/Chicago 02:00',
    },
    error: null,
  });
  render(<ClubDataSimplePage />);
  await screen.findByText('Shark Tank');
  fireEvent.click(screen.getByRole('button', { name: 'Select Date Range' }));
  selectCalendarDay('2026-11-09');
  selectCalendarDay('2026-11-15');
  fireEvent.click(screen.getByRole('button', { name: 'Apply Dates' }));
  await waitFor(() =>
    expect(rpcMock.mock.calls.at(-1)?.[1]).toMatchObject({
      p_start: '2026-11-09',
      p_end: '2026-11-15',
    })
  );
});

describe('standalone Pacific report answers', () => {
  it('starts on the Pacific day before discovery and preserves net-flow fee meaning', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-11-16T07:30:00Z'));
    rpcMock.mockImplementation(async (_name: string, args: Record<string, string>) => ({
      data: {
        ...live,
        scope: 'downline',
        union_id: null,
        accounting_basis: 'pacific_net_money_flow',
        day_basis: 'America/Los_Angeles 00:00',
        range: { start: args.p_start, end: args.p_end, days: 1 },
        member_fees: {
          cash_fees: 4.27,
          tournament_fees: 4.55,
          total_fees: 8.82,
          definition: 'pacific_earned_fees',
          day_basis: 'America/Los_Angeles 00:00',
          source: 'original_earning_receipts',
        },
      },
      error: null,
    }));
    render(<ClubDataSimplePage />);
    await screen.findByText('8.82');
    expect(rpcMock.mock.calls[0][1]).toMatchObject({ p_start: '2026-11-15', p_end: '2026-11-15' });
    expect(screen.getByText('Nov 15, 2026 2:00 AM To Now')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Select Date Range' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Pacific Calendar Dates');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
    fireEvent.click(screen.getByLabelText('How These Figures Are Counted'));
    expect(
      screen.getByText(
        /Your Fees After Shares And Adjustments, Across All Games In This Pacific Window/
      )
    ).toBeTruthy();
    expect(screen.queryByText(/Union Invoice Basis\./)).toBeNull();
  });
  it('clears held figures when the source refuses incomplete Pacific history', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    rpcMock.mockResolvedValueOnce({ data: live, error: null });
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'CLUB_DATA_PACIFIC_WINDOW_INCOMPLETE' },
    });
    render(<ClubDataSimplePage />);
    await screen.findByText('987.25');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(screen.queryByText('987.25')).toBeNull();
    expect(
      screen.getAllByText(
        'Pacific Day Data Is Not Yet Complete. Totals Are Unavailable Until The Selected Days Are Verified.'
      ).length
    ).toBeGreaterThan(0);
    expect(screen.queryByText('No Data In This Period.')).toBeNull();
  });
});
