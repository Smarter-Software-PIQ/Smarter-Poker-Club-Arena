import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LobbyTable from '../../src/components/lobby/LobbyTable';
import { tournamentEntry, type LobbyTournamentRow } from '../../src/components/lobby/lobbyEntries';

vi.mock('../../src/hooks/useSpinTierAvailability', () => ({
  useSpinTierAvailability: () => ({ can_draw_100x: false }),
}));
vi.mock('../../src/services/tableWarmup', () => ({
  observeLobbyTableWarmups: vi.fn(() => () => {}),
  warmTable: vi.fn(),
}));

beforeEach(() => localStorage.clear());
afterEach(cleanup);
const ctx = {
  waitlistedIds: new Set<string>(),
  seatedIds: new Set<string>(),
  registeredIds: new Set<string>(),
  favoriteIds: new Set<string>(),
};
const categories = ['SPIN', 'SNG', 'SATELLITE'] as const;
function show(category: (typeof categories)[number]) {
  const entry = (id: string, players: number, price: number, running = false) =>
    tournamentEntry(
      {
        id,
        name: id,
        game_type: 'NLH',
        format_contract:
          category === 'SPIN'
            ? 'spin-v1'
            : category === 'SATELLITE'
              ? 'seat-first-satellite-v1'
              : 'sng-v1',
        tournament_type: category,
        current_players: players,
        max_players: 3,
        buy_in_amount: price,
        buy_in_fee: 0,
        status: running ? 'RUNNING' : 'REGISTERING',
      } as LobbyTournamentRow,
      category === 'SPIN' ? 'spin' : 'sng'
    );
  render(
    <MemoryRouter>
      <LobbyTable
        entries={[
          entry('running', 3, 30, true),
          entry('empty', 0, 1),
          entry('one-waiting', 1, 10),
          entry('two-waiting', 2, 100),
        ]}
        category={category}
        clubId="waiting-sort-club"
        selectedId={null}
        onSelect={vi.fn()}
        onActivate={vi.fn()}
        ctx={ctx}
      />
    </MemoryRouter>
  );
}
function order(selector: string) {
  return [...document.querySelectorAll(selector)].map((row) => row.getAttribute('data-id'));
}

describe('waiting games open by actual current players', () => {
  it.each(categories)('%s shows the busiest waiting game first in both layouts', (category) => {
    show(category);
    const expected = ['two-waiting', 'one-waiting', 'empty', 'running'];
    expect(order('.compact-lobby tbody tr[data-id]')).toEqual(expected);
    expect(order('.lobby-table-wrap tbody tr[data-id]')).toEqual(expected);
    expect(
      [...document.querySelectorAll('[role="status"]')].map((node) => node.textContent)
    ).toContain(`Sorted By ${category === 'SATELLITE' ? 'Registered' : 'Players'}, Descending`);
  });

  it.each(categories)('%s preserves an explicit saved buy-in order', (category) => {
    localStorage.setItem(
      `ca_player_preference:guest:lobby:headingSort:${category}:waiting-sort-club`,
      JSON.stringify({ key: 'buyin', dir: 'asc', chosen: true })
    );
    show(category);
    const expected = ['empty', 'one-waiting', 'two-waiting', 'running'];
    expect(order('.compact-lobby tbody tr[data-id]')).toEqual(expected);
    expect(order('.lobby-table-wrap tbody tr[data-id]')).toEqual(expected);
  });
});
