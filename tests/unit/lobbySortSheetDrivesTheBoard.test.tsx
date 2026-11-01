import { fireEvent, render, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import LobbyTable from '../../src/components/lobby/LobbyTable';
import {
  cashEntry,
  tournamentEntry,
  type LobbyTableRow,
  type LobbyTournamentRow,
  type LobbyEntry,
} from '../../src/components/lobby/lobbyEntries';
import { headingForOrder, orderForHeading } from '../../src/components/lobby/lobbySortBridge';

/* 2026-10-24: the filter sheet's "Sort The Board" chips did nothing on the
   cash tabs, Spins and Heads Up - the board always had a heading sort (the
   Stakes / Buy-In Low To High defaults) and that outranked the sheet. On MTT
   and ALL any heading tapped once outranked it for ever after. The sheet now
   drives the board, and a heading lights the matching chip. */
vi.mock('../../src/hooks/useSpinTierAvailability', () => ({
  useSpinTierAvailability: () => ({ can_draw_100x: false }),
}));
vi.mock('../../src/services/tableWarmup', () => ({
  observeLobbyTableWarmups: vi.fn(() => () => {}),
  warmTable: vi.fn(),
}));

const ctx = {
  waitlistedIds: new Set<string>(),
  seatedIds: new Set<string>(),
  registeredIds: new Set<string>(),
  favoriteIds: new Set<string>(),
};
const game = (id: string, bb: number, players: number) =>
  cashEntry({
    id,
    name: `PLO ${bb / 2}/${bb}`,
    game_variant: 'plo4',
    small_blind: bb / 2,
    big_blind: bb,
    min_buy_in: 20 * bb,
    max_buy_in: 100 * bb,
    current_players: players,
    max_players: 6,
    status: 'open',
  } as LobbyTableRow);
const entries = [game('mid', 2, 6), game('low', 1, 2), game('high', 4, 4)];

function board(category: string, onHeadingSort = vi.fn()) {
  const props = {
    entries,
    category: category as never,
    clubId: 'club-x',
    selectedId: null,
    onSelect: vi.fn(),
    onActivate: vi.fn(),
    ctx,
    onHeadingSort,
  };
  const view = render(
    <MemoryRouter>
      <LobbyTable {...props} requestedOrder={null} />
    </MemoryRouter>
  );
  const press = (key: string, seq: number) =>
    view.rerender(
      <MemoryRouter>
        <LobbyTable {...props} requestedOrder={{ key, seq }} />
      </MemoryRouter>
    );
  const ids = () =>
    Array.from(document.querySelectorAll('.lobby-table-wrap tbody tr[id]')).map((el) =>
      el.id.replace('lt-row-', '')
    );
  return { press, ids, onHeadingSort };
}

describe('the Sort The Board chips drive the board', () => {
  it('on a cash tab each chip takes effect, and Recommended returns the default', () => {
    localStorage.clear();
    const { press, ids } = board('OMAHA');
    expect(ids()).toEqual(['low', 'mid', 'high']); // default: Stakes Low To High
    press('stakes_high', 1);
    expect(ids()).toEqual(['high', 'mid', 'low']);
    press('players', 2);
    expect(ids()).toEqual(['mid', 'high', 'low']);
    press('stakes_low', 3);
    expect(ids()).toEqual(['low', 'mid', 'high']);
    press('players', 4);
    press('recommended', 5);
    expect(ids()).toEqual(['low', 'mid', 'high']);
    expect(
      JSON.parse(localStorage.getItem('ca_player_preference:guest:lobby:headingSort:OMAHA:club-x')!)
    ).toEqual({ key: '', dir: 'asc', chosen: false });
  });

  it('the same chip pressed again after a heading tap still applies', () => {
    localStorage.clear();
    const { press, ids } = board('OMAHA');
    press('stakes_high', 1);
    const head = document.querySelector('.lobby-table-wrap thead') as HTMLElement;
    const players = within(head).getByRole('columnheader', { name: /players/i });
    fireEvent.click(within(players).queryByRole('button') ?? players);
    expect(ids()).toEqual(['low', 'high', 'mid']); // Players asc from the heading
    press('stakes_high', 2);
    expect(ids()).toEqual(['high', 'mid', 'low']);
  });

  it('a chip on ALL clears a heading tapped earlier so the page order shows', () => {
    localStorage.clear();
    localStorage.setItem(
      'ca_player_preference:guest:lobby:headingSort:ALL:club-x',
      JSON.stringify({ key: 'cost', dir: 'asc', chosen: true })
    );
    const { press, ids } = board('ALL');
    expect(ids()).toEqual(['low', 'mid', 'high']);
    press('stakes_high', 1);
    expect(ids()).toEqual(['mid', 'low', 'high']); // the page's own order, as handed in
    expect(
      JSON.parse(localStorage.getItem('ca_player_preference:guest:lobby:headingSort:ALL:club-x')!)
    ).toEqual({ key: '', dir: 'asc', chosen: false });
  });

  it('a heading the player taps is reported so the sheet can light its chip', () => {
    localStorage.clear();
    const { onHeadingSort } = board('OMAHA');
    const head = document.querySelector('.lobby-table-wrap thead') as HTMLElement;
    const players = within(head).getByRole('columnheader', { name: /players/i });
    fireEvent.click(within(players).queryByRole('button') ?? players);
    expect(onHeadingSort).toHaveBeenLastCalledWith('players', 'asc');
  });
});

describe('lobbySortBridge', () => {
  it('maps every chip to the heading each tab sorts by', () => {
    expect(headingForOrder('HOLDEM', 'stakes_high')).toEqual({ key: 'stakes', dir: 'desc' });
    expect(headingForOrder('LIMIT', 'stakes_low')).toEqual({ key: 'stakes', dir: 'asc' });
    expect(headingForOrder('SPIN', 'stakes_high')).toEqual({ key: 'buyin', dir: 'desc' });
    expect(headingForOrder('SATELLITE', 'stakes_high')).toEqual({ key: 'buyin', dir: 'desc' });
    expect(headingForOrder('SATELLITE', 'stakes_low')).toEqual({ key: 'buyin', dir: 'asc' });
    expect(headingForOrder('MTT', 'stakes_low')).toEqual({ key: 'buyin', dir: 'asc' });
    expect(headingForOrder('SNG', 'players')).toEqual({ key: 'players', dir: 'desc' });
    expect(headingForOrder('MTT', 'starting_soon')).toBe('reset');
    expect(headingForOrder('OMAHA', 'recommended')).toBe('reset');
    expect(headingForOrder('ALL', 'stakes_high')).toBe('reset');
  });

  it('maps a heading back to the chip that says the same thing, or none', () => {
    expect(orderForHeading('OMAHA', 'stakes', 'desc')).toBe('stakes_high');
    expect(orderForHeading('ALL', 'cost', 'asc')).toBe('stakes_low');
    expect(orderForHeading('SATELLITE', 'buyin', 'desc')).toBe('stakes_high');
    expect(orderForHeading('SATELLITE', 'buyin', 'asc')).toBe('stakes_low');
    expect(orderForHeading('SPIN', 'buyin', 'desc')).toBe('stakes_high');
    expect(orderForHeading('HOLDEM', 'players', 'desc')).toBe('players');
    expect(orderForHeading('MTT', 'starts', 'asc')).toBe('starting_soon');
    expect(orderForHeading('HOLDEM', 'players', 'asc')).toBeNull();
    expect(orderForHeading('OMAHA', 'status', 'desc')).toBeNull();
  });
});

const event = (
  id: string,
  format: string,
  price: number,
  players: number,
  extra: Partial<LobbyTournamentRow> = {}
) =>
  tournamentEntry(
    {
      id,
      name: `Fixture ${id}`,
      game_type: 'NLH',
      buy_in_amount: price,
      buy_in_fee: 0,
      guaranteed_prize: null,
      format_contract: format,
      start_time: new Date(Date.now() + 7_200_000).toISOString(),
      status: 'REGISTERING',
      current_players: players,
      max_players: format.startsWith('mtt') ? null : format === 'spin-v1' ? 3 : 2,
      starting_chips: 1000,
      ...extra,
    },
    format === 'spin-v1' ? 'spin' : format.startsWith('mtt') ? 'mtt' : 'sng'
  );

function tournamentBoard(category: string, rows: LobbyEntry[], preferPageOrder = false) {
  const props = {
    entries: rows,
    category: category as never,
    clubId: 'event-sort-club',
    selectedId: null,
    onSelect: vi.fn(),
    onActivate: vi.fn(),
    ctx,
  };
  const view = render(
    <MemoryRouter>
      <LobbyTable {...props} preferPageOrder={preferPageOrder} />
    </MemoryRouter>
  );
  const press = (key: string, seq: number, pageOrder = preferPageOrder) =>
    view.rerender(
      <MemoryRouter>
        <LobbyTable {...props} preferPageOrder={pageOrder} requestedOrder={{ key, seq }} />
      </MemoryRouter>
    );
  const ids = () =>
    Array.from(document.querySelectorAll('.lobby-table-wrap tbody tr[id]')).map((row) =>
      row.id.replace('lt-row-', '')
    );
  return { press, ids };
}

describe('tournament sheet sort honors its real board', () => {
  it('Satellite price chips sort real event prices in both directions', () => {
    localStorage.clear();
    const rows = [
      event('low', 'seat-first-satellite-v1', 5, 0),
      event('high', 'seat-first-satellite-v1', 50, 1),
      event('mid', 'seat-first-satellite-v1', 20, 0),
    ];
    const { press, ids } = tournamentBoard('SATELLITE', rows);
    press('stakes_high', 1);
    expect(ids()).toEqual(['high', 'mid', 'low']);
    press('stakes_low', 2);
    expect(ids()).toEqual(['low', 'mid', 'high']);
  });

  it.each([
    ['SPIN', 'spin-v1'],
    ['SNG', 'sng-v1'],
    ['SATELLITE', 'seat-first-satellite-v1'],
  ])(
    '%s keeps its untouched Players default but honors explicit page orders',
    (category, format) => {
      localStorage.clear();
      const rows = [event('page-first', format, 5, 0), event('busier', format, 25, 1)];
      const { press, ids } = tournamentBoard(category, rows);
      expect(ids()).toEqual(['busier', 'page-first']);
      press('recommended', 1, true);
      expect(ids()).toEqual(['page-first', 'busier']);
      press('players', 2, true);
      expect(ids()).toEqual(['busier', 'page-first']);
      press('starting_soon', 3, true);
      expect(ids()).toEqual(['page-first', 'busier']);
    }
  );

  it('MTT Starting Time keeps the parent order while ordinary Recommended retains phase order', () => {
    localStorage.clear();
    const rows = [
      event('future', 'mtt-v1', 5, 0),
      event('late-open', 'mtt-v1', 25, 10, {
        status: 'RUNNING',
        started_at: new Date(Date.now() - 60_000).toISOString(),
        start_time: new Date(Date.now() - 60_000).toISOString(),
        late_reg_mins: 120,
        current_level: 0,
        prize_pool_finalized: false,
      }),
    ];
    const { press, ids } = tournamentBoard('MTT', rows);
    expect(ids()).toEqual(['late-open', 'future']);
    press('starting_soon', 1, true);
    expect(ids()).toEqual(['future', 'late-open']);
    press('recommended', 2, false);
    expect(ids()).toEqual(['late-open', 'future']);
  });
});
