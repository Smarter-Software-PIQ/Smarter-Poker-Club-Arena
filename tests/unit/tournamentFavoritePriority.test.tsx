import { useState } from 'react';
import { cleanup, fireEvent, render, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LobbyTable from '../../src/components/lobby/LobbyTable';
import { prioritizeTournamentFavorites } from '../../src/components/lobby/tournamentFavoriteOrder';
import {
  cashEntry,
  tournamentEntry,
  type LobbyEntry,
  type LobbyTableRow,
  type LobbyTournamentRow,
} from '../../src/components/lobby/lobbyEntries';

vi.mock('../../src/hooks/useSpinTierAvailability', () => ({
  useSpinTierAvailability: () => ({ can_draw_100x: false }),
}));
vi.mock('../../src/services/tableWarmup', () => ({
  observeLobbyTableWarmups: vi.fn(() => () => {}),
  warmTable: vi.fn(),
}));
beforeEach(() => localStorage.clear());
afterEach(cleanup);
const club = 'favorite-priority-club';
function event(id: string, price: number, kind: 'mtt' | 'spin' | 'sng' = 'mtt', featured = false) {
  return tournamentEntry(
    {
      id,
      name: id,
      game_type: 'NLH',
      format_contract: kind === 'mtt' ? 'mtt-v2' : kind === 'spin' ? 'spin-v1' : 'sng-v1',
      current_players: 1,
      max_players: kind === 'mtt' ? null : 3,
      buy_in_amount: price,
      buy_in_fee: 0,
      status: 'REGISTERING',
      start_time: new Date(Date.now() + 60_000).toISOString(),
      is_pinned: featured,
    } as LobbyTournamentRow,
    kind
  );
}
function rememberSort(category: string, key = 'buyin', dir = 'desc') {
  localStorage.setItem(
    `ca_player_preference:guest:lobby:headingSort:${category}:${club}`,
    JSON.stringify({ key, dir, chosen: true })
  );
}
function ids(selector: string) {
  return [...document.querySelectorAll(selector)].map((row) => row.getAttribute('data-id'));
}
function expectOrder(expected: string[]) {
  expect(ids('.compact-lobby tbody tr[data-id]')).toEqual(expected);
  expect(ids('.lobby-table-wrap tbody tr[data-id]')).toEqual(expected);
}
function Board({
  entries,
  category = 'MTT',
  initial = [] as string[],
  onSelect = vi.fn(),
}: {
  entries: LobbyEntry[];
  category?: 'MTT' | 'SPIN' | 'SNG' | 'SATELLITE' | 'HOLDEM';
  initial?: string[];
  onSelect?: ReturnType<typeof vi.fn>;
}) {
  const [favorites, setFavorites] = useState(new Set(initial));
  return (
    <MemoryRouter>
      <button onClick={() => setFavorites(new Set())}>Switch Favorite Owner</button>
      <LobbyTable
        entries={entries}
        category={category}
        clubId={club}
        selectedId={null}
        onSelect={onSelect}
        onActivate={vi.fn()}
        ctx={{
          waitlistedIds: new Set(),
          seatedIds: new Set(),
          registeredIds: new Set(),
          favoriteIds: favorites,
          onToggleFavorite: (id, next) =>
            setFavorites((previous) => {
              const updated = new Set(previous);
              if (next) updated.add(id);
              else updated.delete(id);
              return updated;
            }),
        }}
      />
    </MemoryRouter>
  );
}
function toggle(id: string, label: string, compact = true) {
  const row = document.querySelector(
    `${compact ? '.compact-lobby' : '.lobby-table-wrap'} tbody tr[data-id="${id}"]`
  )!;
  fireEvent.click(within(row as HTMLElement).getByRole('button', { name: label, exact: true }));
}

describe('tournament favorites always follow host pins', () => {
  it('a real star toggle promotes and removes the tournament across both layouts under a chosen sort', () => {
    rememberSort('MTT');
    const onSelect = vi.fn();
    const entries = [
      event('ordinary-high', 100),
      event('favorite-low', 10),
      event('pinned', 1, 'mtt', true),
    ];
    render(<Board entries={entries} onSelect={onSelect} />);
    expectOrder(['pinned', 'ordinary-high', 'favorite-low']);
    toggle('favorite-low', 'Add To Favorites');
    expectOrder(['pinned', 'favorite-low', 'ordinary-high']);
    expect(
      document.querySelectorAll('tr[data-id="favorite-low"] button[aria-pressed="true"]')
    ).toHaveLength(2);
    expect(onSelect).not.toHaveBeenCalled();
    toggle('favorite-low', 'Remove From Favorites', false);
    expectOrder(['pinned', 'ordinary-high', 'favorite-low']);
  });

  it.each(['SPIN', 'SNG', 'SATELLITE'] as const)(
    '%s keeps pins then favorites even under a chosen order',
    (category) => {
      rememberSort(category, 'buyin', 'asc');
      const kind = category === 'SPIN' ? 'spin' : 'sng';
      const favorite = event('favorite-running', 30, kind);
      favorite.status = 'running';
      (favorite.raw as LobbyTournamentRow).status = 'RUNNING';
      render(
        <Board
          category={category}
          initial={['favorite-running']}
          entries={[
            event('ordinary-cheap', 1, kind),
            event('pinned', 100, kind, true),
            favorite,
            event('ordinary-pricey', 10, kind),
          ]}
        />
      );
      expectOrder(['pinned', 'favorite-running', 'ordinary-cheap', 'ordinary-pricey']);
    }
  );

  it('preserves the chosen order within favorite and ordinary tiers and responds to the owner changing', () => {
    rememberSort('MTT');
    render(
      <Board
        initial={['favorite-high', 'favorite-low']}
        entries={[
          event('ordinary-high', 100),
          event('favorite-low', 10),
          event('pinned', 1, 'mtt', true),
          event('favorite-high', 50),
          event('ordinary-low', 5),
        ]}
      />
    );
    expectOrder(['pinned', 'favorite-high', 'favorite-low', 'ordinary-high', 'ordinary-low']);
    fireEvent.click(within(document.body).getByRole('button', { name: 'Switch Favorite Owner' }));
    expectOrder(['pinned', 'ordinary-high', 'favorite-high', 'favorite-low', 'ordinary-low']);
  });

  it('starring a cash game leaves its selected stakes order unchanged', () => {
    rememberSort('HOLDEM', 'stakes');
    const cash = (id: string, stakes: number) =>
      cashEntry({
        id,
        name: id,
        game_variant: 'nlh',
        big_blind: stakes,
        small_blind: stakes / 2,
        current_players: 3,
        max_players: 6,
        status: 'open',
      } as LobbyTableRow);
    render(<Board category="HOLDEM" entries={[cash('cash-low', 1), cash('cash-high', 10)]} />);
    expectOrder(['cash-high', 'cash-low']);
    toggle('cash-low', 'Add To Favorites');
    expectOrder(['cash-high', 'cash-low']);
  });
});

it('the ALL selection retains a low-priced favorite beyond its ten-event cap', () => {
  const ordinary = Array.from({ length: 11 }, (_, index) =>
    event(`ordinary-${index}`, 100 - index)
  );
  const pinned = event('today-pin', 1, 'mtt', true);
  const favorite = event('beyond-the-cap', 1);
  const candidates = [...ordinary, favorite, pinned];
  const selected = prioritizeTournamentFavorites(candidates, new Set([favorite.id])).slice(0, 10);
  expect(selected.map((entry) => entry.id)).toEqual([
    'today-pin',
    'beyond-the-cap',
    ...ordinary.slice(0, 8).map((entry) => entry.id),
  ]);
  expect(candidates.map((entry) => entry.id)).toEqual([
    ...ordinary.map((entry) => entry.id),
    'beyond-the-cap',
    'today-pin',
  ]);
});
